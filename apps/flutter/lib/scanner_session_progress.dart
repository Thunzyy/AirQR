import 'dart:math';

import 'parse/wire.dart';

enum ScannerChunkProgressState { complete, thresholdReached, scanning, missing }

class ScannerProgressRange {
  final int start;
  final int end;

  const ScannerProgressRange(this.start, this.end);

  int get count => max(0, end - start + 1);
}

class ScannerChunkProgressInfo {
  final int chunkId;
  final int receivedUnique;
  final int? decodeThreshold;
  final int? totalPackets;
  final bool totalPacketsExact;
  final ScannerChunkProgressState state;
  final int? missingCount;
  final List<ScannerProgressRange> missingRanges;
  final int? targetFrameCount;
  final List<ScannerProgressRange> targetFrameRanges;
  final int? unseenFrameCount;
  final List<ScannerProgressRange> unseenFrameRanges;

  const ScannerChunkProgressInfo({
    required this.chunkId,
    this.receivedUnique = 0,
    this.decodeThreshold,
    this.totalPackets,
    this.totalPacketsExact = false,
    this.state = ScannerChunkProgressState.missing,
    this.missingCount,
    this.missingRanges = const <ScannerProgressRange>[],
    this.targetFrameCount,
    this.targetFrameRanges = const <ScannerProgressRange>[],
    this.unseenFrameCount,
    this.unseenFrameRanges = const <ScannerProgressRange>[],
  });
}

int scannerProgressToInt(Object? value, [int fallback = 0]) {
  return asWireInt(value) ?? fallback;
}

int scannerProgressReceivedFromPayload(Object? payload) {
  final object = asWireObject(payload);
  final scanState = asWireObject(object['scanState']);
  final received = scannerProgressToInt(
    scanState['receivedUnique'] ??
        scanState['receivedCount'] ??
        scanState['receivedPackets'] ??
        scanState['packetCount'],
  );
  if (received > 0) return received;
  return scannerProgressToInt(
    object['receivedUnique'] ??
        object['receivedPackets'] ??
        object['receivedCount'] ??
        object['packetCount'],
  );
}

int scannerProgressExpectedFromPayload(Object? payload) {
  final object = asWireObject(payload);
  final scanState = asWireObject(object['scanState']);
  final threshold = scannerProgressToInt(
    scanState['decodeThreshold'] ??
        scanState['expectedPackets'] ??
        scanState['totalExpected'],
  );
  if (threshold > 0) return threshold;
  return scannerProgressToInt(
    object['decodeThreshold'] ??
        object['expectedPackets'] ??
        object['totalPackets'],
  );
}

int scannerProgressTotalFromPayload(Object? payload) {
  final chunksTotal = scannerProgressExactTotalFromChunks(
    scannerProgressChunksFromPayload(payload),
  );
  if (chunksTotal != null) return chunksTotal;
  final source = _scanProgressSource(payload);
  if (!asWireLooseBool(source['totalPacketsExact'])) return 0;
  return scannerProgressToInt(source['totalPackets']);
}

int? scannerProgressDecodeThresholdFromChunks(
  List<ScannerChunkProgressInfo> chunks,
) {
  if (chunks.isEmpty) return null;
  var total = 0;
  for (final chunk in chunks) {
    final threshold = chunk.decodeThreshold;
    if (threshold == null || threshold <= 0) return null;
    total += threshold;
  }
  return total > 0 ? total : null;
}

int? scannerProgressExactTotalFromChunks(
  List<ScannerChunkProgressInfo> chunks,
) {
  if (chunks.isEmpty) return null;
  var total = 0;
  for (final chunk in chunks) {
    final chunkTotal = chunk.totalPackets;
    if (!chunk.totalPacketsExact || chunkTotal == null || chunkTotal <= 0) {
      return null;
    }
    total += chunkTotal;
  }
  return total > 0 ? total : null;
}

int scannerProgressMissingFromPayload(Object? payload) {
  final chunks = scannerProgressChunksFromPayload(payload);
  final missing = _missingFromChunks(chunks);
  return missing ?? 0;
}

