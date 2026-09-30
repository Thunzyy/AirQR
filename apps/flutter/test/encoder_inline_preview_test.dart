import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:airqr_mobile/encoder_inline_preview.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

Uint8List _twoFrameGif({
  required (int, int, int) first,
  required (int, int, int) second,
}) {
  img.Image frame((int, int, int) color) {
    final image = img.Image(width: 1, height: 1);
    image.setPixelRgba(0, 0, color.$1, color.$2, color.$3, 255);
    return image;
  }

  final encoder = img.GifEncoder(
    quantizerType: img.QuantizerType.octree,
    numColors: 2,
  );
  encoder.addFrame(frame(first), duration: 10);
  encoder.addFrame(frame(second), duration: 10);
  return encoder.finish()!;
}

Future<List<int>> _firstPixel(ui.Image image) async {
  final bytes = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
  return bytes!.buffer.asUint8List(0, 4).toList();
}

Future<ui.Image> _pumpUntilDecoded(
  WidgetTester tester,
  Key key, {
  ui.Image? differentFrom,
}) async {
  for (var attempt = 0; attempt < 50; attempt++) {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 1)),
    );
    await tester.pump();
    final rawImage = tester.widget<RawImage>(find.byKey(key));
    if (rawImage.image != null &&
        (differentFrom == null || !identical(rawImage.image, differentFrom))) {
      return rawImage.image!;
    }
  }
  fail('Timed out waiting for $key to decode');
}

