import 'package:flutter/material.dart';

class ScannerPageResetUpdate {
  final String? currentScanId;
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final String? currentFilename;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final bool lockSessionIdToCurrent;
  final int? scanStartedAtMs;
  final String? resultFilename;
  final String? resultSessionId;
  final String? resultSavedPath;
  final String? resultSubtitle;
  final bool resultIsNote;
  final String? resultNoteContent;
  final int? resultFileSizeBytes;
  final double resultDurationSeconds;
  final bool isSavingResultToDevice;
  final DateTime? lastRemoteProgressFetch;
  final bool completionHandled;
  final String status;
  final double progress;
  final bool isScanning;
  final bool isCaptureActive;
  final bool isProcessing;
  final Color overlayColor;
  final List<Offset> corners;
  final int fps;
  final int framesInCurrentSecond;
  final int lastFpsUpdate;
  final String syncSourceName;

  const ScannerPageResetUpdate({
    required this.currentScanId,
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.currentFilename,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    this.remoteTotalPackets = 0,
    this.remoteMissingPackets = 0,
    required this.lockSessionIdToCurrent,
    required this.scanStartedAtMs,
    required this.resultFilename,
    required this.resultSessionId,
    required this.resultSavedPath,
    required this.resultSubtitle,
    required this.resultIsNote,
    required this.resultNoteContent,
    required this.resultFileSizeBytes,
    required this.resultDurationSeconds,
    required this.isSavingResultToDevice,
    required this.lastRemoteProgressFetch,
    required this.completionHandled,
    required this.status,
    required this.progress,
    required this.isScanning,
    required this.isCaptureActive,
    required this.isProcessing,
    required this.overlayColor,
    required this.corners,
    required this.fps,
    required this.framesInCurrentSecond,
    required this.lastFpsUpdate,
    required this.syncSourceName,
  });
}

sealed class ScannerSaveResultStartTransition {
  const ScannerSaveResultStartTransition();
}

class ScannerSaveResultSkippedTransition
    extends ScannerSaveResultStartTransition {
  const ScannerSaveResultSkippedTransition();
}

class ScannerSaveResultStartedTransition
    extends ScannerSaveResultStartTransition {
  final bool isSavingResultToDevice;

  const ScannerSaveResultStartedTransition({
    required this.isSavingResultToDevice,
  });
}

class ScannerSaveResultFinishUpdate {
  final bool isSavingResultToDevice;
  final String? resultSavedPath;

  const ScannerSaveResultFinishUpdate({
    required this.isSavingResultToDevice,
    required this.resultSavedPath,
  });
}

class ScannerPageStateController {
  const ScannerPageStateController();

  ScannerPageResetUpdate applyReset({required String localSyncSourceName}) {
    return ScannerPageResetUpdate(
      currentScanId: null,
      receivedPackets: 0,
      expectedPackets: 0,
      totalPackets: 0,
      currentFilename: null,
      remoteReceivedPackets: 0,
      remoteExpectedPackets: 0,
      remoteTotalPackets: 0,
      remoteMissingPackets: 0,
      lockSessionIdToCurrent: false,
      scanStartedAtMs: null,
      resultFilename: null,
      resultSessionId: null,
      resultSavedPath: null,
      resultSubtitle: null,
      resultIsNote: false,
      resultNoteContent: null,
      resultFileSizeBytes: null,
      resultDurationSeconds: 0.0,
      isSavingResultToDevice: false,
      lastRemoteProgressFetch: null,
      completionHandled: false,
      status: 'Scanning...',
      progress: 0.0,
      isScanning: true,
      isCaptureActive: true,
      isProcessing: false,
      overlayColor: Colors.transparent,
      corners: const <Offset>[],
      fps: 0,
      framesInCurrentSecond: 0,
      lastFpsUpdate: 0,
      syncSourceName: localSyncSourceName,
    );
  }

  ScannerSaveResultStartTransition beginSavingResult({
    required bool isSavingResultToDevice,
    required bool isDisposed,
  }) {
    if (isSavingResultToDevice || isDisposed) {
      return const ScannerSaveResultSkippedTransition();
    }
    return const ScannerSaveResultStartedTransition(
      isSavingResultToDevice: true,
    );
  }

  ScannerSaveResultFinishUpdate applySaveResultSuccess({
    required String sourcePath,
  }) {
    return ScannerSaveResultFinishUpdate(
      isSavingResultToDevice: false,
      resultSavedPath: sourcePath,
    );
  }

  ScannerSaveResultFinishUpdate finishSavingResult({
    required String? currentSavedPath,
  }) {
    return ScannerSaveResultFinishUpdate(
      isSavingResultToDevice: false,
      resultSavedPath: currentSavedPath,
    );
  }
}
