import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'server_id.dart';
import 'sync_service.dart';
import 'sync_settings.dart';
import 'parse/wire.dart';

String? normalizeScanFilename(String? filename) {
  if (filename == null) return null;
  final trimmed = filename.trim();
  if (trimmed.isEmpty) return null;
  if (trimmed == 'Unknown File' || trimmed == 'Scanning...') {
    return null;
  }
  if (trimmed.startsWith('DBG:')) {
    return null;
  }
  return trimmed;
}

String? normalizeScanSessionId(String? sessionId) {
  return ServerId.tryParse(sessionId)?.value;
}

Future<Directory?> _packetsDirectoryFor(
  ServerId serverId, {
  required bool createRoot,
}) async {
  final appDir = await getApplicationDocumentsDirectory();
  if (!await appDir.exists()) return null;

  final canonicalAppRoot = p.normalize(await appDir.resolveSymbolicLinks());
  final intendedRootPath = p.normalize(
    p.join(canonicalAppRoot, 'incomplete_scans'),
  );
  final root = Directory(intendedRootPath);
  if (!await root.exists()) {
    if (!createRoot) {
      return Directory(p.join(root.path, serverId.value));
    }
    await root.create();
  }

  final canonicalRoot = p.normalize(await root.resolveSymbolicLinks());
  if (!p.equals(canonicalRoot, intendedRootPath)) return null;

  final candidatePath = p.normalize(p.join(canonicalRoot, serverId.value));
  if (!p.isWithin(canonicalRoot, candidatePath)) return null;

  final type = await FileSystemEntity.type(candidatePath, followLinks: false);
  if (type != FileSystemEntityType.notFound) {
    if (type != FileSystemEntityType.directory) return null;
    final canonicalCandidate = p.normalize(
      await Directory(candidatePath).resolveSymbolicLinks(),
    );
    if (!p.equals(canonicalCandidate, candidatePath)) return null;
    if (p.basename(canonicalCandidate) != serverId.value) return null;
  }
  return Directory(candidatePath);
}

final RegExp _packetFilenamePattern = RegExp(r'^packet_([0-9]+)\.bin$');

typedef PacketFileWriter =
    Future<void> Function(RandomAccessFile handle, Uint8List bytes);
typedef PacketSessionHook = Future<void> Function(String operation);

Future<void> _defaultPacketFileWriter(
  RandomAccessFile handle,
  Uint8List bytes,
) async {
  await handle.writeFrom(bytes);
}

PacketFileWriter _packetFileWriter = _defaultPacketFileWriter;
PacketSessionHook? _packetSessionHook;
final Map<String, Future<void>> _packetSessionTails = <String, Future<void>>{};

String _packetSessionLockKey(Directory sessionDirectory) {
  final normalized = p.normalize(sessionDirectory.path);
  return Platform.isWindows ? normalized.toLowerCase() : normalized;
}

Future<T> _withPacketSessionLock<T>(
  String key,
  Future<T> Function() action,
) async {
  final previous = _packetSessionTails[key] ?? Future<void>.value();
  final done = Completer<void>();
  final tail = done.future;
  _packetSessionTails[key] = tail;
  await previous;
  try {
    return await action();
  } finally {
    done.complete();
    if (identical(_packetSessionTails[key], tail)) {
      _packetSessionTails.remove(key);
    }
  }
}

Future<({File file, bool existed})?> _packetFileFor(
  Directory sessionDirectory,
  int packetIndex, {
  required bool allowMissing,
}) async {
  if (packetIndex < 0) return null;

  final intendedSessionPath = p.normalize(sessionDirectory.path);
  if (!await sessionDirectory.exists()) return null;
  final canonicalSessionPath = p.normalize(
    await sessionDirectory.resolveSymbolicLinks(),
  );
  if (!p.equals(canonicalSessionPath, intendedSessionPath)) return null;

  final filename = 'packet_$packetIndex.bin';
  if (_packetFilenamePattern.firstMatch(filename)?.group(0) != filename) {
    return null;
  }
  final candidatePath = p.normalize(p.join(canonicalSessionPath, filename));
  if (!p.isWithin(canonicalSessionPath, candidatePath)) return null;

  final type = await FileSystemEntity.type(candidatePath, followLinks: false);
  if (type == FileSystemEntityType.notFound) {
    return allowMissing ? (file: File(candidatePath), existed: false) : null;
  }
  if (type != FileSystemEntityType.file) return null;

  final file = File(candidatePath);
  final canonicalCandidate = p.normalize(await file.resolveSymbolicLinks());
  if (!p.equals(canonicalCandidate, candidatePath)) return null;
  // A hardlink is a regular file with this exact canonical path and cannot be
  // detected portably. Creating or swapping one requires a hostile local
  // filesystem writer, which is the same residual TOCTOU documented at the
  // final path-based read/write. Static symlinks and reparse points are
  // rejected above without following them.
  return (file: file, existed: true);
}

