import 'history_item.dart';
import 'incomplete_scans.dart';
import 'history_service.dart';
import 'sync_service.dart';
import 'sync_settings.dart';
import 'safe_local_file_writer.dart';
import 'server_history_item.dart';
import 'server_id.dart';
import 'parse/wire.dart';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class HistoryPageSnapshot {
  final List<HistoryItem> items;
  final List<IncompleteScan> incompleteScans;
  final bool syncEnabled;

  const HistoryPageSnapshot({
    required this.items,
    required this.incompleteScans,
    required this.syncEnabled,
  });
}

enum HistoryCompletedScanDownloadStatus { downloaded, missingSessionId, failed }

class HistoryCompletedScanDownloadResult {
  final HistoryCompletedScanDownloadStatus status;
  final String? sessionId;
  final String? filename;
  final Object? error;

  const HistoryCompletedScanDownloadResult._({
    required this.status,
    this.sessionId,
    this.filename,
    this.error,
  });

  factory HistoryCompletedScanDownloadResult.downloaded({
    required String sessionId,
    String? filename,
  }) {
    return HistoryCompletedScanDownloadResult._(
      status: HistoryCompletedScanDownloadStatus.downloaded,
      sessionId: sessionId,
      filename: filename,
    );
  }

  factory HistoryCompletedScanDownloadResult.missingSessionId() {
    return const HistoryCompletedScanDownloadResult._(
      status: HistoryCompletedScanDownloadStatus.missingSessionId,
    );
  }

  factory HistoryCompletedScanDownloadResult.failed(Object error) {
    return HistoryCompletedScanDownloadResult._(
      status: HistoryCompletedScanDownloadStatus.failed,
      error: error,
    );
  }
}

enum HistoryMaterializationStatus { materialized, alreadyLocal, failed }

class HistoryMaterializationResult {
  final HistoryMaterializationStatus status;
  final HistoryItem? item;
  final Object? error;

  const HistoryMaterializationResult._(this.status, {this.item, this.error});

  factory HistoryMaterializationResult.materialized(HistoryItem item) =>
      HistoryMaterializationResult._(
        HistoryMaterializationStatus.materialized,
        item: item,
      );

  factory HistoryMaterializationResult.alreadyLocal(HistoryItem item) =>
      HistoryMaterializationResult._(
        HistoryMaterializationStatus.alreadyLocal,
        item: item,
      );

  factory HistoryMaterializationResult.failed(Object error) =>
      HistoryMaterializationResult._(
        HistoryMaterializationStatus.failed,
        error: error,
      );
}

typedef HistoryRemoteFileDownloader =
    Future<List<int>?> Function({required String id, required String origin});
typedef HistoryDocumentsDirectoryProvider = Future<Directory> Function();
typedef HistoryIncompleteScanLoader = Future<List<IncompleteScan>> Function();

class HistoryPageRefreshController {
  static const int remoteHistoryLimit = 500;

  final Duration syncInterval;
  final Future<SyncResult> Function() _syncAll;
  final Future<ServerHistoryFetchResult> Function() _fetchServerHistory;
  final HistoryRemoteFileDownloader _downloadFile;
  final HistoryDocumentsDirectoryProvider _documentsDirectory;
  final HistoryIncompleteScanLoader _loadIncompleteScans;
  final Map<String, Future<HistoryMaterializationResult>> _materializations =
      <String, Future<HistoryMaterializationResult>>{};
  final Map<String, int> _materializationGenerations = <String, int>{};
  DateTime? _lastSyncTime;