void main() {
  final gifData = base64Decode(
    'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  );

  testWidgets('playing preview renders its requested decoded frame', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EncoderInlineGifPreview(
          gifData: gifData,
          frameNumber: 1,
          isPlaying: true,
          fit: BoxFit.contain,
        ),
      ),
    );

    final finder = find.byKey(const Key('encoder-inline-animated-image'));
    expect(finder, findsOneWidget);
    final decoded = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-animated-image'),
    );
    final image = tester.widget<RawImage>(finder);
    expect(decoded, isNotNull);
    expect(image.filterQuality, FilterQuality.none);
    expect(find.byKey(const Key('encoder-inline-static-image')), findsNothing);
  });

  testWidgets('paused preview decodes and renders the requested static frame', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: EncoderInlineGifPreview(
          gifData: gifData,
          frameNumber: 1,
          isPlaying: false,
          fit: BoxFit.cover,
        ),
      ),
    );
    expect(
      find.byKey(const Key('encoder-inline-animated-image')),
      findsNothing,
    );
    final finder = find.byKey(const Key('encoder-inline-static-image'));
    await _pumpUntilDecoded(tester, const Key('encoder-inline-static-image'));
    expect(finder, findsOneWidget);
    final image = tester.widget<RawImage>(finder);
    expect(image.image, isNotNull);
    expect(image.fit, BoxFit.cover);
    expect(image.filterQuality, FilterQuality.none);
  });

  testWidgets('reduced motion forces a static frame while playing', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: EncoderInlineGifPreview(
            gifData: gifData,
            frameNumber: 1,
            isPlaying: true,
            fit: BoxFit.contain,
          ),
        ),
      ),
    );
    expect(
      find.byKey(const Key('encoder-inline-animated-image')),
      findsNothing,
    );
    await _pumpUntilDecoded(tester, const Key('encoder-inline-static-image'));
    expect(
      find.byKey(const Key('encoder-inline-static-image')),
      findsOneWidget,
    );
  });

  testWidgets('pending static decode is safe across updates and unmount', (
    tester,
  ) async {
    Widget preview(int frameNumber) => MaterialApp(
      home: EncoderInlineGifPreview(
        gifData: gifData,
        frameNumber: frameNumber,
        isPlaying: false,
        fit: BoxFit.contain,
      ),
    );

    await tester.pumpWidget(preview(1));
    await tester.pumpWidget(preview(2));
    await tester.pumpWidget(const SizedBox.shrink());
    for (var attempt = 0; attempt < 10; attempt++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 1)),
      );
      await tester.pump();
    }

    expect(tester.takeException(), isNull);
  });

  testWidgets('playing pause resume and advance stay on requested GIF frames', (
    tester,
  ) async {
    final animatedGif = _twoFrameGif(first: (255, 0, 0), second: (0, 0, 255));
    Widget preview(int frameNumber, {required bool isPlaying}) => MaterialApp(
      home: EncoderInlineGifPreview(
        gifData: animatedGif,
        frameNumber: frameNumber,
        isPlaying: isPlaying,
        fit: BoxFit.contain,
      ),
    );

    await tester.pumpWidget(preview(1, isPlaying: true));
    final firstImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-animated-image'),
    );
    final firstPixel = await tester.runAsync(() => _firstPixel(firstImage));

    await tester.pumpWidget(preview(2, isPlaying: true));
    final secondImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-animated-image'),
      differentFrom: firstImage,
    );
    final secondPixel = await tester.runAsync(() => _firstPixel(secondImage));

    await tester.pumpWidget(preview(2, isPlaying: false));
    final pausedImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-static-image'),
    );
    final pausedPixel = await tester.runAsync(() => _firstPixel(pausedImage));

    await tester.pumpWidget(preview(2, isPlaying: true));
    final resumedImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-animated-image'),
    );
    final resumedPixel = await tester.runAsync(() => _firstPixel(resumedImage));

    await tester.pumpWidget(preview(1, isPlaying: true));
    final wrappedImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-animated-image'),
      differentFrom: resumedImage,
    );
    final wrappedPixel = await tester.runAsync(() => _firstPixel(wrappedImage));

    expect(firstPixel![0], greaterThan(firstPixel[2]));
    expect(secondPixel![2], greaterThan(secondPixel[0]));
    expect(pausedPixel, secondPixel);
    expect(resumedPixel, secondPixel);
    expect(wrappedPixel, firstPixel);
  });

  testWidgets('frame updates retain the old image until the new frame swaps', (
    tester,
  ) async {
    final animatedGif = _twoFrameGif(first: (255, 0, 0), second: (0, 0, 255));
    Widget preview(int frameNumber) => MaterialApp(
      home: EncoderInlineGifPreview(
        gifData: animatedGif,
        frameNumber: frameNumber,
        isPlaying: true,
        fit: BoxFit.contain,
      ),
    );

    await tester.pumpWidget(preview(1));
    final firstImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-animated-image'),
    );
    final firstPixel = await tester.runAsync(() => _firstPixel(firstImage));
    expect(firstPixel![0], greaterThan(firstPixel[2]));

    await tester.pumpWidget(preview(2));
    final imageDuringDecode = tester
        .widget<RawImage>(
          find.byKey(const Key('encoder-inline-animated-image')),
        )
        .image;
    expect(identical(imageDuringDecode, firstImage), isTrue);

    final secondImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-animated-image'),
      differentFrom: firstImage,
    );
    final secondPixel = await tester.runAsync(() => _firstPixel(secondImage));
    expect(secondPixel![2], greaterThan(secondPixel[0]));
  });

  testWidgets('changing GIF data replaces the decoded static image', (
    tester,
  ) async {
    final redGif = _twoFrameGif(first: (255, 0, 0), second: (0, 0, 255));
    final greenGif = _twoFrameGif(first: (0, 255, 0), second: (255, 255, 0));
    Widget preview(Uint8List data) => MaterialApp(
      home: EncoderInlineGifPreview(
        gifData: data,
        frameNumber: 1,
        isPlaying: false,
        fit: BoxFit.contain,
      ),
    );

    await tester.pumpWidget(preview(redGif));
    final firstImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-static-image'),
    );
    final firstPixel = await tester.runAsync(() => _firstPixel(firstImage));

    await tester.pumpWidget(preview(greenGif));
    final replacementImage = await _pumpUntilDecoded(
      tester,
      const Key('encoder-inline-static-image'),
      differentFrom: firstImage,
    );
    final replacementPixel = await tester.runAsync(
      () => _firstPixel(replacementImage),
    );

    expect(replacementImage, isNot(same(firstImage)));
    expect(firstPixel![0], greaterThan(firstPixel[1]));
    expect(replacementPixel![1], greaterThan(replacementPixel[0]));
  });
}
