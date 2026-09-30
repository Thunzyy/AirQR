import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'sync_settings.dart';
import 'history.dart';
import 'safe_local_file_writer.dart';
import 'server_history_item.dart';
import 'server_id.dart';
import 'utils.dart';
import 'parse/wire.dart';

/// Creates an HTTP client that accepts self-signed certificates.
http.Client _createTrustingClient() {
  final httpClient = HttpClient()
    ..badCertificateCallback = (X509Certificate cert, String host, int port) =>
        true;
  return IOClient(httpClient);
}

/// Result of a sync operation.
class SyncResult {
  final bool success;
  final String? error;
  final int uploadedCount;
  final int downloadedCount;

  const SyncResult({
    required this.success,
    this.error,
    this.uploadedCount = 0,
    this.downloadedCount = 0,
  });

  factory SyncResult.error(String message) =>
      SyncResult(success: false, error: message);

  factory SyncResult.ok({int uploaded = 0, int downloaded = 0}) => SyncResult(
    success: true,
    uploadedCount: uploaded,
    downloadedCount: downloaded,
  );
}

sealed class ServerHistoryFetchResult {
  const ServerHistoryFetchResult();
}

final class ServerHistorySnapshot extends ServerHistoryFetchResult {
  final List<ServerHistoryItem> items;

  const ServerHistorySnapshot(this.items);
}

final class ServerHistoryFetchFailure extends ServerHistoryFetchResult {
  final String message;

  const ServerHistoryFetchFailure(this.message);
}

/// Service for syncing history with the server.
class SyncService {
  static const Duration defaultRequestTimeout = Duration(seconds: 15);
  static const Duration defaultTransferTimeout = Duration(minutes: 2);
  static const int defaultMaxDownloadsPerSync = 20;

  static SyncSettings? _cachedSettings;
  static http.Client? _strictClient;
  static http.Client? _insecureClient;
  static Future<SyncResult>? _activeSyncAll;

  static bool _shouldAllowInsecureTls(SyncSettings settings) {
    if (!kDebugMode) return false;
    final uri = Uri.tryParse(settings.serverUrl);
    if (uri == null || uri.scheme != 'https') return false;
    return isLocalDevHost(uri.host);
  }

  /// Gets HTTP client based on environment and endpoint trust policy.
  static http.Client _httpClientFor(SyncSettings settings) {
    if (_shouldAllowInsecureTls(settings)) {
      _insecureClient ??= _createTrustingClient();
      return _insecureClient!;
    }
    _strictClient ??= http.Client();
    return _strictClient!;
  }

  /// Clears cached settings (call when settings change).
  static void clearCache() {
    _cachedSettings = null;
  }

  @visibleForTesting
  static void setHttpClientForTesting(http.Client? client) {
    _strictClient = client;
    _insecureClient = client;
  }

  /// Gets current sync settings (with caching).
  static Future<SyncSettings> getSettings() async {
    _cachedSettings ??= await SyncSettingsService.load();
    return _cachedSettings!;
  }

  /// Creates HTTP headers with auth if configured.
  static Map<String, String> _headers(
    SyncSettings settings, {
    bool json = true,
  }) {
    final headers = <String, String>{};
    if (json) {
      headers['Content-Type'] = 'application/json';
    }
    final auth = settings.authHeader;
    if (auth != null) {
      headers['Authorization'] = auth;
    }
    return headers;
  }

