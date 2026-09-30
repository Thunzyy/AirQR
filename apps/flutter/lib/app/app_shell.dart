import 'package:flutter/material.dart';

import '../decoder_page.dart';
import '../encoder_page.dart';
import '../airqr_icon.dart';
import '../airqr_theme.dart';
import '../history.dart';
import '../l10n/app_localizations.dart';
import '../resume_service.dart';
import '../settings_page.dart';
import '../widgets/airqr_press_feedback.dart';
import 'app_preferences.dart';

typedef ScannerPageBuilder =
    Widget Function({
      required ValueNotifier<int> settingsChangedNotifier,
      required bool isActive,
    });

Duration _animationDuration(BuildContext context) =>
    MediaQuery.disableAnimationsOf(context)
    ? Duration.zero
    : const Duration(milliseconds: 300);

ThemeData buildAirQrLightTheme() {
  return ThemeData(
    colorScheme: const ColorScheme.light(
      primary: AirQrTheme.accentBlue,
      secondary: AirQrTheme.success,
      surface: AirQrTheme.lightCard,
    ),
    scaffoldBackgroundColor: AirQrTheme.lightBackground,
    canvasColor: AirQrTheme.lightBackground,
    fontFamily: 'Manrope',
    textTheme: AirQrTheme.textTheme,
    iconTheme: const IconThemeData(color: AirQrTheme.lightIconPrimary),
    switchTheme: _airQrSwitchTheme(
      selectedTrack: AirQrTheme.lightSwitchSelectedTrack,
      inactiveThumb: AirQrTheme.lightTextPrimary.withValues(alpha: 0.72),
      inactiveTrack: AirQrTheme.lightTextSecondary.withValues(alpha: 0.22),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AirQrTheme.lightSwitchSelectedTrack,
    ),
    // Flutter ThemeData stores extensions as ThemeExtension<dynamic>.
    // ignore: avoid_annotating_with_dynamic
    extensions: const <ThemeExtension<dynamic>>[AirQrTypography.standard],
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ButtonStyle(
        textStyle: WidgetStatePropertyAll(
          AirQrTypography.standard.primaryAction,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        textStyle: WidgetStatePropertyAll(
          AirQrTypography.standard.primaryAction,
        ),
      ),
    ),
    useMaterial3: true,
  );
}

ThemeData buildAirQrDarkTheme() {
  return ThemeData(
    colorScheme: const ColorScheme.dark(
      primary: AirQrTheme.accentBlue,
      secondary: AirQrTheme.success,
      surface: AirQrTheme.darkCard,
    ),
    scaffoldBackgroundColor: AirQrTheme.darkBackground,
    canvasColor: AirQrTheme.darkBackground,
    fontFamily: 'Manrope',
    textTheme: AirQrTheme.textTheme,
    iconTheme: const IconThemeData(color: AirQrTheme.darkIconPrimary),
    switchTheme: _airQrSwitchTheme(
      selectedTrack: AirQrTheme.darkSwitchSelectedTrack,
      inactiveThumb: AirQrTheme.darkTextPrimary.withValues(alpha: 0.72),
      inactiveTrack: AirQrTheme.darkTextSecondary.withValues(alpha: 0.22),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AirQrTheme.darkSwitchSelectedTrack,
    ),
    // Flutter ThemeData stores extensions as ThemeExtension<dynamic>.
    // ignore: avoid_annotating_with_dynamic
    extensions: const <ThemeExtension<dynamic>>[AirQrTypography.standard],
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ButtonStyle(
        textStyle: WidgetStatePropertyAll(
          AirQrTypography.standard.primaryAction,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        textStyle: WidgetStatePropertyAll(
          AirQrTypography.standard.primaryAction,
        ),
      ),
    ),
    useMaterial3: true,
  );
}

SwitchThemeData _airQrSwitchTheme({
  required Color selectedTrack,
  required Color inactiveThumb,
  required Color inactiveTrack,
}) {
  Color disabled(Color color) => color.withValues(alpha: color.a * 0.38);

  return SwitchThemeData(
    thumbColor: WidgetStateProperty.resolveWith((states) {
      final color = states.contains(WidgetState.selected)
          ? Colors.white
          : inactiveThumb;
      return states.contains(WidgetState.disabled) ? disabled(color) : color;
    }),
    trackColor: WidgetStateProperty.resolveWith((states) {
      final color = states.contains(WidgetState.selected)
          ? selectedTrack
          : inactiveTrack;
      return states.contains(WidgetState.disabled) ? disabled(color) : color;
    }),
    trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
  );
}