int? _packetIndexFromPath(String path) {
  final basename = p.basename(path);
  final match = _packetFilenamePattern.firstMatch(basename);
  if (match == null) return null;
  final packetIndex = int.tryParse(match.group(1)!);
  if (packetIndex == null || packetIndex < 0) return null;
  return basename == 'packet_$packetIndex.bin' ? packetIndex : null;
}

Future<bool> _containsOnlySafePacketChildren(Directory sessionDirectory) async {
  if (!await sessionDirectory.exists()) return true;
  await for (final entity in sessionDirectory.list(followLinks: false)) {
    final packetIndex = _packetIndexFromPath(entity.path);
    if (packetIndex == null) return false;
    final resolution = await _packetFileFor(
      sessionDirectory,
      packetIndex,
      allowMissing: false,
    );
    if (resolution == null ||
        !p.equals(
          p.normalize(resolution.file.path),
          p.normalize(entity.path),
        )) {
      return false;
    }
  }
  return true;
}

Future<bool> _writePacketFileLocked(
  Directory sessionDirectory,
  int packetIndex,
  Uint8List bytes,
) async {
  final resolution = await _packetFileFor(
    sessionDirectory,
    packetIndex,
    allowMissing: true,
  );
  if (resolution == null) return false;
  // Packet entries are immutable. Duplicate scanner frames keep the first
  // successfully committed packet instead of truncating it in place.
  if (resolution.existed) return false;

  File? stagingFile;
  RandomAccessFile? handle;
  var createdHere = false;
  var committed = false;
  try {
    final canonicalSessionPath = p.normalize(
      await sessionDirectory.resolveSymbolicLinks(),
    );
    for (var attempt = 0; attempt < 8; attempt++) {
      final nonce = Random.secure().nextInt(0x7fffffff);
      final candidate = File(
        p.join(
          canonicalSessionPath,
          '.packet_${packetIndex}_${DateTime.now().microsecondsSinceEpoch}_$nonce.tmp',
        ),
      );
      if (!p.isWithin(canonicalSessionPath, p.normalize(candidate.path))) {
        return false;
      }
      try {
        await candidate.create(exclusive: true);
        stagingFile = candidate;
        createdHere = true;
        break;
      } on FileSystemException {
        continue;
      }
    }
    if (stagingFile == null) return false;

    final stagingType = await FileSystemEntity.type(
      stagingFile.path,
      followLinks: false,
    );
    if (stagingType != FileSystemEntityType.file) return false;
    final canonicalStaging = p.normalize(
      await stagingFile.resolveSymbolicLinks(),
    );
    if (!p.equals(canonicalStaging, p.normalize(stagingFile.path)) ||
        !p.isWithin(canonicalSessionPath, canonicalStaging)) {
      return false;
    }

    handle = await stagingFile.open(mode: FileMode.writeOnly);
    await _packetFileWriter(handle, bytes);
    await handle.flush();
    await handle.close();
    handle = null;

    final finalResolution = await _packetFileFor(
      sessionDirectory,
      packetIndex,
      allowMissing: true,
    );
    if (finalResolution == null || finalResolution.existed) return false;
    await stagingFile.rename(finalResolution.file.path);
    committed = true;
    return true;
  } finally {
    try {
      await handle?.close();
    } catch (_) {}
    if (createdHere && !committed && stagingFile != null) {
      final type = await FileSystemEntity.type(
        stagingFile.path,
        followLinks: false,
      );
      if (type == FileSystemEntityType.file) {
        final canonicalStaging = p.normalize(
          await stagingFile.resolveSymbolicLinks(),
        );
        final canonicalSessionPath = p.normalize(
          await sessionDirectory.resolveSymbolicLinks(),
        );
        if (p.equals(canonicalStaging, p.normalize(stagingFile.path)) &&
            p.isWithin(canonicalSessionPath, canonicalStaging)) {
          await stagingFile.delete();
        }
      }
    }
  }
}

