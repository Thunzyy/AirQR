import 'dart:convert';
import 'dart:typed_data';

import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/app/app_shell.dart';
import 'package:airqr_mobile/decoder_page.dart';
import 'package:airqr_mobile/encoder_page_widgets.dart';
import 'package:airqr_mobile/history_page.dart';
import 'package:airqr_mobile/history_page_widgets.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/note_detection.dart';
import 'package:airqr_mobile/note_view.dart';
import 'package:airqr_mobile/scanner_page_chrome.dart';
import 'package:airqr_mobile/scanner_result_view.dart';
import 'package:airqr_mobile/scanner_session_progress.dart';
import 'package:airqr_mobile/scanner_config.dart';
import 'package:airqr_mobile/settings_page.dart';
import 'package:airqr_mobile/settings_page_controller.dart';
import 'package:airqr_mobile/settings_page_sections.dart';
import 'package:airqr_mobile/settings_page_widgets.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _ScalingSettingsController extends SettingsPageController {
  @override
  Future<SettingsPageSnapshot> load() async => SettingsPageSnapshot(
    selectedPreset: ScannerPreset.fast,
    scannerSettings: ScannerSettings.fast(),
    encoderSettings: const EncoderSettingsData(
      fps: 10,
      ecc: 'MEDIUM',
      packetSize: 800,
      raptorqOverhead: 1.2,
      targetSize: 177,
      compressionEnabled: true,
      forceChunkMode: false,
    ),
    syncSettings: const SyncSettings(),
    desktopCameraSelection: const DesktopCameraSelectionState(
      devices: <String>[],
      selectedDeviceName: null,
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpScaled(
    WidgetTester tester,
    Widget child, {
    double scale = 2,
    Size size = const Size(390, 844),
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAirQrLightTheme(),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MediaQuery(
          data: MediaQueryData(
            size: size,
            textScaler: TextScaler.linear(scale),
          ),
          child: Scaffold(body: child),
        ),
      ),
    );
    await tester.pump();
    expect(tester.takeException(), isNull);
  }

  const settingsPalette = SettingsSectionPalette(
    isDarkMode: false,
    primaryColor: Colors.blue,
    cardBackgroundColor: Colors.white,
    fieldBackgroundColor: Color(0xfff4f4f4),
    primaryTextColor: Colors.black,
    secondaryTextColor: Colors.black54,
    subtleBorderColor: Colors.black12,
    segmentedBackgroundColor: Colors.white,
    clearButtonBackgroundColor: Colors.red,
    clearButtonForegroundColor: Colors.white,
  );

  void expectFullyVisibleParagraph(WidgetTester tester, String text) {
    final finder = find.text(text);
    final paragraph = tester.renderObject<RenderParagraph>(finder);
    expect(paragraph.didExceedMaxLines, isFalse);
    final paragraphRect = tester.getRect(finder);
    final screenRect = tester.getRect(find.byType(Scaffold));
    expect(screenRect.contains(paragraphRect.topLeft), isTrue);
    expect(screenRect.contains(paragraphRect.bottomRight), isTrue);
  }

  void expectContainedInViewport(WidgetTester tester, Finder finder) {
    final targetRect = tester.getRect(finder);
    final viewportRect = tester.getRect(find.byType(Scaffold));
    expect(
      targetRect.left >= viewportRect.left &&
          targetRect.top >= viewportRect.top &&
          targetRect.right <= viewportRect.right &&
          targetRect.bottom <= viewportRect.bottom,
      isTrue,
      reason: 'target=$targetRect viewport=$viewportRect',
    );
  }

  testWidgets('settings controls reflow long content at 200 percent', (
    tester,
  ) async {
    const sliderLabel = 'Extremely detailed scanning interval control';
    const dropdownLabel = 'Preferred processing quality selection';
    const dropdownValue = 'Maximum compatibility for every device';
    const switchLabel = 'Automatically synchronize every completed transfer';
    const switchSubtitle =
        'Keeps all linked devices synchronized whenever a transfer completes.';

    await pumpScaled(
      tester,
      ListView(
        children: [
          SettingsSliderTile(
            label: sliderLabel,
            value: 123456,
            min: 0,
            max: 200000,
            onChanged: (_) {},
            onChangeEnd: () {},
            suffix: ' milliseconds',
            primaryTextColor: Colors.black,
            accentColor: Colors.blue,
            inactiveTrackColor: Colors.grey,
          ),
          SettingsDropdownTile(
            label: dropdownLabel,
            value: dropdownValue,
            options: const [dropdownValue, 'Balanced'],
            onChanged: (_) {},
            primaryTextColor: Colors.black,
            accentColor: Colors.blue,
            fieldBackgroundColor: Colors.white,
            borderColor: Colors.grey,
            dropdownColor: Colors.white,
          ),
          SettingsSwitchTile(
            label: switchLabel,
            subtitle: switchSubtitle,
            value: true,
            onChanged: (_) {},
            primaryTextColor: Colors.black,
            secondaryTextColor: Colors.black54,
          ),
        ],
      ),
      size: const Size(320, 700),
    );

    expect(tester.takeException(), isNull);
    for (final text in [
      sliderLabel,
      '123456 milliseconds',
      dropdownLabel,
      dropdownValue,
      switchLabel,
      switchSubtitle,
    ]) {
      await tester.ensureVisible(find.text(text));
      await tester.pump();
      expectFullyVisibleParagraph(tester, text);
    }
    expect(
      tester.getSize(find.byType(Switch)).height,
      greaterThanOrEqualTo(48),
    );
  });

  testWidgets('default camera preserves long device name and refresh target', (
    tester,
  ) async {
    const device =
        'Ultra-wide external conference camera with virtual background support';
    await pumpScaled(
      tester,
      SingleChildScrollView(
        child: SettingsDefaultCameraTile(
          palette: settingsPalette,
          desktopCameraDevices: const [device],
          selectedDesktopCameraName: device,
          onSaveDesktopCameraPreference: (_) async {},
          onRefreshDesktopCameraDevices: () async {},
        ),
      ),
      size: const Size(320, 700),
    );

    expect(tester.takeException(), isNull);
    expectFullyVisibleParagraph(tester, device);
    final refresh = find.byType(IconButton);
    expect(tester.getSize(refresh).width, greaterThanOrEqualTo(48));
    expect(tester.getSize(refresh).height, greaterThanOrEqualTo(48));
  });

  testWidgets('narrow large-text settings dropdown remains selectable', (
    tester,
  ) async {
    const initial = 'Maximum compatibility for every device';
    const replacement = 'Balanced';
    var selected = initial;
    var changes = 0;

    await pumpScaled(
      tester,
      StatefulBuilder(
        builder: (context, setState) => SettingsDropdownTile(
          label: 'Preferred processing quality selection',
          value: selected,
          options: const [initial, replacement],
          onChanged: (value) {
            changes += 1;
            setState(() => selected = value);
          },
          primaryTextColor: Colors.black,
          accentColor: Colors.blue,
          fieldBackgroundColor: Colors.white,
          borderColor: Colors.grey,
          dropdownColor: Colors.white,
        ),
      ),
      size: const Size(320, 700),
    );

    await tester.tap(find.text(initial));
    await tester.pumpAndSettle();
    await tester.tap(find.text(replacement).last);
    await tester.pumpAndSettle();

    expect(changes, 1);
    expect(selected, replacement);
    expect(find.text(replacement), findsOneWidget);
    expect(tester.takeException(), isNull);
    expectFullyVisibleParagraph(tester, replacement);
  });

  testWidgets('about identity and attribution remain fully visible', (
    tester,
  ) async {
    const version = 'Version 2026.07.14 accessibility remediation preview';
    const author = 'Lucas and the international AirQR contributor community';
    await pumpScaled(
      tester,
      SingleChildScrollView(
        child: SettingsAboutSection(
          palette: settingsPalette,
          version: version,
          author: author,
          onOpenAuthorUrl: () {},
          onOpenRepoUrl: () {},
        ),
      ),
      size: const Size(320, 700),
    );

    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text(version));
    await tester.pump();
    expectFullyVisibleParagraph(tester, version);
    await tester.ensureVisible(find.text(author));
    await tester.pump();
    expectFullyVisibleParagraph(tester, author);
    final versionText = tester.widget<Text>(find.text(version));
    expect(versionText.style?.fontFamily, 'Manrope');
  });

  testWidgets('GIF metrics footer wraps long telemetry at 200 percent', (
    tester,
  ) async {
    var fullscreenTaps = 0;
    var downloadTaps = 0;
    final gif = Uint8List.fromList(
      base64Decode(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAEALAAAAAABAAEAAAICRAEAOw==',
      ),
    );
    const sizeLabel = '999.99 megabytes transferred successfully';
    const durationLabel = 'duration 99 minutes and 59 seconds';
    await pumpScaled(
      tester,
      SingleChildScrollView(
        child: EncoderGifResultCard(
          gifData: gif,
          currentFrame: 98765,
          totalFrames: 99999,
          minFrames: 12345,
          sizeLabel: sizeLabel,
          durationLabel: durationLabel,
          onDownload: () => downloadTaps += 1,
          onFullscreen: () => fullscreenTaps += 1,
        ),
      ),
      size: const Size(320, 700),
    );

    const progress = 'Frame: 98765/99999 (Min: 12345)';
    expect(tester.takeException(), isNull);
    final fullscreen = find.byKey(const Key('encoder-gif-fullscreen-action'));
    expect(tester.getSize(fullscreen).height, greaterThanOrEqualTo(40));
    expectContainedInViewport(tester, fullscreen);
    await tester.tap(fullscreen);
    await tester.pump();
    expect(fullscreenTaps, 1);
    await tester.ensureVisible(find.text(progress));
    await tester.pump();
    expect(find.text(progress), findsOneWidget);
    final download = find.byKey(const Key('encoder-gif-download-action'));
    await tester.ensureVisible(download);
    await tester.pump();
    expect(tester.getSize(download).height, greaterThanOrEqualTo(40));
    expectContainedInViewport(tester, download);
    await tester.tap(download);
    await tester.pump();
    expect(downloadTaps, 1);
  });

  testWidgets('navigation keeps essential labels at 200 percent', (
    tester,
  ) async {
    await pumpScaled(
      tester,
      AirQrBottomNav(
        currentIndex: 2,
        onTap: (_) {},
        items: const [
          AirQrNavItem(iconName: 'qr_code_2', label: 'Encode'),
          AirQrNavItem(iconName: 'qr_code_scanner', label: 'Decode'),
          AirQrNavItem(iconName: 'center_focus_weak', label: 'Scanner'),
          AirQrNavItem(iconName: 'history', label: 'History'),
          AirQrNavItem(iconName: 'settings', label: 'Settings'),
        ],
      ),
    );
    expect(find.text('Scanner'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
  });

  testWidgets('settings and encoder note controls scale without overflow', (
    tester,
  ) async {
    await pumpScaled(
      tester,
      ListView(
        children: [
          SettingsSegmentedControl(
            options: const ['Light', 'Dark', 'System'],
            value: 'System',
            selectedColor: Colors.black,
            backgroundColor: Colors.white,
            unselectedTextColor: Colors.grey,
            onChanged: (_) {},
          ),
          EncoderNoteEditor(
            noteText: 'A readable note',
            noteFormat: NoteFormat.plain,
            onNoteTextChanged: (_) {},
            onNoteFormatChanged: (_) {},
            onClear: () {},
          ),
        ],
      ),
    );
    expect(find.text('System'), findsOneWidget);
    expect(find.text('A readable note'), findsOneWidget);
  });

  testWidgets('history filters keep full tappable labels at 200 percent', (
    tester,
  ) async {
    var selected = 'all';
    await pumpScaled(
      tester,
      HistoryFilterToggle(
        selectedFilter: selected,
        cardColor: Colors.white,
        selectedColor: Colors.grey,
        allLabel: 'All transfers',
        scannedLabel: 'Scanned files',
        generatedLabel: 'Generated files',
        onChanged: (value) => selected = value,
      ),
    );

    for (final label in ['All transfers', 'Scanned files', 'Generated files']) {
      final paragraph = tester.renderObject<RenderParagraph>(find.text(label));
      expect(paragraph.didExceedMaxLines, isFalse);
      final target = tester.getSize(find.bySemanticsLabel(label));
      expect(target.height, greaterThanOrEqualTo(48));
    }
    await tester.tap(find.bySemanticsLabel('Generated files'));
    expect(selected, 'generated');
  });

  testWidgets(
    'encoder mode and source actions keep full labels at 200 percent',
    (tester) async {
      var fileModeTapped = false;
      var folderTapped = false;
      await pumpScaled(
        tester,
        ListView(
          children: [
            EncoderModeToggle(
              noteMode: false,
              onSelectFileMode: () => fileModeTapped = true,
              onSelectNoteMode: () {},
            ),
            EncoderSourceCard(
              fileName: null,
              fileSizeLabel: null,
              hasSelection: false,
              onSelectFile: () {},
              onSelectFolder: () => folderTapped = true,
            ),
          ],
        ),
      );

      for (final label in ['File', 'Note', 'Select File(s)', 'Select Folder']) {
        final paragraph = tester.renderObject<RenderParagraph>(
          find.text(label),
        );
        expect(paragraph.didExceedMaxLines, isFalse);
      }
      await tester.tap(find.text('File'));
      await tester.tap(find.text('Select Folder'));
      expect(fileModeTapped, isTrue);
      expect(folderTapped, isTrue);
    },
  );

  testWidgets('long settings detail title wraps at 200 percent', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await pumpScaled(
      tester,
      SettingsPage(
        settingsChangedNotifier: ValueNotifier<int>(0),
        pageController: _ScalingSettingsController(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Offline web app'));
    await tester.pumpAndSettle();

    final title = tester.renderObject<RenderParagraph>(
      find.text('Offline web app').last,
    );
    expect(title.didExceedMaxLines, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('settings menu descriptions use Manrope semantic text', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await pumpScaled(
      tester,
      SettingsPage(
        settingsChangedNotifier: ValueNotifier<int>(0),
        pageController: _ScalingSettingsController(),
      ),
      scale: 1,
    );
    await tester.pumpAndSettle();

    final description = tester.widget<Text>(find.textContaining('fps').first);
    expect(description.style?.fontFamily, 'Manrope');
    expect(description.style?.fontFamily, isNot('monospace'));
  });

  testWidgets('chunk telemetry wraps and remains tappable at 200 percent', (
    tester,
  ) async {
    var playTapped = false;
    var autoAdvanceTapped = false;
    final gif = Uint8List.fromList(
      base64Decode(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAEALAAAAAABAAEAAAICRAEAOw==',
      ),
    );
    await pumpScaled(
      tester,
      SingleChildScrollView(
        child: EncoderChunkResultCard(
          chunkGifs: [gif, gif],
          chunkFrameCounts: const [99999, 99999],
          selectedChunkIndex: 0,
          totalChunks: 2,
          totalFrames: 199998,
          currentChunkFrame: 98765,
          minFrames: 12345,
          resultSizeLabel: '999.99 MB',
          durationLabel: '99.9s',
          isChunkPlaying: false,
          onDownload: () {},
          onFullscreen: () {},
          onChunkSelected: (_) {},
          onOpenMultiView: () {},
          onToggleAutoAdvanceChunks: () => autoAdvanceTapped = true,
          onTogglePlayPause: () => playTapped = true,
        ),
      ),
      size: const Size(320, 700),
    );

    expect(find.text('98765/99999 • Min 12345'), findsOneWidget);
    expect(find.byKey(const Key('encoder-chunk-selector')), findsOneWidget);
    expect(find.text('Chunk 1/2 • 20:35'), findsOneWidget);
    for (final label in ['98765/99999 • Min 12345']) {
      await tester.ensureVisible(find.text(label));
      await tester.pump();
      expectFullyVisibleParagraph(tester, label);
    }
    final multiView = find.byKey(const Key('encoder-chunk-multi-view-action'));
    await tester.ensureVisible(multiView);
    await tester.pump();
    expect(tester.getSize(multiView).height, greaterThanOrEqualTo(40));
    expectContainedInViewport(tester, multiView);
    final autoAdvance = find.byKey(const Key('encoder-chunk-auto-advance'));
    await tester.ensureVisible(autoAdvance);
    await tester.pump();
    expect(tester.getSize(autoAdvance).height, 32);
    expectContainedInViewport(tester, autoAdvance);
    await tester.tap(autoAdvance);
    expect(autoAdvanceTapped, isTrue);
    final playToggle = find.byKey(const Key('encoder-chunk-play-toggle'));
    await tester.ensureVisible(playToggle);
    await tester.pump();
    expect(tester.getSize(playToggle).height, greaterThanOrEqualTo(48));
    expectContainedInViewport(tester, playToggle);
    await tester.tap(playToggle);
    expect(playTapped, isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('scanner chrome and result preserve status and actions', (
    tester,
  ) async {
    final overlay = ScannerChromeOverlay(
      fps: 24,
      syncSourceName: 'Nearby phone',
      showMobileCamera: true,
      showDesktopCamera: false,
      isTorchOn: false,
      currentChunkNumber: 1,
      currentChunkTotal: 2,
      displayReceivedPackets: 12,
      displayExpectedPackets: 30,
      displayTotalPackets: 48,
      displayMissingPackets: 18,
      displayChunks: const <ScannerChunkProgressInfo>[],
      displayProgress: .4,
      isComplete: false,
      status: 'Scanning...',
      primaryColor: AirQrTheme.accentBlue,
      successColor: AirQrTheme.success,
      onToggleTorch: () {},
      onOpenMobileCameraSelector: () {},
      onOpenDesktopCameraSelector: null,
      onOpenHelp: () {},
      onReset: () {},
    );
    await pumpScaled(tester, overlay, size: const Size(390, 900));
    expect(find.text('Scanning...'), findsOneWidget);

    await pumpScaled(
      tester,
      ScannerResultView(
        primaryColor: AirQrTheme.accentBlue,
        successColor: AirQrTheme.success,
        filename: 'archive.zip',
        sizeLabel: '4.2 MB',
        durationLabel: '8.1s',
        subtitle: 'Synced nearby',
        canDownload: true,
        isSaving: false,
        onDownload: () {},
        onClose: () {},
      ),
    );
    expect(find.text('Download'), findsOneWidget);
    expect(find.text('Close'), findsOneWidget);
  });

  testWidgets('decoder history and note surfaces tolerate large text', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await pumpScaled(tester, const DecoderPage());
    expect(find.text('Decode GIF'), findsOneWidget);

    await pumpScaled(tester, const HistoryPage(isActive: false));
    expect(tester.takeException(), isNull);

    await pumpScaled(
      tester,
      NoteViewerScaffold(
        filename: 'long-note.txt',
        content: 'Readable prose content',
        onBack: () {},
      ),
    );
    expect(find.text('Readable prose content'), findsOneWidget);
  });
}
