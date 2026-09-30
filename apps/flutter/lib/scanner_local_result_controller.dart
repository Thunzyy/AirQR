import 'dart:typed_data';

import 'scanner_local_decode_controller.dart';

class ScannerLocalResultState {
  final bool completionHandled;
  final String? currentScanId;
  final String? currentFilename;
  final int currentTotalPackets;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int lastUpdateTime;
  final int framesInCurrentSecond;

  const ScannerLocalResultState({
    required this.completionHandled,
    required this.currentScanId,
    required this.currentFilename,
    this.currentTotalPackets = 0,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    required this.lastUpdateTime,
    required this.framesInCurrentSecond,
  });
}

class ScannerLocalProgressUpdate {
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final String? currentFilename;
  final double progress;
  final String status;
  final String syncSourceName;
  final int lastUpdateTime;
  final bool shouldRefreshGlobalCounters;
  final bool shouldApplyWidgetUpdate;

  const ScannerLocalProgressUpdate({
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.currentFilename,
    required this.progress,
    required this.status,
    required this.syncSourceName,
    required this.lastUpdateTime,
    required this.shouldRefreshGlobalCounters,
    required this.shouldApplyWidgetUpdate,
  });
}

class ScannerLocalCompletionUpdate {
  final bool completionHandled;
  final String? currentScanId;
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final String? currentFilename;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final double progress;
  final String status;
  final bool resultIsNote;
  final String? resultNoteContent;
  final String resultFilename;
  final String? resultSessionId;
  final int resultFileSizeBytes;
  final double resultDurationSeconds;
  final String? resultSavedPath;
  final String? resultSubtitle;
  final bool isScanning;
  final bool shouldClearCorners;
  final Uint8List fileData;

  const ScannerLocalCompletionUpdate({
    required this.completionHandled,
    required this.currentScanId,
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.currentFilename,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    required this.progress,
    required this.status,
    required this.resultIsNote,
    required this.resultNoteContent,
    required this.resultFilename,
    required this.resultSessionId,
    required this.resultFileSizeBytes,
    required this.resultDurationSeconds,
    required this.resultSavedPath,
    required this.resultSubtitle,
    required this.isScanning,
    required this.shouldClearCorners,
    required this.fileData,
  });
}

class ScannerLocalErrorUpdate {
  final String status;

  const ScannerLocalErrorUpdate({required this.status});
}

class ScannerLocalResultController {
  const ScannerLocalResultController();

  ScannerLocalProgressUpdate applyProgress({
    required ScannerLocalProgressTransition transition,
    required ScannerLocalResultState state,
    required int nowMillis,
  }) {
    final shouldApplyWidgetUpdate =
        nowMillis - state.lastUpdateTime > 100 ||
        state.framesInCurrentSecond == 0;
    final currentFilename = transition.currentFilename ?? state.currentFilename;

    return ScannerLocalProgressUpdate(
      receivedPackets: transition.receivedPackets,
      expectedPackets: transition.expectedPackets,
      totalPackets: transition.totalPackets > 0
          ? transition.totalPackets
          : state.currentTotalPackets,
      currentFilename: currentFilename,
      progress: transition.progress,
      status: transition.status,
      syncSourceName: transition.syncSourceName,
      lastUpdateTime: shouldApplyWidgetUpdate ? nowMillis : state.lastUpdateTime,
      shouldRefreshGlobalCounters: transition.shouldRefreshGlobalCounters,
      shouldApplyWidgetUpdate: shouldApplyWidgetUpdate,
    );
  }

  ScannerLocalCompletionUpdate applyCompletion({
    required ScannerLocalCompletedTransition transition,
  }) {
    return ScannerLocalCompletionUpdate(
      completionHandled: transition.completionHandled,
      currentScanId: null,
      receivedPackets: 0,
      expectedPackets: 0,
      totalPackets: transition.totalPackets,
      currentFilename: null,
      remoteReceivedPackets: 0,
      remoteExpectedPackets: 0,
      progress: transition.progress,
      status: transition.status,
      resultIsNote: transition.resultIsNote,
      resultNoteContent: transition.resultNoteContent,
      resultFilename: transition.resultFilename,
      resultSessionId: transition.resultSessionId,
      resultFileSizeBytes: transition.resultFileSizeBytes,
      resultDurationSeconds: transition.resultDurationSeconds,
      resultSavedPath: null,
      resultSubtitle: null,
      isScanning: false,
      shouldClearCorners: true,
      fileData: transition.fileData,
    );
  }

  ScannerLocalErrorUpdate applyError(ScannerLocalErrorTransition transition) {
    return ScannerLocalErrorUpdate(status: transition.status);
  }
}
