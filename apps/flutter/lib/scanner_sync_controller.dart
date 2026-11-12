import 'dart:math';

import 'incomplete_scans.dart';
import 'note_detection.dart';
import 'scanner_session_progress.dart';
import 'server_id.dart';
import 'sync_service.dart';
import 'utils.dart';
import 'websocket_sync.dart';
import 'parse/wire.dart';

typedef ScannerAdoptRemoteSessionCallback =
    Future<String> Function(String sessionId);
typedef ScannerUpdateIncompleteProgressCallback =
    Future<void> Function({
      required double progress,
      required int receivedPackets,
      required int expectedPackets,
      required String? filename,
    });
typedef ScannerCompleteCurrentScanCallback = Future<void> Function();
typedef ScannerSyncAllCallback = Future<void> Function();

class ScannerRemoteProgressState {
  final bool canScanLocally;
  final String? currentScanId;
  final int displayReceivedPackets;
  final int displayExpectedPackets;
  final int displayTotalPackets;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final List<ScannerChunkProgressInfo> remoteChunks;
  final double progress;
  final String? currentFilename;
  final String? syncSourceName;

  const ScannerRemoteProgressState({
    required this.canScanLocally,
    required this.currentScanId,
    required this.displayReceivedPackets,
    required this.displayExpectedPackets,
    this.displayTotalPackets = 0,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    this.remoteTotalPackets = 0,
    this.remoteMissingPackets = 0,
    this.remoteChunks = const <ScannerChunkProgressInfo>[],
    required this.progress,
    required this.currentFilename,
    required this.syncSourceName,
  });
}

class ScannerRemoteProgressResult {
  final String currentScanId;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final List<ScannerChunkProgressInfo> remoteChunks;
  final double progress;
  final String status;
  final String? currentFilename;
  final String? syncSourceName;

  const ScannerRemoteProgressResult({
    required this.currentScanId,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    this.remoteTotalPackets = 0,
    this.remoteMissingPackets = 0,
    this.remoteChunks = const <ScannerChunkProgressInfo>[],
    required this.progress,
    required this.status,
    required this.currentFilename,
    required this.syncSourceName,
  });
}

class ScannerRemoteCompletionState {
  final bool canScanLocally;
  final String? currentScanId;
  final bool completionHandled;
  final double scanDurationSeconds;

  const ScannerRemoteCompletionState({
    required this.canScanLocally,
    required this.currentScanId,
    required this.completionHandled,
    required this.scanDurationSeconds,
  });
}

class ScannerRemoteCompletionResult {
  final String? currentScanId;
  final bool completionHandled;
  final bool isCaptureActive;
  final bool isProcessing;
  final bool isScanning;
  final double progress;
  final bool resultIsNote;
  final String? resultNoteContent;
  final String resultFilename;
  final String resultSessionId;
  final int? resultFileSizeBytes;
  final double resultDurationSeconds;
  final String? resultSubtitle;
  final String status;
  final String snackBarMessage;

  const ScannerRemoteCompletionResult({
    required this.currentScanId,
    required this.completionHandled,
    required this.isCaptureActive,
    required this.isProcessing,
    required this.isScanning,
    required this.progress,
    required this.resultIsNote,
    required this.resultNoteContent,
    required this.resultFilename,
    required this.resultSessionId,
    required this.resultFileSizeBytes,
    required this.resultDurationSeconds,
    required this.resultSubtitle,
    required this.status,
    required this.snackBarMessage,
  });
}

class ScannerSyncController {
  final ScannerAdoptRemoteSessionCallback _adoptRemoteSession;
  final ScannerUpdateIncompleteProgressCallback _updateIncompleteProgress;
  final ScannerCompleteCurrentScanCallback _completeCurrentScan;
  final ScannerSyncAllCallback _syncAll;

  ScannerSyncController({
    ScannerAdoptRemoteSessionCallback? adoptRemoteSession,
    ScannerUpdateIncompleteProgressCallback? updateIncompleteProgress,
    ScannerCompleteCurrentScanCallback? completeCurrentScan,
    ScannerSyncAllCallback? syncAll,
  }) : _adoptRemoteSession =
           adoptRemoteSession ??
           ((sessionId) =>
               IncompleteScanService.startNewSession(sessionId: sessionId)),
       _updateIncompleteProgress =
           updateIncompleteProgress ?? IncompleteScanService.updateProgress,
       _completeCurrentScan =
           completeCurrentScan ?? IncompleteScanService.completeCurrentScan,
       _syncAll = syncAll ?? SyncService.syncAll;

