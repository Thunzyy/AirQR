import 'package:shared_preferences/shared_preferences.dart';

import 'camera_preferences.dart' as camera_preferences;
import 'scanner_config.dart';

typedef ScannerLoadPreferencesCallback =
    Future<Map<String, Object?>> Function();
typedef ScannerLoadPreferredDesktopCameraNameCallback =
    Future<String?> Function();
typedef ScannerLoadPreferredMobileCameraFacingCallback =
    Future<camera_preferences.MobileCameraFacingPreference> Function();

class ScannerSettingsLoadState {
  final String? lastScannerSettingsSignature;
  final bool supportsMobileScanner;
  final bool supportsDesktopCamera;
  final bool hasController;

  const ScannerSettingsLoadState({
    required this.lastScannerSettingsSignature,
    required this.supportsMobileScanner,
    required this.supportsDesktopCamera,
    required this.hasController,
  });
}

class ScannerSettingsLoadResult {
  final ScannerPreset selectedPreset;
  final ScannerSettings currentSettings;
  final String? preferredDesktopCameraName;
  final camera_preferences.MobileCameraFacingPreference
  preferredMobileCameraFacing;
  final String nextScannerSettingsSignature;
  final bool needsControllerReload;

  const ScannerSettingsLoadResult({
    required this.selectedPreset,
    required this.currentSettings,
    required this.preferredDesktopCameraName,
    this.preferredMobileCameraFacing =
        camera_preferences.MobileCameraFacingPreference.back,
    required this.nextScannerSettingsSignature,
    required this.needsControllerReload,
  });
}

class ScannerSettingsController {
  final ScannerLoadPreferencesCallback _loadPreferences;
  final ScannerLoadPreferredDesktopCameraNameCallback
  _loadPreferredDesktopCameraName;
  final ScannerLoadPreferredMobileCameraFacingCallback
  _loadPreferredMobileCameraFacing;

  ScannerSettingsController({
    ScannerLoadPreferencesCallback? loadPreferences,
    ScannerLoadPreferredDesktopCameraNameCallback?
    loadPreferredDesktopCameraName,
    ScannerLoadPreferredMobileCameraFacingCallback?
    loadPreferredMobileCameraFacing,
  }) : _loadPreferences = loadPreferences ?? _defaultLoadPreferences,
       _loadPreferredDesktopCameraName =
           loadPreferredDesktopCameraName ??
           camera_preferences.loadPreferredDesktopCameraName,
       _loadPreferredMobileCameraFacing =
           loadPreferredMobileCameraFacing ??
           camera_preferences.loadPreferredMobileCameraFacing;

  Future<ScannerSettingsLoadResult> load({
    required ScannerSettingsLoadState state,
  }) async {
    final preferences = await _loadPreferences();
    final presetName = preferences['scanner_preset'] as String? ?? 'fast';

    final ScannerPreset selectedPreset;
    try {
      selectedPreset = ScannerPreset.values.byName(presetName);
    } catch (_) {
      return _buildResult(
        selectedPreset: ScannerPreset.fast,
        currentSettings: ScannerSettings.fast(),
        state: state,
      );
    }

    if (selectedPreset == ScannerPreset.custom) {
      final jsonString = preferences['scanner_custom_settings'] as String?;
      if (jsonString != null) {
        try {
          return _buildResult(
            selectedPreset: selectedPreset,
            currentSettings: ScannerSettings.fromJsonString(jsonString),
            state: state,
          );
        } catch (_) {
          return _buildResult(
            selectedPreset: ScannerPreset.fast,
            currentSettings: ScannerSettings.fast(),
            state: state,
          );
        }
      }
      return _buildResult(
        selectedPreset: ScannerPreset.fast,
        currentSettings: ScannerSettings.fast(),
        state: state,
      );
    }

    return _buildResult(
      selectedPreset: selectedPreset,
      currentSettings: ScannerSettings.fromPreset(selectedPreset),
      state: state,
    );
  }

  Future<ScannerSettingsLoadResult> _buildResult({
    required ScannerPreset selectedPreset,
    required ScannerSettings currentSettings,
    required ScannerSettingsLoadState state,
  }) async {
    final preferredDesktopCameraName = state.supportsDesktopCamera
        ? await _loadPreferredDesktopCameraName()
        : null;
    final preferredMobileCameraFacing = state.supportsMobileScanner
        ? await _loadPreferredMobileCameraFacing()
        : camera_preferences.MobileCameraFacingPreference.back;
    final nextSignature = computeSignature(
      selectedPreset,
      currentSettings,
      preferredMobileCameraFacing,
    );
    final scannerSettingsChanged =
        state.lastScannerSettingsSignature != nextSignature;
    final needsControllerReload =
        state.supportsMobileScanner &&
        (!state.hasController || scannerSettingsChanged);

    return ScannerSettingsLoadResult(
      selectedPreset: selectedPreset,
      currentSettings: currentSettings,
      preferredDesktopCameraName: preferredDesktopCameraName,
      preferredMobileCameraFacing: preferredMobileCameraFacing,
      nextScannerSettingsSignature: nextSignature,
      needsControllerReload: needsControllerReload,
    );
  }

  static String computeSignature(
    ScannerPreset preset,
    ScannerSettings settings, [
    camera_preferences.MobileCameraFacingPreference mobileCameraFacing =
        camera_preferences.MobileCameraFacingPreference.back,
  ]) {
    final formats = settings.formats.map((f) => f.index).join(',');
    return [
      preset.name,
      settings.detectionSpeed.index.toString(),
      settings.detectionTimeoutMs.toString(),
      settings.resolutionPreset.index.toString(),
      settings.torchEnabled ? '1' : '0',
      formats,
      mobileCameraFacing.name,
    ].join('|');
  }

  static Future<Map<String, Object?>> _defaultLoadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    return <String, Object?>{
      'scanner_preset': prefs.getString('scanner_preset'),
      'scanner_custom_settings': prefs.getString('scanner_custom_settings'),
    };
  }
}
