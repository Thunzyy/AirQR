import 'dart:typed_data';

import 'scanner_replay_transition_controller.dart';
import 'scanner_resume_controller.dart';

class ScannerResumeBeginTransition {
  final bool completionHandled;
  final bool shouldClearLastProcessedBytes;
  final bool completedDuringResume;
  final bool isCaptureActive;
  final bool isProcessing;

  const ScannerResumeBeginTransition({
    required this.completionHandled,
    required this.shouldClearLastProcessedBytes,
    required this.completedDuringResume,
    required this.isCaptureActive,
    required this.isProcessing,
  });
}

class ScannerResumeLoadedTransition {
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final String? currentFilename;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final DateTime? lastRemoteProgressFetch;
  final String currentScanId;
  final bool isExplicitResume;
  final bool lockSessionIdToCurrent;
  final int? scanStartedAtMs;
  final String status;
  final double progress;
  final bool isScanning;
  final String syncSourceName;

  const ScannerResumeLoadedTransition({
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.currentFilename,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    required this.lastRemoteProgressFetch,
    required this.currentScanId,
    required this.isExplicitResume,
    required this.lockSessionIdToCurrent,
    required this.scanStartedAtMs,
    required this.status,
    required this.progress,
    required this.isScanning,
    required this.syncSourceName,
  });
}

class ScannerResumeReplayProgressUpdate {
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final double progress;
  final String status;

  const ScannerResumeReplayProgressUpdate({
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.progress,
    required this.status,
  });
}

class ScannerResumeReplayCompletionUpdate {
  final bool completionHandled;
  final bool completedDuringResume;
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

  const ScannerResumeReplayCompletionUpdate({
    required this.completionHandled,
    required this.completedDuringResume,
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

class ScannerResumeFinishTransition {
  final String status;
  final bool isCaptureActive;
  final String syncSourceName;

  const ScannerResumeFinishTransition({
    required this.status,
    required this.isCaptureActive,
    required this.syncSourceName,
  });
}

class ScannerResumeErrorTransition {
  final String status;

  const ScannerResumeErrorTransition({required this.status});
}

class ScannerResumeFlowController {
  const ScannerResumeFlowController();

  ScannerResumeBeginTransition beginResume() {
    return const ScannerResumeBeginTransition(
      completionHandled: false,
      shouldClearLastProcessedBytes: true,
      completedDuringResume: false,
      isCaptureActive: false,
      isProcessing: false,
    );
  }

  ScannerResumeLoadedTransition applyLoadedResume({
    required ScannerResumeLoadResult resumeState,
    required String localSyncSourceName,
  }) {
    return ScannerResumeLoadedTransition(
      receivedPackets: resumeState.receivedPackets,
      expectedPackets: resumeState.expectedPackets,
      totalPackets: resumeState.totalPackets,
      currentFilename: resumeState.currentFilename,
      remoteReceivedPackets: resumeState.remoteReceivedPackets,
      remoteExpectedPackets: resumeState.remoteExpectedPackets,
      lastRemoteProgressFetch: null,
      currentScanId: resumeState.currentScanId,
      isExplicitResume: resumeState.isExplicitResume,
      lockSessionIdToCurrent: resumeState.lockSessionIdToCurrent,
      scanStartedAtMs: null,
      status: resumeState.status,
      progress: resumeState.progress,
      isScanning: true,
      syncSourceName: localSyncSourceName,
    );
  }

  ScannerResumeReplayProgressUpdate applyReplayProgress(
    ScannerReplayProgressTransition transition,
  ) {
    return ScannerResumeReplayProgressUpdate(
      receivedPackets: transition.receivedPackets,
      expectedPackets: transition.expectedPackets,
      totalPackets: transition.totalPackets,
      progress: transition.progress,
      status: transition.status,
    );
  }

  ScannerResumeReplayCompletionUpdate applyReplayCompletion(
    ScannerReplayCompletedTransition transition,
  ) {
    return ScannerResumeReplayCompletionUpdate(
      completionHandled: true,
      completedDuringResume: true,
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
      resultSessionId: transition.completedSessionId,
      resultFileSizeBytes: transition.resultFileSizeBytes,
      resultDurationSeconds: transition.resultDurationSeconds,
      resultSavedPath: null,
      resultSubtitle: null,
      isScanning: false,
      shouldClearCorners: true,
      fileData: transition.fileData,
    );
  }

  ScannerResumeFinishTransition finishResume({
    required String localSyncSourceName,
  }) {
    return ScannerResumeFinishTransition(
      status: 'Scanning...',
      isCaptureActive: true,
      syncSourceName: localSyncSourceName,
    );
  }

  ScannerResumeErrorTransition applyResumeError(Object error) {
    return ScannerResumeErrorTransition(status: 'Resume error: $error');
  }
}
