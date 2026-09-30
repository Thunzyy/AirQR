import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'l10n/app_localizations.dart';
import 'scanner_config.dart';

String settingsLanguageDropdownValue(Locale? locale) {
  if (locale == null) return 'system';
  const supportedLanguages = <String>['en', 'fr'];
  if (supportedLanguages.contains(locale.languageCode)) {
    return locale.languageCode;
  }
  return 'system';
}

String settingsThemeDropdownValue(ThemeMode themeMode) {
  switch (themeMode) {
    case ThemeMode.system:
      return 'system';
    case ThemeMode.light:
      return 'light';
    case ThemeMode.dark:
      return 'dark';
  }
}

ThemeMode settingsThemeModeFromDropdown(String value) {
  switch (value) {
    case 'light':
      return ThemeMode.light;
    case 'dark':
      return ThemeMode.dark;
    default:
      return ThemeMode.system;
  }
}

String settingsResolutionToString(CameraResolutionPreset resolution) {
  switch (resolution) {
    case CameraResolutionPreset.low:
      return '480p';
    case CameraResolutionPreset.medium:
      return '720p';
    case CameraResolutionPreset.high:
      return '1080p';
    case CameraResolutionPreset.veryHigh:
      return '1440p';
    case CameraResolutionPreset.ultraHigh:
      return '4K';
  }
}

CameraResolutionPreset settingsResolutionFromString(String value) {
  switch (value) {
    case '480p':
      return CameraResolutionPreset.low;
    case '720p':
      return CameraResolutionPreset.medium;
    case '1080p':
      return CameraResolutionPreset.high;
    case '1440p':
    case '2K':
      return CameraResolutionPreset.veryHigh;
    case '4K':
      return CameraResolutionPreset.ultraHigh;
    default:
      return CameraResolutionPreset.high;
  }
}

String settingsDetectionSpeedToString(
  DetectionSpeed detectionSpeed,
  AppLocalizations l10n,
) {
  switch (detectionSpeed) {
    case DetectionSpeed.normal:
      return l10n.settings_accurate;
    case DetectionSpeed.noDuplicates:
    case DetectionSpeed.unrestricted:
      return l10n.settings_fast;
  }
}

DetectionSpeed settingsDetectionSpeedFromString(
  String value,
  AppLocalizations l10n,
) {
  if (value == l10n.settings_accurate) {
    return DetectionSpeed.normal;
  }
  if (value == l10n.settings_fast) {
    return DetectionSpeed.noDuplicates;
  }
  if (value == l10n.settings_detectionNormal) {
    return DetectionSpeed.normal;
  }
  if (value == l10n.settings_detectionNoDuplicates) {
    return DetectionSpeed.noDuplicates;
  }
  if (value == l10n.settings_detectionUnrestricted) {
    return DetectionSpeed.unrestricted;
  }
  return DetectionSpeed.noDuplicates;
}
