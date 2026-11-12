import 'dart:ui' show FontFeature, Tristate;

import 'package:airqr_mobile/scanner_page_chrome.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/scanner_session_progress.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Widget wrapApp(
    Widget child, {
    Locale locale = const Locale('en'),
    MediaQueryData? mediaQueryData,
    ThemeData? theme,
  }) {
    return MaterialApp(
      locale: locale,
      theme: theme,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: MediaQuery(
        data: mediaQueryData ?? const MediaQueryData(),
        child: Scaffold(body: child),
      ),
    );
  }

  ScannerChromeOverlay buildOverlay({
    List<ScannerChunkProgressInfo> chunks = const [],
    int? missingPackets,
    int receivedPackets = 12,
    int expectedPackets = 30,
    int localChunkFramesScanned = 0,
    int? currentChunkNumber,
    int? currentChunkTotal,
    String status = 'Scanning...',
    String? syncSourceName = 'Nearby phone',
    VoidCallback? onCamera,
  }) {
    return ScannerChromeOverlay(
      fps: 24,
      syncSourceName: syncSourceName,
      showMobileCamera: true,
      showDesktopCamera: false,
      isTorchOn: false,
      currentChunkNumber: currentChunkNumber ?? (chunks.isEmpty ? null : 1),
      currentChunkTotal:
          currentChunkTotal ?? (chunks.isEmpty ? null : chunks.length),
      displayReceivedPackets: receivedPackets,
      displayExpectedPackets: expectedPackets,
      localChunkFramesScanned: localChunkFramesScanned,
      displayTotalPackets: 48,
      displayMissingPackets: missingPackets,
      displayChunks: chunks,
      displayProgress: 0.4,
      isComplete: false,
      status: status,
      primaryColor: const Color(0xFF3b82f6),
      successColor: const Color(0xFF22c55e),
      onToggleTorch: () {},
      onOpenMobileCameraSelector: onCamera ?? () {},
      onOpenDesktopCameraSelector: null,
      onOpenHelp: () {},
      onReset: () {},
    );
  }

  testWidgets('scanner actions keep 48dp targets with 40dp web surfaces', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(wrapApp(buildOverlay()));

    for (final key in const [
      Key('scanner_camera_button'),
      Key('scanner_torch_button'),
      Key('scanner_reset_button'),
      Key('scanner_help_button'),
    ]) {
      final size = tester.getSize(find.byKey(key));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
      final surface = find.descendant(
        of: find.byKey(key),
        matching: find.byType(DecoratedBox),
      );
      expect(tester.getSize(surface.first), const Size(40, 40));
    }
    expect(find.bySemanticsLabel('Camera'), findsOneWidget);
    final cameraSemantics = tester.getSemantics(
      find.bySemanticsLabel('Camera'),
    );
    expect(cameraSemantics.flagsCollection.isButton, isTrue);
    expect(
      cameraSemantics.getSemanticsData().hasAction(SemanticsAction.tap),
      isTrue,
    );
    ShapeDecoration surfaceDecoration(Key key) {
      final surface = tester.widget<DecoratedBox>(
        find
            .descendant(
              of: find.byKey(key),
              matching: find.byType(DecoratedBox),
            )
            .first,
      );
      return surface.decoration as ShapeDecoration;
    }

    expect(
      surfaceDecoration(const Key('scanner_reset_button')).color,
      surfaceDecoration(const Key('scanner_camera_button')).color,
    );
    final resetIcon = tester.widget<AirQrIcon>(
      find.descendant(
        of: find.byKey(const Key('scanner_reset_button')),
        matching: find.byType(AirQrIcon),
      ),
    );
    expect(
      resetIcon.color,
      AirQrTheme.dangerText(
        tester.element(find.byKey(const Key('scanner_reset_button'))),
      ),
    );
    semantics.dispose();
  });

  testWidgets('scanner stats stay just above the floating bottom nav', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      wrapApp(
        buildOverlay(),
        mediaQueryData: const MediaQueryData(size: Size(390, 844)),
      ),
    );

    final statsBottom = tester
        .getRect(find.byKey(const Key('scanner_stats_panel')))
        .bottom;
    expect(statsBottom, closeTo(844 - 122, 0.5));
  });

  testWidgets('mobile scanner keeps FPS fixed beside the top actions', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      wrapApp(
        buildOverlay(missingPackets: 1962),
        mediaQueryData: const MediaQueryData(size: Size(390, 844)),
      ),
    );

    final fps = tester.getRect(find.byKey(const Key('scanner_fps_chip')));
    final actions = tester.getRect(
      find.byKey(const Key('scanner_top_actions')),
    );
    final sync = tester.getRect(find.byKey(const Key('scanner_sync_chip')));

    expect(fps.center.dy, closeTo(actions.center.dy, 0.01));
    expect(sync.top, greaterThanOrEqualTo(actions.bottom + 4));
    expect(fps.left, 16);
  });

  testWidgets('mobile scanner telemetry pills hug their content', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      wrapApp(
        buildOverlay(missingPackets: 1962),
        mediaQueryData: const MediaQueryData(size: Size(390, 844)),
      ),
    );

    final sync = tester.getSize(find.byKey(const Key('scanner_sync_chip')));
    final session = tester.getSize(
      find.byKey(const Key('scanner_session_chip')),
    );
    final missing = tester.getSize(
      find.byKey(const Key('scanner_missing_chip')),
    );
    expect(sync.width, lessThan(260));
    expect(session.width, lessThan(210));
    expect(missing.width, lessThan(175));
    expect(sync.height, lessThanOrEqualTo(26));
    expect(session.height, lessThanOrEqualTo(26));
    expect(missing.height, lessThanOrEqualTo(30));
    final sessionRect = tester.getRect(
      find.byKey(const Key('scanner_session_chip')),
    );
    final missingRect = tester.getRect(
      find.byKey(const Key('scanner_missing_chip')),
    );
    expect(missingRect.top - sessionRect.bottom, closeTo(6, 0.01));
    expect(
      tester.getSize(find.byKey(const Key('scanner_session_missing'))).height,
      greaterThanOrEqualTo(48),
    );
    expect(find.byKey(const Key('scanner_filename_chip')), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('scanner shows local chunk progress above the progress bar', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        buildOverlay(
          receivedPackets: 540,
          expectedPackets: 20696,
          localChunkFramesScanned: 7,
          currentChunkNumber: 2,
          currentChunkTotal: 5,
          syncSourceName: 'Android phone',
        ),
      ),
    );

    final summary = find.byKey(const Key('scanner_local_chunk_summary'));
    final progress = find.byType(LinearProgressIndicator);
    expect(summary, findsOneWidget);
    expect(find.text('Android phone'), findsOneWidget);
    expect(find.text('7'), findsOneWidget);
    expect(find.text('Chunk'), findsOneWidget);
    expect(find.text('2/5'), findsOneWidget);
    final chunkLabel = find.byKey(const Key('scanner_local_chunk_label'));
    final chunkRatio = find.byKey(const Key('scanner_local_chunk_ratio'));
    final separator = find.byKey(const Key('scanner_local_chunk_separator'));
    final source = find.byKey(const Key('scanner_local_chunk_source'));
    final received = find.byKey(const Key('scanner_local_chunk_received'));
    expect(
      tester.getRect(source).left,
      lessThan(tester.getRect(received).left),
    );
    expect(
      tester.getRect(received).left,
      lessThan(tester.getRect(separator).left),
    );
    expect(
      tester.getRect(separator).left,
      lessThan(tester.getRect(chunkLabel).left),
    );
    expect(
      tester.getRect(chunkLabel).left,
      lessThan(tester.getRect(chunkRatio).left),
    );
    expect(
      tester.getRect(summary).bottom,
      lessThan(tester.getRect(progress).top),
    );
    final progressIndicator = tester.widget<LinearProgressIndicator>(progress);
    expect(
      progressIndicator.valueColor?.value,
      AirQrTheme.lightSwitchSelectedTrack,
    );
  });

  testWidgets('scanner uses white for the local device name in dark mode', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        buildOverlay(syncSourceName: 'Android phone'),
        theme: ThemeData(brightness: Brightness.dark),
      ),
    );

    final source = tester.widget<Text>(
      find.byKey(const Key('scanner_local_chunk_source')),
    );
    expect(source.style?.color, Colors.white);
  });

  testWidgets('local chunk summary preserves web order at 2.4x', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      wrapApp(
        buildOverlay(
          localChunkFramesScanned: 12345,
          currentChunkNumber: 28,
          currentChunkTotal: 999,
          syncSourceName: 'google sdk_gphone64_x86_64 with a long name',
        ),
        mediaQueryData: const MediaQueryData(
          size: Size(320, 844),
          textScaler: TextScaler.linear(2.4),
        ),
      ),
    );

    final chunk = find.byKey(const Key('scanner_local_chunk_label'));
    final chunkRatio = find.byKey(const Key('scanner_local_chunk_ratio'));
    final separator = find.byKey(const Key('scanner_local_chunk_separator'));
    final source = find.byKey(const Key('scanner_local_chunk_source'));
    final received = find.byKey(const Key('scanner_local_chunk_received'));
    expect(
      tester.getRect(source).left,
      lessThan(tester.getRect(received).left),
    );
    expect(tester.getRect(source).top, lessThan(tester.getRect(chunk).top));
    expect(
      tester.getRect(separator).left,
      lessThan(tester.getRect(chunk).left),
    );
    expect(
      tester.getRect(chunk).left,
      lessThan(tester.getRect(chunkRatio).left),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('mobile scanner measures FPS and actions at every text scale', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    for (final scale in <double>[1, 1.2, 1.5, 2, 2.4]) {
      await tester.pumpWidget(
        wrapApp(
          buildOverlay(missingPackets: 1962),
          mediaQueryData: MediaQueryData(
            size: const Size(320, 844),
            textScaler: TextScaler.linear(scale),
          ),
        ),
      );

      final fps = tester.getRect(find.byKey(const Key('scanner_fps_chip')));
      final actions = tester.getRect(
        find.byKey(const Key('scanner_top_actions')),
      );
      final sync = tester.getRect(find.byKey(const Key('scanner_sync_chip')));
      expect(actions.overlaps(fps), isFalse, reason: 'text scale $scale');
      expect(
        actions.bottom,
        lessThanOrEqualTo(sync.top),
        reason: 'text scale $scale',
      );
      expect(tester.takeException(), isNull, reason: 'text scale $scale');
    }
  });

  testWidgets('only discrete scanner status is a live semantic region', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(wrapApp(buildOverlay()));

    var status = tester.getSemantics(
      find.byKey(const Key('scanner_status_text')),
    );
    expect(status.flagsCollection.isLiveRegion, isTrue);
    expect(status.label, 'Scanning...');
    expect(status.value, isEmpty);

    await tester.pumpWidget(
      wrapApp(buildOverlay(receivedPackets: 13, expectedPackets: 30)),
    );
    status = tester.getSemantics(find.byKey(const Key('scanner_status_text')));
    expect(status.flagsCollection.isLiveRegion, isTrue);
    expect(status.label, 'Scanning...');
    expect(status.value, isEmpty);

    await tester.pumpWidget(
      wrapApp(buildOverlay(receivedPackets: 0, expectedPackets: 0)),
    );
    status = tester.getSemantics(find.byKey(const Key('scanner_status_text')));
    expect(find.byKey(const Key('scanner_session_progress')), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    expect(status.label, isNot(contains('0/0')));
    expect(status.value, isEmpty);
    semantics.dispose();
  });

  test('scanner live-status classifier excludes high-frequency progress', () {
    expect(scannerStatusUsesLiveRegion('Progress: 40% (12/30)'), isFalse);
    expect(
      scannerStatusUsesLiveRegion('Session progress: 43.2% (13/30)'),
      isFalse,
    );
    expect(scannerStatusUsesLiveRegion('Progression : 43 % (13/30)'), isFalse);
    expect(scannerStatusUsesLiveRegion('Receiving: 43%'), isFalse);
    expect(scannerStatusUsesLiveRegion('Scanning...'), isTrue);
    expect(scannerStatusUsesLiveRegion('Completed! demo.bin'), isTrue);
    expect(scannerStatusUsesLiveRegion('Error: packet 13/30 failed'), isTrue);
  });

  testWidgets('changing raw progress status remains readable but not live', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      wrapApp(buildOverlay(status: 'Progress: 40% (12/30)')),
    );

    var status = tester.getSemantics(
      find.byKey(const Key('scanner_status_text')),
    );
    expect(status.flagsCollection.isLiveRegion, isFalse);
    expect(status.label, 'Progress: 40% (12/30)');

    await tester.pumpWidget(
      wrapApp(
        buildOverlay(receivedPackets: 13, status: 'Progress: 43% (13/30)'),
      ),
    );
    status = tester.getSemantics(find.byKey(const Key('scanner_status_text')));
    expect(status.flagsCollection.isLiveRegion, isFalse);
    expect(status.label, 'Progress: 43% (13/30)');
    semantics.dispose();
  });

  testWidgets('chunk choices expose button and selected semantics', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    const chunks = <ScannerChunkProgressInfo>[
      ScannerChunkProgressInfo(
        chunkId: 0,
        state: ScannerChunkProgressState.scanning,
        receivedUnique: 12,
        decodeThreshold: 30,
        missingCount: 18,
      ),
      ScannerChunkProgressInfo(
        chunkId: 1,
        state: ScannerChunkProgressState.complete,
        receivedUnique: 30,
        decodeThreshold: 30,
        missingCount: 0,
      ),
    ];
    await tester.pumpWidget(
      wrapApp(buildOverlay(chunks: chunks, missingPackets: 18)),
    );
    await tester.tap(find.byKey(const Key('scanner_session_missing')));
    await tester.pumpAndSettle();

    final first = tester.getSemantics(
      find.byKey(const Key('scanner_chunk_option_0')),
    );
    expect(first.flagsCollection.isButton, isTrue);
    expect(first.flagsCollection.isSelected, Tristate.isTrue);
    expect(first.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
    expect(
      tester.getSize(find.byKey(const Key('scanner_chunk_option_0'))).height,
      greaterThanOrEqualTo(48),
    );
    final firstScope = find.byKey(const Key('scanner_chunk_option_0'));
    final firstMaterial = tester.widget<Material>(
      find.descendant(of: firstScope, matching: find.byType(Material)).first,
    );
    final firstInkWell = tester.widget<InkWell>(
      find.descendant(of: firstScope, matching: find.byType(InkWell)).first,
    );
    expect(firstMaterial.color, isNot(Colors.transparent));
    expect(
      firstInkWell.overlayColor?.resolve(<WidgetState>{WidgetState.focused})?.a,
      greaterThan(0),
    );

    await tester.tap(find.byKey(const Key('scanner_chunk_option_1')));
    await tester.pumpAndSettle();
    final second = tester.getSemantics(
      find.byKey(const Key('scanner_chunk_option_1')),
    );
    expect(second.flagsCollection.isSelected, Tristate.isTrue);
    semantics.dispose();
  });

  testWidgets('single missing chunk uses the compact web card structure', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const chunks = <ScannerChunkProgressInfo>[
      ScannerChunkProgressInfo(
        chunkId: 0,
        state: ScannerChunkProgressState.missing,
        receivedUnique: 0,
        decodeThreshold: 97,
        missingCount: 97,
        targetFrameCount: 0,
        unseenFrameCount: 0,
      ),
    ];
    await tester.pumpWidget(
      wrapApp(
        buildOverlay(chunks: chunks, missingPackets: 97),
        mediaQueryData: const MediaQueryData(size: Size(360, 800)),
      ),
    );

    await tester.tap(find.byKey(const Key('scanner_session_missing')));
    await tester.pumpAndSettle();

    expect(
      find.byKey(const Key('scanner_chunk_details_panel')),
      findsOneWidget,
    );
    expect(find.byKey(const Key('scanner_chunk_summary_card')), findsOneWidget);
    expect(find.text('Select chunk'), findsNothing);
    expect(find.byKey(const Key('scanner_chunk_option_0')), findsNothing);
    expect(find.byKey(const Key('scanner_chunk_scroll_track')), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(const Key('scanner_chunk_details_panel')),
        matching: find.text('1/1'),
      ),
      findsNothing,
    );
    expect(find.text('Chunk 1'), findsOneWidget);
    expect(find.text('Missing'), findsOneWidget);
    expect(find.text('0/97 to threshold'), findsOneWidget);
    expect(find.text('97 more unique QR'), findsOneWidget);
    expect(find.text('Candidates'), findsOneWidget);
    expect(find.text('Unseen'), findsOneWidget);
    expect(
      tester
          .getSize(find.byKey(const Key('scanner_chunk_details_panel')))
          .height,
      lessThan(145),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('chunk scrubber is accessible and moves the chunk list', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final chunks = List<ScannerChunkProgressInfo>.generate(
      8,
      (index) => ScannerChunkProgressInfo(
        chunkId: index,
        state: ScannerChunkProgressState.missing,
        receivedUnique: 0,
        decodeThreshold: 30,
        missingCount: 30,
      ),
    );
    await tester.pumpWidget(
      wrapApp(buildOverlay(chunks: chunks, missingPackets: 240)),
    );
    await tester.tap(find.byKey(const Key('scanner_session_missing')));
    await tester.pumpAndSettle();

    final track = find.byKey(const Key('scanner_chunk_scroll_track'));
    expect(tester.getSize(track).height, greaterThanOrEqualTo(48));
    expect(find.bySemanticsLabel('Scroll through chunks'), findsOneWidget);
    final trackSemantics = tester.getSemantics(
      find.bySemanticsLabel('Scroll through chunks'),
    );
    expect(trackSemantics.flagsCollection.isSlider, isTrue);
    expect(trackSemantics.value, isNotEmpty);
    expect(
      trackSemantics.getSemanticsData().hasAction(SemanticsAction.increase),
      isTrue,
    );
    expect(
      trackSemantics.getSemanticsData().hasAction(SemanticsAction.decrease),
      isTrue,
    );
    final initialValue = trackSemantics.value;

    final scrollable = tester.state<ScrollableState>(
      find.descendant(
        of: find.byKey(const Key('scanner_chunk_scroll_view')),
        matching: find.byType(Scrollable),
      ),
    );
    expect(scrollable.position.pixels, 0);
    trackSemantics.owner!.performAction(
      trackSemantics.id,
      SemanticsAction.increase,
    );
    await tester.pump();
    expect(scrollable.position.pixels, greaterThan(0));
    final increasedOffset = scrollable.position.pixels;
    final increasedValue = tester
        .getSemantics(find.bySemanticsLabel('Scroll through chunks'))
        .value;
    expect(increasedValue, isNot(initialValue));

    final updatedSemantics = tester.getSemantics(
      find.bySemanticsLabel('Scroll through chunks'),
    );
    updatedSemantics.owner!.performAction(
      updatedSemantics.id,
      SemanticsAction.decrease,
    );
    await tester.pump();
    expect(scrollable.position.pixels, lessThan(increasedOffset));
    expect(scrollable.position.pixels, greaterThanOrEqualTo(0));
    semantics.dispose();
  });

  testWidgets('scanner chrome fits at 320dp with 2x text scaling', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    const chunks = <ScannerChunkProgressInfo>[
      ScannerChunkProgressInfo(
        chunkId: 0,
        state: ScannerChunkProgressState.scanning,
        receivedUnique: 12,
        decodeThreshold: 30,
        missingCount: 18,
        targetFrameCount: 18,
        unseenFrameCount: 24,
      ),
    ];
    var cameraTapped = false;
    await tester.pumpWidget(
      wrapApp(
        buildOverlay(
          chunks: chunks,
          missingPackets: 18,
          onCamera: () => cameraTapped = true,
        ),
        mediaQueryData: const MediaQueryData(
          size: Size(320, 800),
          textScaler: TextScaler.linear(2),
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('scanner_session_missing')));
    await tester.pump();

    expect(
      find.byKey(const Key('scanner_chunk_details_panel')),
      findsOneWidget,
    );
    final actions = tester.getRect(
      find.byKey(const Key('scanner_top_actions')),
    );
    final fps = tester.getRect(find.byKey(const Key('scanner_fps_chip')));
    final details = tester.getRect(
      find.byKey(const Key('scanner_chunk_details_panel')),
    );
    final syncChip = tester.getRect(
      find.byKey(const Key('scanner_sync_source')),
    );
    final bottom = tester.getRect(
      find.byKey(const Key('scanner_bottom_chrome')),
    );
    expect(actions.top, greaterThanOrEqualTo(0));
    expect(actions.right, lessThanOrEqualTo(320));
    expect(actions.overlaps(fps), isFalse, reason: 'actions=$actions fps=$fps');
    expect(
      actions.overlaps(syncChip),
      isFalse,
      reason: 'actions=$actions sync=$syncChip',
    );
    expect(actions.bottom, lessThanOrEqualTo(details.top));
    expect(actions.bottom, lessThan(bottom.top));
    expect(
      find.byKey(const Key('scanner_camera_button')).hitTestable(),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const Key('scanner_camera_button')).hitTestable(),
    );
    expect(cameraTapped, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('scanner actions stay separate at 412dp with 2x text scaling', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(412, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var cameraTapped = false;
    final chunks = List<ScannerChunkProgressInfo>.generate(
      3,
      (index) => ScannerChunkProgressInfo(
        chunkId: index,
        state: ScannerChunkProgressState.scanning,
        receivedUnique: 12,
        decodeThreshold: 30,
        missingCount: 18,
      ),
    );

    await tester.pumpWidget(
      wrapApp(
        buildOverlay(
          chunks: chunks,
          missingPackets: 54,
          syncSourceName:
              'A nearby device with a deliberately long display name',
          onCamera: () => cameraTapped = true,
        ),
        mediaQueryData: const MediaQueryData(
          size: Size(412, 800),
          textScaler: TextScaler.linear(2),
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('scanner_session_missing')));
    await tester.pump();

    final actions = tester.getRect(
      find.byKey(const Key('scanner_top_actions')),
    );
    final fps = tester.getRect(find.byKey(const Key('scanner_fps_chip')));
    final details = tester.getRect(
      find.byKey(const Key('scanner_chunk_details_panel')),
    );
    final syncChip = tester.getRect(
      find.byKey(const Key('scanner_sync_source')),
    );
    final bottom = tester.getRect(
      find.byKey(const Key('scanner_bottom_chrome')),
    );
    expect(actions.right, lessThanOrEqualTo(412));
    expect(actions.overlaps(fps), isFalse, reason: 'actions=$actions fps=$fps');
    expect(actions.overlaps(syncChip), isFalse);
    expect(actions.bottom, lessThanOrEqualTo(details.top));
    expect(actions.bottom, lessThan(bottom.top));
    expect(
      find.byKey(const Key('scanner_camera_button')).hitTestable(),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(const Key('scanner_camera_button')).hitTestable(),
    );
    expect(cameraTapped, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('scanner help scrolls on a short large-text viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      wrapApp(
        Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => showScannerHelpDialog(context),
            child: const Text('Open help'),
          ),
        ),
        mediaQueryData: const MediaQueryData(
          size: Size(320, 480),
          textScaler: TextScaler.linear(2),
        ),
      ),
    );
    await tester.tap(find.text('Open help'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('scanner_help_scroll')), findsOneWidget);
    expect(find.text('Got it').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('scanner count messages use singular and plural forms', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        Builder(
          builder: (context) {
            final l10n = AppLocalizations.of(context)!;
            return Column(
              children: [
                Text(l10n.scanner_missingPackets(1)),
                Text(l10n.scanner_missingPackets(2)),
                Text(l10n.scanner_receivedCount(1)),
                Text(l10n.scanner_receivedCount(2)),
                Text(l10n.scanner_moreUniqueQr(1)),
                Text(l10n.scanner_moreUniqueQr(2)),
              ],
            );
          },
        ),
        locale: const Locale('fr'),
      ),
    );

    expect(find.text('1 manquant'), findsOneWidget);
    expect(find.text('2 manquants'), findsOneWidget);
    expect(find.text('1 reçu'), findsOneWidget);
    expect(find.text('2 reçus'), findsOneWidget);
    expect(find.text('Encore 1 QR unique'), findsOneWidget);
    expect(find.text('Encore 2 QR uniques'), findsOneWidget);
  });

  testWidgets('scanner telemetry uses accessible text color roles', (
    tester,
  ) async {
    await tester.pumpWidget(wrapApp(buildOverlay()));

    final scanned = tester.widget<Text>(find.text('Scanned'));
    final scannedContext = tester.element(find.text('Scanned'));
    expect(scanned.style?.color, AirQrTheme.textSecondary(scannedContext));
    expect(scanned.style?.fontFamily, 'Manrope');

    final scannedValue = tester.widget<Text>(
      find.byKey(const Key('scanner_stat_scanned_value')),
    );
    expect(scannedValue.style?.fontFamily, 'monospace');
    expect(
      scannedValue.style?.fontFeatures,
      contains(const FontFeature.tabularFigures()),
    );

    expect(find.text('demo.bin'), findsNothing);
  });

  testWidgets('scanner FPS splits technical value from Manrope label', (
    tester,
  ) async {
    await tester.pumpWidget(wrapApp(buildOverlay()));

    final fpsText = tester.widget<RichText>(
      find.byKey(const Key('scanner_fps_text')),
    );
    final root = fpsText.text as TextSpan;
    final spans = root.children!.cast<TextSpan>();
    expect(spans, hasLength(2));
    expect(spans[0].text, '24');
    expect(spans[0].style?.fontFamily, 'monospace');
    expect(
      spans[0].style?.fontFeatures,
      contains(const FontFeature.tabularFigures()),
    );
    expect(spans[1].text, ' FPS');
    expect(spans[1].style?.fontFamily, 'Manrope');
    expect(spans[1].style?.fontFeatures, isNull);
  });

  testWidgets('scanner FPS honors text scaling with one semantic label', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      wrapApp(
        buildOverlay(),
        mediaQueryData: const MediaQueryData(textScaler: TextScaler.linear(2)),
      ),
    );

    final finder = find.byKey(const Key('scanner_fps_text'));
    final paragraph = tester.renderObject<RenderParagraph>(finder);
    expect(paragraph.textScaler.scale(10), 20);
    expect(tester.getSemantics(finder).label, '24 FPS');
    semantics.dispose();
  });

  testWidgets('scanner telemetry is localized in French', (tester) async {
    const chunks = <ScannerChunkProgressInfo>[
      ScannerChunkProgressInfo(
        chunkId: 0,
        state: ScannerChunkProgressState.scanning,
        receivedUnique: 12,
        decodeThreshold: 30,
        missingCount: 18,
      ),
      ScannerChunkProgressInfo(
        chunkId: 1,
        state: ScannerChunkProgressState.missing,
        receivedUnique: 0,
        decodeThreshold: 30,
        missingCount: 30,
      ),
    ];
    await tester.pumpWidget(
      wrapApp(
        buildOverlay(chunks: chunks, missingPackets: 18),
        locale: const Locale('fr'),
      ),
    );
    await tester.tap(find.byKey(const Key('scanner_session_missing')));
    await tester.pumpAndSettle();

    expect(find.textContaining('Sync :'), findsOneWidget);
    expect(find.textContaining('Session :'), findsOneWidget);
    expect(find.textContaining('manquants'), findsWidgets);
    expect(find.text('Sélectionner un chunk'), findsOneWidget);
    expect(find.textContaining('jusqu’au seuil'), findsOneWidget);
    expect(find.bySemanticsLabel('Parcourir les chunks'), findsOneWidget);
  });

  testWidgets(
    'ScannerChromeOverlay renders stats badges and forwards actions',
    (tester) async {
      var cameraTapped = false;
      var torchTapped = false;
      var helpTapped = false;
      var resetTapped = false;

      await tester.pumpWidget(
        wrapApp(
          ScannerChromeOverlay(
            fps: 24,
            syncSourceName: 'iPhone',
            showMobileCamera: true,
            showDesktopCamera: false,
            isTorchOn: true,
            currentChunkNumber: 3,
            currentChunkTotal: 5,
            displayReceivedPackets: 12,
            displayExpectedPackets: 30,
            displayTotalPackets: 48,
            displayMissingPackets: 6,
            displayProgress: 0.4,
            isComplete: false,
            status: 'Scanning...',
            primaryColor: const Color(0xFF3b82f6),
            successColor: const Color(0xFF22c55e),
            onToggleTorch: () => torchTapped = true,
            onOpenMobileCameraSelector: () => cameraTapped = true,
            onOpenDesktopCameraSelector: null,
            onOpenHelp: () => helpTapped = true,
            onReset: () => resetTapped = true,
          ),
        ),
      );

      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is RichText &&
              widget.text.toPlainText().contains('24 FPS'),
        ),
        findsOneWidget,
      );
      expect(find.text('Scanned'), findsOneWidget);
      expect(find.text('Min'), findsOneWidget);
      expect(find.text('Max'), findsOneWidget);
      expect(find.byKey(const Key('scanner_current_chunk')), findsNothing);
      expect(
        find.byKey(const Key('scanner_local_chunk_ratio')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('scanner_sync_source')), findsOneWidget);
      expect(find.byKey(const Key('scanner_session_progress')), findsOneWidget);
      expect(find.text('Session: 12/30'), findsOneWidget);
      expect(find.byKey(const Key('scanner_session_missing')), findsOneWidget);
      expect(find.text('6 missing'), findsOneWidget);
      expect(find.text('demo.bin'), findsNothing);
      expect(
        find.byKey(const Key('scanner_stat_scanned_value')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('scanner_stat_min_value')), findsOneWidget);
      expect(find.byKey(const Key('scanner_stat_max_value')), findsOneWidget);
      expect(find.byKey(const Key('scanner_status_text')), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      final viewportHeight = tester.getSize(find.byType(Scaffold)).height;
      final statsPanelBottom = tester
          .getRect(find.byKey(const Key('scanner_stats_panel')))
          .bottom;
      expect(statsPanelBottom, lessThanOrEqualTo(viewportHeight - 114));
      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'videocam',
        ),
        findsOneWidget,
      );
      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'flashlight_on',
        ),
        findsOneWidget,
      );
      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'restart_alt',
        ),
        findsOneWidget,
      );
      final cameraButtonSurface = tester.widget<DecoratedBox>(
        find
            .descendant(
              of: find.byKey(const Key('scanner_camera_button')),
              matching: find.byType(DecoratedBox),
            )
            .first,
      );
      final resetButtonSurface = tester.widget<DecoratedBox>(
        find
            .descendant(
              of: find.byKey(const Key('scanner_reset_button')),
              matching: find.byType(DecoratedBox),
            )
            .first,
      );
      expect(resetButtonSurface.decoration, cameraButtonSurface.decoration);
      final resetIcon = tester.widget<AirQrIcon>(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'restart_alt',
        ),
      );
      expect(
        resetIcon.color,
        AirQrTheme.dangerText(
          tester.element(find.byKey(const Key('scanner_reset_button'))),
        ),
      );
      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'help',
        ),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const Key('scanner_camera_button')));
      await tester.pump();
      expect(cameraTapped, isTrue);

      await tester.tap(find.byKey(const Key('scanner_torch_button')));
      await tester.pump();
      expect(torchTapped, isTrue);

      await tester.tap(find.byKey(const Key('scanner_help_button')));
      await tester.pump();
      expect(helpTapped, isTrue);

      await tester.tap(find.byKey(const Key('scanner_reset_button')));
      await tester.pump();
      expect(resetTapped, isTrue);
    },
  );

  testWidgets(
    'ScannerChromeOverlay renders zero missing as complete when chunks are complete',
    (tester) async {
      await tester.pumpWidget(
        wrapApp(
          ScannerChromeOverlay(
            fps: 0,
            syncSourceName: 'Windows Browser',
            showMobileCamera: true,
            showDesktopCamera: false,
            isTorchOn: false,
            displayReceivedPackets: 100,
            displayExpectedPackets: 100,
            displayTotalPackets: 100,
            displayMissingPackets: 0,
            displayChunks: const <ScannerChunkProgressInfo>[
              ScannerChunkProgressInfo(
                chunkId: 0,
                state: ScannerChunkProgressState.complete,
                receivedUnique: 100,
                decodeThreshold: 100,
                missingCount: 0,
              ),
            ],
            displayProgress: 1,
            isComplete: false,
            status: 'Session progress: 100% (100/100)',
            primaryColor: const Color(0xFF3b82f6),
            successColor: const Color(0xFF22c55e),
            onToggleTorch: () {},
            onOpenMobileCameraSelector: () {},
            onOpenDesktopCameraSelector: null,
            onOpenHelp: () {},
            onReset: () {},
          ),
          mediaQueryData: const MediaQueryData(size: Size(360, 800)),
        ),
      );

      expect(find.byKey(const Key('scanner_session_missing')), findsOneWidget);
      expect(find.text('0 missing'), findsOneWidget);

      final text = tester.widget<Text>(find.text('0 missing'));
      final context = tester.element(find.text('0 missing'));
      expect(text.style?.color, AirQrTheme.successText(context));

      await tester.tap(find.byKey(const Key('scanner_session_missing')));
      await tester.pumpAndSettle();
      final candidates = tester.widget<Container>(
        find
            .descendant(
              of: find.byKey(const Key('scanner_chunk_candidates_metric')),
              matching: find.byType(Container),
            )
            .first,
      );
      final candidatesDecoration = candidates.decoration! as BoxDecoration;
      expect(candidatesDecoration.color, AirQrTheme.successSurface(context));
    },
  );

  testWidgets('ScannerChromeOverlay opens chunk details from missing badge', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        ScannerChromeOverlay(
          fps: 0,
          syncSourceName: 'Windows Browser',
          showMobileCamera: true,
          showDesktopCamera: false,
          isTorchOn: false,
          displayReceivedPackets: 6088,
          displayExpectedPackets: 20696,
          displayTotalPackets: 20696,
          displayMissingPackets: 3364,
          displayChunks: const <ScannerChunkProgressInfo>[
            ScannerChunkProgressInfo(
              chunkId: 0,
              state: ScannerChunkProgressState.scanning,
              receivedUnique: 1180,
              decodeThreshold: 1465,
              missingCount: 285,
              targetFrameCount: 285,
              unseenFrameCount: 871,
            ),
            ScannerChunkProgressInfo(
              chunkId: 1,
              state: ScannerChunkProgressState.missing,
              receivedUnique: 0,
              decodeThreshold: 1167,
              missingCount: 0,
            ),
          ],
          displayProgress: 6088 / 20696,
          isComplete: false,
          status: 'Session progress: 29.4% (6088/20696)',
          primaryColor: const Color(0xFF3b82f6),
          successColor: const Color(0xFF22c55e),
          onToggleTorch: () {},
          onOpenMobileCameraSelector: () {},
          onOpenDesktopCameraSelector: null,
          onOpenHelp: () {},
          onReset: () {},
        ),
      ),
    );

    expect(find.byKey(const Key('scanner_chunk_details_panel')), findsNothing);
    final actionsTopBefore = tester
        .getTopLeft(find.byKey(const Key('scanner_top_actions')))
        .dy;

    await tester.tap(find.byKey(const Key('scanner_session_missing')));
    await tester.pumpAndSettle();

    final actionsTopAfter = tester
        .getTopLeft(find.byKey(const Key('scanner_top_actions')))
        .dy;
    expect(actionsTopAfter, actionsTopBefore);
    expect(
      find.byKey(const Key('scanner_chunk_details_panel')),
      findsOneWidget,
    );
    final missingChip = tester.getRect(
      find.byKey(const Key('scanner_missing_chip')),
    );
    final detailsPanel = tester.getRect(
      find.byKey(const Key('scanner_chunk_details_panel')),
    );
    expect(detailsPanel.top - missingChip.bottom, inInclusiveRange(0, 16));
    final candidates = tester.widget<Container>(
      find
          .descendant(
            of: find.byKey(const Key('scanner_chunk_candidates_metric')),
            matching: find.byType(Container),
          )
          .first,
    );
    final candidatesDecoration = candidates.decoration! as BoxDecoration;
    final candidatesContext = tester.element(
      find.byKey(const Key('scanner_chunk_candidates_metric')),
    );
    expect(
      candidatesDecoration.color,
      AirQrTheme.warningSurface(candidatesContext),
    );
    expect(
      find.byKey(const Key('scanner_chunk_scroll_previous')),
      findsNothing,
    );
    expect(find.byKey(const Key('scanner_chunk_scroll_view')), findsOneWidget);
    expect(find.byKey(const Key('scanner_chunk_scroll_track')), findsOneWidget);
    expect(find.byKey(const Key('scanner_chunk_scroll_next')), findsNothing);
    expect(find.text('Select chunk'), findsOneWidget);
    expect(find.text('Chunk 1'), findsNWidgets(2));
    expect(find.text('Chunk 2'), findsOneWidget);
    expect(find.text('1180/1465 to threshold'), findsOneWidget);
    expect(find.text('285 more unique QR'), findsOneWidget);
    expect(find.text('Candidates'), findsOneWidget);
    expect(find.text('285'), findsOneWidget);
    expect(find.text('Unseen'), findsOneWidget);
    expect(find.text('871'), findsOneWidget);

    final chunkTwoOption = find.byKey(const Key('scanner_chunk_option_1'));
    final chunkTwoMaterial = tester.widget<Material>(
      find
          .descendant(of: chunkTwoOption, matching: find.byType(Material))
          .first,
    );
    final chunkTwoContext = tester.element(chunkTwoOption);
    expect(chunkTwoMaterial.color, AirQrTheme.successSurface(chunkTwoContext));

    await tester.tap(find.byKey(const Key('scanner_chunk_option_1')));
    await tester.pumpAndSettle();

    expect(find.text('0/1167 to threshold'), findsOneWidget);
    expect(find.text('Complete'), findsOneWidget);
  });

  testWidgets(
    'ScannerChromeOverlay colors chunks from displayed missing count only',
    (tester) async {
      await tester.pumpWidget(
        wrapApp(
          ScannerChromeOverlay(
            fps: 0,
            syncSourceName: 'Windows Browser',
            showMobileCamera: true,
            showDesktopCamera: false,
            isTorchOn: false,
            displayReceivedPackets: 6088,
            displayExpectedPackets: 20696,
            displayTotalPackets: 20696,
            displayMissingPackets: 278,
            displayChunks: const <ScannerChunkProgressInfo>[
              ScannerChunkProgressInfo(
                chunkId: 0,
                state: ScannerChunkProgressState.complete,
                receivedUnique: 394,
                decodeThreshold: 394,
                missingCount: 278,
              ),
              ScannerChunkProgressInfo(
                chunkId: 1,
                state: ScannerChunkProgressState.missing,
                receivedUnique: 394,
                decodeThreshold: 394,
                missingCount: 0,
              ),
            ],
            displayProgress: 6088 / 20696,
            isComplete: false,
            status: 'Session progress: 29.4% (6088/20696)',
            primaryColor: const Color(0xFF3b82f6),
            successColor: const Color(0xFF22c55e),
            onToggleTorch: () {},
            onOpenMobileCameraSelector: () {},
            onOpenDesktopCameraSelector: null,
            onOpenHelp: () {},
            onReset: () {},
          ),
        ),
      );

      await tester.tap(find.byKey(const Key('scanner_session_missing')));
      await tester.pumpAndSettle();

      final chunkOneOption = find.byKey(const Key('scanner_chunk_option_0'));
      final chunkOneMaterial = tester.widget<Material>(
        find
            .descendant(of: chunkOneOption, matching: find.byType(Material))
            .first,
      );
      final chunkOneContext = tester.element(chunkOneOption);
      expect(
        chunkOneMaterial.color,
        isNot(AirQrTheme.successSurface(chunkOneContext)),
      );
      expect(find.text('278 missing'), findsWidgets);

      await tester.tap(find.byKey(const Key('scanner_chunk_option_1')));
      await tester.pumpAndSettle();

      final chunkTwoOption = find.byKey(const Key('scanner_chunk_option_1'));
      final chunkTwoMaterial = tester.widget<Material>(
        find
            .descendant(of: chunkTwoOption, matching: find.byType(Material))
            .first,
      );
      final chunkTwoContext = tester.element(chunkTwoOption);
      expect(
        chunkTwoMaterial.color,
        AirQrTheme.successSurface(chunkTwoContext),
      );
      expect(find.text('0 missing'), findsWidgets);
      expect(find.text('Complete'), findsOneWidget);
    },
  );

  testWidgets('ScannerChromeOverlay keeps desktop scanner actions pinned', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        ScannerChromeOverlay(
          fps: 0,
          syncSourceName: 'Mobile Device',
          showMobileCamera: false,
          showDesktopCamera: true,
          isTorchOn: false,
          displayReceivedPackets: 6088,
          displayExpectedPackets: 20839,
          displayTotalPackets: 20839,
          displayMissingPackets: 4602,
          displayChunks: const <ScannerChunkProgressInfo>[
            ScannerChunkProgressInfo(
              chunkId: 0,
              state: ScannerChunkProgressState.scanning,
              receivedUnique: 1180,
              decodeThreshold: 1465,
              missingCount: 871,
            ),
            ScannerChunkProgressInfo(
              chunkId: 1,
              state: ScannerChunkProgressState.missing,
              receivedUnique: 0,
              missingCount: 278,
            ),
            ScannerChunkProgressInfo(
              chunkId: 2,
              state: ScannerChunkProgressState.missing,
              receivedUnique: 0,
              missingCount: 724,
            ),
            ScannerChunkProgressInfo(
              chunkId: 3,
              state: ScannerChunkProgressState.missing,
              receivedUnique: 0,
              missingCount: 898,
            ),
            ScannerChunkProgressInfo(
              chunkId: 4,
              state: ScannerChunkProgressState.missing,
              receivedUnique: 0,
              missingCount: 1802,
            ),
            ScannerChunkProgressInfo(
              chunkId: 5,
              state: ScannerChunkProgressState.missing,
              receivedUnique: 0,
              missingCount: 29,
            ),
          ],
          displayProgress: 6088 / 20839,
          isComplete: false,
          status: 'Session progress: 29.2% (6088/20839)',
          primaryColor: const Color(0xFF3b82f6),
          successColor: const Color(0xFF22c55e),
          onToggleTorch: null,
          onOpenMobileCameraSelector: null,
          onOpenDesktopCameraSelector: () {},
          onOpenHelp: () {},
          onReset: () {},
        ),
      ),
    );

    expect(find.byKey(const Key('scanner_camera_button')), findsOneWidget);
    expect(find.byKey(const Key('scanner_torch_button')), findsOneWidget);
    expect(find.byTooltip('Turn on flashlight'), findsOneWidget);

    final actionsTopBefore = tester
        .getTopLeft(find.byKey(const Key('scanner_top_actions')))
        .dy;

    await tester.tap(find.byKey(const Key('scanner_session_missing')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('scanner_chunk_scroll_next')), findsNothing);
    expect(find.byKey(const Key('scanner_chunk_scroll_track')), findsOneWidget);
    await tester.drag(
      find.byKey(const Key('scanner_chunk_scroll_view')),
      const Offset(-120, 0),
    );
    await tester.pumpAndSettle();
    await tester.drag(
      find.byKey(const Key('scanner_chunk_scroll_track')),
      const Offset(90, 0),
    );
    await tester.pumpAndSettle();

    final actionsTopAfter = tester
        .getTopLeft(find.byKey(const Key('scanner_top_actions')))
        .dy;
    expect(actionsTopAfter, actionsTopBefore);
  });

  testWidgets('ScannerChromeOverlay keeps the torch action visible when off', (
    tester,
  ) async {
    var torchTapped = false;

    await tester.pumpWidget(
      wrapApp(
        ScannerChromeOverlay(
          fps: 0,
          syncSourceName: null,
          showMobileCamera: true,
          showDesktopCamera: false,
          isTorchOn: false,
          displayReceivedPackets: 0,
          displayExpectedPackets: 0,
          displayProgress: 0,
          isComplete: false,
          status: 'Scanning...',
          primaryColor: const Color(0xFF3b82f6),
          successColor: const Color(0xFF22c55e),
          onToggleTorch: () => torchTapped = true,
          onOpenMobileCameraSelector: () {},
          onOpenDesktopCameraSelector: null,
          onOpenHelp: () {},
          onReset: () {},
        ),
      ),
    );

    expect(find.byTooltip('Turn on flashlight'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'flashlight_off',
      ),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('scanner_torch_button')));
    await tester.pump();
    expect(torchTapped, isTrue);
  });

  testWidgets(
    'ScannerChromeOverlay keeps web-like top action row without mobile overflow',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        wrapApp(
          ScannerChromeOverlay(
            fps: 0,
            syncSourceName: 'google sdk_gphone64_x86_64',
            showMobileCamera: true,
            showDesktopCamera: false,
            isTorchOn: false,
            displayReceivedPackets: 0,
            displayExpectedPackets: 0,
            displayProgress: 0,
            isComplete: false,
            status: 'Scanning...',
            primaryColor: const Color(0xFF3b82f6),
            successColor: const Color(0xFF22c55e),
            onToggleTorch: () {},
            onOpenMobileCameraSelector: () {},
            onOpenDesktopCameraSelector: null,
            onOpenHelp: () {},
            onReset: () {},
          ),
          mediaQueryData: const MediaQueryData(size: Size(360, 800)),
        ),
      );

      expect(tester.takeException(), isNull);

      final actionsFinder = find.byKey(const Key('scanner_top_actions'));
      final actions = tester.widget<Flex>(actionsFinder);
      final actionsRect = tester.getRect(actionsFinder);
      final syncRect = tester.getRect(
        find.byKey(const Key('scanner_sync_source')),
      );
      final fpsRect = tester.getRect(find.byKey(const Key('scanner_fps_chip')));

      expect(actions.direction, Axis.horizontal);
      expect(actionsRect.right, lessThanOrEqualTo(348));
      expect(actionsRect.center.dy, closeTo(fpsRect.center.dy, 0.5));
      expect(fpsRect.width, lessThan(100));
      expect(syncRect.top, greaterThan(actionsRect.bottom));
      expect(
        tester.getSize(find.byKey(const Key('scanner_camera_button'))),
        const Size(48, 48),
      );
      expect(find.byKey(const Key('scanner_camera_button')), findsOneWidget);
      expect(find.byKey(const Key('scanner_torch_button')), findsOneWidget);
      expect(find.byKey(const Key('scanner_reset_button')), findsOneWidget);
      expect(find.byKey(const Key('scanner_help_button')), findsOneWidget);
    },
  );

  testWidgets('ScannerDesktopPlaceholder renders title and tip', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        const ScannerDesktopPlaceholder(
          title: 'Scanner',
          tip: 'Point your camera at an animated QR.',
        ),
      ),
    );

    expect(find.text('Scanner'), findsOneWidget);
    expect(find.text('Point your camera at an animated QR.'), findsOneWidget);
  });

  testWidgets('showScannerHelpDialog shows tips and closes', (tester) async {
    await tester.pumpWidget(
      wrapApp(
        Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => showScannerHelpDialog(context),
            child: const Text('Open'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();

    expect(find.text('Scanning Tips'), findsOneWidget);
    expect(find.text('Position the QR Code'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'qr_code_scanner',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'light_mode',
      ),
      findsOneWidget,
    );

    await tester.tap(find.text('Got it'));
    await tester.pumpAndSettle();

    expect(find.text('Scanning Tips'), findsNothing);
  });

  testWidgets('showScannerCameraSelectorSheet uses AirQR icon styling', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => showScannerCameraSelectorSheet(
              context,
              onSelectBackCamera: () {},
              onSelectFrontCamera: () {},
            ),
            child: const Text('Open cameras'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open cameras'));
    await tester.pumpAndSettle();

    expect(find.text('Select Camera'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'photo_camera_back',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'photo_camera_front',
      ),
      findsOneWidget,
    );
  });
}
