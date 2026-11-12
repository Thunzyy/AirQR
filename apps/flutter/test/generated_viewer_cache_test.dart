import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:airqr_mobile/generated_history_viewer.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const benchmarkGif = String.fromEnvironment('AIRQR_PERF_GIF');
  test('real GIF cold and warm preparation benchmark', () async {
    final cache = GeneratedViewerSourceCache();
    for (var sample = 0; sample < 3; sample++) {
      cache.clear();
      final clock = Stopwatch()..start();
      final cold = await cache.load(benchmarkGif);
      final coldMicros = clock.elapsedMicroseconds;
      clock.reset();
      final warm = await cache.load(benchmarkGif);
      final warmMicros = clock.elapsedMicroseconds;
      expect(warm, same(cold));
      // ignore: avoid_print
      print(
        'PERF sample=$sample cold_us=$coldMicros warm_us=$warmMicros frames=${cold.frameCounts.first}',
      );
    }
  }, skip: benchmarkGif.isEmpty);

  late Directory directory;
  late File file;
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('airqr-preview-cache-');
    file = await File('${directory.path}/one.gif').writeAsBytes([1]);
  });
  tearDown(() => directory.delete(recursive: true));

  GeneratedViewerSource source([int size = 3]) => GeneratedViewerSource(
    gifs: [Uint8List(size)],
    frameCounts: const [1],
    fps: 10,
  );

  test('second open and concurrent opens reuse preparation', () async {
    var loads = 0;
    final cache = GeneratedViewerSourceCache(
      loader: (_, _) async {
        loads++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return source();
      },
    );
    final results = await Future.wait([
      cache.load(file.path),
      cache.load(file.path),
    ]);
    expect(identical(results[0], results[1]), isTrue);
    expect(await cache.load(file.path), same(results[0]));
    expect(loads, 1);
  });

  test(
    'file replacement, deletion and fallback metadata invalidate the source',
    () async {
      var loads = 0;
      final cache = GeneratedViewerSourceCache(
        loader: (_, _) async {
          loads++;
          return source();
        },
      );
      await cache.load(file.path);
      await file.setLastModified(
        DateTime.now().add(const Duration(seconds: 5)),
      );
      await cache.load(file.path);
      expect(loads, 2);
      await cache.load(file.path, fallbackFrameCount: 10);
      expect(loads, 3);
      await file.delete();
      await expectLater(
        cache.load(file.path),
        throwsA(isA<FileSystemException>()),
      );
      await file.writeAsBytes([1]);
      await cache.load(file.path);
      expect(loads, 4);
    },
  );

  test('evicts by byte budget and does not retain oversized sources', () async {
    var loads = 0;
    final cache = GeneratedViewerSourceCache(
      maxBytes: 4,
      loader: (_, _) async {
        loads++;
        return source();
      },
    );
    final other = await File('${directory.path}/two.gif').writeAsBytes([2]);
    await cache.load(file.path);
    await cache.load(other.path);
    await cache.load(file.path);
    expect(loads, 3);
    final oversized = GeneratedViewerSourceCache(
      maxBytes: 1,
      loader: (_, _) async {
        loads++;
        return source();
      },
    );
    await oversized.load(file.path);
    await oversized.load(file.path);
    expect(loads, 5);
  });

  test(
    'failed preparation is retried and clear discards pending cache writes',
    () async {
      var loads = 0;
      final completion = Completer<GeneratedViewerSource>();
      final entered = Completer<void>();
      final cache = GeneratedViewerSourceCache(
        loader: (_, _) async {
          loads++;
          if (loads == 1) throw const FormatException('bad GIF');
          if (loads == 2) {
            entered.complete();
            return completion.future;
          }
          return source();
        },
      );
      await expectLater(cache.load(file.path), throwsFormatException);
      final loading = cache.load(file.path);
      await entered.future;
      cache.clear();
      completion.complete(source());
      await loading;
      await cache.load(file.path);
      expect(loads, 3);
    },
  );
}
