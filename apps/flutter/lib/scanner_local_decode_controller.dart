import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';

import 'incomplete_scans.dart';
import 'note_detection.dart';
import 'server_id.dart';
import 'src/rust/api/simple.dart';
import 'websocket_sync.dart';

typedef ScannerLocalSavePacketCallback =
    Future<void> Function(int packetIndex, Uint8List packetData);
typedef ScannerLocalUploadPacketCallback =
    Future<bool> Function({
      required String sessionId,
      required Uint8List packetData,
      String? filename,
      String? resultType,
      int? receivedPackets,
      int? expectedPackets,
    });
typedef ScannerLocalRealtimePacketCallback =
    void Function({
      required String sessionId,
      required Uint8List packetBytes,
      String? filename,
      required int receivedPackets,
      required int expectedPackets,
    });
typedef ScannerLocalUpdateProgressCallback =
    Future<void> Function({
      required double progress,
      required int receivedPackets,
      required int expectedPackets,
      String? filename,
    });
typedef ScannerLocalCompleteScanCallback = Future<void> Function();
typedef ScannerLocalNowMillisCallback = int Function();
typedef ScannerLocalLogCallback = void Function(String message);

class ScannerLocalDecodeState {
  final String? currentScanId;
  final bool completionHandled;
  final int displayReceivedPackets;
  final int displayExpectedPackets;
  final double progress;
  final double scanDurationSeconds;
  final String? syncSourceName;
  final bool serverAuthoritative;

  const ScannerLocalDecodeState({
    required this.currentScanId,
    required this.completionHandled,
    required this.displayReceivedPackets,
    required this.displayExpectedPackets,
    required this.progress,
    required this.scanDurationSeconds,
    required this.syncSourceName,
    this.serverAuthoritative = false,
  });
}

sealed class ScannerLocalDecodeTransition {
  const ScannerLocalDecodeTransition();
}

class ScannerLocalIgnoredTransition extends ScannerLocalDecodeTransition {
  const ScannerLocalIgnoredTransition();
}

class ScannerLocalProgressTransition extends ScannerLocalDecodeTransition {
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final double progress;
  final String status;
  final String? currentFilename;
  final String syncSourceName;
  final bool shouldRefreshGlobalCounters;

  const ScannerLocalProgressTransition({
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.progress,
    required this.status,
    required this.currentFilename,
    required this.syncSourceName,
    required this.shouldRefreshGlobalCounters,
  });
}

class ScannerLocalCompletedTransition extends ScannerLocalDecodeTransition {
  final bool completionHandled;
  final double progress;
  final String status;
  final int totalPackets;
  final bool resultIsNote;
  final String? resultNoteContent;
  final String resultFilename;
  final String? resultSessionId;
  final int resultFileSizeBytes;
  final double resultDurationSeconds;
  final Uint8List fileData;

  const ScannerLocalCompletedTransition({
    required this.completionHandled,
    required this.progress,
    required this.status,
    this.totalPackets = 0,
    required this.resultIsNote,
    required this.resultNoteContent,
    required this.resultFilename,
    required this.resultSessionId,
    required this.resultFileSizeBytes,
    required this.resultDurationSeconds,
    required this.fileData,
  });
}

class ScannerLocalErrorTransition extends ScannerLocalDecodeTransition {
  final String status;

  const ScannerLocalErrorTransition({required this.status});
}

class ScannerLocalDecodeController {
  final ScannerLocalSavePacketCallback _savePacket;
  final ScannerLocalUploadPacketCallback _uploadPacketToServer;
  final ScannerLocalRealtimePacketCallback _notifyRealtimePacket;
  final ScannerLocalUpdateProgressCallback _updateIncompleteProgress;
  final ScannerLocalCompleteScanCallback _completeCurrentScan;
  final ScannerLocalNowMillisCallback _nowMillis;
  final ScannerLocalLogCallback _log;

