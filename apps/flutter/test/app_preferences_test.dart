import 'package:airqr_mobile/app/app_preferences.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AppPreferencesController', () {
    setUp(() {
      SharedPreferences.setMockInitialValues(<String, Object>{});
    });

    test('loads locale and theme mode from shared preferences', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        kLanguagePreferenceKey: 'fr',
        kThemePreferenceKey: 'dark',
      });

      final controller = AppPreferencesController();

      await controller.load();

      expect(controller.locale, const Locale('fr'));
      expect(controller.themeMode, ThemeMode.dark);
    });

    test('persists locale changes and clears system locale preference', () async {
      final controller = AppPreferencesController();
      final prefs = await SharedPreferences.getInstance();

      await controller.setLocale(const Locale('en'));
      expect(controller.locale, const Locale('en'));
      expect(prefs.getString(kLanguagePreferenceKey), 'en');

      await controller.setLocale(null);
      expect(controller.locale, isNull);
      expect(prefs.containsKey(kLanguagePreferenceKey), isFalse);
    });

    test('persists theme mode changes', () async {
      final controller = AppPreferencesController();
      final prefs = await SharedPreferences.getInstance();

      await controller.setThemeMode(ThemeMode.light);
      expect(controller.themeMode, ThemeMode.light);
      expect(prefs.getString(kThemePreferenceKey), 'light');
    });
  });
}
