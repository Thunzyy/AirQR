import 'dart:io';

import 'history_item.dart';
import 'history_service.dart';
import 'incomplete_scans.dart';
import 'package:path/path.dart' as p;
import 'sync_service.dart';
import 'sync_settings.dart';
import 'utils.dart';

class HistoryDeleteResult {
  final bool shouldShowServerDeleteFailure;

  const HistoryDeleteResult({this.shouldShowServerDeleteFailure = false});
}

class HistoryKeepLocalResult {
  final String fileName;

  const HistoryKeepLocalResult({required this.fileName});
}

enum HistorySyncItemStatus { queued, syncNotConfigured, fileNotFound, failed }

class HistorySyncItemResult {
  final HistorySyncItemStatus status;
  final String fileName;
  final Object? error;

  const HistorySyncItemResult._({
    required this.status,
    required this.fileName,
    this.error,
  });

  factory HistorySyncItemResult.queued(String fileName) {
    return HistorySyncItemResult._(
      status: HistorySyncItemStatus.queued,
      fileName: fileName,
    );
  }

  factory HistorySyncItemResult.syncNotConfigured(String fileName) {
    return HistorySyncItemResult._(
      status: HistorySyncItemStatus.syncNotConfigured,
      fileName: fileName,
    );
  }

  factory HistorySyncItemResult.fileNotFound(String fileName) {
    return HistorySyncItemResult._(
      status: HistorySyncItemStatus.fileNotFound,
      fileName: fileName,
    );
  }

  factory HistorySyncItemResult.failed(String fileName, Object error) {
    return HistorySyncItemResult._(
      status: HistorySyncItemStatus.failed,
      fileName: fileName,
      error: error,
    );
  }
}

enum HistoryIncompleteKeepLocalStatus { saved, packetsUnavailable, failed }

class HistoryIncompleteKeepLocalResult {
  final HistoryIncompleteKeepLocalStatus status;
  final String fileName;
  final Object? error;
  final bool shouldShowServerDeleteFailure;

  const HistoryIncompleteKeepLocalResult._({
    required this.status,
    required this.fileName,
    this.error,
    this.shouldShowServerDeleteFailure = false,
  });

  factory HistoryIncompleteKeepLocalResult.saved(
    String fileName, {
    bool serverDeleteFailed = false,
  }) {
    return HistoryIncompleteKeepLocalResult._(
      status: HistoryIncompleteKeepLocalStatus.saved,
      fileName: fileName,
      shouldShowServerDeleteFailure: serverDeleteFailed,
    );
  }

  factory HistoryIncompleteKeepLocalResult.packetsUnavailable(String fileName) {
    return HistoryIncompleteKeepLocalResult._(
      status: HistoryIncompleteKeepLocalStatus.packetsUnavailable,
      fileName: fileName,
    );
  }

  factory HistoryIncompleteKeepLocalResult.failed(
    String fileName,
    Object error,
  ) {
    return HistoryIncompleteKeepLocalResult._(
      status: HistoryIncompleteKeepLocalStatus.failed,
      fileName: fileName,
      error: error,
    );
  }
}

class HistoryPageActions {
  Future<HistoryDeleteResult> deleteHistoryItem(HistoryItem? item) async {
    if (item == null) {
      return const HistoryDeleteResult();
    }

    await HistoryService.remove(item.path);

    if (!item.isSynced ||
        item.serverId == null ||
        item.serverId!.isEmpty ||
        item.isLocalOnly) {
      return const HistoryDeleteResult();
    }

    final removedOnServer = item.origin == 'generated'
        ? await SyncService.deleteServerHistoryItem(item.serverId!)
        : await SyncService.deleteServerSession(item.serverId!);

    return HistoryDeleteResult(shouldShowServerDeleteFailure: !removedOnServer);
  }

  Future<HistoryKeepLocalResult> keepLocal(String path) async {
    await HistoryService.markAsLocal(path);
    return HistoryKeepLocalResult(fileName: p.basename(path));
  }