  /// Uploads a completed scan to the server.
  static Future<SyncResult> uploadScan({
    required String sessionId,
    required String filename,
    required List<int> fileBytes,
    required String mimeType,
    String? completedAt,
    int? totalChunks,
    int? chunksCompleted,
    Duration timeout = defaultTransferTimeout,
  }) async {
    if (ServerId.tryParse(sessionId) == null) {
      return SyncResult.error('Invalid server ID');
    }
    final settings = await getSettings();
    debugPrint(
      'uploadScan: isConfigured=${settings.isConfigured}, syncScanned=${settings.syncScanned}, serverUrl=${settings.serverUrl}',
    );
    if (!settings.isConfigured || !settings.syncScanned) {
      debugPrint(
        'uploadScan: Skipping - sync not configured or syncScanned disabled',
      );
      return SyncResult.ok();
    }

    try {
      final url = Uri.parse('${settings.serverUrl}/api/scan/complete').replace(
        queryParameters: <String, String>{
          'sessionId': sessionId,
          'filename': filename,
          'mimeType': mimeType,
          'fileSize': fileBytes.length.toString(),
          'completedAt':
              completedAt ?? DateTime.now().toUtc().toIso8601String(),
          if (totalChunks != null) 'totalChunks': totalChunks.toString(),
          if (chunksCompleted != null)
            'chunksCompleted': chunksCompleted.toString(),
        },
      );
      debugPrint('uploadScan: POSTing to $url');
      final response = await _httpClientFor(settings)
          .post(
            url,
            headers: <String, String>{
              ..._headers(settings, json: false),
              'Content-Type': 'application/octet-stream',
            },
            body: fileBytes,
          )
          .timeout(timeout);

      debugPrint(
        'uploadScan: Response ${response.statusCode}: ${response.body}',
      );
      if (response.statusCode == 200) {
        debugPrint('✓ Scan uploaded to server: $filename');
        return SyncResult.ok(uploaded: 1);
      } else {
        return SyncResult.error(
          'Server returned ${response.statusCode}: ${response.body}',
        );
      }
    } catch (e, stackTrace) {
      debugPrint('uploadScan: Exception: $e');
      debugPrint('uploadScan: Stack: $stackTrace');
      return SyncResult.error('Upload failed: $e');
    }
  }

  /// Uploads a generated history item to the server.
  static Future<SyncResult> uploadGenerated({
    required String historyId,
    required String filename,
    required List<int> fileBytes,
    required String mimeType,
    String? createdAt,
    int? totalFrames,
    int? minFrames,
    List<int>? chunkMinFrames,
    Duration timeout = defaultTransferTimeout,
  }) async {
    if (ServerId.tryParse(historyId) == null) {
      return SyncResult.error('Invalid server ID');
    }
    final settings = await getSettings();
    if (!settings.isConfigured || !settings.syncGenerated) {
      return SyncResult.ok();
    }

    try {
      final url = Uri.parse('${settings.serverUrl}/api/history/item').replace(
        queryParameters: <String, String>{
          'historyId': historyId,
          'filename': filename,
          'title': filename,
          'mimeType': mimeType,
          'createdAt': createdAt ?? DateTime.now().toUtc().toIso8601String(),
          if (totalFrames != null) 'totalFrames': totalFrames.toString(),
          if (minFrames != null) 'minFrames': minFrames.toString(),
          if (chunkMinFrames != null)
            'chunkMinFrames': jsonEncode(chunkMinFrames),
        },
      );
      final response = await _httpClientFor(settings)
          .post(
            url,
            headers: <String, String>{
              ..._headers(settings, json: false),
              'Content-Type': 'application/octet-stream',
            },
            body: fileBytes,
          )
          .timeout(timeout);

      if (response.statusCode == 200) {
        debugPrint('✓ Generated file uploaded to server: $filename');
        return SyncResult.ok(uploaded: 1);
      } else {
        return SyncResult.error(
          'Server returned ${response.statusCode}: ${response.body}',
        );
      }
    } catch (e) {
      return SyncResult.error('Upload failed: $e');
    }
  }

  /// Fetches all history from the server.
  static Future<ServerHistoryFetchResult> fetchServerHistory({
    Duration timeout = defaultRequestTimeout,
    int? limit,
  }) async {
    final settings = await getSettings();
    if (!settings.isConfigured) {
      return const ServerHistoryFetchFailure('Sync not configured');
    }

    try {
      final baseUrl = Uri.parse('${settings.serverUrl}/api/history');
      final url = limit != null && limit > 0
          ? baseUrl.replace(
              queryParameters: <String, String>{
                ...baseUrl.queryParameters,
                'limit': '$limit',
              },
            )
          : baseUrl;
      debugPrint('fetchServerHistory: Fetching from $url');
      final response = await _httpClientFor(
        settings,
      ).get(url, headers: _headers(settings)).timeout(timeout);

      if (response.statusCode == 200) {
        final decoded = parseJsonText(response.body);
        final decodedList = tryWireList(decoded);
        if (decodedList == null) {
          return const ServerHistoryFetchFailure(
            'Server history response was not a list',
          );
        }
        final items = <ServerHistoryItem>[];
        for (final decodedItem in decodedList) {
          final item = ServerHistoryItem.tryParse(decodedItem);
          if (item == null) {
            return const ServerHistoryFetchFailure(
              'Server history response contained a malformed item',
            );
          }
          items.add(item);
        }
        debugPrint('fetchServerHistory: Got ${items.length} items from server');
        // Log completed vs incomplete
        int completed = 0;
        int incomplete = 0;
        for (final item in items) {
          if (item.completed) {
            completed++;
          } else {
            incomplete++;
          }
        }
        debugPrint(
          'fetchServerHistory: $completed completed, $incomplete incomplete',
        );
        return ServerHistorySnapshot(items);
      }
      debugPrint(
        'fetchServerHistory: Failed with status ${response.statusCode}',
      );
      return ServerHistoryFetchFailure(
        'Server history request failed with status ${response.statusCode}',
      );
    } catch (e) {
      debugPrint('Failed to fetch server history: $e');
      return ServerHistoryFetchFailure('Server history request failed: $e');
    }
  }