class MyApp extends StatefulWidget {
  final ScannerPageBuilder buildScannerPage;

  const MyApp({super.key, required this.buildScannerPage});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  final AppPreferencesController _appPreferences = AppPreferencesController();

  @override
  void initState() {
    super.initState();
    _appPreferences.load();
  }

  @override
  void dispose() {
    _appPreferences.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _appPreferences,
      builder: (context, child) {
        return AppPreferencesScope(
          controller: _appPreferences,
          child: MaterialApp(
            title: 'AirQR',
            theme: buildAirQrLightTheme(),
            darkTheme: buildAirQrDarkTheme(),
            themeMode: _appPreferences.themeMode,
            locale: _appPreferences.locale,
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            home: MainPage(buildScannerPage: widget.buildScannerPage),
          ),
        );
      },
    );
  }
}

class MainPage extends StatefulWidget {
  final ScannerPageBuilder buildScannerPage;

  const MainPage({super.key, required this.buildScannerPage});

  @override
  State<MainPage> createState() => _MainPageState();
}

class _MainPageState extends State<MainPage> {
  int _currentIndex = 2;
  int _settingsSectionRequestRevision = 0;
  SettingsPageSectionTarget? _requestedSettingsSection;
  final ValueNotifier<int> _settingsChangedNotifier = ValueNotifier<int>(0);

  List<Widget> _buildPages() {
    return [
      EncoderPage(onOpenOfflineWebSettings: _openOfflineWebSettings),
      const DecoderPage(),
      widget.buildScannerPage(
        settingsChangedNotifier: _settingsChangedNotifier,
        isActive: _currentIndex == 2,
      ),
      HistoryPage(
        onResumeRequested: _onResumeRequested,
        isActive: _currentIndex == 3,
      ),
      SettingsPage(
        settingsChangedNotifier: _settingsChangedNotifier,
        isActive: _currentIndex == 4,
        requestedSection: _requestedSettingsSection,
        requestedSectionRevision: _settingsSectionRequestRevision,
      ),
    ];
  }

  void _openOfflineWebSettings() {
    setState(() {
      _requestedSettingsSection = SettingsPageSectionTarget.offlineWeb;
      _settingsSectionRequestRevision += 1;
      _currentIndex = 4;
    });
  }