  ScannerLocalDecodeController({
    ScannerLocalSavePacketCallback? savePacket,
    ScannerLocalUploadPacketCallback? uploadPacketToServer,
    ScannerLocalRealtimePacketCallback? notifyRealtimePacket,
    ScannerLocalUpdateProgressCallback? updateIncompleteProgress,
    ScannerLocalCompleteScanCallback? completeCurrentScan,
    ScannerLocalNowMillisCallback? nowMillis,
    ScannerLocalLogCallback? log,
  }) : _savePacket = savePacket ?? IncompleteScanService.savePacket,
       _uploadPacketToServer =
           uploadPacketToServer ?? _defaultUploadPacketToServer,
       _notifyRealtimePacket =
           notifyRealtimePacket ?? _defaultNotifyRealtimePacket,
       _updateIncompleteProgress =
           updateIncompleteProgress ?? IncompleteScanService.updateProgress,
       _completeCurrentScan =
           completeCurrentScan ?? IncompleteScanService.completeCurrentScan,
       _nowMillis = nowMillis ?? (() => DateTime.now().millisecondsSinceEpoch),
       _log = log ?? debugPrint;

  Future<ScannerLocalDecodeTransition> applyResult({
    required DecodeStatus result,
    required Uint8List rawBytes,
    required ScannerLocalDecodeState state,
    required String localSyncSourceName,
  }) async {
    switch (result.status) {
      case 'Progress':
        return _handleProgress(
          result: result,
          rawBytes: rawBytes,
          state: state,
          localSyncSourceName: localSyncSourceName,
        );
      case 'Completed':
        return _handleCompleted(result: result, state: state);
      case 'Error':
        _queueServerAuthoritativeDecodeError(rawBytes: rawBytes, state: state);
        return ScannerLocalErrorTransition(status: 'Error: ${result.errorMsg}');
      default:
        return const ScannerLocalIgnoredTransition();
    }
  }

  Future<ScannerLocalDecodeTransition> _handleProgress({
    required DecodeStatus result,
    required Uint8List rawBytes,
    required ScannerLocalDecodeState state,
    required String localSyncSourceName,
  }) async {
    final sessionId = state.currentScanId;
    if (sessionId == null) {
      return const ScannerLocalIgnoredTransition();
    }

    final transportFilename = normalizeScanFilename(result.filename);
    final displayFilename =
        transportFilename != null && isNoteFilename(transportFilename)
        ? getDisplayNoteFilename(transportFilename)
        : transportFilename;
    final receivedPackets = result.receivedPackets;
    final expectedPackets = result.expectedPackets;

    await _savePacket(receivedPackets, rawBytes);

    final packetIndexForLog = receivedPackets;
    final expectedForLog = expectedPackets;
    unawaited(() async {
      final uploaded = await _uploadPacketToServer(
        sessionId: sessionId,
        packetData: rawBytes,
        filename: transportFilename,
        resultType: null,
        receivedPackets: receivedPackets,
        expectedPackets: expectedPackets,
      );
      if (!uploaded) {
        _log(
          'SCAN_LOG: HTTP packet upload failed for session=$sessionId packet=$packetIndexForLog/$expectedForLog',
        );
      } else if (packetIndexForLog <= 3 ||
          packetIndexForLog % 20 == 0 ||
          packetIndexForLog == expectedForLog) {
        _log(
          'SCAN_LOG: HTTP packet uploaded session=$sessionId packet=$packetIndexForLog/$expectedForLog',
        );
      }
    }());

    _notifyRealtimePacket(
      sessionId: sessionId,
      packetBytes: rawBytes,
      filename: transportFilename,
      receivedPackets: receivedPackets,
      expectedPackets: expectedPackets,
    );

    await _updateIncompleteProgress(
      progress: normalizeIncompleteProgress(result.percent / 100.0),
      receivedPackets: receivedPackets,
      expectedPackets: expectedPackets,
      filename: displayFilename,
    );

    final displayReceived = receivedPackets > state.displayReceivedPackets
        ? receivedPackets
        : state.displayReceivedPackets;
    final displayExpected = expectedPackets > state.displayExpectedPackets
        ? expectedPackets
        : state.displayExpectedPackets;
    final displayProgress = normalizeIncompleteProgress(
      displayExpected > 0
          ? displayReceived / displayExpected
          : result.percent / 100.0,
    );
    final displayPercent = formatIncompleteProgressPercent(displayProgress);

    return ScannerLocalProgressTransition(
      receivedPackets: receivedPackets,
      expectedPackets: expectedPackets,
      totalPackets: result.totalPackets,
      progress: displayProgress,
      status: 'Progress: $displayPercent% ($displayReceived/$displayExpected)',
      currentFilename: displayFilename,
      syncSourceName: localSyncSourceName,
      shouldRefreshGlobalCounters: true,
    );
  }