  /// Fetches incomplete scan sessions from the server.
  static Future<List<WireObject>> fetchIncompleteScans() async {
    final settings = await getSettings();
    if (!settings.isConfigured || !settings.syncScanned) {
      return [];
    }

    try {
      final url = Uri.parse(
        '${settings.serverUrl}/api/scan/history',
      ).replace(queryParameters: const <String, String>{'completed': 'false'});
      final response = await _httpClientFor(
        settings,
      ).get(url, headers: _headers(settings)).timeout(defaultRequestTimeout);

      if (response.statusCode == 200) {
        final decoded = parseJsonText(response.body);
        final decodedList = tryWireList(decoded);
        if (decodedList == null) {
          throw const FormatException('Incomplete scan response is not a list');
        }

        final validated = <WireObject>[];
        for (final raw in decodedList) {
          final object = tryWireObject(raw);
          if (object == null) {
            throw const FormatException(
              'Incomplete scan item is not an object',
            );
          }
          final serverId = ServerId.tryParseAliases(
            object,
            keys: const <String>['id', 'sessionId'],
          );
          if (serverId == null) {
            // Fail the whole snapshot closed: callers must never hydrate a
            // partially trusted set of remote filesystem identifiers.
            throw const FormatException('Invalid incomplete scan identifier');
          }
          if (object['completed'] != true) {
            validated.add(<String, Object?>{
              ...object,
              'id': serverId.value,
              'sessionId': serverId.value,
            });
          }
        }
        return validated;
      }
      return [];
    } catch (e) {
      debugPrint('Failed to fetch incomplete scans: $e');
      return [];
    }
  }

  /// Fetch session info (counts/progress) for a specific scan session.
  static Future<WireObject?> fetchSessionInfo(
    String sessionId,
  ) async {
    final serverId = ServerId.tryParse(sessionId);
    if (serverId == null) return null;
    final settings = await getSettings();
    if (!settings.isConfigured) {
      return null;
    }

    try {
      final url = Uri.parse(
        '${settings.serverUrl}/api/scan/session/${serverId.encodedPathSegment}',
      );
      final response = await _httpClientFor(
        settings,
      ).get(url, headers: _headers(settings)).timeout(defaultRequestTimeout);

      if (response.statusCode == 200) {
        return tryWireObject(parseJsonText(response.body));
      }
      return null;
    } catch (e) {
      debugPrint('Failed to fetch session info for $sessionId: $e');
      return null;
    }
  }

  /// Check if a scan session is completed on the server
  static Future<bool> isSessionCompleted(String sessionId) async {
    final serverId = ServerId.tryParse(sessionId);
    if (serverId == null) return false;
    final settings = await getSettings();
    if (!settings.isConfigured) {
      return false;
    }

    try {
      final url = Uri.parse(
        '${settings.serverUrl}/api/scan/session/${serverId.encodedPathSegment}',
      );
      debugPrint('Checking session completion: $url');
      final response = await _httpClientFor(
        settings,
      ).get(url, headers: _headers(settings)).timeout(defaultRequestTimeout);

      debugPrint(
        'Session $sessionId response: ${response.statusCode} - ${response.body}',
      );
      if (response.statusCode == 200) {
        final data = asWireObject(parseJsonText(response.body));
        final isCompleted = data['completed'] == true;
        debugPrint('Session $sessionId completed: $isCompleted');
        return isCompleted;
      } else if (response.statusCode == 404) {
        // Session doesn't exist on server - might be purely local
        debugPrint('Session $sessionId not found on server');
        return false;
      }
      return false;
    } catch (e) {
      debugPrint('Error checking session $sessionId: $e');
      return false;
    }
  }