String formatScanDisplayName(String id) {
  final trimmed = id.trim();
  if (trimmed.isEmpty) {
    return 'Scan';
  }
  if (trimmed.startsWith('scan_') && trimmed.length > 5) {
    final timestampPart = trimmed.substring(5);
    final displayPart = timestampPart.length > 13
        ? timestampPart.substring(0, 13)
        : timestampPart;
    return 'Scan $displayPart';
  }
  if (trimmed.startsWith('DBG:')) {
    final match = RegExp(r'TS=([0-9]{5,})').firstMatch(trimmed);
    if (match != null) {
      return 'Scan ${match.group(1)}';
    }
    return 'Scan';
  }
  return 'Scan $trimmed';
}

String resolveScanDisplayName(String? filename, String id) {
  final normalized = normalizeScanFilename(filename);
  if (normalized != null) return normalized;
  return formatScanDisplayName(id);
}

int _toInt(Object? value, [int fallback = 0]) {
  return asWireInt(value) ?? fallback;
}

double _toDouble(Object? value, [double fallback = 0.0]) {
  return asWireDouble(value) ?? fallback;
}

int _decodeThresholdFromServerJson(WireObject json) {
  final scanState = asWireObject(json['scanState']);
  final threshold = _toInt(scanState['decodeThreshold']);
  if (threshold > 0) return threshold;
  return _toInt(
    json['decodeThreshold'] ?? json['expectedPackets'] ?? json['totalPackets'],
    100,
  );
}

double normalizeIncompleteProgress(double value) {
  if (!value.isFinite || value <= 0) return 0.0;
  return min(0.999, max(0.0, value));
}

String formatIncompleteProgressPercent(double progress) {
  final percent =
      (normalizeIncompleteProgress(progress) * 1000).floorToDouble() / 10;
  if (percent == percent.truncateToDouble()) {
    return percent.toInt().toString();
  }
  return percent.toStringAsFixed(1);
}

/// Represents an incomplete scan session that can be resumed
class IncompleteScan {
  final String id; // Unique identifier for this scan session
  final int startTimestamp;
  final int lastUpdateTimestamp;
  final double progress;
  final int receivedPackets;
  final int expectedPackets;
  final String? filename;
  final bool isRemote; // True if this scan is from the server
  final String? deviceId;
  final String? deviceName;
  final int? serverReceivedPackets;
  final int? serverExpectedPackets;

  IncompleteScan({
    required this.id,
    required this.startTimestamp,
    required this.lastUpdateTimestamp,
    required this.progress,
    required this.receivedPackets,
    required this.expectedPackets,
    this.filename,
    this.isRemote = false,
    this.deviceId,
    this.deviceName,
    this.serverReceivedPackets,
    this.serverExpectedPackets,
  });

  WireObject toJson() => {
    'id': id,
    'startTimestamp': startTimestamp,
    'lastUpdateTimestamp': lastUpdateTimestamp,
    'progress': progress,
    'receivedPackets': receivedPackets,
    'expectedPackets': expectedPackets,
    'filename': filename,
    'isRemote': isRemote,
    'deviceId': deviceId,
    'deviceName': deviceName,
    'serverReceivedPackets': serverReceivedPackets,
    'serverExpectedPackets': serverExpectedPackets,
  };