  HistoryPageRefreshController({
    this.syncInterval = const Duration(seconds: 10),
    Future<SyncResult> Function()? syncAll,
    Future<ServerHistoryFetchResult> Function()? fetchServerHistory,
    HistoryRemoteFileDownloader? downloadFile,
    HistoryDocumentsDirectoryProvider? documentsDirectory,
    HistoryIncompleteScanLoader? loadIncompleteScans,
  }) : _syncAll = syncAll ?? SyncService.syncAll,
       _fetchServerHistory =
           fetchServerHistory ??
           (() => SyncService.fetchServerHistory(limit: remoteHistoryLimit)),
       _downloadFile = downloadFile ?? SyncService.downloadFile,
       _documentsDirectory =
           documentsDirectory ?? getApplicationDocumentsDirectory,
       _loadIncompleteScans =
           loadIncompleteScans ?? IncompleteScanService.getAllWithRemote;

  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async {
    final settings = await SyncSettingsService.load();
    final syncEnabled = settings.isConfigured && settings.enabled;

    if (syncEnabled && forceSync) {
      final now = DateTime.now();
      final shouldSync =
          _lastSyncTime == null ||
          now.difference(_lastSyncTime!) > syncInterval;

      if (shouldSync) {
        _lastSyncTime = now;
        await _syncAll();
      }
    }

    final localItems = await HistoryService.getHistory();
    var items = localItems;
    var unifiedServerItems = const <ServerHistoryItem>[];
    if (syncEnabled) {
      try {
        final remoteResult = await _fetchServerHistory();
        if (remoteResult is ServerHistorySnapshot) {
          unifiedServerItems = remoteResult.items;
          items = _mergeCompletedServerItems(localItems, remoteResult.items);
        }
      } catch (error) {
        debugPrint('History refresh failed: $error');
      }
    }
    final serviceIncompleteScans = await _loadIncompleteScans();
    final incompleteScans = _mergeIncompleteServerItems(
      serviceIncompleteScans,
      unifiedServerItems,
    );

    return HistoryPageSnapshot(
      items: items,
      incompleteScans: incompleteScans,
      syncEnabled: syncEnabled,
    );
  }

  static List<HistoryItem> _mergeCompletedServerItems(
    List<HistoryItem> localItems,
    List<ServerHistoryItem> serverItems,
  ) {
    final merged = <HistoryItem>[];
    final knownServerIdentities = <String>{};

    for (final localItem in localItems) {
      final serverId = localItem.serverId;
      if (serverId != null &&
          serverId.isNotEmpty &&
          !knownServerIdentities.add(
            _serverIdentity(localItem.origin, serverId),
          )) {
        continue;
      }
      merged.add(localItem);
    }

    for (final serverItem in serverItems) {
      if (!serverItem.completed) continue;
      final serverId = serverItem.id.value;
      if (!knownServerIdentities.add(
        _serverIdentity(serverItem.originValue, serverId),
      )) {
        continue;
      }
      merged.add(
        HistoryItem(
          path:
              'airqr-remote://${serverItem.originValue}/$serverId/'
              '${SafeLocalFileWriter.safeBasename(serverItem.filename ?? serverId)}',
          timestamp: serverItem.effectiveTimestamp?.millisecondsSinceEpoch ?? 0,
          size: serverItem.size,
          origin: serverItem.originValue,
          mimeType: serverItem.mimeType,
          totalFrames: serverItem.totalFrames,
          minFrames: serverItem.minFrames,
          chunkMinFrames: serverItem.chunkMinFrames,
          isSynced: true,
          serverId: serverId,
        ),
      );
    }

    return merged;
  }

  static List<IncompleteScan> _mergeIncompleteServerItems(
    List<IncompleteScan> serviceItems,
    List<ServerHistoryItem> serverItems,
  ) {
    final remoteById = <String, IncompleteScan>{};
    for (final serverItem in serverItems) {
      final remote = _toIncompleteScan(serverItem);
      if (remote == null) continue;
      final existing = remoteById[remote.id];
      remoteById[remote.id] = existing == null
          ? remote
          : _mergeIncompleteScan(existing, remote);
    }

    final serviceOrder = <String>[];
    final serviceById = <String, IncompleteScan>{};
    for (final serviceItem in serviceItems) {
      final existing = serviceById[serviceItem.id];
      if (existing == null) {
        serviceOrder.add(serviceItem.id);
        serviceById[serviceItem.id] = serviceItem;
      } else {
        serviceById[serviceItem.id] = _mergeIncompleteScan(
          existing,
          serviceItem,
        );
      }
    }

    final merged = <IncompleteScan>[];
    for (final id in serviceOrder) {
      final serviceItem = serviceById[id]!;
      final remote = remoteById.remove(id);
      merged.add(
        remote == null
            ? serviceItem
            : _mergeIncompleteScan(serviceItem, remote),
      );
    }
    merged.addAll(remoteById.values);
    return merged;
  }