  /// Uploads a single packet to the server during scanning.
  static Future<bool> uploadPacket({
    required String sessionId,
    required List<int> packetBytes,
    String? filename,
    String? resultType,
    int? receivedPackets,
    int? expectedPackets,
    String? deviceId,
    String? deviceName,
  }) async {
    if (ServerId.tryParse(sessionId) == null) return false;
    final settings = await getSettings();
    if (!settings.isConfigured || !settings.syncScanned) {
      return false;
    }

    try {
      final url = Uri.parse('${settings.serverUrl}/api/scan/packet');
      final response = await _httpClientFor(settings)
          .post(
            url,
            headers: _headers(settings),
            body: jsonEncode({
              'sessionId': sessionId,
              'packetBase64': base64Encode(packetBytes),
              'capturedAt': DateTime.now().toUtc().toIso8601String(),
              if (filename != null) 'filename': filename,
              if (resultType != null) 'resultType': resultType,
              if (receivedPackets != null) 'receivedPackets': receivedPackets,
              if (expectedPackets != null) 'expectedPackets': expectedPackets,
              if (deviceId != null && deviceId.isNotEmpty) 'deviceId': deviceId,
              if (deviceName != null && deviceName.isNotEmpty)
                'deviceName': deviceName,
            }),
          )
          .timeout(defaultRequestTimeout);

      if (response.statusCode != 200) {
        debugPrint(
          'uploadPacket: Server returned ${response.statusCode} for session=$sessionId body=${response.body}',
        );
        return false;
      }
      return true;
    } catch (e) {
      debugPrint('Failed to upload packet for session=$sessionId: $e');
      return false;
    }
  }

  /// Downloads all packets for a scan session from the server.
  static Future<List<List<int>>> downloadPackets(String sessionId) async {
    final serverId = ServerId.tryParse(sessionId);
    if (serverId == null) return <List<int>>[];
    final settings = await getSettings();
    if (!settings.isConfigured) {
      debugPrint('downloadPackets: Sync not configured');
      return [];
    }

    try {
      final url = Uri.parse(
        '${settings.serverUrl}/api/scan/session/${serverId.encodedPathSegment}/packets',
      );
      debugPrint('downloadPackets: Fetching from $url');
      final response = await _httpClientFor(
        settings,
      ).get(url, headers: _headers(settings)).timeout(defaultTransferTimeout);

      debugPrint('downloadPackets: Response ${response.statusCode}');
      if (response.statusCode == 200) {
        final data = asWireObject(parseJsonText(response.body));
        final packetsB64 = asWireList(data['packets']);
        debugPrint(
          'downloadPackets: Got ${packetsB64.length} packets for $sessionId',
        );
        return packetsB64
            .map(asWireString)
            .whereType<String>()
            .map(base64Decode)
            .toList();
      }
      debugPrint(
        'downloadPackets: No packets found (status ${response.statusCode})',
      );
      return [];
    } catch (e) {
      debugPrint('Failed to download packets for $sessionId: $e');
      return [];
    }
  }

  /// Downloads a file from the server.
  static Future<List<int>?> downloadFile({
    required String id,
    required String origin,
    Duration timeout = defaultTransferTimeout,
  }) async {
    final serverId = ServerId.tryParse(id);
    if (serverId == null) {
      throw FormatException('Invalid server ID', id);
    }
    final settings = await getSettings();
    if (!settings.isConfigured) {
      return null;
    }

    try {
      final String endpoint;
      if (origin == 'scanned') {
        endpoint =
            '${settings.serverUrl}/api/scan/session/${serverId.encodedPathSegment}/file';
      } else {
        endpoint =
            '${settings.serverUrl}/api/history/item/${serverId.encodedPathSegment}/file';
      }

      debugPrint('downloadFile: Fetching from $endpoint');
      final url = Uri.parse(endpoint);
      final response = await _httpClientFor(
        settings,
      ).get(url, headers: _headers(settings, json: false)).timeout(timeout);

      debugPrint(
        'downloadFile: Response ${response.statusCode} (${response.bodyBytes.length} bytes)',
      );
      if (response.statusCode == 200) {
        return response.bodyBytes;
      }
      debugPrint('downloadFile: Failed - ${response.body}');
      return null;
    } catch (e) {
      debugPrint('Failed to download file $id: $e');
      return null;
    }
  }