  factory IncompleteScan.fromJson(Object? json) {
    final object = asWireObject(json);
    final serverId = ServerId.tryParse(object['id']);
    if (serverId == null) {
      throw const FormatException('Invalid local incomplete scan identifier');
    }
    final startTimestamp = asWireInt(object['startTimestamp']);
    final lastUpdateTimestamp = asWireInt(object['lastUpdateTimestamp']);
    final progress = asWireDouble(object['progress']);
    final receivedPackets = asWireInt(object['receivedPackets']);
    final expectedPackets = asWireInt(object['expectedPackets']);
    if (startTimestamp == null ||
        lastUpdateTimestamp == null ||
        progress == null ||
        receivedPackets == null ||
        expectedPackets == null) {
      throw const FormatException('Invalid local incomplete scan');
    }
    return IncompleteScan(
      id: serverId.value,
      startTimestamp: startTimestamp,
      lastUpdateTimestamp: lastUpdateTimestamp,
      progress: progress,
      receivedPackets: receivedPackets,
      expectedPackets: expectedPackets,
      filename: asWireString(object['filename']),
      isRemote: asWireBool(object['isRemote']) ?? false,
      deviceId: asWireString(object['deviceId']),
      deviceName: asWireString(object['deviceName']),
      serverReceivedPackets: asWireInt(object['serverReceivedPackets']),
      serverExpectedPackets: asWireInt(object['serverExpectedPackets']),
    );
  }

  /// Create from server response
  factory IncompleteScan.fromServerJson(Object? json) {
    final object = asWireObject(json);
    final serverId = ServerId.tryParseAliases(
      object,
      keys: const <String>['id', 'sessionId'],
    );
    if (serverId == null) {
      throw const FormatException('Invalid remote incomplete scan identifier');
    }
    var startTs = DateTime.now().millisecondsSinceEpoch;
    var lastTs = startTs;

    final createdAt = asWireDateTime(object['createdAt']);
    if (createdAt != null) {
      startTs = createdAt.millisecondsSinceEpoch;
    }
    final updatedAt = asWireDateTime(object['updatedAt']);
    if (updatedAt != null) {
      lastTs = updatedAt.millisecondsSinceEpoch;
    }

    final received = _toInt(
      object['receivedPackets'] ??
          object['receivedCount'] ??
          object['packetCount'],
    );
    final expected = _decodeThresholdFromServerJson(object);
    final rawCompletionPercent = _toDouble(
      object['completionPercent'] ?? object['progressPercent'],
      -1,
    );
    final progress = rawCompletionPercent >= 0
        ? normalizeIncompleteProgress(rawCompletionPercent / 100)
        : expected > 0
        ? normalizeIncompleteProgress(received / expected)
        : 0.0;

    return IncompleteScan(
      id: serverId.value,
      startTimestamp: startTs,
      lastUpdateTimestamp: lastTs,
      progress: progress.toDouble(),
      receivedPackets: received,
      expectedPackets: expected,
      filename: normalizeScanFilename(asWireString(object['filename'])),
      isRemote: true,
      deviceId: asWireString(object['deviceId']),
      deviceName: asWireString(object['deviceName']),
      serverReceivedPackets: received,
      serverExpectedPackets: expected,
    );
  }

  /// Get the directory path for storing this scan's packets
  Future<String> get packetsDirectory async {
    final serverId = ServerId.tryParse(id);
    if (serverId == null) {
      throw FileSystemException('Invalid incomplete scan identifier', id);
    }
    final directory = await _packetsDirectoryFor(serverId, createRoot: false);
    if (directory == null) {
      throw FileSystemException('Unsafe incomplete scan directory', id);
    }
    return directory.path;
  }
}

/// Service for managing incomplete scans
class IncompleteScanService {
  static const String _key = 'airqr_incomplete_scans';
  static const int _packetUploadMaxAttempts = 4;
  static const int _packetUploadBaseDelayMs = 250;
  static String? _currentScanId;

  @visibleForTesting
  static void setPacketFileWriterForTesting(PacketFileWriter? writer) {
    _packetFileWriter = writer ?? _defaultPacketFileWriter;
  }

  @visibleForTesting
  static void setPacketSessionHookForTesting(PacketSessionHook? hook) {
    _packetSessionHook = hook;
  }

  /// Get all incomplete scans (local only)
  static Future<List<IncompleteScan>> getAll() async {
    final prefs = await SharedPreferences.getInstance();
    final String? jsonString = prefs.getString(_key);
    if (jsonString == null) return [];

    final decoded = parseJsonText(jsonString);
    final jsonList = tryWireList(decoded);
    if (jsonList == null) return [];
    return jsonList.map(IncompleteScan.fromJson).toList();
  }

