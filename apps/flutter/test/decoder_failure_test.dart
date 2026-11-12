import 'dart:io';

import 'package:airqr_mobile/decoder_failure.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('classifyDecoderFailure', () {
    test('maps a regular photo GIF with zero QR codes to notAirQr', () {
      expect(
        classifyDecoderFailure(
          errorMsg:
              'Incomplete: 12 frames (first: 480x270), 0 QR, 12 errors, data=4096 bytes',
          qrDetected: 0,
        ),
        DecoderFailureKind.notAirQr,
      );
    });

    test('maps an AirQR GIF that is still missing packets to incomplete', () {
      expect(
        classifyDecoderFailure(
          errorMsg: 'Incomplete: not all chunks decoded',
          qrDetected: 40,
        ),
        DecoderFailureKind.incomplete,
      );
    });

    test('maps GIF codec failures to invalidFile', () {
      expect(
        classifyDecoderFailure(
          errorMsg: 'GIF decode error: invalid code in raster data',
          qrDetected: 0,
        ),
        DecoderFailureKind.invalidFile,
      );
    });

    test('maps filesystem errors to unreadable', () {
      expect(
        classifyDecoderFailure(
          errorMsg: 'FileSystemException: Cannot open file',
          qrDetected: 0,
          caughtError: const FileSystemException('Cannot open file'),
        ),
        DecoderFailureKind.unreadable,
      );
    });

    test('does not treat 10 QR as zero QR', () {
      expect(
        classifyDecoderFailure(
          errorMsg: 'Incomplete: 12 frames (first: 177x177), 10 QR, 2 errors',
          qrDetected: 10,
        ),
        DecoderFailureKind.incomplete,
      );
    });

    test('maps wrapped Exception photo-GIF text to notAirQr', () {
      expect(
        classifyDecoderFailure(
          errorMsg:
              'Exception: Incomplete: 12 frames (first: 480x270), 0 QR, 12 errors, data=4096 bytes',
          qrDetected: 0,
        ),
        DecoderFailureKind.notAirQr,
      );
    });

    test('notAirQr is guidance, not a product error', () {
      expect(decoderFailureShowsError(DecoderFailureKind.notAirQr), isFalse);
      expect(decoderFailureShowsError(DecoderFailureKind.incomplete), isTrue);
    });
  });
}
