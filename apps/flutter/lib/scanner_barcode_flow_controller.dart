import 'dart:typed_data';

import 'scanner_live_session_controller.dart';
import 'scanner_local_decode_controller.dart';
import 'scanner_local_result_controller.dart';
import 'scanner_session_progress.dart';
import 'server_id.dart';
import 'src/rust/api/simple.dart';

typedef ScannerBarcodeEnsureSessionCallback =
    Future<ScannerLiveSessionTransition> Function({
      required String? qrSessionId,
      required ScannerLiveSessionState state,
    });
typedef ScannerBarcodeApplyLocalDecodeCallback =
    Future<ScannerLocalDecodeTransition> Function({
      required DecodeStatus result,
      required Uint8List rawBytes,
      required ScannerLocalDecodeState state,
      required String localSyncSourceName,
    });
typedef ScannerBarcodeApplyProgressResultCallback =
    ScannerLocalProgressUpdate Function({
      required ScannerLocalProgressTransition transition,
      required ScannerLocalResultState state,
      required int nowMillis,
    });
typedef ScannerBarcodeApplyCompletionResultCallback =
    ScannerLocalCompletionUpdate Function({
      required ScannerLocalCompletedTransition transition,
    });
typedef ScannerBarcodeApplyErrorResultCallback =
    ScannerLocalErrorUpdate Function(ScannerLocalErrorTransition transition);

class ScannerBarcodeFlowState {
  final String? currentScanId;
  final bool isExplicitResume;
  final bool lockSessionIdToCurrent;
  final bool completionHandled;
  final String? currentFilename;
  final int currentTotalPackets;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final int remoteTotalPackets;
  final int remoteMissingPackets;
  final List<ScannerChunkProgressInfo> remoteChunks;
  final DateTime? lastRemoteProgressFetch;
  final int? scanStartedAtMs;
  final int displayReceivedPackets;
  final int displayExpectedPackets;
  final double progress;
  final double scanDurationSeconds;
  final String? syncSourceName;
  final bool serverAuthoritative;
  final int lastUpdateTime;
  final int framesInCurrentSecond;

  const ScannerBarcodeFlowState({
    required this.currentScanId,
    required this.isExplicitResume,
    required this.lockSessionIdToCurrent,
    required this.completionHandled,
    required this.currentFilename,
    this.currentTotalPackets = 0,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    this.remoteTotalPackets = 0,
    this.remoteMissingPackets = 0,
    this.remoteChunks = const <ScannerChunkProgressInfo>[],
    required this.lastRemoteProgressFetch,
    required this.scanStartedAtMs,
    required this.displayReceivedPackets,
    required this.displayExpectedPackets,
    required this.progress,
    required this.scanDurationSeconds,
    required this.syncSourceName,
    this.serverAuthoritative = false,
    required this.lastUpdateTime,
    required this.framesInCurrentSecond,
  });
}

sealed class ScannerBarcodeFlowTransition {
  const ScannerBarcodeFlowTransition();
}

class ScannerBarcodeIgnoredTransition extends ScannerBarcodeFlowTransition {
  const ScannerBarcodeIgnoredTransition();
}

class ScannerBarcodeProgressFlowTransition
    extends ScannerBarcodeFlowTransition {
  final ScannerLiveSessionReadyTransition session;
  final ScannerLocalProgressUpdate progressUpdate;
  final String? qrSessionId;
  final int? scanStartedAtMs;
  final bool shouldForceGlobalCounterRefresh;

  const ScannerBarcodeProgressFlowTransition({
    required this.session,
    required this.progressUpdate,
    required this.qrSessionId,
    required this.scanStartedAtMs,
    required this.shouldForceGlobalCounterRefresh,
  });
}

class ScannerBarcodeCompletedFlowTransition
    extends ScannerBarcodeFlowTransition {
  final ScannerLocalCompletionUpdate completionUpdate;

  const ScannerBarcodeCompletedFlowTransition({required this.completionUpdate});
}

class ScannerBarcodeErrorFlowTransition extends ScannerBarcodeFlowTransition {
  final ScannerLocalErrorUpdate errorUpdate;

  const ScannerBarcodeErrorFlowTransition({required this.errorUpdate});
}

class ScannerBarcodeFlowController {
  final ScannerBarcodeEnsureSessionCallback _ensureSession;
  final ScannerBarcodeApplyLocalDecodeCallback _applyLocalDecode;
  final ScannerBarcodeApplyProgressResultCallback _applyProgressResult;
  final ScannerBarcodeApplyCompletionResultCallback _applyCompletionResult;
  final ScannerBarcodeApplyErrorResultCallback _applyErrorResult;