  /// Get a specific incomplete scan by ID
  static Future<IncompleteScan?> getById(String scanId) async {
    final serverId = ServerId.tryParse(scanId);
    if (serverId == null) return null;
    final list = await getAll();
    try {
      return list.firstWhere((s) => s.id == serverId.value);
    } catch (e) {
      return null;
    }
  }

  /// Get all incomplete scans including remote ones from server
  static Future<List<IncompleteScan>> getAllWithRemote() async {
    final localScans = await getAll();

    // Fetch remote scans
    final settings = await SyncSettingsService.load();
    if (!settings.isConfigured || !settings.syncScanned) {
      return localScans;
    }

    try {
      // Clean up local scans that have been completed on server
      final scansToRemove = <String>[];
      for (final localScan in localScans) {
        // Check if this scan was completed on the server
        final isCompleted = await SyncService.isSessionCompleted(localScan.id);
        if (isCompleted) {
          scansToRemove.add(localScan.id);
          debugPrint(
            '✓ Scan ${localScan.id} completed on server, removing locally',
          );
        }
      }

      // Remove completed scans from local storage
      for (final scanId in scansToRemove) {
        await remove(scanId);
      }

      // Refresh local scans after cleanup
      final updatedLocalScans = await getAll();

      // Fetch remote incomplete scans (only those NOT completed)
      final remoteScansJson = await SyncService.fetchIncompleteScans();
      final remoteOrder = <String>[];
      final remoteById = <String, IncompleteScan>{};

      for (final json in remoteScansJson) {
        if (json['completed'] == true) continue;
        final scan = IncompleteScan.fromServerJson(json);
        remoteOrder.add(scan.id);
        remoteById[scan.id] = scan;
      }

      final mergedLocalScans = <IncompleteScan>[];
      var localChanged = false;

      for (final localScan in updatedLocalScans) {
        final remoteScan = remoteById.remove(localScan.id);
        if (remoteScan == null) {
          mergedLocalScans.add(localScan);
          continue;
        }
        localChanged = true;
        mergedLocalScans.add(_mergeScans(localScan, remoteScan));
      }

      if (localChanged) {
        await _save(mergedLocalScans);
      }

      final remoteOnly = <IncompleteScan>[];
      for (final id in remoteOrder) {
        final remote = remoteById[id];
        if (remote != null) {
          remoteOnly.add(remote);
        }
      }

      // Merge: local first, then remote-only
      return [...mergedLocalScans, ...remoteOnly];
    } catch (e) {
      debugPrint('Error fetching remote scans: $e');
      return localScans;
    }
  }

  static IncompleteScan _mergeScans(
    IncompleteScan localScan,
    IncompleteScan remoteScan,
  ) {
    final mergedExpected = max(
      localScan.expectedPackets,
      remoteScan.expectedPackets,
    );
    final mergedReceived = max(
      localScan.receivedPackets,
      remoteScan.receivedPackets,
    );
    final mergedProgress = mergedExpected > 0
        ? mergedReceived / mergedExpected
        : max(localScan.progress, remoteScan.progress);

    return IncompleteScan(
      id: localScan.id,
      startTimestamp: min(localScan.startTimestamp, remoteScan.startTimestamp),
      lastUpdateTimestamp: max(
        localScan.lastUpdateTimestamp,
        remoteScan.lastUpdateTimestamp,
      ),
      progress: normalizeIncompleteProgress(mergedProgress),
      receivedPackets: mergedReceived,
      expectedPackets: mergedExpected,
      filename: remoteScan.filename ?? localScan.filename,
      isRemote: true,
      deviceId: remoteScan.deviceId ?? localScan.deviceId,
      deviceName: remoteScan.deviceName ?? localScan.deviceName,
      serverReceivedPackets: remoteScan.receivedPackets,
      serverExpectedPackets: remoteScan.expectedPackets,
    );
  }

