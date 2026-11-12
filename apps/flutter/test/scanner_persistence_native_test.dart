import 'dart:io';

import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/src/rust/api/simple.dart';
import 'package:airqr_mobile/src/rust/frb_generated.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_rust_bridge/flutter_rust_bridge_for_generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:zxing2/qrcode.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const enabled = bool.fromEnvironment('AIRQR_NATIVE_PERSISTENCE');
  const libraryPath = String.fromEnvironment('AIRQR_NATIVE_LIBRARY');
  const channel = MethodChannel('plugins.flutter.io/path_provider');
  late Directory directory;

  setUpAll(() async {
    if (!enabled) return;
    await RustLib.init(externalLibrary: ExternalLibrary.open(libraryPath));
  });
  setUp(() async {
    if (!enabled) return;
    directory = await Directory.systemTemp.createTemp(
      'airqr-native-persistence-',
    );
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => directory.path);
  });
  tearDown(() async {
    if (!enabled) return;
    IncompleteScanService.onMetadataSavedForTesting = null;
    IncompleteScanService.clearCurrentScan();
    await IncompleteScanService.flushPending();
    await resetDecoder();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
    await directory.delete(recursive: true);
  });

  test(
    'real QR packets survive a flushed interruption and reconstruct the file',
    () async {
      final input = Uint8List.fromList(
        List.generate(8192, (i) => (i * 71 + i ~/ 256) % 256),
      );
      final encoded = await encodeToGif(
        filename: 'resume-fixture.bin',
        data: input,
        fps: 10,
        eccLevel: 'MEDIUM',
        packetSize: 300,
        raptorqOverhead: 1.4,
        compress: false,
      );
      expect(encoded.success, isTrue, reason: encoded.errorMsg);
      final gif = img.decodeGif(encoded.gifData!)!;
      final packets = <Uint8List>[];
      for (final frame in gif.frames) {
        // Give the optical decoder a few pixels per QR module.
        final scaled = img.copyResize(
          frame,
          width: frame.width * 3,
          height: frame.height * 3,
          interpolation: img.Interpolation.nearest,
        );
        final pixels = Int32List(scaled.width * scaled.height);
        for (var y = 0; y < scaled.height; y++) {
          for (var x = 0; x < scaled.width; x++) {
            final pixel = scaled.getPixel(x, y);
            pixels[y * scaled.width + x] =
                0xff000000 |
                pixel.r.toInt() << 16 |
                pixel.g.toInt() << 8 |
                pixel.b.toInt();
          }
        }
        final decoded = QRCodeReader().decode(
          BinaryBitmap(
            HybridBinarizer(
              RGBLuminanceSource(scaled.width, scaled.height, pixels),
            ),
          ),
          hints: DecodeHints()..put(DecodeHintType.pureBarcode),
        );
        final segments =
            decoded.resultMetadata[ResultMetadataType.byteSegments];
        if (segments is! List<Int8List>) {
          throw StateError('QR byte segment missing');
        }
        final bytes = BytesBuilder(copy: false);
        for (final segment in segments) {
          bytes.add(
            segment.buffer.asUint8List(
              segment.offsetInBytes,
              segment.lengthInBytes,
            ),
          );
        }
        packets.add(bytes.takeBytes());
      }
      final prefixCount = packets.length ~/ 3;
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'native-resume',
      );
      for (final packet in packets.take(prefixCount)) {
        final decoded = await processChunk(data: packet);
        expect(decoded.status, 'Progress');
        await IncompleteScanService.recordProgressPacket(
          sessionId: id,
          packetData: packet,
          progress: decoded.percent / 100,
          receivedPackets: decoded.receivedPackets,
          expectedPackets: decoded.expectedPackets,
          filename: decoded.filename,
        );
      }
      IncompleteScanService.clearCurrentScan();
      await IncompleteScanService.flushPending();
      await resetDecoder();
      await IncompleteScanService.resumeSession(id);
      final saved = await IncompleteScanService.getPackets(id);
      expect(saved.length, prefixCount);
      DecodeStatus? result;
      for (final packet in [...saved, ...packets.skip(prefixCount)]) {
        result = await processChunk(data: packet);
        if (result.status == 'Completed') break;
        expect(result.status, 'Progress');
      }
      expect(result!.status, 'Completed');
      expect(result.fileData, input);
      expect(result.filename, 'resume-fixture.bin');
      debugPrint(
        'PERSIST_REPLAY saved_packets=${saved.length} qr_frames=${packets.length} bytes=${input.length} identical=true',
      );
    },
    skip: !enabled,
    timeout: const Timeout(Duration(minutes: 2)),
  );

  test(
    'measure blocking persistence versus batched admission on real files',
    () async {
      final payload = Uint8List.fromList(List.generate(1200, (i) => i % 256));
      for (var sample = 0; sample < 3; sample++) {
        var writes = 0;
        IncompleteScanService.onMetadataSavedForTesting = () => writes++;
        await IncompleteScanService.startNewSession(
          sessionId: 'before-$sample',
        );
        writes = 0;
        final old = Stopwatch()..start();
        for (var i = 1; i <= 96; i++) {
          await IncompleteScanService.savePacket(i, payload);
          await IncompleteScanService.updateProgress(
            progress: i / 100,
            receivedPackets: i,
            expectedPackets: 100,
          );
        }
        old.stop();
        final oldWrites = writes;
        final id = await IncompleteScanService.startNewSession(
          sessionId: 'after-$sample',
        );
        writes = 0;
        final batched = Stopwatch()..start();
        for (var i = 1; i <= 96; i++) {
          await IncompleteScanService.recordProgressPacket(
            sessionId: id,
            packetData: payload,
            progress: i / 100,
            receivedPackets: i,
            expectedPackets: 100,
          );
        }
        final admissionUs = batched.elapsedMicroseconds;
        await IncompleteScanService.flushPending();
        batched.stop();
        expect(await IncompleteScanService.getPackets(id), hasLength(96));
        expect(writes, 6);
        debugPrint(
          'PERSIST_PERF sample=$sample packets=96 before_us=${old.elapsedMicroseconds} admission_us=$admissionUs durable_us=${batched.elapsedMicroseconds} metadata_before=$oldWrites metadata_after=$writes',
        );
      }
    },
    skip: !enabled,
    timeout: const Timeout(Duration(minutes: 2)),
  );
}