  Future<HistorySyncItemResult> syncItem(HistoryItem item) async {
    final fileName = p.basename(item.path);

    await HistoryService.enableSync(item.path);

    final settings = await SyncSettingsService.load();
    if (!settings.isConfigured) {
      return HistorySyncItemResult.syncNotConfigured(fileName);
    }

    final file = File(item.path);
    if (!await file.exists()) {
      return HistorySyncItemResult.fileNotFound(fileName);
    }

    try {
      final fileBytes = await file.readAsBytes();
      final safeFilename = sanitizeId(fileName);
      final uniqueId = '${item.origin}_${safeFilename}_${item.timestamp}';
      final isoTimestamp = DateTime.fromMillisecondsSinceEpoch(
        item.timestamp,
      ).toUtc().toIso8601String();

      if (item.origin == 'scanned') {
        await SyncService.uploadScan(
          sessionId: 'mobile_$uniqueId',
          filename: fileName,
          fileBytes: fileBytes,
          mimeType: item.mimeType ?? 'application/octet-stream',
          completedAt: isoTimestamp,
        );
      } else if (item.origin == 'generated') {
        await SyncService.uploadGenerated(
          historyId: 'mobile_$uniqueId',
          filename: fileName,
          fileBytes: fileBytes,
          mimeType: item.mimeType ?? 'application/octet-stream',
          createdAt: isoTimestamp,
          totalFrames: item.totalFrames,
          minFrames: item.minFrames,
          chunkMinFrames: item.chunkMinFrames,
        );
      }

      return HistorySyncItemResult.queued(fileName);
    } catch (error) {
      return HistorySyncItemResult.failed(fileName, error);
    }
  }

  Future<HistorySyncItemResult> syncIncompleteScan(IncompleteScan scan) async {
    final fileName = scan.filename ?? 'Scan ${scan.id}';

    final settings = await SyncSettingsService.load();
    if (!settings.isConfigured || !settings.syncScanned) {
      return HistorySyncItemResult.syncNotConfigured(fileName);
    }

    try {
      final packets = await IncompleteScanService.getPackets(scan.id);
      if (packets.isEmpty) {
        return HistorySyncItemResult.fileNotFound(fileName);
      }

      for (final packet in packets) {
        final uploaded = await IncompleteScanService.uploadPacketToServer(
          sessionId: scan.id,
          packetData: packet,
          filename: scan.filename,
          receivedPackets: scan.receivedPackets,
          expectedPackets: scan.expectedPackets,
          deviceId: scan.deviceId,
          deviceName: scan.deviceName,
        );
        if (!uploaded) {
          return HistorySyncItemResult.failed(fileName, 'packet upload failed');
        }
      }

      return HistorySyncItemResult.queued(fileName);
    } catch (error) {
      return HistorySyncItemResult.failed(fileName, error);
    }
  }

  Future<HistoryIncompleteKeepLocalResult> keepLocalIncompleteScan(
    IncompleteScan scan,
  ) async {
    final fileName = scan.filename ?? 'Scan ${scan.id}';

    try {
      final localPackets = await IncompleteScanService.getPackets(scan.id);
      if (localPackets.isEmpty && scan.isRemote) {
        final remotePackets = await SyncService.downloadPackets(scan.id);
        if (remotePackets.isEmpty) {
          return HistoryIncompleteKeepLocalResult.packetsUnavailable(fileName);
        }
        await IncompleteScanService.replacePackets(scan.id, remotePackets);
      }

      await IncompleteScanService.keepLocalCopy(scan);
      final removedOnServer = scan.isRemote
          ? await SyncService.deleteServerSession(scan.id)
          : true;
      return HistoryIncompleteKeepLocalResult.saved(
        fileName,
        serverDeleteFailed: !removedOnServer,
      );
    } catch (error) {
      return HistoryIncompleteKeepLocalResult.failed(fileName, error);
    }
  }

  Future<HistoryDeleteResult> deleteIncompleteScan(
    IncompleteScan? scan, {
    required bool syncEnabled,
  }) async {
    if (scan == null) {
      return const HistoryDeleteResult();
    }

    await IncompleteScanService.remove(scan.id);

    final removedOnServer = await SyncService.deleteServerSession(scan.id);
    return HistoryDeleteResult(
      shouldShowServerDeleteFailure:
          !removedOnServer && (scan.isRemote || syncEnabled),
    );
  }

  Future<HistoryDeleteResult> clearHistory({
    required Iterable<HistoryItem> items,
    required Iterable<IncompleteScan> incompleteScans,
    required bool syncEnabled,
  }) async {
    var serverDeleteFailed = false;

    for (final item in items) {
      final result = await deleteHistoryItem(item);
      serverDeleteFailed =
          serverDeleteFailed || result.shouldShowServerDeleteFailure;
    }

    for (final scan in incompleteScans) {
      final result = await deleteIncompleteScan(scan, syncEnabled: syncEnabled);
      serverDeleteFailed =
          serverDeleteFailed || result.shouldShowServerDeleteFailure;
    }

    IncompleteScanService.clearCurrentScan();
    return HistoryDeleteResult(
      shouldShowServerDeleteFailure: serverDeleteFailed,
    );
  }
}
