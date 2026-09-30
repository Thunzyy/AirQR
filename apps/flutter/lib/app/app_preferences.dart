import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Key for storing language preference (aligned with web app)
const String kLanguagePreferenceKey = 'airqr_language';

/// Key for storing theme preference (aligned with web app)
const String kThemePreferenceKey = 'airqr_theme';

class AppPreferencesController extends ChangeNotifier {
  Locale? _locale;
  ThemeMode _themeMode = ThemeMode.system;

  Locale? get locale => _locale;
  ThemeMode get themeMode => _themeMode;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final languageCode = prefs.getString(kLanguagePreferenceKey);
    final nextLocale = languageCode == null ? null : Locale(languageCode);
    final nextThemeMode = _themeModeFromString(
      prefs.getString(kThemePreferenceKey),
    );

    final changed = nextLocale != _locale || nextThemeMode != _themeMode;
    _locale = nextLocale;
    _themeMode = nextThemeMode;

    if (changed) {
      notifyListeners();
    }
  }

  Future<void> setLocale(Locale? locale) async {
    final prefs = await SharedPreferences.getInstance();
    if (locale == null) {
      await prefs.remove(kLanguagePreferenceKey);
    } else {
      await prefs.setString(kLanguagePreferenceKey, locale.languageCode);
    }

    if (_locale == locale) {
      return;
    }

    _locale = locale;
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode themeMode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(kThemePreferenceKey, _themeModeToString(themeMode));

    if (_themeMode == themeMode) {
      return;
    }

    _themeMode = themeMode;
    notifyListeners();
  }

  static ThemeMode _themeModeFromString(String? value) {
    switch (value) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }

  static String _themeModeToString(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'light';
      case ThemeMode.dark:
        return 'dark';
      case ThemeMode.system:
        return 'system';
    }
  }
}

class AppPreferencesScope extends InheritedNotifier<AppPreferencesController> {
  const AppPreferencesScope({
    super.key,
    required AppPreferencesController controller,
    required super.child,
  }) : super(notifier: controller);

  static AppPreferencesController? maybeControllerOf(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<AppPreferencesScope>()
        ?.notifier;
  }

  static AppPreferencesController controllerOf(BuildContext context) {
    final controller = maybeControllerOf(context);
    assert(
      controller != null,
      'AppPreferencesScope.controllerOf called with no AppPreferencesScope in context.',
    );
    return controller!;
  }

  static void setLocale(BuildContext context, Locale? locale) {
    controllerOf(context).setLocale(locale);
  }

  static Locale? getLocale(BuildContext context) {
    return maybeControllerOf(context)?.locale;
  }

  static void setThemeMode(BuildContext context, ThemeMode themeMode) {
    controllerOf(context).setThemeMode(themeMode);
  }

  static ThemeMode getThemeMode(BuildContext context) {
    return maybeControllerOf(context)?.themeMode ?? ThemeMode.system;
  }
}