List<ScannerChunkProgressInfo> scannerProgressChunksFromPayload(
  Object? payload,
) {
  final source = _scanProgressSource(payload);
  final rawChunks = source['chunks'] ?? source['chunkStates'];
  if (rawChunks is! List) return const <ScannerChunkProgressInfo>[];

  final chunksTotalRaw =
      _optionalInt(source['chunksTotal']) ??
      _optionalInt(source['totalChunks']);
  final totalPackets = _optionalInt(source['totalPackets']);
  final totalPacketsExact = asWireLooseBool(source['totalPacketsExact']);
  final decodeThreshold = _optionalInt(
    source['decodeThreshold'] ??
        source['expectedPackets'] ??
        source['totalExpected'],
  );
  final singleChunkFallback = chunksTotalRaw == 1;
  final chunks = <ScannerChunkProgressInfo>[];
  var index = 0;
  for (final rawChunk in rawChunks) {
    chunks.add(
      _normalizeChunk(
        asWireObject(rawChunk),
        index,
        decodeThreshold: singleChunkFallback ? decodeThreshold : null,
        totalPackets: singleChunkFallback ? totalPackets : null,
        totalPacketsExact: singleChunkFallback ? totalPacketsExact : false,
      ),
    );
    index += 1;
  }

  final chunksTotal = _effectiveChunksTotal(chunksTotalRaw, chunks);
  if (chunksTotal == null) return chunks;

  final byId = <int, ScannerChunkProgressInfo>{
    for (final chunk in chunks) chunk.chunkId: chunk,
  };
  for (var chunkId = 0; chunkId < chunksTotal; chunkId += 1) {
    byId.putIfAbsent(
      chunkId,
      () => _normalizeChunk(<String, Object?>{'chunkId': chunkId}, chunkId),
    );
  }
  final canonicalChunks = byId.values.toList()
    ..sort((left, right) => left.chunkId.compareTo(right.chunkId));
  return canonicalChunks;
}

WireObject _scanProgressSource(Object? payload) {
  final object = asWireObject(payload);
  if (object['type'] == 'scan-session-state' && isJsonMap(object['payload'])) {
    return asWireObject(object['payload']);
  }
  if (isJsonMap(object['scanState'])) {
    return asWireObject(object['scanState']);
  }
  if (isJsonMap(object['state'])) {
    return asWireObject(object['state']);
  }
  final nestedPayload = object['payload'];
  if (isJsonMap(nestedPayload)) {
    final nested = asWireObject(nestedPayload);
    if (nested['type'] == 'scan-session-state' && isJsonMap(nested['payload'])) {
      return asWireObject(nested['payload']);
    }
    if (isJsonMap(nested['scanState'])) {
      return asWireObject(nested['scanState']);
    }
  }
  return object;
}

ScannerChunkProgressInfo _normalizeChunk(
  WireObject raw,
  int fallbackId, {
  int? decodeThreshold,
  int? totalPackets,
  bool totalPacketsExact = false,
}) {
  final receivedUnique = scannerProgressToInt(
    raw['receivedUnique'] ??
        raw['receivedCount'] ??
        raw['receivedPackets'] ??
        raw['packetCount'],
  );
  final chunkDecodeThreshold =
      _optionalInt(
        raw['decodeThreshold'] ??
            raw['expectedPackets'] ??
            raw['totalExpected'],
      ) ??
      decodeThreshold;
  final chunkTotalPackets = _optionalInt(raw['totalPackets']) ?? totalPackets;
  final chunkTotalPacketsExact = raw.containsKey('totalPacketsExact')
      ? asWireLooseBool(raw['totalPacketsExact'])
      : totalPacketsExact;
  final state = _deriveChunkState(
    rawState: raw['state'],
    receivedUnique: receivedUnique,
    decodeThreshold: chunkDecodeThreshold,
    totalPackets: chunkTotalPackets,
    totalPacketsExact: chunkTotalPacketsExact,
  );
  var missingRanges = _normalizeRanges(raw['missingRanges'] ?? raw['missing']);
  var targetFrameRanges = _normalizeRanges(raw['targetFrameRanges']);
  var unseenFrameRanges = _normalizeRanges(raw['unseenFrameRanges']);
  var missingCount =
      _optionalInt(raw['missingCount']) ??
      _countRanges(missingRanges) ??
      (chunkDecodeThreshold != null
          ? max(chunkDecodeThreshold - receivedUnique, 0)
          : chunkTotalPackets != null
          ? max(chunkTotalPackets - receivedUnique, 0)
          : null);
  var targetFrameCount =
      _optionalInt(raw['targetFrameCount']) ?? _countRanges(targetFrameRanges);
  var unseenFrameCount =
      _optionalInt(raw['unseenFrameCount']) ?? _countRanges(unseenFrameRanges);

  if (state == ScannerChunkProgressState.complete) {
    missingCount = 0;
    missingRanges = const <ScannerProgressRange>[];
    targetFrameCount = 0;
    targetFrameRanges = const <ScannerProgressRange>[];
    unseenFrameCount = 0;
    unseenFrameRanges = const <ScannerProgressRange>[];
  }

  return ScannerChunkProgressInfo(
    chunkId: scannerProgressToInt(raw['chunkId'], fallbackId),
    receivedUnique: receivedUnique,
    decodeThreshold: chunkDecodeThreshold,
    totalPackets: chunkTotalPackets,
    totalPacketsExact: chunkTotalPacketsExact,
    state: state,
    missingCount: missingCount,
    missingRanges: missingRanges,
    targetFrameCount: targetFrameCount,
    targetFrameRanges: targetFrameRanges,
    unseenFrameCount: unseenFrameCount,
    unseenFrameRanges: unseenFrameRanges,
  );
}

