import 'scanner_sync_controller.dart';
import 'scanner_session_progress.dart';
import 'server_id.dart';
import 'websocket_sync.dart';
import 'parse/wire.dart';

typedef ScannerRemoteEventAdoptSessionCallback =
    Future<String> Function(String sessionId);
typedef ScannerRemoteEventHandleProgressCallback =
    Future<ScannerRemoteProgressResult?> Function({
      required ScannerRemoteProgressState state,
      required SyncEvent event,
    });
typedef ScannerRemoteEventHandleCompletionCallback =
    Future<ScannerRemoteCompletionResult?> Function({
      required ScannerRemoteCompletionState state,
      required SyncEvent event,
    });

class ScannerRemoteEventState {
  final bool canScanLocally;
  final String? currentScanId;
  final bool completionHandled;
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
  final double scanDurationSeconds;

  const ScannerRemoteEventState({
    required this.canScanLocally,
    required this.currentScanId,
    required this.completionHandled,
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
    required this.scanDurationSeconds,
  });
}

sealed class ScannerRemoteProgressEventTransition {
  const ScannerRemoteProgressEventTransition();
}

class ScannerRemoteProgressIgnoredTransition
    extends ScannerRemoteProgressEventTransition {
  const ScannerRemoteProgressIgnoredTransition();
}

class ScannerRemoteProgressSnapshotTransition
    extends ScannerRemoteProgressEventTransition {
  final String currentScanId;
  final bool completionHandled;
  final String snapshotSessionId;

  const ScannerRemoteProgressSnapshotTransition({
    required this.currentScanId,
    required this.completionHandled,
    required this.snapshotSessionId,
  });
}