  /// Deletes a scan session on the server.
  /// Returns true when deletion succeeded or the session is already missing.
  static Future<bool> deleteServerSession(String sessionId) async {
    final serverId = ServerId.tryParse(sessionId);
    if (serverId == null) return false;
    final settings = await getSettings();
    if (!settings.isConfigured) {
      return true;
    }
    try {
      final endpoint =
          '${settings.serverUrl}/api/scan/session/${serverId.encodedPathSegment}';
      final response = await _httpClientFor(
        settings,
      ).delete(Uri.parse(endpoint), headers: _headers(settings, json: false));

      if (response.statusCode == 200 || response.statusCode == 404) {
        return true;
      }

      debugPrint(
        'deleteServerSession: Failed (${response.statusCode}) for sessionId=$sessionId',
      );
      return false;
    } catch (e) {
      debugPrint('deleteServerSession: Error for sessionId=$sessionId: $e');
      return false;
    }
  }

  /// Deletes a generated history item on the server.
  /// Returns true when deletion succeeded or the item is already missing.
  static Future<bool> deleteServerHistoryItem(String historyId) async {
    final serverId = ServerId.tryParse(historyId);
    if (serverId == null) return false;
    final settings = await getSettings();
    if (!settings.isConfigured) {
      return true;
    }
    try {
      final endpoint =
          '${settings.serverUrl}/api/history/item/${serverId.encodedPathSegment}';
      final response = await _httpClientFor(
        settings,
      ).delete(Uri.parse(endpoint), headers: _headers(settings, json: false));

      if (response.statusCode == 200 || response.statusCode == 404) {
        return true;
      }

      debugPrint(
        'deleteServerHistoryItem: Failed (${response.statusCode}) for historyId=$historyId',
      );
      return false;
    } catch (e) {
      debugPrint('deleteServerHistoryItem: Error for historyId=$historyId: $e');
      return false;
    }
  }

  static String _buildDeterministicServerId({
    required HistoryItem item,
    required String filename,
  }) {
    final safeFilename = sanitizeId(filename);
    final uniqueId = '${item.origin}_${safeFilename}_${item.timestamp}';
    return 'mobile_$uniqueId';
  }

  static String? _buildServerFingerdebugPrint(ServerHistoryItem serverItem) {
    final origin = serverItem.originValue;
    final filename = serverItem.filename;
    if (filename == null || filename.isEmpty) return null;
    final size = serverItem.size;
    final timestamp = serverItem.effectiveTimestamp;
    if (timestamp == null) return null;
    final epochSeconds = timestamp.toUtc().millisecondsSinceEpoch ~/ 1000;
    return '$origin|$filename|$size|$epochSeconds';
  }

  static String _buildLocalFingerdebugPrint(HistoryItem item, String filename) {
    final epochSeconds =
        DateTime.fromMillisecondsSinceEpoch(
          item.timestamp,
          isUtc: true,
        ).millisecondsSinceEpoch ~/
        1000;
    return '${item.origin}|$filename|${item.size}|$epochSeconds';
  }

  /// Syncs local history with server (bidirectional).
  /// - Uploads local items not on server
  /// - Downloads server items not local
  /// - Deletes local synced items that were deleted on server
  static Future<SyncResult> syncAll({
    Duration requestTimeout = defaultRequestTimeout,
    Duration transferTimeout = defaultTransferTimeout,
    int maxDownloads = defaultMaxDownloadsPerSync,
  }) async {
    final activeSyncAll = _activeSyncAll;
    if (activeSyncAll != null) {
      debugPrint('syncAll: Reusing active sync operation');
      return activeSyncAll;
    }

    final future = _syncAllInternal(
      requestTimeout: requestTimeout,
      transferTimeout: transferTimeout,
      maxDownloads: maxDownloads,
    );
    _activeSyncAll = future;
    try {
      return await future;
    } finally {
      if (identical(_activeSyncAll, future)) {
        _activeSyncAll = null;
      }
    }
  }