  ScannerBarcodeFlowController({
    ScannerBarcodeEnsureSessionCallback? ensureSession,
    ScannerBarcodeApplyLocalDecodeCallback? applyLocalDecode,
    ScannerBarcodeApplyProgressResultCallback? applyProgressResult,
    ScannerBarcodeApplyCompletionResultCallback? applyCompletionResult,
    ScannerBarcodeApplyErrorResultCallback? applyErrorResult,
  }) : _ensureSession =
           ensureSession ??
           (({
             required qrSessionId,
             required state,
           }) => Future<ScannerLiveSessionTransition>.error(
             UnimplementedError(
               'ScannerBarcodeFlowController requires ensureSession when using the default constructor.',
             ),
           )),
       _applyLocalDecode =
           applyLocalDecode ??
           (({
             required result,
             required rawBytes,
             required state,
             required localSyncSourceName,
           }) => ScannerLocalDecodeController().applyResult(
             result: result,
             rawBytes: rawBytes,
             state: state,
             localSyncSourceName: localSyncSourceName,
           )),
       _applyProgressResult =
           applyProgressResult ??
           (({required transition, required state, required nowMillis}) =>
               const ScannerLocalResultController().applyProgress(
                 transition: transition,
                 state: state,
                 nowMillis: nowMillis,
               )),
       _applyCompletionResult =
           applyCompletionResult ??
           (({required transition}) => const ScannerLocalResultController()
               .applyCompletion(transition: transition)),
       _applyErrorResult =
           applyErrorResult ??
           ((transition) =>
               const ScannerLocalResultController().applyError(transition));

  Future<ScannerBarcodeFlowTransition> handle({
    required DecodeStatus result,
    required Uint8List rawBytes,
    required ScannerBarcodeFlowState state,
    required int nowMillis,
    required String localSyncSourceName,
  }) async {
    if (result.status == 'Progress') {
      return _handleProgress(
        result: result,
        rawBytes: rawBytes,
        state: state,
        nowMillis: nowMillis,
        localSyncSourceName: localSyncSourceName,
      );
    }

    final transition = await _applyLocalDecode(
      result: result,
      rawBytes: rawBytes,
      state: ScannerLocalDecodeState(
        currentScanId: state.currentScanId,
        completionHandled: state.completionHandled,
        displayReceivedPackets: state.displayReceivedPackets,
        displayExpectedPackets: state.displayExpectedPackets,
        progress: state.progress,
        scanDurationSeconds: state.scanDurationSeconds,
        syncSourceName: state.syncSourceName,
        serverAuthoritative: state.serverAuthoritative,
      ),
      localSyncSourceName: localSyncSourceName,
    );

    if (transition case ScannerLocalCompletedTransition completion) {
      return ScannerBarcodeCompletedFlowTransition(
        completionUpdate: _applyCompletionResult(transition: completion),
      );
    }
    if (transition case ScannerLocalErrorTransition error) {
      return ScannerBarcodeErrorFlowTransition(
        errorUpdate: _applyErrorResult(error),
      );
    }
    return const ScannerBarcodeIgnoredTransition();
  }

  Future<ScannerBarcodeFlowTransition> _handleProgress({
    required DecodeStatus result,
    required Uint8List rawBytes,
    required ScannerBarcodeFlowState state,
    required int nowMillis,
    required String localSyncSourceName,
  }) async {
    final qrSessionId =
        ServerId.tryFromPositiveInt(result.sessionId)?.value ??
        _extractSessionId(rawBytes);
    final sessionTransition = await _ensureSession(
      qrSessionId: qrSessionId,
      state: ScannerLiveSessionState(
        currentScanId: state.currentScanId,
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
      ),
    );
    if (sessionTransition case ScannerLiveSessionSkippedTransition()) {
      return const ScannerBarcodeIgnoredTransition();
    }

    final readySession = sessionTransition as ScannerLiveSessionReadyTransition;
    final localTransition = await _applyLocalDecode(
      result: result,
      rawBytes: rawBytes,
      state: ScannerLocalDecodeState(
        currentScanId: readySession.currentScanId,
        completionHandled: readySession.completionHandled,
        displayReceivedPackets: state.displayReceivedPackets,
        displayExpectedPackets: state.displayExpectedPackets,
        progress: state.progress,
        scanDurationSeconds: state.scanDurationSeconds,
        syncSourceName: state.syncSourceName,
        serverAuthoritative: state.serverAuthoritative,
      ),
      localSyncSourceName: localSyncSourceName,
    );
    if (localTransition case ScannerLocalProgressTransition progress) {
      final progressUpdate = _applyProgressResult(
        transition: progress,
        state: ScannerLocalResultState(
          completionHandled: readySession.completionHandled,
          currentScanId: readySession.currentScanId,
          currentFilename: readySession.currentFilename,
          currentTotalPackets: state.currentTotalPackets,
          remoteReceivedPackets: readySession.remoteReceivedPackets,
          remoteExpectedPackets: readySession.remoteExpectedPackets,
          lastUpdateTime: state.lastUpdateTime,
          framesInCurrentSecond: state.framesInCurrentSecond,
        ),
        nowMillis: nowMillis,
      );
      return ScannerBarcodeProgressFlowTransition(
        session: readySession,
        progressUpdate: progressUpdate,
        qrSessionId: qrSessionId,
        scanStartedAtMs: readySession.scanStartedAtMs ?? nowMillis,
        shouldForceGlobalCounterRefresh:
            readySession.shouldRefreshGlobalCounters,
      );
    }
    if (localTransition case ScannerLocalErrorTransition error) {
      return ScannerBarcodeErrorFlowTransition(
        errorUpdate: _applyErrorResult(error),
      );
    }
    return const ScannerBarcodeIgnoredTransition();
  }

  String? _extractSessionId(Uint8List bytes) {
    if (bytes.length < 31 || bytes[0] != 1) return null;
    try {
      final view = ByteData.sublistView(bytes);
      return ServerId.tryFromPositiveInt(view.getUint32(1))?.value;
    } catch (_) {
      return null;
    }
  }
}