  void _queueServerAuthoritativeDecodeError({
    required Uint8List rawBytes,
    required ScannerLocalDecodeState state,
  }) {
    final sessionId = state.currentScanId;
    if (!state.serverAuthoritative ||
        sessionId == null ||
        !_hasValidStreamingTransportIdentity(rawBytes)) {
      return;
    }

    unawaited(() async {
      final uploaded = await _uploadPacketToServer(
        sessionId: sessionId,
        packetData: rawBytes,
        resultType: 'server_authoritative_decode_error',
        receivedPackets: null,
        expectedPackets: null,
      );
      if (!uploaded) {
        _log(
          'SCAN_LOG: server-authoritative decode-error packet upload failed for session=$sessionId',
        );
      }
    }());
  }

  bool _hasValidStreamingTransportIdentity(Uint8List bytes) {
    if (bytes.length < 31 || (bytes[0] != 1 && bytes[0] != 2)) {
      return false;
    }
    try {
      final view = ByteData.sublistView(bytes);
      final chunkId = view.getUint32(5);
      final totalChunks = view.getUint32(9);
      view.getUint32(27);
      return totalChunks > 0 && chunkId < totalChunks;
    } catch (_) {
      return false;
    }
  }

  Future<ScannerLocalDecodeTransition> _handleCompleted({
    required DecodeStatus result,
    required ScannerLocalDecodeState state,
  }) async {
    if (state.completionHandled) {
      return const ScannerLocalIgnoredTransition();
    }

    final fileData = result.fileData;
    if (fileData == null || fileData.isEmpty) {
      return const ScannerLocalErrorTransition(
        status: 'Error: Completed decode returned no file data',
      );
    }

    final resultSessionId =
        state.currentScanId ??
        ServerId.tryFromPositiveInt(result.sessionId)?.value;
    await _completeCurrentScan();

    final durationSeconds = state.scanDurationSeconds;
    final durationLabel = durationSeconds.toStringAsFixed(1);
    final sizeLabel = '${(fileData.length / 1024).toStringAsFixed(1)} KB';
    final transportFilename =
        normalizeScanFilename(result.filename) ??
        'received_${_nowMillis()}.bin';
    final resultIsNote = isNoteFilename(transportFilename);
    final resultFilename = resultIsNote
        ? getDisplayNoteFilename(transportFilename)
        : transportFilename;
    final resultNoteContent = resultIsNote
        ? const Utf8Decoder(allowMalformed: true).convert(fileData)
        : null;

    return ScannerLocalCompletedTransition(
      completionHandled: true,
      progress: 1.0,
      status:
          'Completed! $resultFilename\n'
          'Time: $durationLabel | Size: $sizeLabel\n'
          'Frames: ${result.totalPackets}',
      totalPackets: result.totalPackets,
      resultIsNote: resultIsNote,
      resultNoteContent: resultNoteContent,
      resultFilename: resultFilename,
      resultSessionId: resultSessionId,
      resultFileSizeBytes: fileData.length,
      resultDurationSeconds: durationSeconds,
      fileData: fileData,
    );
  }

  static Future<bool> _defaultUploadPacketToServer({
    required String sessionId,
    required Uint8List packetData,
    String? filename,
    String? resultType,
    int? receivedPackets,
    int? expectedPackets,
  }) {
    final deviceInfo = WebSocketSyncService.instance.deviceInfo;
    return IncompleteScanService.uploadPacketToServer(
      sessionId: sessionId,
      packetData: packetData,
      filename: filename,
      resultType: resultType,
      receivedPackets: receivedPackets,
      expectedPackets: expectedPackets,
      deviceId: deviceInfo?.deviceId,
      deviceName: deviceInfo?.deviceName,
    );
  }

  static void _defaultNotifyRealtimePacket({
    required String sessionId,
    required Uint8List packetBytes,
    String? filename,
    required int receivedPackets,
    required int expectedPackets,
  }) {
    // Packets use the reliable HTTP upload path. The shared events websocket is
    // receive-only for scan-progress/scan-complete broadcasts from the server.
  }
}