  /// Get packets for a scan - from local or server
  static Future<List<Uint8List>> getPacketsWithRemote(String scanId) async {
    final serverId = ServerId.tryParse(scanId);
    if (serverId == null) return [];
    // Try local first
    final localPackets = await getPackets(serverId.value);
    if (localPackets.isNotEmpty) {
      debugPrint(
        'getPacketsWithRemote: Found ${localPackets.length} local packets for $scanId',
      );
      return localPackets;
    }

    debugPrint(
      'getPacketsWithRemote: No local packets for $scanId, trying server...',
    );

    // Try server
    final settings = await SyncSettingsService.load();
    if (!settings.isConfigured) {
      debugPrint(
        'getPacketsWithRemote: Sync not configured, cannot fetch from server',
      );
      return [];
    }

    try {
      final remotePackets = await SyncService.downloadPackets(serverId.value);
      debugPrint(
        'getPacketsWithRemote: Downloaded ${remotePackets.length} packets from server for $scanId',
      );
      return remotePackets.map((p) => Uint8List.fromList(p)).toList();
    } catch (e) {
      debugPrint('Error downloading remote packets: $e');
      return [];
    }
  }

  /// Upload packet to server if sync is enabled
  static Future<bool> uploadPacketToServer({
    required String sessionId,
    required Uint8List packetData,
    String? filename,
    String? resultType,
    int? receivedPackets,
    int? expectedPackets,
    String? deviceId,
    String? deviceName,
  }) async {
    final serverId = ServerId.tryParse(sessionId);
    if (serverId == null) return false;
    final settings = await SyncSettingsService.load();
    // Packet sync must stay live even when autoSync is disabled.
    // `autoSync` is meant for background/history sync, not realtime scanner packets.
    if (!settings.isConfigured) {
      debugPrint('uploadPacketToServer: skipped (sync not configured)');
      return false;
    }
    if (!settings.syncScanned) {
      debugPrint('uploadPacketToServer: skipped (syncScanned disabled)');
      return false;
    }

    final safeFilename = normalizeScanFilename(filename);
    for (int attempt = 1; attempt <= _packetUploadMaxAttempts; attempt++) {
      final ok = await SyncService.uploadPacket(
        sessionId: serverId.value,
        packetBytes: packetData,
        filename: safeFilename,
        resultType: resultType,
        receivedPackets: receivedPackets,
        expectedPackets: expectedPackets,
        deviceId: deviceId,
        deviceName: deviceName,
      );
      if (ok) return true;

      if (attempt < _packetUploadMaxAttempts) {
        final delayMs = _packetUploadBaseDelayMs * (1 << (attempt - 1));
        debugPrint(
          'uploadPacketToServer: retry $attempt/${_packetUploadMaxAttempts - 1} for session=$sessionId in ${delayMs}ms',
        );
        await Future<void>.delayed(Duration(milliseconds: delayMs));
      }
    }
    return false;
  }

  /// Start a new incomplete scan session
  static Future<String> startNewSession({String? sessionId}) async {
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    // Keep non-streaming IDs consistent with web app (milliseconds timestamp as string).
    final generatedId = ServerId.tryFromPositiveInt(timestamp)!;
    final serverId = ServerId.tryParse(sessionId) ?? generatedId;
    _currentScanId = serverId.value;
    debugPrint('🆕 SCAN_LOG: startNewSession created $_currentScanId');

    final dir = await _packetsDirectoryFor(serverId, createRoot: true);
    if (dir == null) {
      _currentScanId = null;
      throw FileSystemException(
        'Unsafe incomplete scan directory',
        serverId.value,
      );
    }
    await dir.create(recursive: true);

    return _currentScanId!;
  }

  /// Save a packet for the current scan session
  static Future<void> savePacket(int packetIndex, Uint8List packetData) async {
    final currentScanId = _currentScanId;
    if (currentScanId == null) return;
    final serverId = ServerId.tryParse(currentScanId);
    if (serverId == null) return;
    final bytes = Uint8List.fromList(packetData);

    try {
      final lockDirectory = await _packetsDirectoryFor(
        serverId,
        createRoot: false,
      );
      if (lockDirectory == null) return;
      await _withPacketSessionLock<void>(
        _packetSessionLockKey(lockDirectory),
        () async {
          if (_currentScanId != currentScanId) return;
          final dir = await _packetsDirectoryFor(serverId, createRoot: true);
          if (dir == null) return;
          await dir.create(recursive: true);
          await _writePacketFileLocked(dir, packetIndex, bytes);
        },
      );
    } catch (e, stackTrace) {
      // Local persistence should never block live scan upload/progress.
      debugPrint(
        '⚠️ SCAN_LOG: savePacket failed for session=$_currentScanId packet=$packetIndex error=$e',
      );
      debugPrint('⚠️ SCAN_LOG: savePacket stack: $stackTrace');
    }
  }