  void _onResumeRequested(String scanId) {
    ResumeService().requestResume(scanId);
    setState(() {
      _currentIndex = 2;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final pages = _buildPages();
    final items = [
      AirQrNavItem(iconName: 'qr_code_2', label: l10n.nav_encoder),
      AirQrNavItem(iconName: 'qr_code_scanner', label: l10n.nav_decoder),
      AirQrNavItem(
        iconName: 'center_focus_weak',
        assetPath: 'assets/logo.png',
        label: l10n.nav_scanner,
      ),
      AirQrNavItem(iconName: 'history', label: l10n.nav_history),
      AirQrNavItem(iconName: 'settings', label: l10n.nav_settings),
    ];

    void selectDestination(int index) {
      setState(() {
        _currentIndex = index;
      });
    }

    final pageStack = IndexedStack(
      key: const Key('airqr-page-stack'),
      index: _currentIndex,
      sizing: StackFit.expand,
      children: pages,
    );

    return Scaffold(
      extendBody: true,
      backgroundColor: AirQrTheme.background(context),
      body: MediaQuery.removePadding(
        context: context,
        removeBottom: true,
        child: pageStack,
      ),
      bottomNavigationBar: AirQrBottomNav(
        currentIndex: _currentIndex,
        onTap: selectDestination,
        items: items,
      ),
    );
  }
}

class AirQrNavItem {
  final String iconName;
  final String? assetPath;
  final String label;

  const AirQrNavItem({
    required this.iconName,
    this.assetPath,
    required this.label,
  });
}

double _airQrBottomNavHeight(BuildContext context) {
  final scaledLabelHeight = MediaQuery.textScalerOf(context).scale(12);
  return scaledLabelHeight > 18
      ? 22 + 34 + 4 + (scaledLabelHeight * 1.15 * 2)
      : 84.0;
}

class AirQrBottomNav extends StatelessWidget {
  static const double _activeIndicatorExtraWidth = 18;
  static const double _activeIndicatorInset = _activeIndicatorExtraWidth / 2;

  final int currentIndex;
  final ValueChanged<int> onTap;
  final List<AirQrNavItem> items;

  const AirQrBottomNav({
    super.key,
    required this.currentIndex,
    required this.onTap,
    required this.items,
  });

  @override
  Widget build(BuildContext context) {
    final active = AirQrTheme.navActive(context);
    final text = AirQrTheme.textPrimary(context);
    final muted = AirQrTheme.textSecondary(context);
    final navHeight = _airQrBottomNavHeight(context);
    final contentHeight = navHeight - 16;

    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(16, 0, 16, 14),
      child: SizedBox(
        height: navHeight,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Container(
              key: const Key('airqr-bottom-nav'),
              height: navHeight,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              decoration: BoxDecoration(
                color: AirQrTheme.navSurface(context).withValues(alpha: 1),
                borderRadius: BorderRadius.circular(34),
              ),
              clipBehavior: Clip.none,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final itemWidth = constraints.maxWidth / items.length;
                  return Stack(
                    clipBehavior: Clip.none,
                    children: [
                      AnimatedPositioned(
                        duration: _animationDuration(context),
                        curve: const Cubic(0.2, 0.8, 0.2, 1),
                        left:
                            (itemWidth * currentIndex) - _activeIndicatorInset,
                        top: 0,
                        width: itemWidth + _activeIndicatorExtraWidth,
                        height: contentHeight,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 0.5),
                          child: DecoratedBox(
                            key: const Key('airqr-bottom-nav-active-indicator'),
                            decoration: ShapeDecoration(
                              color: active,
                              shape: const StadiumBorder(),
                            ),
                          ),
                        ),
                      ),
                      Row(
                        children: [
                          for (var index = 0; index < items.length; index++)
                            Expanded(
                              child: _AirQrBottomNavButton(
                                key: Key('airqr-bottom-nav-item-$index'),
                                item: items[index],
                                selected: index == currentIndex,
                                selectedColor: text,
                                unselectedColor: muted,
                                onTap: () => onTap(index),
                              ),
                            ),
                        ],
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AirQrBottomNavButton extends StatelessWidget {
  final AirQrNavItem item;
  final bool selected;
  final Color selectedColor;
  final Color unselectedColor;
  final VoidCallback onTap;

  const _AirQrBottomNavButton({
    super.key,
    required this.item,
    required this.selected,
    required this.selectedColor,
    required this.unselectedColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected ? selectedColor : unselectedColor;
    final usesTwoLineLabel = MediaQuery.textScalerOf(context).scale(12) > 18;
    return Semantics(
      button: true,
      selected: selected,
      label: item.label,
      onTap: onTap,
      child: ExcludeSemantics(
        child: AirQrPressFeedback(
          builder: (context, statesController, child) => Material(
            color: Colors.transparent,
            child: InkWell(
              statesController: statesController,
              onTap: onTap,
              customBorder: const StadiumBorder(),
              overlayColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.focused)) {
                  return AirQrTheme.textPrimary(
                    context,
                  ).withValues(alpha: 0.12);
                }
                return Colors.transparent;
              }),
              child: child,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(2, 0, 2, 4),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  SizedBox(
                    height: 34,
                    child: Center(
                      child: item.assetPath != null
                          ? Image.asset(
                              item.assetPath!,
                              width: selected ? 34 : 31,
                              height: selected ? 34 : 31,
                              fit: BoxFit.contain,
                            )
                          : AirQrIcon(
                              item.iconName,
                              size: selected ? 28 : 25,
                              color: color,
                            ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  if (usesTwoLineLabel)
                    Text(
                      item.label,
                      maxLines: 2,
                      textAlign: TextAlign.center,
                      style: AirQrTypography.of(context).compactStatus.copyWith(
                        color: color,
                        height: 1.15,
                        fontWeight: selected
                            ? FontWeight.w800
                            : FontWeight.w600,
                      ),
                    )
                  else
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        item.label,
                        maxLines: 1,
                        softWrap: false,
                        textAlign: TextAlign.center,
                        style: AirQrTypography.of(context).compactStatus
                            .copyWith(
                              color: color,
                              height: 1.15,
                              fontWeight: selected
                                  ? FontWeight.w800
                                  : FontWeight.w600,
                            ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
