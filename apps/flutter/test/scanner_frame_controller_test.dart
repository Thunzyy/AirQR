import 'dart:typed_data';

import 'package:airqr_mobile/scanner_frame_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerFrameController', () {
    test('handleFrame describes streaming packets and updates fps state', () {
      final controller = ScannerFrameController();
      final bytes = Uint8List(31);
      final view = ByteData.sublistView(bytes);
      view.setUint8(0, 1);
      view.setUint32(1, 1234);
      view.setUint32(5, 2);
      view.setUint32(9, 5);
      view.setUint32(21, 4096);
      view.setUint16(25, 800);
      view.setUint32(27, 99);

      final transition = controller.handleFrame(
        rawBytes: bytes,
        state: const ScannerFrameState(
          lastProcessedBytes: null,
          fps: 0,
          framesInCurrentSecond: 0,
          lastFpsUpdate: 0,
        ),
        nowMillis: 1500,
      );

      expect(transition, isA<ScannerFrameAcceptedTransition>());
      final accepted = transition as ScannerFrameAcceptedTransition;
      expect(accepted.debugInfo, contains('Session: 1234'));
      expect(accepted.debugInfo, contains('Chunk: 2/5'));
      expect(accepted.debugInfo, contains('Symbol: 99'));
      expect(accepted.debugInfo, contains('Size: 4096'));
      expect(accepted.debugInfo, contains('Pkt: 800'));
      expect(accepted.currentChunkNumber, 3);
      expect(accepted.currentChunkTotal, 5);
      expect(accepted.streamFrameInfo?.sessionId, 1234);
      expect(accepted.streamFrameInfo?.chunkNumber, 3);
      expect(accepted.streamFrameInfo?.chunkTotal, 5);
      expect(accepted.streamFrameInfo?.symbolId, 99);
      expect(accepted.fps, 1);
      expect(accepted.framesInCurrentSecond, 0);
      expect(accepted.lastFpsUpdate, 1500);
    });

    test('chunk frame counter counts unique frames per chunk', () {
      final counter = ScannerChunkFrameCounter();
      const first = ScannerStreamFrameInfo(
        sessionId: 1234,
        chunkNumber: 2,
        chunkTotal: 5,
        symbolId: 10,
      );

      expect(counter.accept(first).framesScanned, 1);
      expect(counter.accept(first).framesScanned, 1);
      expect(
        counter
            .accept(
              const ScannerStreamFrameInfo(
                sessionId: 1234,
                chunkNumber: 2,
                chunkTotal: 5,
                symbolId: 11,
              ),
            )
            .framesScanned,
        2,
      );
      expect(
        counter
            .accept(
              const ScannerStreamFrameInfo(
                sessionId: 1234,
                chunkNumber: 3,
                chunkTotal: 5,
                symbolId: 10,
              ),
            )
            .framesScanned,
        1,
      );
      counter.reset();
      expect(counter.accept(first).framesScanned, 1);
    });

    test('version 2 frames expose exact totals and use the shifted symbol', () {
      final controller = ScannerFrameController();
      final counter = ScannerChunkFrameCounter();
      final bytes = Uint8List(35);
      final view = ByteData.sublistView(bytes);
      view.setUint8(0, 2);
      view.setUint32(1, 1234);
      view.setUint32(5, 0);
      view.setUint32(9, 1);
      view.setUint32(21, 4096);
      view.setUint16(25, 800);
      view.setUint32(27, 130);
      view.setUint32(31, 42);

      final accepted =
          controller.handleFrame(
                rawBytes: bytes,
                state: const ScannerFrameState(
                  lastProcessedBytes: null,
                  fps: 0,
                  framesInCurrentSecond: 0,
                  lastFpsUpdate: 0,
                ),
                nowMillis: 10,
              )
              as ScannerFrameAcceptedTransition;

      expect(accepted.streamFrameInfo?.symbolId, 42);
      expect(accepted.streamFrameInfo?.exactPacketsTotal, 130);
      expect(accepted.currentChunkNumber, 1);
      expect(accepted.currentChunkTotal, 1);
      final update = counter.accept(accepted.streamFrameInfo!);
      expect(update.framesScanned, 1);
      expect(update.exactSessionTotal, 130);
    });

    test('handleFrame ignores duplicate bytes', () {
      final controller = ScannerFrameController();
      final bytes = Uint8List.fromList(const <int>[2, 3, 4]);

      final transition = controller.handleFrame(
        rawBytes: bytes,
        state: ScannerFrameState(
          lastProcessedBytes: Uint8List.fromList(const <int>[2, 3, 4]),
          fps: 10,
          framesInCurrentSecond: 2,
          lastFpsUpdate: 1000,
        ),
        nowMillis: 1100,
      );

      expect(transition, isA<ScannerFrameIgnoredDuplicateTransition>());
      expect(transition.debugInfo, contains('Legacy/Unknown'));
    });

    test('handleFrame accumulates frames within the same second', () {
      final controller = ScannerFrameController();

      final transition = controller.handleFrame(
        rawBytes: Uint8List.fromList(const <int>[9, 8, 7]),
        state: const ScannerFrameState(
          lastProcessedBytes: null,
          fps: 12,
          framesInCurrentSecond: 3,
          lastFpsUpdate: 1000,
        ),
        nowMillis: 1500,
      );

      final accepted = transition as ScannerFrameAcceptedTransition;
      expect(accepted.currentChunkNumber, isNull);
      expect(accepted.currentChunkTotal, isNull);
      expect(accepted.fps, 12);
      expect(accepted.framesInCurrentSecond, 4);
      expect(accepted.lastFpsUpdate, 1000);
    });
  });
}