  /// Update the progress of current scan
  static Future<void> updateProgress({
    required double progress,
    required int receivedPackets,
    required int expectedPackets,
    String? filename,
  }) async {
    if (_currentScanId == null) return;

    final list = await getAll();
    final timestamp = DateTime.now().millisecondsSinceEpoch;

    final existingScan = list.firstWhere(
      (s) => s.id == _currentScanId,
      orElse: () => IncompleteScan(
        id: _currentScanId!,
        startTimestamp: timestamp,
        lastUpdateTimestamp: timestamp,
        progress: 0.0,
        receivedPackets: 0,
        expectedPackets: 0,
      ),
    );

    list.removeWhere((s) => s.id == _currentScanId);

    final safeFilename =
        normalizeScanFilename(filename) ?? existingScan.filename;

    list.insert(
      0,
      IncompleteScan(
        id: _currentScanId!,
        startTimestamp: existingScan.startTimestamp,
        lastUpdateTimestamp: timestamp,
        progress: normalizeIncompleteProgress(progress),
        receivedPackets: receivedPackets,
        expectedPackets: expectedPackets,
        filename: safeFilename,
        serverReceivedPackets: existingScan.serverReceivedPackets,
        serverExpectedPackets: existingScan.serverExpectedPackets,
      ),
    );

    await _save(list);
  }

  /// Get all saved packets for a scan session
  static Future<List<Uint8List>> getPackets(String scanId) async {
    final serverId = ServerId.tryParse(scanId);
    if (serverId == null) return [];
    final dir = await _packetsDirectoryFor(serverId, createRoot: false);
    if (dir == null) return [];

    return _withPacketSessionLock<List<Uint8List>>(
      _packetSessionLockKey(dir),
      () async {
        final validatedDir = await _packetsDirectoryFor(
          serverId,
          createRoot: false,
        );
        if (validatedDir == null) return <Uint8List>[];
        return _getPacketsLocked(validatedDir);
      },
    );
  }

  static Future<List<Uint8List>> _getPacketsLocked(Directory dir) async {
    if (!await dir.exists()) return [];

    final files = await dir.list(followLinks: false).toList();
    final packets = <Uint8List>[];

    for (final entity in files) {
      final packetIndex = _packetIndexFromPath(entity.path);
      if (packetIndex == null) continue;
      final resolution = await _packetFileFor(
        dir,
        packetIndex,
        allowMissing: false,
      );
      if (resolution == null) continue;
      // As with regular-file updates, Dart cannot hold a no-follow handle
      // across this read; a hostile local replacement after validation is an
      // unavoidable TOCTOU. Static symlinks and reparse points are rejected;
      // hardlinks require the same out-of-scope hostile local writer.
      final data = await resolution.file.readAsBytes();
      packets.add(data);
    }

    return packets;
  }

  /// Resume a scan session
  static Future<void> resumeSession(String scanId) async {
    final serverId = ServerId.tryParse(scanId);
    if (serverId == null) return;
    try {
      final dir = await _packetsDirectoryFor(serverId, createRoot: true);
      if (dir == null) return;
      await dir.create(recursive: true);
      _currentScanId = serverId.value;
    } catch (e) {
      debugPrint(
        '⚠️ SCAN_LOG: resumeSession failed to prepare packet dir for $scanId: $e',
      );
    }
  }

  /// Complete the current scan (remove from incomplete list)
  static Future<void> completeCurrentScan() async {
    debugPrint(
      '🏁 SCAN_LOG: completeCurrentScan called, _currentScanId=$_currentScanId',
    );
    if (_currentScanId == null) {
      debugPrint('🏁 SCAN_LOG: _currentScanId is null, returning early!');
      return;
    }

    debugPrint(
      '🏁 SCAN_LOG: Removing scan $_currentScanId from incomplete list',
    );
    await remove(_currentScanId!);
    debugPrint('🏁 SCAN_LOG: Scan removed, setting _currentScanId to null');
    _currentScanId = null;
  }

