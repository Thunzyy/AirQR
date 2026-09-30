import 'package:flutter/foundation.dart';

class ScannerFrameState {
  final Uint8List? lastProcessedBytes;
  final int fps;
  final int framesInCurrentSecond;
  final int lastFpsUpdate;

  const ScannerFrameState({
    required this.lastProcessedBytes,
    required this.fps,
    required this.framesInCurrentSecond,
    required this.lastFpsUpdate,
  });
}

sealed class ScannerFrameTransition {
  final String debugInfo;

  const ScannerFrameTransition({required this.debugInfo});
}

class ScannerFrameIgnoredDuplicateTransition extends ScannerFrameTransition {
  const ScannerFrameIgnoredDuplicateTransition({required super.debugInfo});
}

class ScannerFrameAcceptedTransition extends ScannerFrameTransition {
  final Uint8List lastProcessedBytes;
  final int fps;
  final int framesInCurrentSecond;
  final int lastFpsUpdate;
  final int nowMillis;
  final int? currentChunkNumber;
  final int? currentChunkTotal;
  final ScannerStreamFrameInfo? streamFrameInfo;

  const ScannerFrameAcceptedTransition({
    required super.debugInfo,
    required this.lastProcessedBytes,
    required this.fps,
    required this.framesInCurrentSecond,
    required this.lastFpsUpdate,
    required this.nowMillis,
    this.currentChunkNumber,
    this.currentChunkTotal,
    this.streamFrameInfo,
  });
}

class ScannerStreamFrameInfo {
  final int sessionId;
  final int chunkNumber;
  final int chunkTotal;
  final int symbolId;
  final int? exactPacketsTotal;

  const ScannerStreamFrameInfo({
    required this.sessionId,
    required this.chunkNumber,
    required this.chunkTotal,
    required this.symbolId,
    this.exactPacketsTotal,
  });
}

class ScannerChunkFrameCountUpdate {
  final int framesScanned;
  final int? exactSessionTotal;

  const ScannerChunkFrameCountUpdate({
    required this.framesScanned,
    required this.exactSessionTotal,
  });
}

class ScannerChunkFrameCounter {
  final Map<(int, int), Set<int>> _symbolsByChunk = <(int, int), Set<int>>{};
  final Map<(int, int), int> _exactTotalsByChunk = <(int, int), int>{};

  ScannerChunkFrameCountUpdate accept(ScannerStreamFrameInfo frame) {
    final symbols = _symbolsByChunk.putIfAbsent((
      frame.sessionId,
      frame.chunkNumber,
    ), () => <int>{});
    symbols.add(frame.symbolId);
    final exactPacketsTotal = frame.exactPacketsTotal;
    if (exactPacketsTotal != null && exactPacketsTotal > 0) {
      _exactTotalsByChunk[(frame.sessionId, frame.chunkNumber)] =
          exactPacketsTotal;
    }
    final sessionTotals = <int>[];
    for (var chunkNumber = 1; chunkNumber <= frame.chunkTotal; chunkNumber++) {
      final total = _exactTotalsByChunk[(frame.sessionId, chunkNumber)];
      if (total == null) {
        return ScannerChunkFrameCountUpdate(
          framesScanned: symbols.length,
          exactSessionTotal: null,
        );
      }
      sessionTotals.add(total);
    }
    return ScannerChunkFrameCountUpdate(
      framesScanned: symbols.length,
      exactSessionTotal: sessionTotals.fold<int>(
        0,
        (sum, total) => sum + total,
      ),
    );
  }

  void reset() {
    _symbolsByChunk.clear();
    _exactTotalsByChunk.clear();
  }
}

class ScannerFrameController {
  const ScannerFrameController();

  ScannerFrameTransition handleFrame({
    required Uint8List rawBytes,
    required ScannerFrameState state,
    required int nowMillis,
  }) {
    final debugInfo = _describeBytes(rawBytes);
    if (state.lastProcessedBytes != null &&
        listEquals(state.lastProcessedBytes, rawBytes)) {
      return ScannerFrameIgnoredDuplicateTransition(debugInfo: debugInfo);
    }

    var framesInCurrentSecond = state.framesInCurrentSecond + 1;
    var fps = state.fps;
    var lastFpsUpdate = state.lastFpsUpdate;

    if (nowMillis - lastFpsUpdate >= 1000) {
      fps = framesInCurrentSecond;
      framesInCurrentSecond = 0;
      lastFpsUpdate = nowMillis;
    }

    final streamFrameInfo = parseStreamFrameInfo(rawBytes);

    return ScannerFrameAcceptedTransition(
      debugInfo: debugInfo,
      lastProcessedBytes: rawBytes,
      fps: fps,
      framesInCurrentSecond: framesInCurrentSecond,
      lastFpsUpdate: lastFpsUpdate,
      nowMillis: nowMillis,
      currentChunkNumber: streamFrameInfo?.chunkNumber,
      currentChunkTotal: streamFrameInfo?.chunkTotal,
      streamFrameInfo: streamFrameInfo,
    );
  }

  String _describeBytes(Uint8List bytes) {
    var debugInfo = 'Bytes: ${bytes.length}';
    if (bytes.isNotEmpty &&
        (bytes[0] == 1 || bytes[0] == 2) &&
        bytes.length >= (bytes[0] == 2 ? 35 : 31)) {
      final view = ByteData.sublistView(bytes);
      final sessionId = view.getUint32(1);
      final chunkId = view.getUint32(5);
      final totalChunks = view.getUint32(9);
      final totalSize = view.getUint32(21);
      final packetSize = view.getUint16(25);
      final symbolId = view.getUint32(bytes[0] == 2 ? 31 : 27);
      debugInfo +=
          ' [Stream Mode] Session: $sessionId, Chunk: $chunkId/$totalChunks, Symbol: $symbolId, Size: $totalSize, Pkt: $packetSize';
    } else {
      debugInfo +=
          ' [Legacy/Unknown] Byte0: ${bytes.isNotEmpty ? bytes[0] : 'empty'}';
    }
    return debugInfo;
  }

  ScannerStreamFrameInfo? parseStreamFrameInfo(Uint8List bytes) {
    if (bytes.isEmpty || (bytes[0] != 1 && bytes[0] != 2)) {
      return null;
    }
    final hasExactChunkTotal = bytes[0] == 2;
    final minimumLength = hasExactChunkTotal ? 35 : 31;
    if (bytes.length < minimumLength) {
      return null;
    }
    final view = ByteData.sublistView(bytes);
    final sessionId = view.getUint32(1);
    final chunkId = view.getUint32(5);
    final totalChunks = view.getUint32(9);
    final exactPacketsTotal = hasExactChunkTotal ? view.getUint32(27) : null;
    final symbolId = view.getUint32(hasExactChunkTotal ? 31 : 27);
    if (totalChunks == 0 || chunkId >= totalChunks) {
      return null;
    }
    return ScannerStreamFrameInfo(
      sessionId: sessionId,
      chunkNumber: chunkId + 1,
      chunkTotal: totalChunks,
      symbolId: symbolId,
      exactPacketsTotal: exactPacketsTotal,
    );
  }
}
