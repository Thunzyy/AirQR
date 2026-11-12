// Opt-in captures of real widgets for the web/native parity review.
// flutter test test/parity_visual_capture_test.dart --dart-define=AIRQR_CAPTURE_DIR=...
import 'dart:io';
import 'dart:ui' as ui;

import 'package:airqr_mobile/app/app_shell.dart';
import 'package:airqr_mobile/decoder_page.dart';
import 'package:airqr_mobile/encoder_page.dart';
import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_page.dart';
import 'package:airqr_mobile/history_page_refresh.dart';
import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/scanner_page_chrome.dart';
import 'package:airqr_mobile/settings_page.dart';
import 'package:airqr_mobile/settings_page_controller.dart';
import 'package:airqr_mobile/encoder_defaults.dart';
import 'package:airqr_mobile/scanner_config.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const captureDirectory = String.fromEnvironment('AIRQR_CAPTURE_DIR');
const _boundaryKey = Key('parity-capture');
const _navItems = [
  AirQrNavItem(iconName: 'qr_code_2', label: 'Encoder'),
  AirQrNavItem(iconName: 'qr_code_scanner', label: 'Decoder'),
  AirQrNavItem(
    iconName: 'center_focus_weak',
    assetPath: 'assets/logo.png',
    label: 'Scanner',
  ),
  AirQrNavItem(iconName: 'history', label: 'History'),
  AirQrNavItem(iconName: 'settings', label: 'Settings'),
];

class _VisualHistory extends HistoryPageRefreshController {
  final String fixtureDirectory;
  _VisualHistory(this.fixtureDirectory);
  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async =>
      HistoryPageSnapshot(
        syncEnabled: true,
        connected: true,
        items: [
          HistoryItem(
            path: '$fixtureDirectory/report.pdf',
            timestamp: DateTime.now().millisecondsSinceEpoch,
            size: 204800,
            isSynced: true,
            serverId: 'report',
          ),
          HistoryItem(
            path: '$fixtureDirectory/notes.txt',
            timestamp: DateTime.now().millisecondsSinceEpoch,
            size: 1024,
            origin: 'generated',
            isLocalOnly: true,
          ),
        ],
        incompleteScans: [
          IncompleteScan(
            id: 'capture-session',
            filename: 'archive.zip',
            startTimestamp: 1,
            lastUpdateTimestamp: DateTime.now().millisecondsSinceEpoch,
            progress: 0.42,
            receivedPackets: 42,
            expectedPackets: 100,
          ),
        ],
      );
}

class _VisualSettings extends SettingsPageController {
  @override
  Future<SettingsPageSnapshot> load() async => SettingsPageSnapshot(
    selectedPreset: ScannerPreset.fast,
    scannerSettings: ScannerSettings.fast(),
    encoderSettings: const EncoderSettingsData(
      fps: EncoderDefaults.fps,
      ecc: EncoderDefaults.errorCorrection,
      packetSize: EncoderDefaults.packetSize,
      raptorqOverhead: EncoderDefaults.raptorqOverhead,
      targetSize: EncoderDefaults.targetQrSize,
      compressionEnabled: true,
      forceChunkMode: false,
    ),
    syncSettings: const SyncSettings(),
    desktopCameraSelection: const DesktopCameraSelectionState(
      devices: [],
      selectedDeviceName: null,
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final dark in [false, true]) {
    testWidgets('capture all pages ${dark ? 'dark' : 'light'}', (tester) async {
      tester.view.physicalSize = const Size(402, 874);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final previousShadows = debugDisableShadows;
      debugDisableShadows = false;
      addTearDown(() => debugDisableShadows = previousShadows);
      final font = FontLoader('Manrope');
      for (final weight in [
        'Regular',
        'Medium',
        'SemiBold',
        'Bold',
        'ExtraBold',
      ]) {
        font.addFont(rootBundle.load('assets/fonts/Manrope-$weight.ttf'));
      }
      await font.load();
      final materialIcons = FontLoader('MaterialIcons')
        ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
      await materialIcons.load();
      const monoPath = String.fromEnvironment('AIRQR_MONO_FONT');
      if (monoPath.isNotEmpty) {
        final bytes = await tester.runAsync(() => File(monoPath).readAsBytes());
        final mono = FontLoader('monospace')
          ..addFont(Future.value(ByteData.sublistView(bytes!)));
        await mono.load();
      }
      final fixtureDirectory = '$captureDirectory/fixtures';
      await tester.runAsync(() async {
        await Directory(fixtureDirectory).create(recursive: true);
        for (final name in ['report.pdf', 'notes.txt']) {
          await File('$fixtureDirectory/$name').writeAsString('Visual fixture');
        }
      });
      final notifier = ValueNotifier<int>(0);
      addTearDown(notifier.dispose);
      Future<void> mount(Widget child, int index) async {
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpWidget(
          RepaintBoundary(
            key: _boundaryKey,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: dark ? buildAirQrDarkTheme() : buildAirQrLightTheme(),
              locale: const Locale('en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: Scaffold(
                extendBody: true,
                body: child,
                bottomNavigationBar: AirQrBottomNav(
                  currentIndex: index,
                  onTap: (_) {},
                  items: _navItems,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      Future<void> capture(String name) async {
        await tester.pumpAndSettle();
        final boundary = tester.renderObject<RenderRepaintBoundary>(
          find.byKey(_boundaryKey),
        );
        await tester.runAsync(() async {
          final image = await boundary.toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final output = File(
            '$captureDirectory/${dark ? 'dark' : 'light'}-$name.png',
          );
          await output.parent.create(recursive: true);
          await output.writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }

      await mount(const EncoderPage(), 0);
      await capture('encoder');
      await tester.tap(find.text('Note').first);
      await tester.pumpAndSettle();
      await capture('encoder-note');
      await mount(const DecoderPage(), 1);
      await capture('decoder');
      await mount(
        ScannerChromeOverlay(
          fps: 60,
          syncSourceName: null,
          showMobileCamera: true,
          showDesktopCamera: false,
          isTorchOn: false,
          displayReceivedPackets: 42,
          displayExpectedPackets: 100,
          localChunkFramesScanned: 42,
          displayTotalPackets: 120,
          displayMissingPackets: 58,
          displayChunks: const [],
          displayProgress: 0.42,
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
        2,
      );
      await capture('scanner');
      await mount(
        HistoryPage(
          refreshController: _VisualHistory(fixtureDirectory),
          refreshInterval: const Duration(days: 1),
        ),
        3,
      );
      await capture('history');
      for (final section in <String?>[
        null,
        'Encoder',
        'Scanner',
        'Server sync',
        'Offline web app',
        'Appearance',
        'Logging',
        'About',
      ]) {
        await mount(
          SettingsPage(
            settingsChangedNotifier: notifier,
            pageController: _VisualSettings(),
          ),
          4,
        );
        if (section != null) {
          final entry = find.text(section).first;
          await tester.ensureVisible(entry);
          await tester.tap(entry);
          await tester.pumpAndSettle();
        }
        await capture(
          'settings-${section?.toLowerCase().replaceAll(' ', '-') ?? 'menu'}',
        );
      }
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      debugDisableShadows = previousShadows;
    }, skip: captureDirectory.isEmpty);
  }
}
