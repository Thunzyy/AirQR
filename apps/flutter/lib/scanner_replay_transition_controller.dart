import 'dart:typed_data';

import 'incomplete_scans.dart';
import 'note_detection.dart';
import 'src/rust/api/simple.dart';

typedef ScannerReplayCompleteCurrentScanCallback = Future<void> Function();
typedef ScannerReplayNowMillisCallback = int Function();

sealed class ScannerReplayTransition {
  const ScannerReplayTransition();
}

class ScannerReplayIgnoredTransition extends ScannerReplayTransition {
  const ScannerReplayIgnoredTransition();
}

class ScannerReplayProgressTransition extends ScannerReplayTransition {
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final double progress;
  final String status;

  const ScannerReplayProgressTransition({
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.progress,
    required this.status,
  });
}

class ScannerReplayCompletedTransition extends ScannerReplayTransition {
  final String? completedSessionId;
  final Uint8List fileData;
  final bool resultIsNote;
  final String? resultNoteContent;
  final String resultFilename;
  final int resultFileSizeBytes;
  final double resultDurationSeconds;
  final double progress;
  final String status;
  final int totalPackets;

  const ScannerReplayCompletedTransition({
    required this.completedSessionId,
    required this.fileData,
    required this.resultIsNote,
    required this.resultNoteContent,
    required this.resultFilename,
    required this.resultFileSizeBytes,
    required this.resultDurationSeconds,
    required this.progress,
    required this.status,
    required this.totalPackets,
  });
}

class ScannerReplayTransitionController {
  final ScannerReplayCompleteCurrentScanCallback _completeCurrentScan;
  final ScannerReplayNowMillisCallback _nowMillis;

  ScannerReplayTransitionController({
    ScannerReplayCompleteCurrentScanCallback? completeCurrentScan,
    ScannerReplayNowMillisCallback? nowMillis,
  }) : _completeCurrentScan =
           completeCurrentScan ?? IncompleteScanService.completeCurrentScan,
       _nowMillis = nowMillis ?? (() => DateTime.now().millisecondsSinceEpoch);

  Future<ScannerReplayTransition> applyResult({
    required DecodeStatus result,
    required String? currentScanId,
    required bool completionHandled,
    required double scanDurationSeconds,
  }) async {
    if (result.status == 'Progress') {
      final progress = normalizeIncompleteProgress(result.percent / 100.0);
      final percent = formatIncompleteProgressPercent(progress);
      return ScannerReplayProgressTransition(
        receivedPackets: result.receivedPackets,
        expectedPackets: result.expectedPackets,
        totalPackets: result.totalPackets,
        progress: progress,
        status:
            'Resuming: $percent% (${result.receivedPackets}/${result.expectedPackets})',
      );
    }

    if (result.status == 'Completed') {
      if (completionHandled || result.fileData == null) {
        return const ScannerReplayIgnoredTransition();
      }

      final completedSessionId = currentScanId;
      await _completeCurrentScan();

      final transportFilename =
          normalizeScanFilename(result.filename) ??
          'received_${_nowMillis()}.bin';
      final resultIsNote = isNoteFilename(transportFilename);
      final resultFilename = resultIsNote
          ? getDisplayNoteFilename(transportFilename)
          : transportFilename;
      final resultNoteContent = resultIsNote
          ? decodeNoteContent(result.fileData!)
          : null;
      final durationSec = scanDurationSeconds.toStringAsFixed(1);
      final sizeKb = (result.fileData!.length / 1024).toStringAsFixed(1);

      return ScannerReplayCompletedTransition(
        completedSessionId: completedSessionId,
        fileData: result.fileData!,
        resultIsNote: resultIsNote,
        resultNoteContent: resultNoteContent,
        resultFilename: resultFilename,
        resultFileSizeBytes: result.fileData!.length,
        resultDurationSeconds: scanDurationSeconds,
        progress: 1.0,
        totalPackets: result.totalPackets,
        status:
            'Completed! $resultFilename\nTime: ${durationSec}s | Size: $sizeKb KB\nFrames: ${result.totalPackets}',
      );
    }

    return const ScannerReplayIgnoredTransition();
  }
}
