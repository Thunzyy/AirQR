import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/camera_preferences.dart';
import 'package:airqr_mobile/encoder_defaults.dart';
import 'package:airqr_mobile/local_sync_server_controller.dart';
import 'package:airqr_mobile/offline_web_server_controller.dart';
import 'package:airqr_mobile/scanner_config.dart';
import 'package:airqr_mobile/settings_export_config_controller.dart';
import 'package:airqr_mobile/settings_page.dart';
import 'package:airqr_mobile/settings_page_controller.dart';
import 'package:airqr_mobile/settings_page_sections.dart';
import 'package:airqr_mobile/settings_page_widgets.dart';
import 'package:airqr_mobile/settings_sync_controller.dart';
import 'package:airqr_mobile/sync_service.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:airqr_mobile/widgets/airqr_segmented_control.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeSettingsPageController extends SettingsPageController {
  final SettingsPageSnapshot snapshot;

  _FakeSettingsPageController(this.snapshot);

  @override
  Future<SettingsPageSnapshot> load() async => snapshot;
}

class _FakeSettingsExportConfigController
    extends SettingsExportConfigController {
  final SettingsExportConfig config;

  _FakeSettingsExportConfigController(this.config);

  @override
  Future<SettingsExportConfig> load(SyncSettings settings) async => config;

  @override
  Future<SettingsExportConfig> save(
    SyncSettings settings,
    Object? updates,
  ) async {
    return config;
  }
}

class _FakeLocalSyncServerController extends LocalSyncServerController {
  _FakeLocalSyncServerController();

  String? username;
  String? password;
  int? port;
  bool running = false;
  int stopCount = 0;
  String? url;

  @override
  bool get canStartOnThisPlatform => true;

  @override
  bool get isRunning => running;

  @override
  String? get serverUrl => url;

  @override
  Future<void> refreshStatus() async {}

  @override
  Future<LocalSyncServerLaunchResult> start({
    required String username,
    required String password,
    int port = 8081,
  }) async {
    this.username = username;
    this.password = password;
    this.port = port;
    running = true;
    url = 'http://192.168.1.36:$port';
    return LocalSyncServerLaunchResult.ok(url!);
  }

  @override
  Future<void> stop() async {
    stopCount++;
    running = false;
    url = null;
  }
}

class _FakeOfflineWebServerController extends OfflineWebServerController {
  bool running = false;
  int startCount = 0;
  int stopCount = 0;
  String? url;
  List<String> urls = const [];

  @override
  bool get isRunning => running;

  @override
  String? get serverUrl => url;

  @override
  int? get port => running ? 8090 : null;

  @override
  List<String> get networkUrls => urls;

  @override
  Future<OfflineWebServerLaunchResult> start() async {
    startCount++;
    running = true;
    urls = urls.isEmpty
        ? const ['http://192.168.1.36:8090']
        : List<String>.from(urls);
    url = urls.first;
    return OfflineWebServerLaunchResult.ok(url!);
  }

  @override
  Future<void> stop() async {
    stopCount++;
    running = false;
    url = null;
    urls = const [];
  }
}