class ScannerRemoteProgressUpdateTransition
    extends ScannerRemoteProgressEventTransition {
  final String currentScanId;
  final bool completionHandled;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final List<ScannerChunkProgressInfo> remoteChunks;
  final double progress;
  final String status;
  final String? currentFilename;
  final String? syncSourceName;

  const ScannerRemoteProgressUpdateTransition({
    required this.currentScanId,
    required this.completionHandled,
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

class ScannerRemoteCompletionViewTransition {
  final String? currentScanId;
  final bool completionHandled;
  final bool isCaptureActive;
  final bool isProcessing;
  final bool isScanning;
  final bool isExplicitResume;
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final String? currentFilename;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final List<ScannerChunkProgressInfo> remoteChunks;
  final DateTime? lastRemoteProgressFetch;
  final double progress;
  final bool resultIsNote;
  final String? resultNoteContent;
  final String resultFilename;
  final String resultSessionId;
  final int? resultFileSizeBytes;
  final double resultDurationSeconds;
  final String? resultSavedPath;
  final String? resultSubtitle;
  final String status;
  final bool shouldClearCorners;
  final String snackBarMessage;

  const ScannerRemoteCompletionViewTransition({
    required this.currentScanId,
    required this.completionHandled,
    required this.isCaptureActive,
    required this.isProcessing,
    required this.isScanning,
    required this.isExplicitResume,
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.currentFilename,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    this.remoteTotalPackets = 0,
    this.remoteMissingPackets = 0,
    this.remoteChunks = const <ScannerChunkProgressInfo>[],
    required this.lastRemoteProgressFetch,
    required this.progress,
    required this.resultIsNote,
    required this.resultNoteContent,
    required this.resultFilename,
    required this.resultSessionId,
    required this.resultFileSizeBytes,
    required this.resultDurationSeconds,
    required this.resultSavedPath,
    required this.resultSubtitle,
    required this.status,
    required this.shouldClearCorners,
    required this.snackBarMessage,
  });
}

class ScannerRemoteEventController {
  final ScannerRemoteEventAdoptSessionCallback _adoptRemoteSession;
  final ScannerRemoteEventHandleProgressCallback _handleRemoteProgress;
  final ScannerRemoteEventHandleCompletionCallback _handleRemoteCompletion;

  ScannerRemoteEventController({
    ScannerRemoteEventAdoptSessionCallback? adoptRemoteSession,
    ScannerRemoteEventHandleProgressCallback? handleRemoteProgress,
    ScannerRemoteEventHandleCompletionCallback? handleRemoteCompletion,
  }) : _adoptRemoteSession =
           adoptRemoteSession ??
           ((sessionId) => Future<String>.value(sessionId)),
       _handleRemoteProgress =
           handleRemoteProgress ??
           (({required state, required event}) => ScannerSyncController()
               .handleRemoteProgress(state: state, event: event)),
       _handleRemoteCompletion =
           handleRemoteCompletion ??
           (({required state, required event}) => ScannerSyncController()
               .handleRemoteCompletion(state: state, event: event));

  Future<ScannerRemoteProgressEventTransition> handleProgress({
    required ScannerRemoteEventState state,
    required SyncEvent event,
  }) async {
    final serverId = ServerId.tryParse(event.payload['sessionId']);
    if (serverId == null) {
      return const ScannerRemoteProgressIgnoredTransition();
    }
    final sessionId = serverId.value;

    var activeSessionId = state.currentScanId;
    var completionHandled = state.completionHandled;
    if (activeSessionId == null) {
      if (state.canScanLocally) {
        return const ScannerRemoteProgressIgnoredTransition();
      }
      activeSessionId = await _adoptRemoteSession(sessionId);
      completionHandled = false;
    }

    if (sessionId != activeSessionId) {
      return const ScannerRemoteProgressIgnoredTransition();
    }

    final payloadReceived = asWireInt(
      event.payload['receivedPackets'] ??
          event.payload['receivedCount'] ??
          event.payload['packetCount'],
    ) ?? 0;
    final payloadExpected = asWireInt(
      event.payload['expectedPackets'] ?? event.payload['totalPackets'],
    ) ?? 0;

    if (payloadReceived <= 0 && payloadExpected <= 0) {
      return ScannerRemoteProgressSnapshotTransition(
        currentScanId: activeSessionId,
        completionHandled: completionHandled,
        snapshotSessionId: sessionId,
      );
    }

    final result = await _handleRemoteProgress(
      state: ScannerRemoteProgressState(
        canScanLocally: state.canScanLocally,
        currentScanId: activeSessionId,
        displayReceivedPackets: state.displayReceivedPackets,
        displayExpectedPackets: state.displayExpectedPackets,
        displayTotalPackets: state.displayTotalPackets,
        remoteReceivedPackets: state.remoteReceivedPackets,
        remoteExpectedPackets: state.remoteExpectedPackets,
        remoteTotalPackets: state.remoteTotalPackets,
        remoteMissingPackets: state.remoteMissingPackets,
        remoteChunks: state.remoteChunks,
        progress: state.progress,
        currentFilename: state.currentFilename,
        syncSourceName: state.syncSourceName,
      ),
      event: event,
    );
    if (result == null) return const ScannerRemoteProgressIgnoredTransition();

    return ScannerRemoteProgressUpdateTransition(
      currentScanId: result.currentScanId,
      completionHandled: completionHandled,
      remoteReceivedPackets: result.remoteReceivedPackets,
      remoteExpectedPackets: result.remoteExpectedPackets,
      remoteTotalPackets: result.remoteTotalPackets,
      remoteMissingPackets: result.remoteMissingPackets,
      remoteChunks: result.remoteChunks,
      progress: result.progress,
      status: result.status,
      currentFilename: result.currentFilename,
      syncSourceName: result.syncSourceName,
    );
  }

  Future<ScannerRemoteCompletionViewTransition?> handleCompletion({
    required ScannerRemoteEventState state,
    required SyncEvent event,
  }) async {
    final result = await _handleRemoteCompletion(
      state: ScannerRemoteCompletionState(
        canScanLocally: state.canScanLocally,
        currentScanId: state.currentScanId,
        completionHandled: state.completionHandled,
        scanDurationSeconds: state.scanDurationSeconds,
      ),
      event: event,
    );
    if (result == null) return null;

    return ScannerRemoteCompletionViewTransition(
      currentScanId: result.currentScanId,
      completionHandled: result.completionHandled,
      isCaptureActive: result.isCaptureActive,
      isProcessing: result.isProcessing,
      isScanning: result.isScanning,
      isExplicitResume: false,
      receivedPackets: 0,
      expectedPackets: 0,
      totalPackets: 0,
      currentFilename: null,
      remoteReceivedPackets: 0,
      remoteExpectedPackets: 0,
      remoteTotalPackets: 0,
      remoteMissingPackets: 0,
      remoteChunks: const <ScannerChunkProgressInfo>[],
      lastRemoteProgressFetch: null,
      progress: result.progress,
      resultIsNote: result.resultIsNote,
      resultNoteContent: result.resultNoteContent,
      resultFilename: result.resultFilename,
      resultSessionId: result.resultSessionId,
      resultFileSizeBytes: result.resultFileSizeBytes,
      resultDurationSeconds: result.resultDurationSeconds,
      resultSavedPath: null,
      resultSubtitle: result.resultSubtitle,
      status: result.status,
      shouldClearCorners: true,
      snackBarMessage: result.snackBarMessage,
    );
  }
}
