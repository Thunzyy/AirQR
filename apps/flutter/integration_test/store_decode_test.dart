import 'dart:convert';
import 'dart:io';

import 'package:airqr_mobile/encoder_defaults.dart';
import 'package:airqr_mobile/src/rust/api/simple.dart';
import 'package:airqr_mobile/src/rust/frb_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_rust_bridge/flutter_rust_bridge_for_generated.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    const libraryPath = String.fromEnvironment('AIRQR_NATIVE_LIBRARY');
    await RustLib.init(
      externalLibrary: libraryPath.isEmpty
          ? null
          : ExternalLibrary.open(libraryPath),
    );
  });

  testWidgets(
    'Windows native bridge restores a saved default-settings CSV GIF',
    (tester) async {
      final data = utf8.encode(
        List.generate(40000, (n) => '$n,row-$n,${n * 7919}\n').join(),
      );
      final encoded = await encodeToGif(
        filename: 'csv.csv',
        data: data,
        fps: EncoderDefaults.fps,
        eccLevel: EncoderDefaults.errorCorrection,
        packetSize: EncoderDefaults.packetSize,
        raptorqOverhead: EncoderDefaults.raptorqOverhead,
        compress: EncoderDefaults.compressionEnabled,
      );
      expect(encoded.success, isTrue, reason: encoded.errorMsg);
      expect(encoded.totalFrames, greaterThan(200));
      final temporary = await Directory.systemTemp.createTemp(
        'airqr-store-test-',
      );
      try {
        final file = File('${temporary.path}/csv_csv.gif');
        await file.writeAsBytes(encoded.gifData!, flush: true);
        final result = await decodeGifFile(gifData: await file.readAsBytes());
        expect(result.success, isTrue, reason: result.errorMsg);
        expect(result.filename, 'csv.csv');
        expect(result.fileData, orderedEquals(data));
      } finally {
        await temporary.delete(recursive: true);
      }
    },
  );
}
