import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/scanner_config.dart';
import 'package:airqr_mobile/settings_page_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

void main() {
  test('settingsTheme helpers map both ways', () {
    expect(settingsThemeDropdownValue(ThemeMode.system), 'system');
    expect(settingsThemeDropdownValue(ThemeMode.light), 'light');
    expect(settingsThemeDropdownValue(ThemeMode.dark), 'dark');

    expect(settingsThemeModeFromDropdown('system'), ThemeMode.system);
    expect(settingsThemeModeFromDropdown('light'), ThemeMode.light);
    expect(settingsThemeModeFromDropdown('dark'), ThemeMode.dark);
  });

  test('settingsResolution helpers map both ways', () {
    expect(settingsResolutionToString(CameraResolutionPreset.low), '480p');
    expect(settingsResolutionToString(CameraResolutionPreset.medium), '720p');
    expect(
      settingsResolutionToString(CameraResolutionPreset.veryHigh),
      '1440p',
    );
    expect(
      settingsResolutionFromString('1440p'),
      CameraResolutionPreset.veryHigh,
    );
    expect(
      settingsResolutionFromString('unexpected'),
      CameraResolutionPreset.high,
    );
  });

  test('settingsDetectionSpeed helpers map both ways', () {
    final l10n = lookupAppLocalizations(const Locale('en'));

    expect(
      settingsDetectionSpeedToString(DetectionSpeed.normal, l10n),
      l10n.settings_accurate,
    );
    expect(
      settingsDetectionSpeedToString(DetectionSpeed.noDuplicates, l10n),
      l10n.settings_fast,
    );
    expect(
      settingsDetectionSpeedFromString(l10n.settings_accurate, l10n),
      DetectionSpeed.normal,
    );
    expect(
      settingsDetectionSpeedFromString(l10n.settings_fast, l10n),
      DetectionSpeed.noDuplicates,
    );
    expect(
      settingsDetectionSpeedFromString('unexpected', l10n),
      DetectionSpeed.noDuplicates,
    );
  });

  test('settingsLanguageDropdownValue falls back to system', () {
    expect(settingsLanguageDropdownValue(const Locale('fr')), 'fr');
    expect(settingsLanguageDropdownValue(const Locale('es')), 'system');
    expect(settingsLanguageDropdownValue(null), 'system');
  });

  test('settings status and logging copy is localized', () {
    final en = lookupAppLocalizations(const Locale('en'));
    final fr = lookupAppLocalizations(const Locale('fr'));

    expect(en.settings_serverConnected, 'CONNECTED');
    expect(fr.settings_serverConnected, 'CONNECTÉ');
    expect(en.settings_serverUnavailable, 'UNAVAILABLE');
    expect(fr.settings_serverUnavailable, 'INDISPONIBLE');
    expect(en.settings_loggingSection, 'LOGGING');
    expect(fr.settings_loggingSection, 'JOURNALISATION');
    expect(en.settings_resetToDefaults, 'Reset to defaults');
    expect(fr.settings_resetToDefaults, 'Rétablir les valeurs par défaut');
    expect(en.settings_backToSettings, 'Back to settings');
    expect(fr.settings_backToSettings, 'Retour aux réglages');
    expect(en.settings_syncEnabled, 'Sync: enabled');
    expect(fr.settings_syncEnabled, 'Sync : activée');
    expect(en.settings_syncDisabled, 'Sync: disabled');
    expect(fr.settings_syncDisabled, 'Sync : désactivée');
    expect(en.settings_encoderMenu, 'Encoder');
    expect(fr.settings_encoderMenu, 'Encodeur');
    expect(en.settings_serverSyncMenu, 'Server sync');
    expect(fr.settings_serverSyncMenu, 'Synchronisation serveur');
  });
}