  static IncompleteScan _mergeIncompleteScan(
    IncompleteScan preferred,
    IncompleteScan other,
  ) {
    final received = preferred.receivedPackets >= other.receivedPackets
        ? preferred.receivedPackets
        : other.receivedPackets;
    final expected = preferred.expectedPackets >= other.expectedPackets
        ? preferred.expectedPackets
        : other.expectedPackets;
    final progress = expected > 0
        ? received / expected
        : preferred.progress >= other.progress
        ? preferred.progress
        : other.progress;
    return IncompleteScan(
      id: preferred.id,
      startTimestamp: preferred.startTimestamp <= other.startTimestamp
          ? preferred.startTimestamp
          : other.startTimestamp,
      lastUpdateTimestamp:
          preferred.lastUpdateTimestamp >= other.lastUpdateTimestamp
          ? preferred.lastUpdateTimestamp
          : other.lastUpdateTimestamp,
      progress: normalizeIncompleteProgress(progress),
      receivedPackets: received,
      expectedPackets: expected,
      filename: preferred.filename ?? other.filename,
      isRemote: preferred.isRemote || other.isRemote,
      deviceId: preferred.deviceId ?? other.deviceId,
      deviceName: preferred.deviceName ?? other.deviceName,
      serverReceivedPackets:
          preferred.serverReceivedPackets ?? other.serverReceivedPackets,
      serverExpectedPackets:
          preferred.serverExpectedPackets ?? other.serverExpectedPackets,
    );
  }

  static IncompleteScan? _toIncompleteScan(ServerHistoryItem item) {
    if (item.origin != ServerHistoryOrigin.scanned || item.completed) {
      return null;
    }
    final start =
        item.createdAt ??
        item.updatedAt ??
        DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
    final last = item.updatedAt ?? item.createdAt ?? start;
    return IncompleteScan(
      id: item.id.value,
      startTimestamp: start.toUtc().millisecondsSinceEpoch,
      lastUpdateTimestamp: last.toUtc().millisecondsSinceEpoch,
      progress: normalizeIncompleteProgress(item.progress),
      receivedPackets: item.receivedPackets,
      expectedPackets: item.expectedPackets,
      filename: normalizeScanFilename(item.filename),
      isRemote: true,
      deviceId: item.deviceId,
      deviceName: item.deviceName,
      serverReceivedPackets: item.receivedPackets,
      serverExpectedPackets: item.expectedPackets,
    );
  }

  Future<HistoryMaterializationResult> materializeRemoteItem(HistoryItem item) {
    final remoteUri = Uri.tryParse(item.path);
    if (remoteUri?.scheme != 'airqr-remote') {
      return Future<HistoryMaterializationResult>.value(
        HistoryMaterializationResult.alreadyLocal(item),
      );
    }

    final serverId = ServerId.tryParse(item.serverId);
    if (serverId == null) {
      return Future<HistoryMaterializationResult>.value(
        HistoryMaterializationResult.failed('Invalid server ID'),
      );
    }
    if (item.origin != 'scanned' && item.origin != 'generated') {
      return Future<HistoryMaterializationResult>.value(
        HistoryMaterializationResult.failed('Invalid history origin'),
      );
    }

    final identity = _serverIdentity(item.origin, serverId.value);
    final existing = _materializations[identity];
    if (existing != null) return existing;
    final generation = _materializationGenerations[identity] ?? 0;

    late final Future<HistoryMaterializationResult> inFlight;
    inFlight =
        _performMaterialization(
          item,
          remoteUri!,
          serverId,
          identity,
          generation,
        ).whenComplete(() {
          if (identical(_materializations[identity], inFlight)) {
            _materializations.remove(identity);
          }
        });
    _materializations[identity] = inFlight;
    return inFlight;
  }

  void invalidateRemoteMaterialization(HistoryItem item) {
    final serverId = ServerId.tryParse(item.serverId);
    if (serverId == null) return;
    final identity = _serverIdentity(item.origin, serverId.value);
    _materializationGenerations[identity] =
        (_materializationGenerations[identity] ?? 0) + 1;
    _materializations.remove(identity);
  }

  void invalidateRemoteMaterializations(Iterable<HistoryItem> items) {
    for (final item in items) {
      invalidateRemoteMaterialization(item);
    }
  }

  static String _serverIdentity(String origin, String serverId) =>
      '$origin\u0000$serverId';

  bool _isCurrentMaterialization(String identity, int generation) =>
      (_materializationGenerations[identity] ?? 0) == generation;