ScannerChunkProgressState _deriveChunkState({
  required Object? rawState,
  required int receivedUnique,
  required int? decodeThreshold,
  required int? totalPackets,
  required bool totalPacketsExact,
}) {
  final state = asWireString(rawState);
  if (state == 'complete') return ScannerChunkProgressState.complete;
  if (state == 'threshold_reached') {
    return ScannerChunkProgressState.thresholdReached;
  }
  if (state == 'scanning') return ScannerChunkProgressState.scanning;
  if (state == 'missing') return ScannerChunkProgressState.missing;
  if (decodeThreshold != null && receivedUnique >= decodeThreshold) {
    return ScannerChunkProgressState.thresholdReached;
  }
  if (totalPacketsExact &&
      totalPackets != null &&
      receivedUnique >= totalPackets) {
    return ScannerChunkProgressState.complete;
  }
  if (receivedUnique > 0) return ScannerChunkProgressState.scanning;
  return ScannerChunkProgressState.missing;
}

int? _effectiveChunksTotal(
  int? chunksTotal,
  List<ScannerChunkProgressInfo> chunks,
) {
  if (chunksTotal == null && chunks.isEmpty) return null;
  final highestObserved = chunks.fold<int>(
    0,
    (highest, chunk) => max(highest, chunk.chunkId + 1),
  );
  return max(max(chunksTotal ?? 0, chunks.length), highestObserved);
}

int? _optionalInt(Object? value) {
  if (value == null) return null;
  final parsed = scannerProgressToInt(value, -1);
  return parsed >= 0 ? parsed : null;
}

List<ScannerProgressRange> _normalizeRanges(Object? ranges) {
  if (ranges is! List) return const <ScannerProgressRange>[];
  final normalized = <ScannerProgressRange>[];
  for (final range in ranges) {
    int? start;
    int? end;
    if (range is List && range.length >= 2) {
      start = scannerProgressToInt(range[0], -1);
      end = scannerProgressToInt(range[1], -1);
    } else if (isJsonMap(range)) {
      final object = asWireObject(range);
      start = scannerProgressToInt(
        object['start'] ?? object['from'] ?? object['first'],
        -1,
      );
      end = scannerProgressToInt(
        object['end'] ?? object['to'] ?? object['last'],
        -1,
      );
    }
    if (start == null || end == null || start < 0 || end < 0) continue;
    normalized.add(ScannerProgressRange(min(start, end), max(start, end)));
  }
  return normalized;
}

int? _missingFromChunks(List<ScannerChunkProgressInfo> chunks) {
  var total = 0;
  var hasValue = false;
  for (final chunk in chunks) {
    final missing = chunk.missingCount;
    if (missing == null) continue;
    total += missing;
    hasValue = true;
  }
  return hasValue ? total : null;
}

int? _countRanges(List<ScannerProgressRange> ranges) {
  if (ranges.isEmpty) return null;
  return ranges.fold<int>(0, (sum, range) => sum + range.count);
}
