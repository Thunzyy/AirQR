import 'dart:math';

import 'incomplete_scans.dart';
import 'note_detection.dart';
import 'scanner_session_progress.dart';
import 'parse/wire.dart';

typedef ScannerRemoteSnapshotUpdateProgressCallback =
    Future<void> Function({
      required double progress,
      required int receivedPackets,
      required int expectedPackets,
      required String? filename,
    });

class ScannerRemoteSnapshotRequestState {
  final bool syncScannedEnabled;
  final String? currentScanId;
  final bool remoteProgressInFlight;
  final DateTime? lastRemoteProgressFetch;

  const ScannerRemoteSnapshotRequestState({
    required this.syncScannedEnabled,
    required this.currentScanId,
    required this.remoteProgressInFlight,
    required this.lastRemoteProgressFetch,
  });
}

class ScannerRemoteSnapshotRequest {
  final String targetSessionId;
  final DateTime nextLastRemoteProgressFetch;

  const ScannerRemoteSnapshotRequest({
    required this.targetSessionId,
    required this.nextLastRemoteProgressFetch,
  });
}

class ScannerRemoteSnapshotState {
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

  const ScannerRemoteSnapshotState({
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
  });
}

class ScannerRemoteSnapshotResult {
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final List<ScannerChunkProgressInfo> remoteChunks;
  final double progress;
  final String status;
  final String? currentFilename;

  const ScannerRemoteSnapshotResult({
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    this.remoteTotalPackets = 0,
    this.remoteMissingPackets = 0,
    this.remoteChunks = const <ScannerChunkProgressInfo>[],
    required this.progress,
    required this.status,
    required this.currentFilename,
  });
}

class ScannerRemoteSnapshotController {
  final ScannerRemoteSnapshotUpdateProgressCallback _updateIncompleteProgress;

  ScannerRemoteSnapshotController({
    ScannerRemoteSnapshotUpdateProgressCallback? updateIncompleteProgress,
  }) : _updateIncompleteProgress =
           updateIncompleteProgress ?? IncompleteScanService.updateProgress;

  ScannerRemoteSnapshotRequest? prepareRequest({
    required ScannerRemoteSnapshotRequestState state,
    required String? sessionId,
    required bool force,
    required DateTime now,
  }) {
    if (!state.syncScannedEnabled) return null;
    final targetSessionId = sessionId ?? state.currentScanId;
    if (targetSessionId == null) return null;
    if (state.remoteProgressInFlight) return null;
    if (!force &&
        state.lastRemoteProgressFetch != null &&
        now.difference(state.lastRemoteProgressFetch!) <
            const Duration(milliseconds: 750)) {
      return null;
    }

    return ScannerRemoteSnapshotRequest(
      targetSessionId: targetSessionId,
      nextLastRemoteProgressFetch: now,
    );
  }

  Future<ScannerRemoteSnapshotResult?> applySnapshot({
    required ScannerRemoteSnapshotState state,
    required String targetSessionId,
    required Object? sessionInfo,
  }) async {
    if (sessionInfo == null) return null;
    if (state.currentScanId != targetSessionId) return null;

    final object = asWireObject(sessionInfo);
    final received = scannerProgressReceivedFromPayload(object);
    final expected = scannerProgressExpectedFromPayload(object);
    final total = scannerProgressTotalFromPayload(object);
    final missing = scannerProgressMissingFromPayload(object);
    final chunks = scannerProgressChunksFromPayload(object);
    final hasRemoteMissingCount = chunks.any(
      (chunk) => chunk.missingCount != null,
    );
    final rawFilename = normalizeScanFilename(
      asWireString(object['filename']),
    );
    final filename = rawFilename != null && isNoteFilename(rawFilename)
        ? getDisplayNoteFilename(rawFilename)
        : rawFilename;

    if (received <= 0 && expected <= 0) return null;

    final displayReceived = max(state.displayReceivedPackets, received);
    final displayExpected = max(state.displayExpectedPackets, expected);
    final displayProgress = normalizeIncompleteProgress(
      displayExpected > 0 ? displayReceived / displayExpected : state.progress,
    );
    final displayPercent = formatIncompleteProgressPercent(displayProgress);

    await _updateIncompleteProgress(
      progress: displayProgress,
      receivedPackets: displayReceived,
      expectedPackets: displayExpected,
      filename: filename ?? state.currentFilename,
    );

    return ScannerRemoteSnapshotResult(
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
    );
  }
}
