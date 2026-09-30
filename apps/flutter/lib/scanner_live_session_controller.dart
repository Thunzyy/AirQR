import 'package:flutter/foundation.dart';

import 'incomplete_scans.dart';
import 'scanner_session_resolution_controller.dart';
import 'scanner_session_progress.dart';

typedef ScannerResolveFreshSessionCallback =
    Future<ScannerSessionResolutionResult> Function(String? qrSessionId);
typedef ScannerStartNewSessionCallback =
    Future<String> Function({required String? sessionId});
typedef ScannerLiveSessionLogCallback = void Function(String message);

class ScannerLiveSessionState {
  final String? currentScanId;
  final bool isExplicitResume;
  final bool lockSessionIdToCurrent;
  final bool completionHandled;
  final String? currentFilename;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final List<ScannerChunkProgressInfo> remoteChunks;
  final DateTime? lastRemoteProgressFetch;
  final int? scanStartedAtMs;

  const ScannerLiveSessionState({
    required this.currentScanId,
    required this.isExplicitResume,
    required this.lockSessionIdToCurrent,
    required this.completionHandled,
    required this.currentFilename,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    this.remoteTotalPackets = 0,
    this.remoteMissingPackets = 0,
    this.remoteChunks = const <ScannerChunkProgressInfo>[],
    required this.lastRemoteProgressFetch,
    required this.scanStartedAtMs,
  });
}

sealed class ScannerLiveSessionTransition {
  const ScannerLiveSessionTransition();
}

class ScannerLiveSessionSkippedTransition extends ScannerLiveSessionTransition {
  const ScannerLiveSessionSkippedTransition();
}

class ScannerLiveSessionReadyTransition extends ScannerLiveSessionTransition {
  final String currentScanId;
  final bool isExplicitResume;
  final bool lockSessionIdToCurrent;
  final bool completionHandled;
  final String? currentFilename;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final List<ScannerChunkProgressInfo> remoteChunks;
  final DateTime? lastRemoteProgressFetch;
  final int? scanStartedAtMs;
  final bool shouldRefreshGlobalCounters;

  const ScannerLiveSessionReadyTransition({
    required this.currentScanId,
    required this.isExplicitResume,
    required this.lockSessionIdToCurrent,
    required this.completionHandled,
    required this.currentFilename,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    this.remoteTotalPackets = 0,
    this.remoteMissingPackets = 0,
    this.remoteChunks = const <ScannerChunkProgressInfo>[],
    required this.lastRemoteProgressFetch,
    required this.scanStartedAtMs,
    required this.shouldRefreshGlobalCounters,
  });
}

class ScannerLiveSessionController {
  final ScannerResolveFreshSessionCallback _resolveFreshSession;
  final ScannerStartNewSessionCallback _startNewSession;
  final ScannerLiveSessionLogCallback _log;

  ScannerLiveSessionController({
    required ScannerResolveFreshSessionCallback resolveFreshSession,
    ScannerStartNewSessionCallback? startNewSession,
    ScannerLiveSessionLogCallback? log,
  }) : _resolveFreshSession = resolveFreshSession,
       _startNewSession =
           startNewSession ?? IncompleteScanService.startNewSession,
       _log = log ?? debugPrint;

  Future<ScannerLiveSessionTransition> ensureSession({
    required String? qrSessionId,
    required ScannerLiveSessionState state,
  }) async {
    if (state.currentScanId == null) {
      final resolvedSession = await _resolveFreshSession(qrSessionId);
      if (resolvedSession.skipSession) {
        return const ScannerLiveSessionSkippedTransition();
      }

      final sessionId = await _startNewSession(
        sessionId: resolvedSession.sessionId,
      );
      _log('📱 SCAN_LOG: Started new session: $sessionId');
      return ScannerLiveSessionReadyTransition(
        currentScanId: sessionId,
        isExplicitResume: false,
        lockSessionIdToCurrent: resolvedSession.lockToCurrent,
        completionHandled: false,
        currentFilename: null,
        remoteReceivedPackets: 0,
        remoteExpectedPackets: 0,
        remoteTotalPackets: 0,
        remoteMissingPackets: 0,
        remoteChunks: const <ScannerChunkProgressInfo>[],
        lastRemoteProgressFetch: null,
        scanStartedAtMs: null,
        shouldRefreshGlobalCounters: true,
      );
    }

    if (qrSessionId != null && state.currentScanId != qrSessionId) {
      if (state.isExplicitResume || state.lockSessionIdToCurrent) {
        _log(
          '📱 SCAN_LOG: QR stream id=$qrSessionId differs from locked session=${state.currentScanId} — keeping current session',
        );
        return ScannerLiveSessionReadyTransition(
          currentScanId: state.currentScanId!,
          isExplicitResume: state.isExplicitResume,
          lockSessionIdToCurrent: state.lockSessionIdToCurrent,
          completionHandled: state.completionHandled,
          currentFilename: state.currentFilename,
          remoteReceivedPackets: state.remoteReceivedPackets,
          remoteExpectedPackets: state.remoteExpectedPackets,
          remoteTotalPackets: state.remoteTotalPackets,
          remoteMissingPackets: state.remoteMissingPackets,
          remoteChunks: state.remoteChunks,
          lastRemoteProgressFetch: state.lastRemoteProgressFetch,
          scanStartedAtMs: state.scanStartedAtMs,
          shouldRefreshGlobalCounters: false,
        );
      }

      final previousSessionId = state.currentScanId;
      final sessionId = await _startNewSession(sessionId: qrSessionId);
      _log('📱 SCAN_LOG: Switched session: $previousSessionId -> $sessionId');
      return ScannerLiveSessionReadyTransition(
        currentScanId: sessionId,
        isExplicitResume: false,
        lockSessionIdToCurrent: false,
        completionHandled: false,
        currentFilename: null,
        remoteReceivedPackets: 0,
        remoteExpectedPackets: 0,
        remoteTotalPackets: 0,
        remoteMissingPackets: 0,
        remoteChunks: const <ScannerChunkProgressInfo>[],
        lastRemoteProgressFetch: null,
        scanStartedAtMs: null,
        shouldRefreshGlobalCounters: true,
      );
    }

    return ScannerLiveSessionReadyTransition(
      currentScanId: state.currentScanId!,
      isExplicitResume: state.isExplicitResume,
      lockSessionIdToCurrent: state.lockSessionIdToCurrent,
      completionHandled: state.completionHandled,
      currentFilename: state.currentFilename,
      remoteReceivedPackets: state.remoteReceivedPackets,
      remoteExpectedPackets: state.remoteExpectedPackets,
      remoteTotalPackets: state.remoteTotalPackets,
      remoteMissingPackets: state.remoteMissingPackets,
      remoteChunks: state.remoteChunks,
      lastRemoteProgressFetch: state.lastRemoteProgressFetch,
      scanStartedAtMs: state.scanStartedAtMs,
      shouldRefreshGlobalCounters: false,
    );
  }
}