  Future<HistoryMaterializationResult> _performMaterialization(
    HistoryItem item,
    Uri remoteUri,
    ServerId serverId,
    String identity,
    int generation,
  ) async {
    try {
      final localHistory = await HistoryService.getHistory();
      for (final existing in localHistory) {
        if (existing.origin == item.origin &&
            existing.serverId == serverId.value &&
            !existing.path.startsWith('airqr-remote://') &&
            await File(existing.path).exists()) {
          return HistoryMaterializationResult.alreadyLocal(existing);
        }
      }

      final fileBytes = await _downloadFile(
        id: serverId.value,
        origin: item.origin,
      );
      if (fileBytes == null) {
        return HistoryMaterializationResult.failed(
          'Could not download ${serverId.value}',
        );
      }
      if (!_isCurrentMaterialization(identity, generation)) {
        return HistoryMaterializationResult.failed('Materialization cancelled');
      }

      final appDir = await _documentsDirectory();
      final directory = Directory(p.join(appDir.path, item.origin));
      final remoteFilename = remoteUri.pathSegments.isEmpty
          ? serverId.value
          : remoteUri.pathSegments.last;
      if (!_isCurrentMaterialization(identity, generation)) {
        return HistoryMaterializationResult.failed('Materialization cancelled');
      }
      final filePath = await SafeLocalFileWriter.writeBytes(
        directory,
        SafeLocalFileWriter.safeBasename(remoteFilename),
        fileBytes,
      );
      if (!_isCurrentMaterialization(identity, generation)) {
        await File(filePath).delete();
        return HistoryMaterializationResult.failed('Materialization cancelled');
      }
      await HistoryService.add(
        path: filePath,
        origin: item.origin,
        mimeType: item.mimeType,
        totalFrames: item.totalFrames,
        minFrames: item.minFrames,
        chunkMinFrames: item.chunkMinFrames,
        timestamp: item.timestamp,
        syncToServer: false,
        isSynced: true,
        serverId: serverId.value,
      );
      if (!_isCurrentMaterialization(identity, generation)) {
        await HistoryService.remove(filePath);
        return HistoryMaterializationResult.failed('Materialization cancelled');
      }

      return HistoryMaterializationResult.materialized(
        HistoryItem(
          path: filePath,
          timestamp: item.timestamp,
          size: fileBytes.length,
          origin: item.origin,
          mimeType: item.mimeType,
          totalFrames: item.totalFrames,
          minFrames: item.minFrames,
          chunkMinFrames: item.chunkMinFrames,
          isSynced: true,
          serverId: serverId.value,
        ),
      );
    } catch (error) {
      return HistoryMaterializationResult.failed(error);
    }
  }

  Future<HistoryCompletedScanDownloadResult> downloadCompletedScan(
    Object? payload,
  ) async {
    try {
      final object = asWireObject(payload);
      final rawSessionId = object['sessionId'];
      final filename = asWireString(object['filename']);

      if (rawSessionId == null) {
        return HistoryCompletedScanDownloadResult.missingSessionId();
      }
      final serverId = ServerId.tryParse(rawSessionId);
      if (serverId == null) {
        return HistoryCompletedScanDownloadResult.failed('Invalid server ID');
      }
      final sessionId = serverId.value;

      final existingHistory = await HistoryService.getHistory();
      final alreadyDownloaded = existingHistory.any(
        (item) => item.serverId == sessionId,
      );
      if (alreadyDownloaded) {
        return HistoryCompletedScanDownloadResult.downloaded(
          sessionId: sessionId,
          filename: filename,
        );
      }

      final fileBytes = await SyncService.downloadFile(
        id: sessionId,
        origin: 'scanned',
      );
      if (fileBytes == null) {
        return HistoryCompletedScanDownloadResult.failed(
          'Could not download completed scan $sessionId',
        );
      }

      final appDir = await getApplicationDocumentsDirectory();
      final dir = Directory(p.join(appDir.path, 'scanned'));
      await dir.create(recursive: true);
      final safeFilename = (filename == null || filename.isEmpty)
          ? '$sessionId.bin'
          : filename;
      final filePath = await SafeLocalFileWriter.writeBytes(
        dir,
        safeFilename,
        fileBytes,
      );

      final timestamp =
          _parseTimestamp(object) ?? DateTime.now().millisecondsSinceEpoch;
      await HistoryService.add(
        path: filePath,
        origin: 'scanned',
        mimeType: asWireString(object['mimeType']),
        timestamp: timestamp,
        syncToServer: false,
        isSynced: true,
        serverId: sessionId,
      );

      _lastSyncTime = DateTime.now();
      return HistoryCompletedScanDownloadResult.downloaded(
        sessionId: sessionId,
        filename: filename,
      );
    } catch (error) {
      return HistoryCompletedScanDownloadResult.failed(error);
    }
  }

  static int? _parseTimestamp(WireObject payload) {
    final raw =
        payload['createdAt'] ?? payload['completedAt'] ?? payload['updatedAt'];
    return asWireDateTime(raw)?.millisecondsSinceEpoch;
  }
}
