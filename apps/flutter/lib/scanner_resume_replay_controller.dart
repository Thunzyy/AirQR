import 'dart:typed_data';

import 'scanner_replay_transition_controller.dart';
import 'scanner_resume_flow_controller.dart';
import 'src/rust/api/simple.dart';

typedef ScannerResumeReplayProcessChunkCallback =
    Future<DecodeStatus> Function(Uint8List packet);
typedef ScannerResumeReplayProgressCallback =
    void Function(
      ScannerResumeReplayProgressUpdate progressUpdate,
      int packetIndex,
      int totalPackets,
    );
typedef ScannerResumeReplayDurationCallback = double Function();

sealed class ScannerResumeReplayRunResult {
  const ScannerResumeReplayRunResult();
}

class ScannerResumeReplayFinishedResult extends ScannerResumeReplayRunResult {
  const ScannerResumeReplayFinishedResult();
}

class ScannerResumeReplayCompletedResult extends ScannerResumeReplayRunResult {
  final ScannerResumeReplayCompletionUpdate completionUpdate;

  const ScannerResumeReplayCompletedResult({required this.completionUpdate});
}

class ScannerResumeReplayInterruptedResult extends ScannerResumeReplayRunResult {
  final Object error;
  final StackTrace stackTrace;
  final int failedPacketIndex;
  final int totalPackets;

  const ScannerResumeReplayInterruptedResult({
    required this.error,
    required this.stackTrace,
    required this.failedPacketIndex,
    required this.totalPackets,
  });
}

class ScannerResumeReplayController {
  final ScannerReplayTransitionController _replayTransitionController;
  final ScannerResumeFlowController _resumeFlowController;

  ScannerResumeReplayController({
    ScannerReplayTransitionController? replayTransitionController,
    ScannerResumeFlowController? resumeFlowController,
  }) : _replayTransitionController =
           replayTransitionController ?? ScannerReplayTransitionController(),
       _resumeFlowController =
           resumeFlowController ?? const ScannerResumeFlowController();

  Future<ScannerResumeReplayRunResult> replay({
    required List<Uint8List> packets,
    required String? currentScanId,
    required bool completionHandled,
    required ScannerResumeReplayProcessChunkCallback processChunk,
    required ScannerResumeReplayDurationCallback scanDurationSeconds,
    required ScannerResumeReplayProgressCallback onProgress,
  }) async {
    for (var i = 0; i < packets.length; i++) {
      final DecodeStatus result;
      try {
        result = await processChunk(packets[i]);
      } catch (error, stackTrace) {
        return ScannerResumeReplayInterruptedResult(
          error: error,
          stackTrace: stackTrace,
          failedPacketIndex: i,
          totalPackets: packets.length,
        );
      }

      final transition = await _replayTransitionController.applyResult(
        result: result,
        currentScanId: currentScanId,
        completionHandled: completionHandled,
        scanDurationSeconds: scanDurationSeconds(),
      );

      if (transition case ScannerReplayProgressTransition progress) {
        onProgress(
          _resumeFlowController.applyReplayProgress(progress),
          i,
          packets.length,
        );
      } else if (transition case ScannerReplayCompletedTransition completion) {
        return ScannerResumeReplayCompletedResult(
          completionUpdate: _resumeFlowController.applyReplayCompletion(
            completion,
          ),
        );
      }
    }

    return const ScannerResumeReplayFinishedResult();
  }
}