  static Future<SyncResult> _syncAllInternal({
    required Duration requestTimeout,
    required Duration transferTimeout,
    required int maxDownloads,
  }) async {
    final settings = await getSettings();
    if (!settings.isConfigured) {
      return SyncResult.error('Sync not configured');
    }

    int uploaded = 0;
    int downloaded = 0;
    int deleted = 0;

    try {
      final serverHistoryResult = await fetchServerHistory(
        timeout: requestTimeout,
      );
      final List<ServerHistoryItem> serverHistory;
      switch (serverHistoryResult) {
        case ServerHistoryFetchFailure(:final message):
          return SyncResult.error(message);
        case ServerHistorySnapshot(:final items):
          serverHistory = items;
      }
      final localHistory = await HistoryService.getHistory();

      // Build set of server IDs for deletion detection
      final serverIdSet = <String>{};
      final serverFingerprints = <String>{};
      final serverItemsById = <String, ServerHistoryItem>{};
      for (final item in serverHistory) {
        final serverId = item.id.value;
        serverIdSet.add(serverId);
        serverItemsById[serverId] = item;
        final fingerprint = _buildServerFingerdebugPrint(item);
        if (fingerprint != null) {
          serverFingerprints.add(fingerprint);
        }
      }

      // Delete local synced items that no longer exist on server
      for (final item in localHistory) {
        if (item.isSynced && item.serverId != null) {
          if (!serverIdSet.contains(item.serverId)) {
            debugPrint(
              'syncAll: Deleting local file ${p.basename(item.path)} (removed from server)',
            );
            await HistoryService.removeByServerId(item.serverId!);
            deleted++;
          }
        }
      }

      // Refresh local history after deletions
      final updatedLocalHistory = await HistoryService.getHistory();

      // Upload local items that aren't on server
      for (final item in updatedLocalHistory) {
        final file = File(item.path);
        if (!file.existsSync()) continue;

        // Skip local-only files (user explicitly detached from server)
        if (item.isLocalOnly) continue;

        final filename = p.basename(item.path);
        final deterministicServerId = _buildDeterministicServerId(
          item: item,
          filename: filename,
        );
        final localFingerprint = _buildLocalFingerdebugPrint(item, filename);

        // Match by canonical ID first, then by strict fingerprint fallback.
        final existsOnServer =
            serverIdSet.contains(deterministicServerId) ||
            serverFingerprints.contains(localFingerprint);

        if (!existsOnServer && !item.isSynced) {
          final fileBytes = await file.readAsBytes();
          final timestamp = DateTime.fromMillisecondsSinceEpoch(
            item.timestamp,
          ).toUtc().toIso8601String();

          SyncResult result;
          String serverId = deterministicServerId;

          if (item.origin == 'scanned' && settings.syncScanned) {
            result = await uploadScan(
              sessionId: serverId,
              filename: filename,
              fileBytes: fileBytes,
              mimeType: item.mimeType ?? 'application/octet-stream',
              completedAt: timestamp,
              timeout: transferTimeout,
            );
          } else if (item.origin == 'generated' && settings.syncGenerated) {
            result = await uploadGenerated(
              historyId: serverId,
              filename: filename,
              fileBytes: fileBytes,
              mimeType: item.mimeType ?? 'application/octet-stream',
              createdAt: timestamp,
              totalFrames: item.totalFrames,
              minFrames: item.minFrames,
              chunkMinFrames: item.chunkMinFrames,
              timeout: transferTimeout,
            );
          } else {
            continue;
          }

          if (result.success) {
            uploaded += result.uploadedCount;
            // Mark as synced
            await HistoryService.markAsSynced(item.path, serverId);
            debugPrint('✓ Uploaded to server: $filename');
          } else {
            return SyncResult(
              success: false,
              error:
                  'Failed to upload $filename: ${result.error ?? 'unknown error'}',
              uploadedCount: uploaded,
              downloadedCount: downloaded,
            );
          }
        } else if (existsOnServer && !item.isSynced && !item.isLocalOnly) {
          // Item exists on server, mark as synced using canonical or fingerprint match.
          var matchedServerId = serverIdSet.contains(deterministicServerId)
              ? deterministicServerId
              : null;

          if (matchedServerId == null) {
            for (final entry in serverItemsById.entries) {
              final fp = _buildServerFingerdebugPrint(entry.value);
              if (fp == localFingerprint) {
                matchedServerId = entry.key;
                break;
              }
            }
          }

          if (matchedServerId != null) {
            await HistoryService.markAsSynced(item.path, matchedServerId);
          }
        }
      }

      // Download server items that aren't local (only completed ones)
      final appDir = await getApplicationDocumentsDirectory();
      final refreshedLocalHistory = await HistoryService.getHistory();
      final knownLocalServerIds = refreshedLocalHistory
          .map((item) => item.serverId)
          .whereType<String>()
          .where((serverId) => serverId.isNotEmpty)
          .toSet();
      final processedServerIds = <String>{};

      for (final serverItem in serverHistory) {
        if (downloaded >= maxDownloads) {
          debugPrint(
            'syncAll: Download batch limit reached ($maxDownloads files)',
          );
          break;
        }
        final origin = serverItem.originValue;
        final filename = serverItem.filename;
        final isCompleted = serverItem.completed;

        if (filename == null) continue;
        // Only download completed scans
        if (origin == 'scanned' && !isCompleted) continue;

        // Check if we should sync this type
        if (origin == 'scanned' && !settings.syncScanned) continue;
        if (origin == 'generated' && !settings.syncGenerated) continue;

        final serverId = serverItem.id.value;

        if (!processedServerIds.add(serverId)) {
          debugPrint('syncAll: Skipping duplicate server item id=$serverId');
          continue;
        }

        // Check if this server item already exists locally (by serverId)
        final existsLocally = knownLocalServerIds.contains(serverId);

        if (!existsLocally) {
          debugPrint(
            'syncAll: Downloading file $filename (id=$serverId, origin=$origin)',
          );
          final fileBytes = await downloadFile(
            id: serverId,
            origin: origin,
            timeout: transferTimeout,
          );
          if (fileBytes != null) {
            // Save file locally
            final subDir = origin == 'scanned' ? 'scanned' : 'generated';
            final dir = Directory('${appDir.path}/$subDir/$serverId');
            await dir.create(recursive: true);

            final filePath = await SafeLocalFileWriter.writeBytes(
              dir,
              filename,
              fileBytes,
            );
            debugPrint(
              'syncAll: Saved file to $filePath (${fileBytes.length} bytes)',
            );

            // Parse timestamp
            final timestamp =
                serverItem.effectiveTimestamp?.millisecondsSinceEpoch ??
                DateTime.now().millisecondsSinceEpoch;

            // Add to local history (without re-syncing to server, already synced)
            await HistoryService.add(
              path: filePath,
              origin: origin,
              mimeType: serverItem.mimeType,
              totalFrames: serverItem.totalFrames,
              minFrames: serverItem.minFrames,
              chunkMinFrames: serverItem.chunkMinFrames,
              timestamp: timestamp,
              syncToServer: false,
              isSynced: true,
              serverId: serverId,
            );

            knownLocalServerIds.add(serverId);
            downloaded++;
            debugPrint('✓ Downloaded from server: $filename');
          } else {
            debugPrint('syncAll: Failed to download file $filename');
            return SyncResult(
              success: false,
              error: 'Failed to download $filename from the server',
              uploadedCount: uploaded,
              downloadedCount: downloaded,
            );
          }
        }
      }

      debugPrint(
        'syncAll: Complete - uploaded=$uploaded, downloaded=$downloaded, deleted=$deleted',
      );
      return SyncResult.ok(uploaded: uploaded, downloaded: downloaded);
    } catch (e) {
      debugPrint('syncAll: Error - $e');
      return SyncResult.error('Sync failed: $e');
    }
  }

  /// Tests connection to the server.
  static Future<SyncResult> testConnection() async {
    final settings = await getSettings();
    if (!settings.isConfigured) {
      return SyncResult.error('Server URL not configured');
    }

    try {
      final url = Uri.parse('${settings.serverUrl}/api/history');
      final response = await _httpClientFor(settings)
          .get(url, headers: _headers(settings))
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        return SyncResult.ok();
      } else if (response.statusCode == 401) {
        return SyncResult.error('Authentication failed');
      } else {
        return SyncResult.error('Server returned ${response.statusCode}');
      }
    } catch (e) {
      return SyncResult.error('Connection failed: $e');
    }
  }
}
