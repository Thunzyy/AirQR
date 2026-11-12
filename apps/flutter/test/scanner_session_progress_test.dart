import 'package:airqr_mobile/scanner_session_progress.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('scanner session progress chunk model', () {
    test('extracts canonical chunk details from scanState payloads', () {
      final chunks = scannerProgressChunksFromPayload(const <String, dynamic>{
        'sessionId': 'scan-1',
        'receivedPackets': 6088,
        'scanState': <String, dynamic>{
          'decodeThreshold': 20696,
          'chunksTotal': 5,
          'chunks': <Map<String, dynamic>>[
            <String, dynamic>{
              'chunkId': 0,
              'state': 'scanning',
              'receivedUnique': 1180,
              'decodeThreshold': 1465,
              'missingCount': 285,
              'targetFrameCount': 285,
              'targetFrameRanges': <List<int>>[
                <int>[10, 12],
                <int>[20, 21],
              ],
              'unseenFrameCount': 871,
            },
            <String, dynamic>{
              'chunkId': 1,
              'state': 'missing',
              'receivedUnique': 0,
              'decodeThreshold': 1167,
              'missingCount': 0,
            },
          ],
        },
      });

      expect(chunks, hasLength(5));
      expect(chunks[0].chunkId, 0);
      expect(chunks[0].state, ScannerChunkProgressState.scanning);
      expect(chunks[0].receivedUnique, 1180);
      expect(chunks[0].decodeThreshold, 1465);
      expect(chunks[0].missingCount, 285);
      expect(chunks[0].targetFrameCount, 285);
      expect(chunks[0].targetFrameRanges, hasLength(2));
      expect(chunks[0].targetFrameRanges.first.start, 10);
      expect(chunks[0].targetFrameRanges.first.end, 12);
      expect(chunks[0].unseenFrameCount, 871);

      expect(chunks[1].chunkId, 1);
      expect(chunks[1].missingCount, 0);
      expect(chunks[4].chunkId, 4);
      expect(chunks[4].state, ScannerChunkProgressState.missing);
      expect(chunks[4].missingCount, isNull);
    });

    test('keeps aggregate missing count aligned with detailed chunks', () {
      final payload = const <String, dynamic>{
        'scanState': <String, dynamic>{
          'chunks': <Map<String, dynamic>>[
            <String, dynamic>{
              'chunkId': 0,
              'receivedUnique': 1180,
              'decodeThreshold': 1465,
            },
            <String, dynamic>{
              'chunkId': 1,
              'missingRanges': <List<int>>[
                <int>[10, 19],
              ],
            },
          ],
        },
      };

      expect(scannerProgressMissingFromPayload(payload), 295);
      final chunks = scannerProgressChunksFromPayload(payload);
      expect(chunks.map((chunk) => chunk.missingCount), <int?>[285, 10]);
    });

    test('separates the decode threshold from the exact transmitted total', () {
      final payload = const <String, dynamic>{
        'scanState': <String, dynamic>{
          'decodeThreshold': 180,
          'totalPackets': 240,
          'totalPacketsExact': true,
          'chunksTotal': 2,
          'chunks': <Map<String, dynamic>>[
            <String, dynamic>{
              'chunkId': 0,
              'decodeThreshold': 100,
              'totalPackets': 130,
              'totalPacketsExact': true,
            },
            <String, dynamic>{
              'chunkId': 1,
              'decodeThreshold': 80,
              'totalPackets': 110,
              'totalPacketsExact': true,
            },
          ],
        },
      };

      final chunks = scannerProgressChunksFromPayload(payload);
      expect(scannerProgressDecodeThresholdFromChunks(chunks), 180);
      expect(scannerProgressExactTotalFromChunks(chunks), 240);
      expect(scannerProgressExpectedFromPayload(payload), 180);
      expect(scannerProgressTotalFromPayload(payload), 240);
    });

    test('does not present an estimated threshold as an exact total', () {
      final payload = const <String, dynamic>{
        'scanState': <String, dynamic>{
          'decodeThreshold': 180,
          'totalPackets': 180,
          'totalPacketsExact': false,
        },
      };

      expect(scannerProgressExpectedFromPayload(payload), 180);
      expect(scannerProgressTotalFromPayload(payload), 0);
    });
  });
}
