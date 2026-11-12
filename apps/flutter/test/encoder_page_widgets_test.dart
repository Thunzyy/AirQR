import 'dart:async';
import 'dart:ui' show Tristate;

import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/encoder_page.dart';
import 'package:airqr_mobile/encoder_page_widgets.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/note_detection.dart';
import 'package:airqr_mobile/widgets/airqr_segmented_control.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUpAll(() async {
    final manrope = FontLoader('Manrope')
      ..addFont(rootBundle.load('assets/fonts/Manrope-ExtraBold.ttf'));
    await manrope.load();
  });

  const validGifBytes = <int>[
    71,
    73,
    70,
    56,
    57,
    97,
    1,
    0,
    1,
    0,
    128,
    0,
    0,
    0,
    0,
    0,
    255,
    255,
    255,
    33,
    249,
    4,
    1,
    0,
    0,
    1,
    0,
    44,
    0,
    0,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    2,
    2,
    68,
    1,
    0,
    59,
  ];
  Widget wrapApp(Widget child, {ThemeData? theme}) {
    return MaterialApp(
      theme: theme ?? ThemeData(brightness: Brightness.dark),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );
  }

  Future<void> pumpUntilInlineImage(WidgetTester tester, Key key) async {
    for (var attempt = 0; attempt < 50; attempt++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 1)),
      );
      await tester.pump();
      final images = tester.widgetList<RawImage>(find.byKey(key)).toList();
      if (images.isNotEmpty && images.every((image) => image.image != null)) {
        return;
      }
    }
    fail('Timed out waiting for $key to decode');
  }

  void expectAccessibleAction(
    WidgetTester tester,
    Key key,
    String label, {
    bool enabled = true,
  }) {
    final finder = find.byKey(key);
    expect(finder, findsOneWidget);
    final size = tester.getSize(finder);
    expect(size.width, greaterThanOrEqualTo(48));
    expect(size.height, greaterThanOrEqualTo(48));
    final data = tester.getSemantics(finder).getSemanticsData();
    expect(data.label, label);
    expect(data.hasAction(SemanticsAction.tap), enabled);
    expect(
      data.flagsCollection.isEnabled,
      enabled ? Tristate.isTrue : Tristate.isFalse,
    );
  }

  void expectVisibleMaterialState(
    WidgetTester tester,
    Key key,
    Color expectedSurface,
  ) {
    final scope = find.byKey(key);
    final material = tester.widget<Material>(
      find.descendant(of: scope, matching: find.byType(Material)).first,
    );
    final inkWell = tester.widget<InkWell>(
      find.descendant(of: scope, matching: find.byType(InkWell)).first,
    );
    expect(material.color, expectedSurface);
    expect(
      inkWell.overlayColor?.resolve(<WidgetState>{WidgetState.focused})?.a,
      greaterThan(0),
    );
    expect(
      inkWell.overlayColor?.resolve(<WidgetState>{WidgetState.pressed})?.a,
      greaterThan(0),
    );
  }

  testWidgets('EncoderSourceCard renders web-like file and folder actions', (
    tester,
  ) async {
    var fileTapped = false;
    var folderTapped = false;

    await tester.pumpWidget(
      wrapApp(
        EncoderSourceCard(
          fileName: 'demo.zip',
          fileSizeLabel: '12.5 MB',
          hasSelection: true,
          onSelectFile: () => fileTapped = true,
          onSelectFolder: () => folderTapped = true,
        ),
      ),
    );

    expect(find.text('demo.zip'), findsOneWidget);
    expect(find.text('12.5 MB'), findsOneWidget);
    expect(find.text('Select File(s)'), findsOneWidget);
    expect(find.text('Select Folder'), findsOneWidget);
    final selectedFileIcon = tester.widget<Container>(
      find.byKey(const Key('encoder-selected-file-icon')),
    );
    final selectedFileIconDecoration =
        selectedFileIcon.decoration! as BoxDecoration;
    expect(
      tester.getSize(find.byKey(const Key('encoder-selected-file-icon'))),
      const Size(48, 48),
    );
    expect(selectedFileIcon.alignment, Alignment.center);
    expect(selectedFileIconDecoration.shape, BoxShape.circle);
    expect(selectedFileIconDecoration.color, AirQrTheme.darkIconSurface);
    final selectedFileGlyph = tester.widget<AirQrIcon>(
      find.descendant(
        of: find.byKey(const Key('encoder-selected-file-icon')),
        matching: find.byType(AirQrIcon),
      ),
    );
    expect(selectedFileGlyph.name, 'description');
    expect(selectedFileGlyph.size, 20);
    expect(
      tester
          .widget<Material>(
            find
                .ancestor(
                  of: find.text('Select File(s)'),
                  matching: find.byType(Material),
                )
                .first,
          )
          .color,
      AirQrTheme.darkControlSurface,
    );

    await tester.tap(find.text('Select File(s)'));
    expect(fileTapped, isTrue);

    await tester.tap(find.text('Select Folder'));
    expect(folderTapped, isTrue);
  });

  testWidgets('EncoderNetworkAccessNotice opens settings and releases', (
    tester,
  ) async {
    var settingsTapped = false;
    var releasesTapped = false;
    var dismissed = false;

    await tester.pumpWidget(
      wrapApp(
        EncoderNetworkAccessNotice(
          onOpenOfflineWebSettings: () => settingsTapped = true,
          onOpenGithubReleases: () => releasesTapped = true,
          onDismiss: () => dismissed = true,
        ),
        theme: ThemeData(
          brightness: Brightness.dark,
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
      ),
    );

    expect(
      tester
          .getSize(find.byWidgetPredicate((widget) => widget is ElevatedButton))
          .height,
      greaterThanOrEqualTo(48),
    );
    final contentRect = tester.getRect(
      find.byKey(const Key('encoder-network-notice-content')),
    );
    final dismissRect = tester.getRect(
      find.byKey(const Key('encoder-network-notice-dismiss')),
    );
    expect(contentRect.right, lessThanOrEqualTo(dismissRect.left - 6));
    expect(
      tester
          .getSize(find.byWidgetPredicate((widget) => widget is TextButton))
          .height,
      greaterThanOrEqualTo(48),
    );

    expect(find.text('Use AirQR from another device'), findsOneWidget);
    expect(find.text('Open server settings'), findsOneWidget);
    expect(find.text('GitHub releases'), findsOneWidget);

    await tester.tap(find.text('Open server settings'));
    expect(settingsTapped, isTrue);

    await tester.tap(find.text('GitHub releases'));
    expect(releasesTapped, isTrue);

    await tester.tap(find.byTooltip('Do not show again'));
    expect(dismissed, isTrue);
  });

  testWidgets('EncoderPage persists dismissed network access notice', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(brightness: Brightness.dark),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const EncoderPage(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Use AirQR from another device'), findsOneWidget);

    await tester.tap(find.byTooltip('Do not show again'));
    await tester.pumpAndSettle();

    expect(find.text('Use AirQR from another device'), findsNothing);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('airqr_encoder_network_notice_hidden'), isTrue);
  });

  testWidgets('chunk playback pause freezes and resume continues', (
    tester,
  ) async {
    final controller = EncoderChunkPlaybackController();
    controller.configure(
      frameCounts: const <int>[5],
      chunkCount: 1,
      fps: 10,
      autoplay: true,
    );

    await tester.pump(const Duration(milliseconds: 110));
    expect(controller.value.currentFrame, 2);
    controller.pause();
    final pausedFrame = controller.value.currentFrame;
    await tester.pump(const Duration(milliseconds: 500));
    expect(controller.value.currentFrame, pausedFrame);

    controller.resume();
    expect(controller.value.currentFrame, pausedFrame);
    await tester.pump(const Duration(milliseconds: 110));
    expect(controller.value.currentFrame, pausedFrame + 1);
    controller.dispose();
  });

  testWidgets('chunk playback exposes the same frame and FPS controls', (
    tester,
  ) async {
    final controller = EncoderChunkPlaybackController();
    controller.configure(
      frameCounts: const <int>[5],
      chunkCount: 1,
      fps: 10,
      autoplay: false,
    );

    expect(controller.value.playbackFps, 10);
    controller.seekFrame(4);
    expect(controller.value.currentFrame, 4);
    controller.seekFrame(99);
    expect(controller.value.currentFrame, 5);

    controller.setPlaybackFps(24);
    expect(controller.value.playbackFps, 24);
    controller.setPlaybackFps(0);
    expect(controller.value.playbackFps, 1);
    controller.dispose();
  });

  testWidgets('chunk auto advance mirrors Web automatic and manual modes', (
    tester,
  ) async {
    final controller = EncoderChunkPlaybackController();
    controller.configure(
      frameCounts: const <int>[2, 2],
      chunkCount: 2,
      fps: 10,
      autoplay: true,
    );

    await tester.pump(const Duration(milliseconds: 110));
    expect(controller.value.currentFrame, 2);

    controller.toggleAutoAdvanceChunks();
    expect(controller.value.autoAdvanceChunks, isFalse);
    await tester.pump(const Duration(milliseconds: 110));
    expect(controller.value.selectedChunkIndex, 0);
    expect(controller.value.currentFrame, 1);

    controller.toggleAutoAdvanceChunks();
    expect(controller.value.autoAdvanceChunks, isTrue);
    await tester.pump(const Duration(milliseconds: 220));
    expect(controller.value.selectedChunkIndex, 1);
    expect(controller.value.currentFrame, 1);
    controller.dispose();
  });

  testWidgets('chunk playback reduced motion pauses until explicit resume', (
    tester,
  ) async {
    final controller = EncoderChunkPlaybackController();
    controller.configure(
      frameCounts: const <int>[5],
      chunkCount: 1,
      fps: 10,
      autoplay: true,
    );
    await tester.pump(const Duration(milliseconds: 110));

    controller.setAnimationsDisabled(true);
    final fixedFrame = controller.value.currentFrame;
    expect(controller.value.isPlaying, isFalse);
    await tester.pump(const Duration(milliseconds: 500));
    expect(controller.value.currentFrame, fixedFrame);
    controller.setAnimationsDisabled(false);
    await tester.pump(const Duration(milliseconds: 500));
    expect(controller.value.currentFrame, fixedFrame);

    controller.resume();
    await tester.pump(const Duration(milliseconds: 110));
    expect(controller.value.currentFrame, fixedFrame + 1);
    controller.dispose();
    await tester.pump(const Duration(milliseconds: 500));
    expect(tester.takeException(), isNull);
  });

  testWidgets('fullscreen completion does not restart after caller disposal', (
    tester,
  ) async {
    var returned = false;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => unawaited(
              pushEncoderFullscreenRoute(
                context: context,
                builder: (_) => const Scaffold(body: Text('fullscreen')),
                onReturn: () => returned = true,
              ),
            ),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('fullscreen'), findsOneWidget);

    await tester.pumpWidget(const MaterialApp(home: Text('replacement')));
    await tester.pumpAndSettle();
    expect(returned, isFalse);
  });

  testWidgets(
    'EncoderSettingsPanel shows chunk size input only in chunk mode',
    (tester) async {
      await tester.pumpWidget(
        wrapApp(
          EncoderSettingsPanel(
            expanded: true,
            onToggleExpanded: () {},
            fps: 10,
            eccLevel: 'MEDIUM',
            packetSize: 800,
            targetQrSize: 177,
            scale: 0,
            raptorqOverhead: 1.2,
            compressionEnabled: true,
            forceChunkMode: false,
            chunkSizeMbText: '10.0',
            onFpsChanged: (_) {},
            onEccLevelChanged: (_) {},
            onPacketSizeChanged: (_) {},
            onTargetQrSizeChanged: (_) {},
            onScaleChanged: (_) {},
            onRaptorqOverheadChanged: (_) {},
            onCompressionChanged: (_) {},
            onForceChunkModeChanged: (_) {},
            onChunkSizeChanged: (_) {},
          ),
        ),
      );

      expect(find.text('Chunk Size (MB)'), findsNothing);

      await tester.pumpWidget(
        wrapApp(
          EncoderSettingsPanel(
            expanded: true,
            onToggleExpanded: () {},
            fps: 10,
            eccLevel: 'MEDIUM',
            packetSize: 800,
            targetQrSize: 177,
            scale: 0,
            raptorqOverhead: 1.2,
            compressionEnabled: true,
            forceChunkMode: true,
            chunkSizeMbText: '10.0',
            onFpsChanged: (_) {},
            onEccLevelChanged: (_) {},
            onPacketSizeChanged: (_) {},
            onTargetQrSizeChanged: (_) {},
            onScaleChanged: (_) {},
            onRaptorqOverheadChanged: (_) {},
            onCompressionChanged: (_) {},
            onForceChunkModeChanged: (_) {},
            onChunkSizeChanged: (_) {},
          ),
        ),
      );

      expect(find.text('Chunk Size (MB)'), findsOneWidget);
    },
  );

  testWidgets('EncoderSettingsPanel matches web slider model', (tester) async {
    double? changedRaptorq;

    await tester.pumpWidget(
      wrapApp(
        EncoderSettingsPanel(
          expanded: true,
          onToggleExpanded: () {},
          fps: 10,
          eccLevel: 'MEDIUM',
          packetSize: 800,
          targetQrSize: 177,
          scale: 0,
          raptorqOverhead: 1.2,
          compressionEnabled: true,
          forceChunkMode: true,
          chunkSizeMbText: '10.0',
          onFpsChanged: (_) {},
          onEccLevelChanged: (_) {},
          onPacketSizeChanged: (_) {},
          onTargetQrSizeChanged: (_) {},
          onScaleChanged: (_) {},
          onRaptorqOverheadChanged: (value) => changedRaptorq = value,
          onCompressionChanged: (_) {},
          onForceChunkModeChanged: (_) {},
          onChunkSizeChanged: (_) {},
        ),
      ),
    );

    expect(find.byType(Slider), findsNWidgets(5));
    expect(find.text('Scale (0=Auto)'), findsNothing);

    for (final slider in find.byType(Slider).evaluate()) {
      final sliderTheme = find
          .ancestor(
            of: find.byWidget(slider.widget),
            matching: find.byType(SliderTheme),
          )
          .first;
      expect(
        tester.widget<SliderTheme>(sliderTheme).data.tickMarkShape,
        SliderTickMarkShape.noTickMark,
      );
    }

    final raptorSlider = tester.widget<Slider>(find.byType(Slider).at(3));
    expect(raptorSlider.max, 3.0);
    raptorSlider.onChanged?.call(3.0);
    expect(changedRaptorq, 3.0);
  });

  testWidgets('Encoder switches use calm selected tracks in both themes', (
    tester,
  ) async {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      await tester.pumpWidget(
        wrapApp(
          EncoderSettingsPanel(
            expanded: true,
            onToggleExpanded: () {},
            fps: 10,
            eccLevel: 'MEDIUM',
            packetSize: 800,
            targetQrSize: 177,
            scale: 0,
            raptorqOverhead: 1.2,
            compressionEnabled: true,
            forceChunkMode: true,
            chunkSizeMbText: '10.0',
            onFpsChanged: (_) {},
            onEccLevelChanged: (_) {},
            onPacketSizeChanged: (_) {},
            onTargetQrSizeChanged: (_) {},
            onScaleChanged: (_) {},
            onRaptorqOverheadChanged: (_) {},
            onCompressionChanged: (_) {},
            onForceChunkModeChanged: (_) {},
            onChunkSizeChanged: (_) {},
          ),
          theme: ThemeData(brightness: brightness),
        ),
      );
      await tester.pumpAndSettle();

      final selectedTrack = tester
          .widget<Switch>(find.byType(Switch).first)
          .trackColor
          ?.resolve(const <WidgetState>{WidgetState.selected});
      expect(
        selectedTrack,
        brightness == Brightness.dark
            ? AirQrTheme.darkSwitchSelectedTrack
            : AirQrTheme.lightSwitchSelectedTrack,
      );
    }
  });

  testWidgets('EncoderGifResultCard renders stats and triggers actions', (
    tester,
  ) async {
    var downloadTapped = false;
    var fullscreenTapped = false;
    var playbackToggles = 0;
    int? requestedFrame;
    int? requestedFps;

    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      wrapApp(
        SingleChildScrollView(
          child: EncoderGifResultCard(
            gifData: Uint8List.fromList(const <int>[
              71,
              73,
              70,
              56,
              57,
              97,
              1,
              0,
              1,
              0,
              128,
              0,
              0,
              0,
              0,
              0,
              255,
              255,
              255,
              33,
              249,
              4,
              1,
              0,
              0,
              1,
              0,
              44,
              0,
              0,
              0,
              0,
              1,
              0,
              1,
              0,
              0,
              2,
              2,
              68,
              1,
              0,
              59,
            ]),
            currentFrame: 3,
            totalFrames: 42,
            minFrames: 28,
            sizeLabel: '4.2 MB',
            durationLabel: '8.1s',
            originalSizeBytes: 1,
            onDownload: () => downloadTapped = true,
            onFullscreen: () => fullscreenTapped = true,
            onTogglePlayback: () => playbackToggles += 1,
            onFrameChanged: (value) => requestedFrame = value,
            onPlaybackFpsChanged: (value) => requestedFps = value,
          ),
        ),
      ),
    );

    expect(find.text('3 / 42 (Min Required: 28)'), findsOneWidget);
    expect(find.textContaining('4.2 MB - 8.1s'), findsOneWidget);
    expect(find.textContaining('expansion'), findsOneWidget);
    expect(find.text('Min scan 2.8s'), findsOneWidget);
    final interactiveViewer = tester.widget<InteractiveViewer>(
      find.byType(InteractiveViewer).first,
    );
    expect(interactiveViewer.panEnabled, isFalse);
    expect(interactiveViewer.onInteractionEnd, isNotNull);
    final frameSliderTheme = tester.widget<SliderTheme>(
      find.byKey(const Key('encoder-gif-frame-slider-theme')),
    );
    final frameSliderContext = tester.element(
      find.byKey(const Key('encoder-gif-frame-slider-theme')),
    );
    expect(
      frameSliderTheme.data.activeTrackColor,
      AirQrTheme.textSecondary(frameSliderContext),
    );
    expect(
      frameSliderTheme.data.inactiveTrackColor,
      AirQrTheme.controlBorder(frameSliderContext),
    );
    expect(
      find.byKey(const Key('encoder-inline-animated-image')),
      findsOneWidget,
    );
    expect(
      find.ancestor(
        of: find.byKey(const Key('encoder-gif-preview')),
        matching: find.byType(RepaintBoundary),
      ),
      findsAtLeastNWidgets(1),
    );
    final gifPreview = tester.widget<Container>(
      find.byKey(const Key('encoder-gif-preview')),
    );
    final gifPreviewDecoration = gifPreview.decoration! as BoxDecoration;
    final gifPreviewContext = tester.element(
      find.byKey(const Key('encoder-gif-preview')),
    );
    expect(gifPreviewDecoration.borderRadius, AirQrRadii.panel);
    expect(
      gifPreviewDecoration.color,
      AirQrTheme.previewSurface(gifPreviewContext),
    );
    expect(
      gifPreviewDecoration.border,
      Border.all(color: AirQrTheme.controlBorder(gifPreviewContext)),
    );
    expect(gifPreview.clipBehavior, Clip.antiAlias);
    expectAccessibleAction(
      tester,
      const Key('encoder-gif-fullscreen-action'),
      'Open fullscreen',
    );
    expect(find.bySemanticsLabel('Open fullscreen'), findsOneWidget);
    expectVisibleMaterialState(
      tester,
      const Key('encoder-gif-fullscreen-action'),
      AirQrTheme.actionSurface(
        tester.element(find.byType(EncoderGifResultCard)),
      ),
    );
    expectAccessibleAction(
      tester,
      const Key('encoder-gif-download-action'),
      'Download GIF',
    );
    expect(
      find.ancestor(
        of: find.byKey(const Key('encoder-gif-download-action')),
        matching: find.byKey(const Key('encoder-gif-preview')),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('encoder-gif-preview')),
        matching: find.byKey(const Key('encoder-gif-frame-badge')),
      ),
      findsOneWidget,
    );

    await tester.ensureVisible(
      find.byKey(const Key('encoder-gif-fullscreen-action')),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('encoder-gif-fullscreen-action')));
    await tester.pump();
    expect(fullscreenTapped, isTrue);
    fullscreenTapped = false;

    await tester.ensureVisible(
      find.byKey(const Key('encoder-gif-download-action')),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('encoder-gif-download-action')));
    await tester.pump();
    expect(downloadTapped, isTrue);

    await tester.ensureVisible(find.byKey(const Key('encoder-gif-controls')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('encoder-gif-play-toggle')));
    await tester.tap(
      find
          .descendant(
            of: find.byKey(const Key('encoder-gif-frame-stepper')),
            matching: find.byType(IconButton),
          )
          .last,
    );
    await tester.tap(
      find
          .descendant(
            of: find.byKey(const Key('encoder-gif-fps-stepper')),
            matching: find.byType(IconButton),
          )
          .first,
    );
    await tester.pump();
    expect(playbackToggles, 1);
    expect(requestedFrame, 4);
    expect(requestedFps, 9);

    await tester.tap(find.byKey(const Key('encoder-gif-collapse-controls')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const Key('encoder-gif-expand-controls')),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('encoder result badges share one line at 360dp', (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(360, 1000));
    await tester.pumpWidget(
      wrapApp(
        SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: EncoderGifResultCard(
            gifData: Uint8List.fromList(validGifBytes),
            currentFrame: 52,
            totalFrames: 81,
            minFrames: 68,
            sizeLabel: '158.61 KB',
            durationLabel: '1.6s',
            originalSizeBytes: 1024,
            playbackFps: 10,
            onDownload: () {},
            onFullscreen: () {},
          ),
        ),
      ),
    );

    final frameText = find.descendant(
      of: find.byKey(const Key('encoder-gif-frame-badge')),
      matching: find.byType(Text),
    );
    final minScanText = find.descendant(
      of: find.byKey(const Key('encoder-gif-min-scan')),
      matching: find.byType(Text),
    );
    expect(find.text('52 / 81 (Min Required: 68)'), findsOneWidget);
    expect(find.text('Min scan 6.8s'), findsOneWidget);
    expect(
      tester.renderObject<RenderParagraph>(frameText).didExceedMaxLines,
      isFalse,
    );
    expect(
      tester.renderObject<RenderParagraph>(minScanText).didExceedMaxLines,
      isFalse,
    );
    expect(
      tester.getCenter(frameText).dy,
      closeTo(tester.getCenter(minScanText).dy, 0.5),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('chunk result reuses the normal viewer structure at 360dp', (
    tester,
  ) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(360, 1200));
    final gif = Uint8List.fromList(validGifBytes);

    await tester.pumpWidget(
      wrapApp(
        SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              EncoderGifResultCard(
                gifData: gif,
                currentFrame: 3,
                totalFrames: 42,
                minFrames: 28,
                sizeLabel: '4.2 MB',
                durationLabel: '1.6s',
                playbackFps: 10,
                onDownload: () {},
                onFullscreen: () {},
              ),
              EncoderChunkResultCard(
                chunkGifs: <Uint8List>[gif, gif],
                chunkFrameCounts: const <int>[42, 38],
                selectedChunkIndex: 0,
                totalChunks: 2,
                totalFrames: 80,
                currentChunkFrame: 3,
                minFrames: 28,
                resultSizeLabel: '8.4 MB',
                durationLabel: '1.6s',
                isChunkPlaying: false,
                onDownload: () {},
                onFullscreen: () {},
                onChunkSelected: (_) {},
                onOpenMultiView: () {},
                onTogglePlayPause: () {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('RESULT'), findsNWidgets(2));
    expect(find.byKey(const Key('encoder-chunk-result-stats')), findsOneWidget);
    expect(find.byKey(const Key('encoder-chunk-frame-badge')), findsOneWidget);
    expect(find.byKey(const Key('encoder-chunk-min-scan')), findsOneWidget);
    expect(find.byKey(const Key('encoder-chunk-controls')), findsOneWidget);
    expect(
      find.byKey(const Key('encoder-chunk-frame-stepper')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('encoder-chunk-fps-stepper')), findsOneWidget);
    expect(
      find.byKey(const Key('encoder-chunk-download-action')),
      findsOneWidget,
    );
    expect(
      tester.getSize(find.byKey(const Key('encoder-chunk-preview'))).height,
      tester.getSize(find.byKey(const Key('encoder-gif-preview'))).height,
    );
    expect(tester.takeException(), isNull);
  });

  for (final brightness in Brightness.values) {
    testWidgets(
      'encoder result progress uses semantic typography in ${brightness.name}',
      (tester) async {
        final theme = ThemeData(
          brightness: brightness,
          textTheme: AirQrTheme.textTheme,
          extensions: const <ThemeExtension<dynamic>>[AirQrTypography.standard],
        );
        await tester.pumpWidget(
          wrapApp(
            SingleChildScrollView(
              child: Column(
                children: [
                  EncoderGifResultCard(
                    gifData: Uint8List.fromList(validGifBytes),
                    currentFrame: 3,
                    totalFrames: 42,
                    minFrames: 28,
                    sizeLabel: '4.2 MB',
                    durationLabel: '8.1s',
                    onDownload: () {},
                    onFullscreen: () {},
                  ),
                  EncoderChunkResultCard(
                    chunkGifs: <Uint8List>[Uint8List.fromList(validGifBytes)],
                    chunkFrameCounts: const <int>[42],
                    selectedChunkIndex: 0,
                    totalChunks: 1,
                    totalFrames: 42,
                    currentChunkFrame: 3,
                    minFrames: 28,
                    resultSizeLabel: '4.2 MB',
                    durationLabel: '8.1s',
                    isChunkPlaying: false,
                    onDownload: () {},
                    onFullscreen: () {},
                    onChunkSelected: (_) {},
                    onOpenMultiView: () {},
                    onTogglePlayPause: () {},
                  ),
                ],
              ),
            ),
            theme: theme,
          ),
        );

        for (final key in const <Key>[
          Key('encoder-gif-frame-badge'),
          Key('encoder-chunk-frame-badge'),
        ]) {
          final progressFinder = find.descendant(
            of: find.byKey(key),
            matching: find.text('3 / 42 (Min Required: 28)'),
          );
          expect(progressFinder, findsOneWidget);
          final progress = tester.widget<Text>(progressFinder);
          expect(
            progress.style?.color,
            AirQrTheme.progressText(tester.element(progressFinder)),
          );
        }
      },
    );
  }

  testWidgets(
    'EncoderChunkResultCard renders chunk controls and triggers actions',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      var downloadTapped = false;
      var fullscreenTapped = false;
      var selectedChunk = -1;
      var multiViewTapped = false;
      var toggleTapped = false;
      var autoAdvanceTapped = false;

      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(
        wrapApp(
          EncoderChunkResultCard(
            chunkGifs: <Uint8List>[
              Uint8List.fromList(const <int>[
                71,
                73,
                70,
                56,
                57,
                97,
                1,
                0,
                1,
                0,
                128,
                0,
                0,
                0,
                0,
                0,
                255,
                255,
                255,
                33,
                249,
                4,
                1,
                0,
                0,
                1,
                0,
                44,
                0,
                0,
                0,
                0,
                1,
                0,
                1,
                0,
                0,
                2,
                2,
                68,
                1,
                0,
                59,
              ]),
              Uint8List.fromList(const <int>[
                71,
                73,
                70,
                56,
                57,
                97,
                1,
                0,
                1,
                0,
                128,
                0,
                0,
                0,
                0,
                0,
                255,
                255,
                255,
                33,
                249,
                4,
                1,
                0,
                0,
                1,
                0,
                44,
                0,
                0,
                0,
                0,
                1,
                0,
                1,
                0,
                0,
                2,
                2,
                68,
                1,
                0,
                59,
              ]),
              Uint8List.fromList(const <int>[
                71,
                73,
                70,
                56,
                57,
                97,
                1,
                0,
                1,
                0,
                128,
                0,
                0,
                0,
                0,
                0,
                255,
                255,
                255,
                33,
                249,
                4,
                1,
                0,
                0,
                1,
                0,
                44,
                0,
                0,
                0,
                0,
                1,
                0,
                1,
                0,
                0,
                2,
                2,
                68,
                1,
                0,
                59,
              ]),
            ],
            chunkFrameCounts: const <int>[20, 35, 18],
            selectedChunkIndex: 1,
            totalChunks: 3,
            totalFrames: 73,
            currentChunkFrame: 7,
            minFrames: 15,
            resultSizeLabel: '42.0 KB',
            durationLabel: '2.4s',
            isChunkPlaying: false,
            onDownload: () => downloadTapped = true,
            onFullscreen: () => fullscreenTapped = true,
            onChunkSelected: (index) => selectedChunk = index,
            onOpenMultiView: () => multiViewTapped = true,
            onToggleAutoAdvanceChunks: () => autoAdvanceTapped = true,
            onTogglePlayPause: () => toggleTapped = true,
          ),
        ),
      );

      expect(find.bySemanticsLabel('Chunk 2/3'), findsOneWidget);
      expect(find.byKey(const Key('encoder-chunk-selector')), findsOneWidget);
      expect(
        find.ancestor(
          of: find.byKey(const Key('encoder-chunk-selector')),
          matching: find.byKey(const Key('encoder-chunk-result-card')),
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('encoder-chunk-option-1')), findsOneWidget);
      expect(find.byKey(const Key('encoder-chunk-option-2')), findsOneWidget);
      expect(find.byKey(const Key('encoder-chunk-option-3')), findsOneWidget);
      expect(
        find.byKey(const Key('encoder-chunk-previous-action')),
        findsNothing,
      );
      expect(find.byKey(const Key('encoder-chunk-next-action')), findsNothing);
      expect(find.text('7/35 • Min 15'), findsOneWidget);
      expect(find.text('Chunk 2/3 • 1.5s'), findsOneWidget);
      expect(find.text('Auto'), findsOneWidget);
      expect(find.bySemanticsLabel('Auto-advance ON'), findsOneWidget);
      expect(
        find.bySemanticsLabel('7 / 35 (Min Required: 15)'),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel('Chunk 2/3, Min scan 1.5s'), findsOneWidget);
      final statusCenters = <double>[
        tester.getCenter(find.byKey(const Key('encoder-chunk-frame-badge'))).dy,
        tester.getCenter(find.byKey(const Key('encoder-chunk-chunk-badge'))).dy,
        tester
            .getCenter(find.byKey(const Key('encoder-chunk-auto-advance')))
            .dy,
      ];
      expect(
        statusCenters.reduce((a, b) => a > b ? a : b) -
            statusCenters.reduce((a, b) => a < b ? a : b),
        lessThanOrEqualTo(1),
      );
      expect(find.textContaining('42.0 KB - 2.4s'), findsOneWidget);
      expect(find.textContaining('73 total frames'), findsNothing);
      await pumpUntilInlineImage(
        tester,
        const Key('encoder-inline-static-image'),
      );
      expect(
        find.byKey(const Key('encoder-inline-static-image')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('encoder-inline-animated-image')),
        findsNothing,
      );
      expect(
        find.ancestor(
          of: find.byKey(const Key('encoder-chunk-preview')),
          matching: find.byType(RepaintBoundary),
        ),
        findsAtLeastNWidgets(1),
      );
      final chunkPreview = tester.widget<Container>(
        find.byKey(const Key('encoder-chunk-preview')),
      );
      final chunkPreviewDecoration = chunkPreview.decoration! as BoxDecoration;
      final chunkPreviewContext = tester.element(
        find.byKey(const Key('encoder-chunk-preview')),
      );
      expect(chunkPreviewDecoration.borderRadius, AirQrRadii.panel);
      expect(
        chunkPreviewDecoration.border,
        Border.all(color: AirQrTheme.controlBorder(chunkPreviewContext)),
      );
      expect(chunkPreview.clipBehavior, Clip.antiAlias);
      expectAccessibleAction(
        tester,
        const Key('encoder-chunk-fullscreen-action'),
        'Open fullscreen',
      );
      expectAccessibleAction(
        tester,
        const Key('encoder-chunk-play-toggle'),
        'Start automatic playback',
      );
      expectAccessibleAction(
        tester,
        const Key('encoder-chunk-download-action'),
        'Download ZIP',
      );
      expect(find.bySemanticsLabel('Open fullscreen'), findsOneWidget);

      await tester.tap(find.byKey(const Key('encoder-chunk-auto-advance')));
      await tester.pump();
      expect(autoAdvanceTapped, isTrue);

      await tester.ensureVisible(
        find.byKey(const Key('encoder-chunk-option-1')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('encoder-chunk-option-1')));
      await tester.pump();
      expect(selectedChunk, 0);

      await tester.ensureVisible(
        find.byKey(const Key('encoder-chunk-option-3')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('encoder-chunk-option-3')));
      await tester.pump();
      expect(selectedChunk, 2);

      await tester.tap(
        find.byKey(const Key('encoder-chunk-multi-view-action')),
      );
      await tester.pump();
      expect(multiViewTapped, isTrue);

      await tester.ensureVisible(
        find.byKey(const Key('encoder-chunk-fullscreen-action')),
      );
      await tester.pump();
      await tester.tap(
        find.byKey(const Key('encoder-chunk-fullscreen-action')),
      );
      await tester.pump();
      expect(fullscreenTapped, isTrue);

      await tester.ensureVisible(
        find.byKey(const Key('encoder-chunk-play-toggle')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('encoder-chunk-play-toggle')));
      await tester.pump();
      expect(toggleTapped, isTrue);

      await tester.ensureVisible(
        find.byKey(const Key('encoder-chunk-download-action')),
      );
      await tester.pump();
      await tester.tap(find.byKey(const Key('encoder-chunk-download-action')));
      await tester.pump();
      expect(downloadTapped, isTrue);
      semantics.dispose();
    },
  );

  testWidgets('single chunk selector exposes one selected option', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      wrapApp(
        EncoderChunkResultCard(
          chunkGifs: <Uint8List>[Uint8List.fromList(validGifBytes)],
          chunkFrameCounts: const <int>[1],
          selectedChunkIndex: 0,
          totalChunks: 1,
          totalFrames: 1,
          currentChunkFrame: 1,
          minFrames: 1,
          resultSizeLabel: '3 B',
          durationLabel: '0.1s',
          isChunkPlaying: false,
          onDownload: () {},
          onFullscreen: () {},
          onChunkSelected: (_) {},
          onOpenMultiView: () {},
          onTogglePlayPause: () {},
        ),
      ),
    );

    expect(find.bySemanticsLabel('Chunk 1/1'), findsOneWidget);
    expect(find.byKey(const Key('encoder-chunk-option-1')), findsOneWidget);
    expect(find.byKey(const Key('encoder-chunk-option-2')), findsNothing);
    semantics.dispose();
  });

  testWidgets('chunk playback action disables and re-enables with motion', (
    tester,
  ) async {
    var toggleCount = 0;
    final gif = Uint8List.fromList(validGifBytes);
    Widget card({required bool canPlay}) => wrapApp(
      EncoderChunkResultCard(
        chunkGifs: <Uint8List>[gif],
        chunkFrameCounts: const <int>[1],
        selectedChunkIndex: 0,
        totalChunks: 1,
        totalFrames: 1,
        currentChunkFrame: 1,
        minFrames: 1,
        resultSizeLabel: '3 B',
        durationLabel: '0.1s',
        isChunkPlaying: false,
        canPlay: canPlay,
        onDownload: () {},
        onFullscreen: () {},
        onChunkSelected: (_) {},
        onOpenMultiView: () {},
        onTogglePlayPause: () => toggleCount++,
      ),
    );

    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(card(canPlay: false));
    expectAccessibleAction(
      tester,
      const Key('encoder-chunk-play-toggle'),
      'Start automatic playback',
      enabled: false,
    );
    await tester.tap(
      find.byKey(const Key('encoder-chunk-play-toggle')),
      warnIfMissed: false,
    );
    await tester.pump();
    expect(toggleCount, 0);

    await tester.pumpWidget(card(canPlay: true));
    expectAccessibleAction(
      tester,
      const Key('encoder-chunk-play-toggle'),
      'Start automatic playback',
    );
    await tester.ensureVisible(
      find.byKey(const Key('encoder-chunk-play-toggle')),
    );
    await tester.pump();
    await tester.tap(find.byKey(const Key('encoder-chunk-play-toggle')));
    await tester.pump();
    expect(toggleCount, 1);
    semantics.dispose();
  });

  testWidgets('reduced motion renders both inline preview cards statically', (
    tester,
  ) async {
    final gif = Uint8List.fromList(validGifBytes);
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: wrapApp(
          SingleChildScrollView(
            child: Column(
              children: [
                EncoderGifResultCard(
                  gifData: gif,
                  currentFrame: 1,
                  totalFrames: 1,
                  minFrames: 1,
                  sizeLabel: '3 B',
                  durationLabel: '0.1s',
                  onDownload: () {},
                  onFullscreen: () {},
                ),
                EncoderChunkResultCard(
                  chunkGifs: <Uint8List>[gif],
                  chunkFrameCounts: const <int>[1],
                  selectedChunkIndex: 0,
                  totalChunks: 1,
                  totalFrames: 1,
                  currentChunkFrame: 1,
                  minFrames: 1,
                  resultSizeLabel: '3 B',
                  durationLabel: '0.1s',
                  isChunkPlaying: true,
                  onDownload: () {},
                  onFullscreen: () {},
                  onChunkSelected: (_) {},
                  onOpenMultiView: () {},
                  onTogglePlayPause: () {},
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await pumpUntilInlineImage(
      tester,
      const Key('encoder-inline-static-image'),
    );

    expect(
      find.byKey(const Key('encoder-inline-static-image')),
      findsNWidgets(2),
    );
    expect(
      find.byKey(const Key('encoder-inline-animated-image')),
      findsNothing,
    );
  });

  testWidgets('EncoderModeToggle switches between file and note modes', (
    tester,
  ) async {
    var selectedMode = 'file';

    await tester.pumpWidget(
      wrapApp(
        EncoderModeToggle(
          noteMode: false,
          onSelectFileMode: () => selectedMode = 'file',
          onSelectNoteMode: () => selectedMode = 'note',
        ),
      ),
    );

    expect(find.text('File'), findsOneWidget);
    expect(find.text('Note'), findsOneWidget);

    await tester.tap(find.text('Note'));
    await tester.pump();

    expect(selectedMode, 'note');
  });

  testWidgets(
    'EncoderModeToggle uses the same sliding indicator model as web',
    (tester) async {
      await tester.pumpWidget(
        wrapApp(
          EncoderModeToggle(
            noteMode: true,
            onSelectFileMode: () {},
            onSelectNoteMode: () {},
          ),
        ),
      );

      final toggleRect = tester.getRect(
        find.byKey(const Key('encoder-mode-toggle')),
      );
      final indicator = tester.widget<AnimatedPositioned>(
        find.byKey(const Key('encoder-mode-toggle-active-indicator')),
      );

      expect(find.byType(AirQrSegmentedControl), findsOneWidget);
      expect(toggleRect.height, 56);
      expect(indicator.duration, const Duration(milliseconds: 300));
      expect(indicator.curve, const Cubic(0.2, 0.8, 0.2, 1));
      expect(indicator.height, 48);
      expect(indicator.width, closeTo((toggleRect.width - 8) / 2, 1));
      expect(indicator.left, closeTo((toggleRect.width - 8) / 2, 1));
      final indicatorDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.descendant(
                      of: find.byKey(
                        const Key('encoder-mode-toggle-active-indicator'),
                      ),
                      matching: find.byType(DecoratedBox),
                    ),
                  )
                  .decoration
              as BoxDecoration;
      expect(indicatorDecoration.boxShadow, isNull);
    },
  );

  testWidgets('Encoder mode and notice controls are 48dp and reduce motion', (
    tester,
  ) async {
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: wrapApp(
          Column(
            children: [
              EncoderModeToggle(
                noteMode: false,
                onSelectFileMode: () {},
                onSelectNoteMode: () {},
              ),
              EncoderNetworkAccessNotice(
                onOpenOfflineWebSettings: () {},
                onOpenGithubReleases: () {},
                onDismiss: () {},
              ),
              EncoderSettingsPanel(
                expanded: false,
                onToggleExpanded: () {},
                fps: 10,
                eccLevel: 'MEDIUM',
                packetSize: 800,
                targetQrSize: 177,
                scale: 4,
                raptorqOverhead: 1.2,
                compressionEnabled: true,
                forceChunkMode: false,
                chunkSizeMbText: '50',
                onFpsChanged: (_) {},
                onEccLevelChanged: (_) {},
                onPacketSizeChanged: (_) {},
                onTargetQrSizeChanged: (_) {},
                onScaleChanged: (_) {},
                onRaptorqOverheadChanged: (_) {},
                onCompressionChanged: (_) {},
                onForceChunkModeChanged: (_) {},
                onChunkSizeChanged: (_) {},
              ),
            ],
          ),
        ),
      ),
    );

    expect(
      tester
          .widget<AnimatedPositioned>(
            find.byKey(const Key('encoder-mode-toggle-active-indicator')),
          )
          .duration,
      Duration.zero,
    );
    for (final key in const [
      Key('encoder-mode-file-option'),
      Key('encoder-mode-note-option'),
      Key('encoder-network-notice-dismiss'),
    ]) {
      final size = tester.getSize(find.byKey(key));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
    }
    expect(
      tester.widget<AnimatedRotation>(find.byType(AnimatedRotation)).duration,
      Duration.zero,
    );
    expect(
      tester.widget<AnimatedCrossFade>(find.byType(AnimatedCrossFade)).duration,
      Duration.zero,
    );
  });

  testWidgets('Encoder mode labels tolerate large text', (tester) async {
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2)),
        child: wrapApp(
          EncoderModeToggle(
            noteMode: false,
            onSelectFileMode: () {},
            onSelectNoteMode: () {},
          ),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('EncoderNoteEditor aligns line numbers and renders real counts', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        EncoderNoteEditor(
          noteText: 'h',
          noteFormat: NoteFormat.plain,
          onNoteTextChanged: (_) {},
          onNoteFormatChanged: (_) {},
          onClear: () {},
        ),
      ),
    );

    expect(find.text('1 line'), findsOneWidget);
    expect(find.text('1 char'), findsOneWidget);
    expect(find.text('1 byte'), findsOneWidget);
    expect(find.textContaining('# line'), findsNothing);
    expect(find.textContaining('# chars'), findsNothing);
    expect(find.textContaining('# bytes'), findsNothing);

    final gutterRight = tester
        .getRect(find.byKey(const Key('encoder_note_line_gutter')))
        .right;
    final firstLineTextRight = tester.getRect(find.text('1').first).right;
    final editorRect = tester.getRect(
      find.byKey(const Key('encoder_note_line_gutter')),
    );

    expect(gutterRight - firstLineTextRight, closeTo(17, 0.5));
    expect(editorRect.height, 360);
    expect(
      tester
          .getRect(find.byKey(const Key('encoder_note_line_number_15')))
          .bottom,
      lessThanOrEqualTo(editorRect.bottom),
    );
  });

  testWidgets('EncoderNoteEditor renders note controls and emits changes', (
    tester,
  ) async {
    var changedText = '';
    NoteFormat? changedFormat;
    var cleared = false;

    await tester.pumpWidget(
      wrapApp(
        EncoderNoteEditor(
          noteText: '# hello\nworld',
          noteFormat: NoteFormat.markdown,
          onNoteTextChanged: (value) => changedText = value,
          onNoteFormatChanged: (value) => changedFormat = value,
          onClear: () => cleared = true,
        ),
      ),
    );

    expect(find.text('Quick Note'), findsNothing);
    expect(find.text('Markdown'), findsOneWidget);
    expect(find.text('Clear note'), findsOneWidget);
    expect(find.byKey(const Key('encoder_note_line_gutter')), findsOneWidget);
    expect(find.byKey(const Key('encoder_note_status_bar')), findsOneWidget);
    expect(
      find.byKey(const Key('encoder_note_format_dropdown')),
      findsOneWidget,
    );
    expect(find.text('1'), findsWidgets);
    expect(find.text('2'), findsWidgets);
    expect(find.text('2 lines'), findsOneWidget);
    expect(find.text('13 chars'), findsOneWidget);
    expect(find.text('13 bytes'), findsOneWidget);
    expect(find.text('|'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'updated note');
    await tester.pump();
    expect(changedText, 'updated note');

    await tester.tap(find.text('Markdown'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('JSON').last);
    await tester.pumpAndSettle();
    expect(changedFormat, NoteFormat.json);

    await tester.tap(find.text('Clear note'));
    await tester.pump();
    expect(cleared, isTrue);
  });
}