  Future<ScannerRemoteProgressResult?> handleRemoteProgress({
    required ScannerRemoteProgressState state,
    required SyncEvent event,
  }) async {
    final serverId = ServerId.tryParse(event.payload['sessionId']);
    if (serverId == null) return null;
    final sessionId = serverId.value;

    var activeSessionId = state.currentScanId;
    if (activeSessionId == null) {
      if (state.canScanLocally) return null;
      activeSessionId = await _adoptRemoteSession(sessionId);
    }

    if (sessionId != activeSessionId) return null;

    final received = scannerProgressReceivedFromPayload(event.payload);
    final expected = scannerProgressExpectedFromPayload(event.payload);
    final total = scannerProgressTotalFromPayload(event.payload);
    final missing = scannerProgressMissingFromPayload(event.payload);
    final chunks = scannerProgressChunksFromPayload(event.payload);
    final hasRemoteMissingCount = chunks.any(
      (chunk) => chunk.missingCount != null,
    );
    if (received <= 0 && expected <= 0) return null;

    final rawFilename = normalizeScanFilename(
      event.payload['filename']?.toString(),
    );
    final filename = rawFilename != null && isNoteFilename(rawFilename)
        ? getDisplayNoteFilename(rawFilename)
        : rawFilename;
    final displayReceived = max(state.displayReceivedPackets, received);
    final displayExpected = max(state.displayExpectedPackets, expected);
    final displayProgress = normalizeIncompleteProgress(
      displayExpected > 0 ? displayReceived / displayExpected : state.progress,
    );
    final displayPercent = formatIncompleteProgressPercent(displayProgress);
    final remoteDeviceNameRaw = event.payload['deviceName']?.toString();
    final remoteDeviceName = remoteDeviceNameRaw?.trim();

    await _updateIncompleteProgress(
      progress: displayProgress,
      receivedPackets: displayReceived,
      expectedPackets: displayExpected,
      filename: filename,
    );

    return ScannerRemoteProgressResult(
      currentScanId: activeSessionId,
      remoteReceivedPackets: max(state.remoteReceivedPackets, received),
      remoteExpectedPackets: max(state.remoteExpectedPackets, expected),
      remoteTotalPackets: max(state.remoteTotalPackets, total),
      remoteMissingPackets: hasRemoteMissingCount
          ? missing
          : max(state.remoteMissingPackets, missing),
      remoteChunks: chunks.isNotEmpty ? chunks : state.remoteChunks,
      progress: displayProgress,
      status:
          'Session progress: $displayPercent% ($displayReceived/$displayExpected)',
      currentFilename: filename ?? state.currentFilename,
      syncSourceName: (remoteDeviceName != null && remoteDeviceName.isNotEmpty)
          ? remoteDeviceName
          : state.syncSourceName,
    );
  }

  Future<ScannerRemoteCompletionResult?> handleRemoteCompletion({
    required ScannerRemoteCompletionState state,
    required SyncEvent event,
  }) async {
    final serverId = ServerId.tryParse(event.payload['sessionId']);
    if (serverId == null) return null;
    final sessionId = serverId.value;

    var activeSessionId = state.currentScanId;
    if (activeSessionId == null) {
      if (state.canScanLocally) return null;
      activeSessionId = await _adoptRemoteSession(sessionId);
    }

    if (sessionId != activeSessionId || state.completionHandled) {
      return null;
    }

    final filename =
        normalizeScanFilename(asWireString(event.payload['filename'])) ??
        sessionId;
    final resultIsNote = isNoteFilename(filename);
    final displayFilename = resultIsNote
        ? getDisplayNoteFilename(filename)
        : filename;
    final remoteDeviceName = asWireString(event.payload['deviceName']);
    final mimeType = asWireString(event.payload['mimeType']);
    final sizeBytes = asWireInt(event.payload['size']) ?? 0;
    final durationSeconds = asWireDouble(event.payload['duration']) ?? 0;
    final sizeLabel = sizeBytes > 0 ? formatBytes(sizeBytes) : null;
    final subtitle = remoteDeviceName != null
        ? 'Completed on $remoteDeviceName'
        : 'Completed on another device';

    await _completeCurrentScan();
    try {
      await _syncAll();
    } catch (_) {}

    final statusLines = <String>[
      subtitle,
      filename,
      if (sizeLabel != null) sizeLabel,
      if (mimeType != null) mimeType,
    ];
    return ScannerRemoteCompletionResult(
      currentScanId: null,
      completionHandled: true,
      isCaptureActive: false,
      isProcessing: false,
      isScanning: false,
      progress: 1.0,
      resultIsNote: resultIsNote,
      resultNoteContent: null,
      resultFilename: displayFilename,
      resultSessionId: sessionId,
      resultFileSizeBytes: sizeBytes > 0 ? sizeBytes : null,
      resultDurationSeconds: durationSeconds > 0
          ? durationSeconds
          : state.scanDurationSeconds,
      resultSubtitle: subtitle,
      status: statusLines
          .map((line) => line == filename ? displayFilename : line)
          .join('\n'),
      snackBarMessage:
          'Scan synced: ${<String>[displayFilename, if (sizeLabel != null) sizeLabel].join(' • ')}',
    );
  }
}