  /// Remove an incomplete scan
  static Future<void> remove(String scanId) async {
    debugPrint('🗑️ SCAN_LOG: remove($scanId) called');
    final serverId = ServerId.tryParse(scanId);
    if (serverId == null) return;
    final list = await getAll();
    debugPrint(
      '🗑️ SCAN_LOG: Current incomplete scans: ${list.map((s) => s.id).toList()}',
    );
    final beforeCount = list.length;
    list.removeWhere((s) => s.id == serverId.value);
    debugPrint(
      '🗑️ SCAN_LOG: Removed ${beforeCount - list.length} scans, remaining: ${list.length}',
    );
    await _save(list);

    // Delete the packets directory
    final dir = await _packetsDirectoryFor(serverId, createRoot: false);
    if (dir == null) return;
    await _withPacketSessionLock<void>(_packetSessionLockKey(dir), () async {
      if (_currentScanId == serverId.value) _currentScanId = null;
      final validatedDir = await _packetsDirectoryFor(
        serverId,
        createRoot: false,
      );
      if (validatedDir == null || !await validatedDir.exists()) return;
      if (!await _containsOnlySafePacketChildren(validatedDir)) return;
      debugPrint(
        '🗑️ SCAN_LOG: Deleting packets directory: ${validatedDir.path}',
      );
      await validatedDir.delete(recursive: true);
      await _packetSessionHook?.call('remove');
    });
  }

  /// Persist metadata for an incomplete scan as local-only.
  static Future<void> keepLocalCopy(IncompleteScan scan) async {
    final serverId = ServerId.tryParse(scan.id);
    if (serverId == null) return;
    final list = await getAll();
    list.removeWhere((s) => s.id == serverId.value);
    list.insert(
      0,
      IncompleteScan(
        id: serverId.value,
        startTimestamp: scan.startTimestamp,
        lastUpdateTimestamp: scan.lastUpdateTimestamp,
        progress: scan.progress,
        receivedPackets: scan.receivedPackets,
        expectedPackets: scan.expectedPackets,
        filename: scan.filename,
        isRemote: false,
        deviceId: scan.deviceId,
        deviceName: scan.deviceName,
      ),
    );
    await _save(list);
  }

  /// Replaces the local packet cache for a scan.
  static Future<void> replacePackets(
    String scanId,
    Iterable<List<int>> packets,
  ) async {
    final serverId = ServerId.tryParse(scanId);
    if (serverId == null) return;
    final materializedPackets = packets
        .map<Uint8List>(Uint8List.fromList)
        .toList(growable: false);
    final dir = await _packetsDirectoryFor(serverId, createRoot: true);
    if (dir == null) return;
    await _packetSessionHook?.call('replace-prelock');
    await _withPacketSessionLock<void>(_packetSessionLockKey(dir), () async {
      await _packetSessionHook?.call('replace');
      final validatedDir = await _packetsDirectoryFor(
        serverId,
        createRoot: true,
      );
      if (validatedDir == null) return;
      if (await validatedDir.exists()) {
        if (!await _containsOnlySafePacketChildren(validatedDir)) return;
        await validatedDir.delete(recursive: true);
      }
      await validatedDir.create(recursive: true);

      for (var index = 0; index < materializedPackets.length; index++) {
        final written = await _writePacketFileLocked(
          validatedDir,
          index,
          materializedPackets[index],
        );
        if (!written) return;
      }
    });
  }

  /// Save the list of incomplete scans
  static Future<void> _save(List<IncompleteScan> list) async {
    final prefs = await SharedPreferences.getInstance();
    final String jsonString = jsonEncode(list.map((e) => e.toJson()).toList());
    await prefs.setString(_key, jsonString);
  }

  /// Get current scan ID
  static String? get currentScanId => _currentScanId;

  /// Clear current scan ID (when starting fresh scan)
  static void clearCurrentScan() {
    _currentScanId = null;
  }
}
