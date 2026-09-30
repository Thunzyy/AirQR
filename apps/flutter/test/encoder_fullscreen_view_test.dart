import 'dart:convert';

import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/encoder_fullscreen_view.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final validGifBytes = base64Decode(
    'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  );

  Widget wrapApp(
    Widget child, {
    Locale? locale,
    MediaQueryData? mediaQueryData,
  }) {
    return MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: mediaQueryData == null
          ? child
          : MediaQuery(data: mediaQueryData, child: child),
    );
  }

  Future<void> tapVisible(WidgetTester tester, Finder finder) async {
    await tester.ensureVisible(finder);
    await tester.pump();
    await tester.tap(finder);
  }

  testWidgets(
    'EncoderFullscreenGifView renders single GIF without chunk toggle',
    (tester) async {
      await tester.pumpWidget(
        wrapApp(
          EncoderFullscreenGifView(
            gifData: Uint8List.fromList(validGifBytes),
            totalFrames: 42,
            minFrames: 28,
            fps: 10,
          ),
        ),
      );

      expect(find.textContaining('Frame: 1/42'), findsOneWidget);
      expect(find.text('AUTO'), findsNothing);
      expect(find.byType(InteractiveViewer), findsOneWidget);
    },
  );

  testWidgets('fullscreen download icon stays white', (tester) async {
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: Uint8List.fromList(validGifBytes),
          totalFrames: 42,
          minFrames: 28,
          fps: 10,
          onDownload: () {},
        ),
      ),
    );

    final downloadIcon = tester.widget<AirQrIcon>(
      find.descendant(
        of: find.byKey(const Key('qr-viewer-download')),
        matching: find.byType(AirQrIcon),
      ),
    );

    expect(downloadIcon.name, 'download');
    expect(downloadIcon.color, Colors.white);
  });

  testWidgets('pause stops frames and resume starts exactly one timer', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: Uint8List.fromList(validGifBytes),
          totalFrames: 20,
          minFrames: 15,
          fps: 10,
          chunkIndex: 0,
          totalChunks: 1,
          allChunkGifs: <Uint8List>[Uint8List.fromList(validGifBytes)],
          allChunkFrameCounts: const <int>[20],
        ),
      ),
    );

    await tester.pump(const Duration(milliseconds: 110));
    expect(find.textContaining('2/20 • Min 15'), findsOneWidget);
    expect(
      find.byKey(const Key('encoder-inline-animated-image')),
      findsOneWidget,
    );

    await tapVisible(tester, find.byKey(const Key('qr-viewer-play-toggle')));
    await tester.pump();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pump();
    expect(
      find.byKey(const Key('encoder-inline-animated-image')),
      findsNothing,
    );
    expect(
      find.byKey(const Key('encoder-inline-static-image')),
      findsOneWidget,
    );
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.textContaining('2/20 • Min 15'), findsOneWidget);

    await tapVisible(tester, find.byKey(const Key('qr-viewer-play-toggle')));
    await tester.pump();
    expect(
      find.byKey(const Key('encoder-inline-animated-image')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('encoder-inline-static-image')), findsNothing);
    await tester.pump(const Duration(milliseconds: 110));
    expect(find.textContaining('3/20 • Min 15'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 110));
    expect(find.textContaining('4/20 • Min 15'), findsOneWidget);
  });

  testWidgets('reduced motion starts and remains fixed without a timer', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: Uint8List.fromList(validGifBytes),
          totalFrames: 20,
          minFrames: 15,
          fps: 10,
          chunkIndex: 0,
          totalChunks: 1,
          allChunkGifs: <Uint8List>[Uint8List.fromList(validGifBytes)],
          allChunkFrameCounts: const <int>[20],
        ),
        mediaQueryData: const MediaQueryData(disableAnimations: true),
      ),
    );

    expect(find.bySemanticsLabel('Start automatic playback'), findsOneWidget);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 20)),
    );
    await tester.pump();
    expect(
      find.byKey(const Key('encoder-inline-animated-image')),
      findsNothing,
    );
    expect(
      find.byKey(const Key('encoder-inline-static-image')),
      findsOneWidget,
    );
    await tester.pump(const Duration(seconds: 2));
    expect(find.textContaining('1/20 • Min 15'), findsOneWidget);
  });

  testWidgets('MediaQuery motion changes stop playback until explicit resume', (
    tester,
  ) async {
    final gif = Uint8List.fromList(validGifBytes);
    final gifs = <Uint8List>[gif];
    Widget app({required bool disableAnimations}) => wrapApp(
      EncoderFullscreenGifView(
        gifData: gif,
        totalFrames: 20,
        minFrames: 15,
        fps: 10,
        chunkIndex: 0,
        totalChunks: 1,
        allChunkGifs: gifs,
        allChunkFrameCounts: const <int>[20],
      ),
      mediaQueryData: MediaQueryData(disableAnimations: disableAnimations),
    );

    await tester.pumpWidget(app(disableAnimations: false));
    await tester.pump(const Duration(milliseconds: 110));
    expect(find.textContaining('2/20 • Min 15'), findsOneWidget);

    await tester.pumpWidget(app(disableAnimations: true));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.textContaining('2/20 • Min 15'), findsOneWidget);

    await tester.pumpWidget(app(disableAnimations: false));
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.textContaining('2/20 • Min 15'), findsOneWidget);
    await tapVisible(tester, find.byKey(const Key('qr-viewer-play-toggle')));
    await tester.pump(const Duration(milliseconds: 110));
    expect(find.textContaining('3/20 • Min 15'), findsOneWidget);
  });

  testWidgets(
    'EncoderFullscreenGifView renders chunk controls and toggles mode',
    (tester) async {
      bool? autoAdvanceChanged;
      await tester.pumpWidget(
        wrapApp(
          EncoderFullscreenGifView(
            gifData: Uint8List.fromList(validGifBytes),
            totalFrames: 20,
            minFrames: 15,
            fps: 10,
            chunkIndex: 1,
            totalChunks: 3,
            allChunkGifs: <Uint8List>[
              Uint8List.fromList(validGifBytes),
              Uint8List.fromList(validGifBytes),
              Uint8List.fromList(validGifBytes),
            ],
            allChunkFrameCounts: const <int>[12, 20, 8],
            initialAutoAdvanceChunks: false,
            onAutoAdvanceChunksChanged: (value) => autoAdvanceChanged = value,
          ),
        ),
      );

      expect(find.textContaining('Chunk 2/3'), findsOneWidget);
      expect(find.text('Manual'), findsOneWidget);
      await tapVisible(tester, find.byKey(const Key('qr-viewer-auto-advance')));
      await tester.pump();
      expect(find.text('Auto'), findsOneWidget);
      expect(autoAdvanceChanged, isTrue);
      final control = find.byKey(const Key('qr-viewer-play-toggle'));
      expect(tester.getSize(control).width, greaterThanOrEqualTo(48));
      expect(tester.getSize(control).height, greaterThanOrEqualTo(48));
      final semantics = tester.getSemantics(control).getSemanticsData();
      expect(semantics.label, 'Pause automatic playback');
      expect(semantics.hasAction(SemanticsAction.tap), isTrue);

      await tapVisible(tester, control);
      await tester.pump();

      expect(find.bySemanticsLabel('Start automatic playback'), findsOneWidget);
    },
  );

  testWidgets(
    'EncoderFullscreenGifView localizes playback controls in French',
    (tester) async {
      await tester.pumpWidget(
        wrapApp(
          EncoderFullscreenGifView(
            gifData: Uint8List.fromList(validGifBytes),
            totalFrames: 20,
            minFrames: 15,
            fps: 10,
            chunkIndex: 0,
            totalChunks: 1,
            allChunkGifs: <Uint8List>[Uint8List.fromList(validGifBytes)],
            allChunkFrameCounts: const <int>[20],
          ),
          locale: const Locale('fr'),
        ),
      );

      expect(find.textContaining('Chunk 1/1'), findsOneWidget);
      expect(find.textContaining('1/20 • Min 15'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Suspendre la lecture automatique'),
        findsOneWidget,
      );
    },
  );

  testWidgets('fullscreen controls expose frame fps timeline and zoom', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: Uint8List.fromList(validGifBytes),
          totalFrames: 20,
          minFrames: 15,
          fps: 10,
        ),
      ),
    );

    expect(find.byKey(const Key('qr-viewer-frame-stepper')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-fps-stepper')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-frame-slider')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-auto-fit')), findsOneWidget);
    expect(
      tester.getSize(find.byKey(const Key('qr-viewer-auto-fit'))),
      tester.getSize(find.byType(InteractiveViewer)),
    );
    final minScanBadge = find.byKey(const Key('qr-viewer-min-scan-badge'));
    final frameBadge = find.byKey(const Key('qr-viewer-frame-badge'));
    expect(minScanBadge, findsOneWidget);
    expect(frameBadge, findsOneWidget);
    expect(
      tester.getCenter(minScanBadge).dy,
      moreOrLessEquals(tester.getCenter(frameBadge).dy, epsilon: 1),
    );
    expect(
      tester
          .widget<InteractiveViewer>(find.byType(InteractiveViewer))
          .panEnabled,
      isFalse,
    );
    final sliderTheme = tester.widget<SliderTheme>(
      find.byKey(const Key('qr-viewer-frame-slider-theme')),
    );
    final sliderContext = tester.element(
      find.byKey(const Key('qr-viewer-frame-slider-theme')),
    );
    expect(
      sliderTheme.data.activeTrackColor,
      AirQrTheme.textSecondary(sliderContext),
    );
    expect(
      sliderTheme.data.inactiveTrackColor,
      AirQrTheme.controlBorder(sliderContext),
    );
    expect(sliderTheme.data.thumbColor, AirQrTheme.textPrimary(sliderContext));
    expect(find.byKey(const Key('qr-viewer-zoom-out')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-zoom-reset')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-zoom-in')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-focus-toggle')), findsNothing);
    expect(find.byKey(const Key('qr-viewer-collapse-toggle')), findsOneWidget);

    await tapVisible(tester, find.byKey(const Key('qr-viewer-play-toggle')));
    await tester.pump();
    await tapVisible(tester, find.byKey(const Key('qr-viewer-next-frame')));
    await tester.pump();
    expect(find.textContaining('Frame: 2/20'), findsOneWidget);

    await tapVisible(tester, find.byKey(const Key('qr-viewer-fps-increase')));
    await tester.pump();
    expect(find.text('11'), findsOneWidget);

    await tapVisible(tester, find.byKey(const Key('qr-viewer-zoom-in')));
    await tester.pump();
    expect(find.text('150%'), findsOneWidget);
  });

  testWidgets('mobile controls match the encoder layout and timeline colors', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(360, 1000));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: Uint8List.fromList(validGifBytes),
          totalFrames: 20,
          minFrames: 15,
          fps: 10,
        ),
      ),
    );

    final controls = tester.getRect(
      find.byKey(const Key('qr-viewer-controls')),
    );
    final collapse = tester.getRect(
      find.byKey(const Key('qr-viewer-collapse-toggle')),
    );
    final play = tester.getRect(find.byKey(const Key('qr-viewer-play-toggle')));
    final frame = tester.getRect(
      find.byKey(const Key('qr-viewer-frame-stepper')),
    );
    final fps = tester.getRect(find.byKey(const Key('qr-viewer-fps-stepper')));

    expect(collapse.center.dy, moreOrLessEquals(play.center.dy, epsilon: 1));
    expect(collapse.left - controls.left, moreOrLessEquals(10, epsilon: 1));
    expect(controls.right - play.right, moreOrLessEquals(10, epsilon: 1));
    expect(frame.top, greaterThan(collapse.bottom));
    expect(fps.top, greaterThan(frame.bottom));
    expect(frame.left, moreOrLessEquals(fps.left, epsilon: 1));
    expect(frame.right, moreOrLessEquals(fps.right, epsilon: 1));

    final sliderTheme = tester.widget<SliderTheme>(
      find.byKey(const Key('qr-viewer-frame-slider-theme')),
    );
    final context = tester.element(
      find.byKey(const Key('qr-viewer-frame-slider-theme')),
    );
    expect(
      sliderTheme.data.activeTrackColor,
      AirQrTheme.textSecondary(context),
    );
    expect(
      sliderTheme.data.inactiveTrackColor,
      AirQrTheme.controlBorder(context),
    );
    expect(sliderTheme.data.thumbColor, AirQrTheme.textPrimary(context));
    expect(
      sliderTheme.data.overlayColor,
      AirQrTheme.textPrimary(context).withValues(alpha: 0.10),
    );
  });

  testWidgets('chunk viewer exposes auto advance data chunks and multi-view', (
    tester,
  ) async {
    final gif = Uint8List.fromList(validGifBytes);
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: gif,
          totalFrames: 3,
          minFrames: 2,
          fps: 10,
          chunkIndex: 0,
          totalChunks: 3,
          allChunkGifs: <Uint8List>[gif, gif, gif],
          allChunkFrameCounts: const <int>[3, 4, 5],
        ),
      ),
    );

    expect(find.text('Data Chunks'), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-auto-advance')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-multi-view')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-chunk-3')), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('qr-viewer-controls')),
        matching: find.byKey(const Key('qr-viewer-chunk-strip')),
      ),
      findsOneWidget,
    );

    await tapVisible(tester, find.byKey(const Key('qr-viewer-chunk-3')));
    await tester.pump();
    expect(find.textContaining('Chunk 3/3'), findsOneWidget);
    expect(find.textContaining('1/5 • Min 2'), findsOneWidget);

    await tapVisible(tester, find.byKey(const Key('qr-viewer-multi-view')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('qr-viewer-multi-view-grid')), findsOneWidget);
    expect(find.byIcon(Icons.fullscreen_rounded), findsNothing);
    expect(find.byIcon(Icons.fullscreen_exit), findsNothing);
    await tester.pump(const Duration(milliseconds: 110));
    expect(find.textContaining('2/3'), findsWidgets);
    expect(find.byKey(const Key('multi-view-open-0')), findsOneWidget);
  });

  testWidgets('chunk viewer uses the minimum required by the active chunk', (
    tester,
  ) async {
    final gif = Uint8List.fromList(validGifBytes);
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: gif,
          totalFrames: 8,
          minFrames: 7,
          fps: 10,
          chunkIndex: 0,
          totalChunks: 2,
          allChunkGifs: <Uint8List>[gif, gif],
          allChunkFrameCounts: const <int>[8, 4],
          allChunkMinFrames: const <int>[7, 3],
        ),
      ),
    );

    expect(find.textContaining('Min 7'), findsOneWidget);
    await tapVisible(tester, find.byKey(const Key('qr-viewer-chunk-2')));
    await tester.pump();
    expect(find.textContaining('Min 3'), findsOneWidget);
    expect(find.textContaining('Min 7'), findsNothing);
  });

  testWidgets('keyboard shortcuts do not hijack frame text input', (
    tester,
  ) async {
    final gif = Uint8List.fromList(validGifBytes);
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: gif,
          totalFrames: 8,
          minFrames: 7,
          fps: 10,
          chunkIndex: 0,
          totalChunks: 2,
          allChunkGifs: <Uint8List>[gif, gif],
          allChunkFrameCounts: const <int>[8, 4],
        ),
      ),
    );
    await tapVisible(tester, find.byKey(const Key('qr-viewer-play-toggle')));
    await tester.pump();
    final frameField = find.descendant(
      of: find.byKey(const Key('qr-viewer-frame-stepper')),
      matching: find.byType(TextField),
    );
    await tapVisible(tester, frameField);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    await tester.pump();

    expect(find.textContaining('Chunk 1/2'), findsOneWidget);
  });

  testWidgets('gesture transformation keeps the zoom percentage synchronized', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: Uint8List.fromList(validGifBytes),
          totalFrames: 8,
          minFrames: 7,
          fps: 10,
        ),
      ),
    );
    final viewer = tester.widget<InteractiveViewer>(
      find.byType(InteractiveViewer),
    );
    viewer.transformationController!.value = Matrix4.diagonal3Values(2, 2, 1);
    await tester.pump();
    expect(find.text('200%'), findsOneWidget);
  });

  testWidgets('viewer remains usable at 320dp with enlarged text', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        EncoderFullscreenGifView(
          gifData: Uint8List.fromList(validGifBytes),
          totalFrames: 20,
          minFrames: 15,
          fps: 10,
        ),
        mediaQueryData: const MediaQueryData(
          size: Size(320, 700),
          textScaler: TextScaler.linear(2),
        ),
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('qr-viewer-frame-stepper')), findsOneWidget);
    expect(find.byKey(const Key('qr-viewer-fps-stepper')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