void main() {
  testWidgets('fresh settings UI uses encoder defaults in English', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
        selectedPreset: ScannerPreset.fast,
        scannerSettings: ScannerSettings.fast(),
        encoderSettings: const EncoderSettingsData(
          fps: EncoderDefaults.fps,
          ecc: EncoderDefaults.errorCorrection,
          packetSize: EncoderDefaults.packetSize,
          raptorqOverhead: EncoderDefaults.raptorqOverhead,
          targetSize: EncoderDefaults.targetQrSize,
          compressionEnabled: EncoderDefaults.compressionEnabled,
          forceChunkMode: false,
        ),
        syncSettings: const SyncSettings(),
        desktopCameraSelection: const DesktopCameraSelectionState(
          devices: <String>[],
          selectedDeviceName: null,
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    for (
      var attempt = 0;
      attempt < 20 && find.text('Encoder').evaluate().isEmpty;
      attempt++
    ) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.tap(find.text('Encoder'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('10 fps'), findsOneWidget);
    expect(find.text('1500 bytes'), findsOneWidget);
    expect(find.text('LOW'), findsOneWidget);
    expect(find.text('177px'), findsOneWidget);
    expect(find.text('1.3x'), findsOneWidget);
    expect(find.text('Redundancy'), findsOneWidget);
  });

  testWidgets('encoder redundancy label is localized in French', (
    tester,
  ) async {
    final section = SettingsEncoderSection(
      palette: const SettingsSectionPalette(
        isDarkMode: false,
        primaryColor: Colors.blue,
        primaryTextColor: Colors.black,
        secondaryTextColor: Colors.grey,
        cardBackgroundColor: Colors.white,
        fieldBackgroundColor: Colors.white,
        subtleBorderColor: Colors.black12,
        segmentedBackgroundColor: Colors.white,
        clearButtonBackgroundColor: Colors.white,
        clearButtonForegroundColor: Colors.black,
      ),
      fps: 10,
      packetSize: 1500,
      ecc: 'LOW',
      targetSize: 177,
      raptorqOverhead: 1.3,
      compressionEnabled: true,
      forceChunkMode: false,
      customChunkSize: 10,
      onFpsChanged: (_) {},
      onPacketSizeChanged: (_) {},
      onEccChanged: (_) {},
      onTargetSizeChanged: (_) {},
      onRaptorqOverheadChanged: (_) {},
      onCompressionChanged: (_) {},
      onForceChunkModeChanged: (_) {},
      onCustomChunkSizeChanged: (_) {},
      onPersist: () {},
    );

    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('fr'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: section),
      ),
    );

    expect(find.text('Redondance'), findsOneWidget);
  });

  testWidgets('Error Correction keeps its selected value fully visible', (
    tester,
  ) async {
    final section = SettingsEncoderSection(
      palette: const SettingsSectionPalette(
        isDarkMode: false,
        primaryColor: Colors.blue,
        primaryTextColor: Colors.black,
        secondaryTextColor: Colors.grey,
        cardBackgroundColor: Colors.white,
        fieldBackgroundColor: Colors.white,
        subtleBorderColor: Colors.black12,
        segmentedBackgroundColor: Colors.white,
        clearButtonBackgroundColor: Colors.white,
        clearButtonForegroundColor: Colors.black,
      ),
      fps: 10,
      packetSize: 1500,
      ecc: 'LOW',
      targetSize: 177,
      raptorqOverhead: 1.3,
      compressionEnabled: true,
      forceChunkMode: false,
      customChunkSize: 10,
      onFpsChanged: (_) {},
      onPacketSizeChanged: (_) {},
      onEccChanged: (_) {},
      onTargetSizeChanged: (_) {},
      onRaptorqOverheadChanged: (_) {},
      onCompressionChanged: (_) {},
      onForceChunkModeChanged: (_) {},
      onCustomChunkSizeChanged: (_) {},
      onPersist: () {},
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SizedBox(
            width: 390,
            child: SingleChildScrollView(child: section),
          ),
        ),
      ),
    );

    final fieldRect = tester.getRect(
      find.byKey(const Key('settings-dropdown-field')),
    );
    final valueRect = tester.getRect(find.text('LOW'));

    expect(fieldRect.height, greaterThanOrEqualTo(48));
    expect(fieldRect.contains(valueRect.topLeft), isTrue);
    expect(fieldRect.contains(valueRect.bottomRight), isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Settings app version uses Manrope metadata type', (
    tester,
  ) async {
    const palette = SettingsSectionPalette(
      isDarkMode: true,
      primaryColor: Colors.blue,
      cardBackgroundColor: Colors.black,
      fieldBackgroundColor: Colors.black,
      primaryTextColor: Colors.white,
      secondaryTextColor: Colors.grey,
      subtleBorderColor: Colors.grey,
      segmentedBackgroundColor: Colors.black,
      clearButtonBackgroundColor: Colors.red,
      clearButtonForegroundColor: Colors.white,
    );
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SettingsAboutSection(
            palette: palette,
            version: 'Version 2.0.26',
            author: 'Lucas',
            onOpenAuthorUrl: () {},
            onOpenRepoUrl: () {},
          ),
        ),
      ),
    );

    final version = tester.widget<Text>(find.text('Version 2.0.26'));
    expect(version.style?.fontFamily, 'Manrope');
    expect(version.style?.fontFeatures, isNull);
  });

  testWidgets('Settings switches stay inline on a mobile-width card', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: UnconstrainedBox(
            child: SizedBox(
              width: 336,
              child: SettingsSwitchTile(
                label: 'Enable server sync',
                subtitle: 'Sync history across devices and resume scans.',
                value: true,
                onChanged: (_) {},
                primaryTextColor: Colors.black,
                secondaryTextColor: Colors.black54,
              ),
            ),
          ),
        ),
      ),
    );

    final labelFinder = find.text('Enable server sync');
    final subtitleFinder = find.text(
      'Sync history across devices and resume scans.',
    );
    final tileFinder = find.byType(SettingsSwitchTile);
    final switchFinder = find.byType(Switch);
    final label = tester.widget<Text>(labelFinder);
    final copyTop = tester.getTopLeft(labelFinder).dy;
    final copyBottom = tester.getBottomLeft(subtitleFinder).dy;
    final tileRect = tester.getRect(tileFinder);
    final switchRect = tester.getRect(switchFinder);

    expect(label.style?.fontSize, 14);
    expect(label.style?.fontWeight, FontWeight.w600);
    expect(switchRect.center.dy, inInclusiveRange(copyTop, copyBottom));
    expect(switchRect.right, lessThanOrEqualTo(tileRect.right));
    expect(tester.takeException(), isNull);
  });

  testWidgets('SettingsCard renders its semantic one-dp outline', (
    tester,
  ) async {
    const borderColor = Color(0xFF456789);
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SettingsCard(
            backgroundColor: Colors.white,
            borderColor: borderColor,
            children: [SizedBox(height: 20)],
          ),
        ),
      ),
    );

    final container = tester.widget<Container>(
      find.descendant(
        of: find.byType(SettingsCard),
        matching: find.byType(Container),
      ),
    );
    final decoration = container.decoration! as BoxDecoration;
    expect(decoration.borderRadius, AirQrRadii.card);
    expect(decoration.border, Border.all(color: borderColor));
  });

  TestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpLoggingSection(
    WidgetTester tester, {
    bool disableAnimations = false,
  }) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MediaQuery(
          data: MediaQueryData(disableAnimations: disableAnimations),
          child: SettingsPage(
            settingsChangedNotifier: ValueNotifier<int>(0),
            pageController: controller,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    await tester.tap(find.text('Logging'));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'SettingsSegmentedControl uses the shared sliding indicator model',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SettingsSegmentedControl(
              key: const Key('settings-segmented-control-under-test'),
              indicatorKey: const Key('settings-segmented-active-indicator'),
              options: const ['Light', 'Dark', 'System'],
              value: 'Dark',
              selectedColor: const Color(0xFF343434),
              backgroundColor: const Color(0xFF101113),
              unselectedTextColor: Colors.white70,
              onChanged: (_) {},
            ),
          ),
        ),
      );

      final controlRect = tester.getRect(
        find.byKey(const Key('settings-segmented-control-under-test')),
      );
      final indicator = tester.widget<AnimatedPositioned>(
        find.byKey(const Key('settings-segmented-active-indicator')),
      );

      expect(find.byType(AirQrSegmentedControl), findsOneWidget);
      expect(controlRect.height, 56);
      expect(indicator.duration, const Duration(milliseconds: 300));
      expect(indicator.curve, const Cubic(0.2, 0.8, 0.2, 1));
      expect(indicator.height, 48);
      expect(indicator.width, closeTo((controlRect.width - 8) / 3, 1));
      expect(indicator.left, closeTo((controlRect.width - 8) / 3, 1));
      final indicatorDecoration =
          tester
                  .widget<DecoratedBox>(
                    find.descendant(
                      of: find.byKey(
                        const Key('settings-segmented-active-indicator'),
                      ),
                      matching: find.byType(DecoratedBox),
                    ),
                  )
                  .decoration
              as BoxDecoration;
      expect(indicatorDecoration.boxShadow, isNull);
      final darkInkWell = tester.widget<InkWell>(
        find
            .ancestor(of: find.text('Dark'), matching: find.byType(InkWell))
            .first,
      );
      expect(
        darkInkWell.overlayColor?.resolve(<WidgetState>{
          WidgetState.focused,
        })?.a,
        greaterThan(0),
      );
      expect(
        darkInkWell.overlayColor?.resolve(<WidgetState>{
          WidgetState.pressed,
        })?.a,
        greaterThan(0),
      );
      for (final label in const ['Light', 'Dark', 'System']) {
        final option = find
            .ancestor(of: find.text(label), matching: find.byType(InkWell))
            .first;
        final size = tester.getSize(option);
        expect(size.width, greaterThanOrEqualTo(48));
        expect(size.height, greaterThanOrEqualTo(48));
      }
    },
  );

  testWidgets('SettingsSegmentedControl honors reduced motion and large text', (
    tester,
  ) async {
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(
          disableAnimations: true,
          textScaler: TextScaler.linear(2),
        ),
        child: MaterialApp(
          home: Scaffold(
            body: SettingsSegmentedControl(
              indicatorKey: const Key('reduced-motion-segment-indicator'),
              options: const ['Light', 'Dark', 'System'],
              value: 'Dark',
              selectedColor: Colors.black,
              backgroundColor: Colors.white,
              unselectedTextColor: Colors.grey,
              onChanged: (_) {},
            ),
          ),
        ),
      ),
    );

    expect(
      tester
          .widget<AnimatedPositioned>(
            find.byKey(const Key('reduced-motion-segment-indicator')),
          )
          .duration,
      Duration.zero,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('settings polish animations honor reduced motion', (
    tester,
  ) async {
    late Duration duration;
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: MaterialApp(
          home: Builder(
            builder: (context) {
              duration = settingsAnimationDuration(
                context,
                const Duration(milliseconds: 180),
              );
              return const SizedBox.shrink();
            },
          ),
        ),
      ),
    );

    expect(duration, Duration.zero);
  });

  testWidgets('SettingsPage shows a web-style settings menu first', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('Encoder'), findsOneWidget);
    expect(find.text('Scanner'), findsOneWidget);
    expect(find.text('Server sync'), findsOneWidget);
    expect(find.text('Offline web app'), findsOneWidget);
    expect(find.text('Appearance'), findsOneWidget);
    expect(find.text('Logging'), findsOneWidget);
    expect(find.text('About'), findsOneWidget);

    expect(find.byType(SettingsEncoderSection), findsNothing);
    expect(find.byType(SettingsScannerPresetSection), findsNothing);
    expect(find.byType(SettingsSyncSection), findsNothing);
    expect(find.byType(SettingsAppearanceSection), findsNothing);
    expect(find.byType(SettingsAboutSection), findsNothing);

    final menuList = tester.widget<ListView>(
      find.byKey(const Key('settings-menu-list')),
    );
    expect(
      menuList.padding,
      EdgeInsets.fromLTRB(
        16,
        8,
        16,
        settingsBottomNavigationClearance(
          tester.element(find.byKey(const Key('settings-menu-list'))),
        ),
      ),
    );

    final menuSurface = tester.widget<Container>(
      find
          .ancestor(of: find.text('Encoder'), matching: find.byType(Container))
          .first,
    );
    final menuDecoration = menuSurface.decoration! as BoxDecoration;
    expect(menuDecoration.boxShadow, isNull);
    expect(menuDecoration.border, isNotNull);

    final encoderTitle = tester.widget<Text>(find.text('Encoder'));
    final encoderRow = find
        .ancestor(of: find.text('Encoder'), matching: find.byType(InkWell))
        .first;
    final encoderDescription = tester.widget<Text>(
      find.descendant(of: encoderRow, matching: find.byType(Text)).last,
    );
    expect(encoderTitle.style?.fontFamily, 'Manrope');
    expect(encoderTitle.style?.fontSize, 20);
    expect(encoderTitle.style?.fontWeight, FontWeight.w600);
    expect(encoderTitle.style?.height, 1.2);
    expect(encoderDescription.style?.fontFamily, 'Manrope');
    expect(encoderDescription.style?.fontSize, 15);
    expect(encoderDescription.style?.fontWeight, FontWeight.w500);
  });

  testWidgets('Settings detail uses compact clearance and title hierarchy', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    await tester.tap(find.text('Encoder'));
    await tester.pumpAndSettle();

    final detailList = tester.widget<ListView>(
      find.byKey(const Key('settings-detail-list')),
    );
    expect(
      detailList.padding,
      EdgeInsets.fromLTRB(
        16,
        8,
        16,
        settingsBottomNavigationClearance(
          tester.element(find.byKey(const Key('settings-detail-list'))),
        ),
      ),
    );
    final title = tester.widget<Text>(find.text('Encoder'));
    expect(
      title.style?.fontSize,
      Theme.of(
        tester.element(find.text('Encoder')),
      ).textTheme.titleLarge?.fontSize,
    );
    final back = find.bySemanticsLabel('Back to settings');
    expect(tester.getSize(back), const Size(48, 48));
    expect(
      tester.getSize(find.byKey(const Key('settings-detail-back-visual'))),
      const Size(36, 36),
    );
    final backIcon = tester.widget<AirQrIcon>(
      find.byKey(const Key('settings-detail-back-icon')),
    );
    expect(backIcon.size, 20);
    expect(
      tester.getCenter(find.text('Encoder')).dy,
      closeTo(tester.getCenter(back).dy, 2),
    );
  });

  testWidgets('Settings About uses the shared outlined card surface', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    await tester.tap(find.text('About'));
    await tester.pumpAndSettle();

    expect(find.byType(SettingsAboutSection), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(SettingsAboutSection),
        matching: find.byType(SettingsCard),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'logging chips paint focus and press states above their surface',
    (tester) async {
      await pumpLoggingSection(tester);

      final services = find.bySemanticsLabel('Services');
      final materialFinder = find.descendant(
        of: services,
        matching: find.byType(Material),
      );
      final inkWellFinder = find.descendant(
        of: services,
        matching: find.byType(InkWell),
      );
      final material = tester.widget<Material>(materialFinder.first);
      final inkWell = tester.widget<InkWell>(inkWellFinder.first);
      expect(
        material.color,
        AirQrTheme.primaryButtonSurface(tester.element(services)),
      );
      expect(
        inkWell.overlayColor?.resolve(<WidgetState>{WidgetState.focused})?.a,
        greaterThan(0),
      );
      expect(
        inkWell.overlayColor?.resolve(<WidgetState>{WidgetState.pressed})?.a,
        greaterThan(0),
      );

      await tester.tap(services);
      await tester.pumpAndSettle();
      expect(
        tester.widget<Material>(materialFinder.first).color,
        AirQrTheme.controlSurface(tester.element(services)),
      );
    },
  );

  testWidgets('logging chip selection animation honors reduced motion', (
    tester,
  ) async {
    await pumpLoggingSection(tester, disableAnimations: true);

    final services = find.bySemanticsLabel('Services');
    final animation = tester.widget<TweenAnimationBuilder<Color?>>(
      find
          .descendant(
            of: services,
            matching: find.byWidgetPredicate(
              (widget) => widget is TweenAnimationBuilder<Color?>,
            ),
          )
          .first,
    );
    expect(animation.duration, Duration.zero);
  });

  testWidgets('Settings lists offline web alternative network URLs', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final offlineWebServerController = _FakeOfflineWebServerController()
      ..urls = const [
        'http://192.168.1.110:8091',
        'http://192.168.1.36:8091',
        'http://10.5.0.2:8091',
      ];
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
          offlineWebServerController: offlineWebServerController,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Offline web app'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('offline-web-server-action-button')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('http://192.168.1.110:8091'), findsWidgets);
    expect(find.text('http://192.168.1.36:8091'), findsOneWidget);
    expect(find.text('http://10.5.0.2:8091'), findsOneWidget);
    expect(find.byKey(const Key('offline-web-network-url-1')), findsOneWidget);
    expect(find.byKey(const Key('offline-web-network-url-2')), findsOneWidget);
  });

  testWidgets('Settings can start and stop the offline web app server', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final offlineWebServerController = _FakeOfflineWebServerController();
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
          offlineWebServerController: offlineWebServerController,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Offline web app'));
    await tester.pumpAndSettle();

    expect(find.text('Start offline web app'), findsOneWidget);
    expect(find.text('http://192.168.1.36:8090'), findsNothing);

    await tester.tap(find.byKey(const Key('offline-web-server-action-button')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(offlineWebServerController.startCount, 1);
    expect(find.text('http://192.168.1.36:8090'), findsWidgets);
    expect(find.text('Stop offline web app'), findsOneWidget);
    expect(
      find.byKey(const Key('offline-web-server-copy-button')),
      findsOneWidget,
    );
    expect(
      find.byKey(const Key('offline-web-server-open-button')),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('offline-web-server-action-button')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(offlineWebServerController.stopCount, 1);
    expect(find.text('Start offline web app'), findsOneWidget);
  });

  testWidgets('SettingsPage opens a section detail and returns to the menu', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Encoder'));
    await tester.pumpAndSettle();

    expect(find.byType(SettingsEncoderSection), findsOneWidget);
    expect(find.bySemanticsLabel('Back to settings'), findsOneWidget);
    expect(
      tester
          .getSemantics(find.bySemanticsLabel('Back to settings'))
          .getSemanticsData()
          .hasAction(SemanticsAction.tap),
      isTrue,
    );

    await tester.tap(find.bySemanticsLabel('Back to settings'));
    await tester.pumpAndSettle();

    expect(find.text('Server sync'), findsOneWidget);
    expect(find.byType(SettingsEncoderSection), findsNothing);
  });

  testWidgets('system Back returns a settings detail to the menu', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Encoder'));
    await tester.pumpAndSettle();

    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(find.byType(SettingsEncoderSection), findsNothing);
    expect(find.text('Server sync'), findsOneWidget);
  });

  testWidgets('inactive settings detail does not consume system Back', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );

    Widget buildApp({required bool isActive}) => MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: SettingsPage(
        settingsChangedNotifier: ValueNotifier<int>(0),
        pageController: controller,
        isActive: isActive,
      ),
    );

    await tester.pumpWidget(buildApp(isActive: true));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Encoder'));
    await tester.pumpAndSettle();
    expect(find.byType(SettingsEncoderSection), findsOneWidget);

    await tester.pumpWidget(buildApp(isActive: false));
    await tester.pump();
    expect(await tester.binding.handlePopRoute(), isFalse);
  });

  testWidgets('Settings encoder detail matches the web settings layout', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
        selectedPreset: ScannerPreset.fast,
        scannerSettings: ScannerSettings.fast(),
        encoderSettings: const EncoderSettingsData(
          fps: 10,
          ecc: 'MEDIUM',
          packetSize: 800,
          raptorqOverhead: 1.2,
          targetSize: 177,
          compressionEnabled: true,
          forceChunkMode: true,
        ),
        syncSettings: const SyncSettings(),
        desktopCameraSelection: const DesktopCameraSelectionState(
          devices: <String>[],
          selectedDeviceName: null,
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Encoder'));
    await tester.pumpAndSettle();

    expect(find.text('ENCODER'), findsNothing);
    expect(find.text('Chunk Size'), findsOneWidget);

    final frameTop = tester.getTopLeft(find.text('Frame Rate (FPS)')).dy;
    final packetTop = tester.getTopLeft(find.text('Packet Size')).dy;
    final eccTop = tester.getTopLeft(find.text('Error Correction')).dy;
    final targetTop = tester.getTopLeft(find.text('Target QR Size')).dy;
    final raptorTop = tester.getTopLeft(find.text('Redundancy')).dy;
    final compressionTop = tester.getTopLeft(find.text('Compression')).dy;
    final forceTop = tester.getTopLeft(find.text('Force Chunk Mode')).dy;
    final chunkTop = tester.getTopLeft(find.text('Chunk Size')).dy;

    expect(frameTop, lessThan(packetTop));
    expect(packetTop, lessThan(eccTop));
    expect(eccTop, lessThan(targetTop));
    expect(targetTop, lessThan(raptorTop));
    expect(raptorTop, lessThan(compressionTop));
    expect(compressionTop, lessThan(forceTop));
    expect(forceTop, lessThan(chunkTop));
  });

  testWidgets(
    'Settings detail pages do not repeat the header as section text',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final controller = _FakeSettingsPageController(
        SettingsPageSnapshot(
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
          syncSettings: const SyncSettings(enabled: true),
          desktopCameraSelection: const DesktopCameraSelectionState(
            devices: <String>[],
            selectedDeviceName: null,
          ),
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: SettingsPage(
            settingsChangedNotifier: ValueNotifier<int>(0),
            pageController: controller,
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      for (final entry in <(String, List<String>)>[
        ('Encoder', ['ENCODER']),
        ('Scanner', ['SCANNER PRESET', 'SCANNER ADVANCED']),
        ('Server sync', ['SERVER SYNC']),
        ('Offline web app', ['OFFLINE WEB APP']),
        ('Appearance', ['APPEARANCE']),
        ('Logging', ['LOGGING']),
        ('About', ['ABOUT']),
      ]) {
        await tester.tap(find.text(entry.$1));
        await tester.pumpAndSettle();

        for (final duplicateHeader in entry.$2) {
          expect(find.text(duplicateHeader), findsNothing);
        }
        final detailList = tester.widget<ListView>(
          find.byKey(const Key('settings-detail-list')),
        );
        expect(
          (detailList.padding! as EdgeInsets).bottom,
          greaterThanOrEqualTo(114),
        );

        await tester.tap(find.bySemanticsLabel('Back to settings'));
        await tester.pumpAndSettle();
      }
    },
  );

  testWidgets(
    'Settings detail cards use flat AirQR surfaces without gradients',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final controller = _FakeSettingsPageController(
        SettingsPageSnapshot(
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
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: SettingsPage(
            settingsChangedNotifier: ValueNotifier<int>(0),
            pageController: controller,
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      await tester.tap(find.text('About'));
      await tester.pumpAndSettle();

      final hasGradientContainer = tester
          .widgetList<Container>(find.byType(Container))
          .any((container) {
            final decoration = container.decoration;
            return decoration is BoxDecoration && decoration.gradient != null;
          });

      expect(hasGradientContainer, isFalse);
    },
  );

  testWidgets('Settings default camera belongs to Scanner not Appearance', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
          devices: <String>['Elgato Facecam'],
          selectedDeviceName: 'Elgato Facecam',
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Appearance'));
    await tester.pumpAndSettle();

    expect(find.text('Default Camera'), findsNothing);

    await tester.tap(find.bySemanticsLabel('Back to settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Scanner'));
    await tester.pumpAndSettle();

    expect(find.text('Default Camera'), findsOneWidget);
    expect(find.text('Elgato Facecam'), findsOneWidget);
  });

  testWidgets('Settings scanner advanced options match the web app model', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Scanner'));
    await tester.pumpAndSettle();

    expect(find.text('Scan Interval'), findsOneWidget);
    expect(find.text('720p'), findsOneWidget);
    expect(find.text('1080p'), findsOneWidget);
    expect(find.text('1440p'), findsOneWidget);
    expect(find.text('Fast'), findsWidgets);
    expect(find.text('Accurate'), findsOneWidget);

    expect(find.text('480p'), findsNothing);
    expect(find.text('2K'), findsNothing);
    expect(find.text('4K'), findsNothing);
    expect(find.text('Normal'), findsNothing);
    expect(find.text('No Duplicates'), findsNothing);
    expect(find.text('Unrestricted'), findsNothing);
  });

  testWidgets('mobile default camera selector saves front camera', (
    tester,
  ) async {
    MobileCameraFacingPreference? savedFacing;
    const palette = SettingsSectionPalette(
      isDarkMode: true,
      primaryColor: AirQrTheme.accentBlue,
      cardBackgroundColor: Color(0xFF202830),
      fieldBackgroundColor: Color(0xFF303840),
      primaryTextColor: Colors.white,
      secondaryTextColor: Color(0xFFB8C0C8),
      subtleBorderColor: Color(0xFF46505A),
      segmentedBackgroundColor: Color(0xFF303840),
      clearButtonBackgroundColor: Color(0xFF303840),
      clearButtonForegroundColor: Colors.white,
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SettingsDefaultCameraTile(
            palette: palette,
            supportsDesktopCameraSelection: false,
            desktopCameraDevices: const <String>[],
            selectedDesktopCameraName: null,
            mobileCameraFacing: MobileCameraFacingPreference.back,
            onSaveDesktopCameraPreference: (_) async {},
            onRefreshDesktopCameraDevices: () async {},
            onSaveMobileCameraPreference: (facing) async {
              savedFacing = facing;
            },
          ),
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('settings-mobile-default-camera')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Front Camera').last);
    await tester.pumpAndSettle();

    expect(savedFacing, MobileCameraFacingPreference.front);
  });

  testWidgets('Settings scanner presets include the web silent preset', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Scanner'));
    await tester.pumpAndSettle();

    expect(find.text('Silent'), findsOneWidget);
    expect(find.text('No sounds or vibrations'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'check_circle',
      ),
      findsOneWidget,
    );
  });

  testWidgets('Settings sync actions use AirQR icons like the web app', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
        syncSettings: const SyncSettings(enabled: true),
        desktopCameraSelection: const DesktopCameraSelectionState(
          devices: <String>[],
          selectedDeviceName: null,
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Server sync'));
    await tester.pumpAndSettle();

    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'wifi_tethering',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'sync',
      ),
      findsOneWidget,
    );
    expect(find.text('Sync'), findsOneWidget);

    final connectionButtonFinder = find.ancestor(
      of: find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'wifi_tethering',
      ),
      matching: find.byWidgetPredicate((widget) => widget is ButtonStyleButton),
    );
    expect(connectionButtonFinder, findsOneWidget);
    final connectionButton = tester.widget<ButtonStyleButton>(
      connectionButtonFinder,
    );
    expect(
      connectionButton.style?.backgroundColor?.resolve(<WidgetState>{}),
      AirQrTheme.lightPrimaryButtonSurface,
    );
    expect(
      connectionButton.style?.foregroundColor?.resolve(<WidgetState>{}),
      AirQrTheme.lightTextPrimary,
    );

    final syncButtonFinder = find.byKey(const Key('settings-sync-button'));
    final syncButton = tester.widget<ButtonStyleButton>(syncButtonFinder);
    expect(
      syncButton.style?.backgroundColor?.resolve(<WidgetState>{}),
      AirQrTheme.lightActionSurface,
    );
    expect(
      syncButton.style?.foregroundColor?.resolve(<WidgetState>{}),
      AirQrTheme.lightTextPrimary,
    );

    final connectionRect = tester.getRect(
      find.byKey(const Key('settings-connection-button')),
    );
    final syncRect = tester.getRect(syncButtonFinder);
    expect(syncRect.top, connectionRect.top);
    expect(syncRect.bottom, connectionRect.bottom);
    expect(syncRect.left, greaterThan(connectionRect.right));

    final syncLabel = tester.widget<Text>(find.text('Sync'));
    expect(syncLabel.maxLines, 1);
    expect(syncLabel.textAlign, TextAlign.center);

    final actionIcons = tester
        .widgetList<AirQrIcon>(
          find.byWidgetPredicate(
            (widget) =>
                widget is AirQrIcon &&
                (widget.name == 'wifi_tethering' || widget.name == 'sync'),
          ),
        )
        .toList();
    expect(actionIcons, hasLength(2));
    for (final icon in actionIcons) {
      expect(icon.exactColor, isTrue);
      expect(icon.color, AirQrTheme.lightTextPrimary);
    }

    final syncSwitch = tester.widget<Switch>(find.byType(Switch).first);
    expect(
      syncSwitch.thumbColor?.resolve(<WidgetState>{WidgetState.selected}),
      Colors.white,
    );
    expect(
      syncSwitch.trackColor?.resolve(<WidgetState>{WidgetState.selected}),
      AirQrTheme.lightSwitchSelectedTrack,
    );
  });

  testWidgets('Settings local server action stacks cleanly on mobile', (
    tester,
  ) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(390, 844));
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
        syncSettings: const SyncSettings(enabled: true),
        desktopCameraSelection: const DesktopCameraSelectionState(
          devices: <String>[],
          selectedDeviceName: null,
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Server sync'));
    await tester.pumpAndSettle();

    final title = find.text('Local server');
    final subtitle = find.text('Start the built-in sync server from this app.');
    final action = find.byKey(const Key('local-server-action-button'));

    expect(title, findsOneWidget);
    expect(subtitle, findsOneWidget);
    expect(action, findsOneWidget);
    expect(
      find.descendant(of: action, matching: find.byType(AirQrIcon)),
      findsNothing,
    );
    expect(
      tester.widget<Text>(find.text('Launch local server')).textAlign,
      TextAlign.center,
    );
    expect(tester.getSize(title).width, greaterThan(80));
    expect(
      tester.getTopLeft(action).dy,
      greaterThan(tester.getBottomLeft(subtitle).dy),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'Settings sync can launch a local server from a credential modal',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final localServerController = _FakeLocalSyncServerController();
      final controller = _FakeSettingsPageController(
        SettingsPageSnapshot(
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
          syncSettings: const SyncSettings(enabled: true),
          desktopCameraSelection: const DesktopCameraSelectionState(
            devices: <String>[],
            selectedDeviceName: null,
          ),
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: SettingsPage(
            settingsChangedNotifier: ValueNotifier<int>(0),
            pageController: controller,
            localServerController: localServerController,
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      await tester.tap(find.text('Server sync'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Launch local server'));
      await tester.pumpAndSettle();

      expect(
        tester
            .widget<TextField>(find.byKey(const Key('local-server-username')))
            .controller
            ?.text,
        'admin',
      );
      expect(
        tester
            .widget<TextField>(find.byKey(const Key('local-server-password')))
            .controller
            ?.text,
        'admin',
      );

      await tester.enterText(
        find.byKey(const Key('local-server-username')),
        'lucas',
      );
      await tester.enterText(
        find.byKey(const Key('local-server-password')),
        'secret',
      );
      await tester.enterText(
        find.byKey(const Key('local-server-port')),
        '9090',
      );
      await tester.tap(find.text('Start server'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));

      expect(localServerController.username, 'lucas');
      expect(localServerController.password, 'secret');
      expect(localServerController.port, 9090);
      expect(find.text('http://192.168.1.36:9090'), findsWidgets);
      expect(find.text('lucas'), findsOneWidget);

      expect(find.text('Stop server'), findsOneWidget);
      final stopButton = find.byKey(const Key('local-server-action-button'));
      expect(stopButton, findsOneWidget);
      final stopWidget = tester.widget<ButtonStyleButton>(stopButton);
      expect(stopWidget.onPressed, isNotNull);
      stopWidget.onPressed!();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      expect(localServerController.stopCount, 1);
      expect(localServerController.isRunning, isFalse);
      expect(find.text('Local server stopped.'), findsOneWidget);
    },
  );

  testWidgets(
    'Settings sync tests connection after launching the local server',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      var testConnectionCount = 0;
      final localServerController = _FakeLocalSyncServerController();
      final syncController = SettingsSyncController(
        saveSettings: (_) async {},
        clearCache: () {},
        testConnection: () async {
          testConnectionCount++;
          return SyncResult.ok();
        },
      );
      final controller = _FakeSettingsPageController(
        SettingsPageSnapshot(
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
          syncSettings: const SyncSettings(enabled: true),
          desktopCameraSelection: const DesktopCameraSelectionState(
            devices: <String>[],
            selectedDeviceName: null,
          ),
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: SettingsPage(
            settingsChangedNotifier: ValueNotifier<int>(0),
            pageController: controller,
            syncController: syncController,
            localServerController: localServerController,
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));

      await tester.tap(find.text('Server sync'));
      await tester.pumpAndSettle();
      expect(find.text('UNAVAILABLE'), findsOneWidget);

      await tester.tap(find.text('Launch local server'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Start server'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 450));

      expect(testConnectionCount, 1);
      expect(find.text('CONNECTED'), findsOneWidget);
      final connectedBadgeText = tester.widget<Text>(find.text('CONNECTED'));
      expect(connectedBadgeText.style?.fontSize, 10);
      expect(connectedBadgeText.style?.fontWeight, FontWeight.w600);
      expect(connectedBadgeText.style?.letterSpacing, 0.2);

      final connectedBadge = tester.widget<AnimatedContainer>(
        find.ancestor(
          of: find.text('CONNECTED'),
          matching: find.byType(AnimatedContainer),
        ),
      );
      expect(
        connectedBadge.padding,
        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      );
      expect(find.text('Connected!'), findsOneWidget);
    },
  );

  testWidgets('Settings sync includes the server file export controls', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _FakeSettingsPageController(
      SettingsPageSnapshot(
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
        syncSettings: const SyncSettings(
          enabled: true,
          serverUrl: 'https://airqr.pgnrd.fr',
          username: 'admin',
          password: 'secret',
        ),
        desktopCameraSelection: const DesktopCameraSelectionState(
          devices: <String>[],
          selectedDeviceName: null,
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: SettingsPage(
          settingsChangedNotifier: ValueNotifier<int>(0),
          pageController: controller,
          exportConfigController: _FakeSettingsExportConfigController(
            const SettingsExportConfig(
              exportDir: r'C:\AirQR-Files',
              effectiveDir: r'C:\AirQR-Files',
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    await tester.tap(find.text('Server sync'));
    await tester.pumpAndSettle();

    expect(find.text('FILE EXPORT (SERVER)'), findsOneWidget);
    expect(find.text('Enable file export'), findsOneWidget);
    expect(find.text('Export scanned files'), findsOneWidget);
    expect(find.text('Export generated files'), findsOneWidget);
    expect(find.text('Export Directory (PC or NAS path)'), findsOneWidget);
    expect(find.text('Save'), findsOneWidget);
    expect(find.textContaining('Export path ready:'), findsOneWidget);

    final headerLeft = tester.getTopLeft(find.text('FILE EXPORT (SERVER)')).dx;
    final cardLeft = tester
        .getTopLeft(find.byType(SettingsFileExportSection))
        .dx;
    expect(headerLeft - cardLeft, lessThan(80));
  });
}
