import 'package:shared_preferences/shared_preferences.dart';

import 'camera_preferences.dart';
import 'encoder_defaults.dart';
import 'scanner_config.dart';
import 'sync_settings.dart';

class EncoderSettingsData {
  final int fps;
  final String ecc;
  final int packetSize;
  final double raptorqOverhead;
  final int targetSize;
  final bool compressionEnabled;
  final bool forceChunkMode;
  final int customChunkSize;

  const EncoderSettingsData({
    required this.fps,
    required this.ecc,
    required this.packetSize,
    required this.raptorqOverhead,
    required this.targetSize,
    required this.compressionEnabled,
    required this.forceChunkMode,
    this.customChunkSize = 10,
  });
}

class DesktopCameraSelectionState {
  final List<String> devices;
  final String? selectedDeviceName;

  const DesktopCameraSelectionState({
    required this.devices,
    required this.selectedDeviceName,
  });
}

class SettingsPageSnapshot {
  final ScannerPreset selectedPreset;
  final ScannerSettings scannerSettings;
  final EncoderSettingsData encoderSettings;
  final SyncSettings syncSettings;
  final DesktopCameraSelectionState desktopCameraSelection;
  final MobileCameraFacingPreference mobileCameraFacing;

  const SettingsPageSnapshot({
    required this.selectedPreset,
    required this.scannerSettings,
    required this.encoderSettings,
    required this.syncSettings,
    required this.desktopCameraSelection,
    this.mobileCameraFacing = MobileCameraFacingPreference.back,
  });
}

typedef LoadDesktopCameraDevicesCallback = Future<List<String>> Function();
typedef LoadPreferredDesktopCameraNameCallback = Future<String?> Function();
typedef SavePreferredDesktopCameraNameCallback = Future<void> Function(String?);
typedef LoadPreferredMobileCameraFacingCallback =
    Future<MobileCameraFacingPreference> Function();
typedef SavePreferredMobileCameraFacingCallback =
    Future<void> Function(MobileCameraFacingPreference);

class SettingsPageController {
  final LoadDesktopCameraDevicesCallback _loadDesktopCameraDevices;
  final LoadPreferredDesktopCameraNameCallback _loadPreferredDesktopCameraName;
  final SavePreferredDesktopCameraNameCallback _savePreferredDesktopCameraName;
  final LoadPreferredMobileCameraFacingCallback
  _loadPreferredMobileCameraFacing;
  final SavePreferredMobileCameraFacingCallback
  _savePreferredMobileCameraFacing;

  SettingsPageController({
    LoadDesktopCameraDevicesCallback? loadDesktopCameraDevicesCallback,
    LoadPreferredDesktopCameraNameCallback?
    loadPreferredDesktopCameraNameCallback,
    SavePreferredDesktopCameraNameCallback?
    savePreferredDesktopCameraNameCallback,
    LoadPreferredMobileCameraFacingCallback?
    loadPreferredMobileCameraFacingCallback,
    SavePreferredMobileCameraFacingCallback?
    savePreferredMobileCameraFacingCallback,
  }) : _loadDesktopCameraDevices =
           loadDesktopCameraDevicesCallback ?? loadDesktopCameraDevices,
       _loadPreferredDesktopCameraName =
           loadPreferredDesktopCameraNameCallback ??
           loadPreferredDesktopCameraName,
       _savePreferredDesktopCameraName =
           savePreferredDesktopCameraNameCallback ??
           savePreferredDesktopCameraName,
       _loadPreferredMobileCameraFacing =
           loadPreferredMobileCameraFacingCallback ??
           loadPreferredMobileCameraFacing,
       _savePreferredMobileCameraFacing =
           savePreferredMobileCameraFacingCallback ??
           savePreferredMobileCameraFacing;

  Future<SettingsPageSnapshot> load() async {
    final prefs = await SharedPreferences.getInstance();
    final presetName = prefs.getString('scanner_preset') ?? 'fast';

    ScannerPreset selectedPreset;
    try {
      selectedPreset = ScannerPreset.values.byName(presetName);
    } catch (_) {
      selectedPreset = ScannerPreset.fast;
    }

    ScannerSettings scannerSettings;
    if (selectedPreset == ScannerPreset.custom) {
      final jsonString = prefs.getString('scanner_custom_settings');
      if (jsonString != null) {
        try {
          scannerSettings = ScannerSettings.fromJsonString(jsonString);
        } catch (_) {
          scannerSettings = ScannerSettings.fast();
        }
      } else {
        scannerSettings = ScannerSettings.fast();
      }
    } else {
      scannerSettings = ScannerSettings.fromPreset(selectedPreset);
    }

    final desktopCameraSelection = await loadDesktopCameraSelection();

    return SettingsPageSnapshot(
      selectedPreset: selectedPreset,
      scannerSettings: scannerSettings,
      encoderSettings: EncoderSettingsData(
        fps: prefs.getInt('encoder_fps') ?? EncoderDefaults.fps,
        ecc: prefs.getString('encoder_ecc') ?? EncoderDefaults.errorCorrection,
        packetSize:
            prefs.getInt('encoder_packet_size') ?? EncoderDefaults.packetSize,
        raptorqOverhead:
            prefs.getDouble('encoder_raptorq_overhead') ??
            EncoderDefaults.raptorqOverhead,
        targetSize:
            prefs.getInt('encoder_target_size') ?? EncoderDefaults.targetQrSize,
        compressionEnabled:
            prefs.getBool('encoder_compression') ??
            EncoderDefaults.compressionEnabled,
        forceChunkMode: prefs.getBool('encoder_force_chunk') ?? false,
        customChunkSize: prefs.getInt('encoder_custom_chunk_size') ?? 10,
      ),
      syncSettings: await SyncSettingsService.load(),
      desktopCameraSelection: desktopCameraSelection,
      mobileCameraFacing: await _loadPreferredMobileCameraFacing(),
    );
  }

  Future<void> saveSettings({
    required ScannerPreset selectedPreset,
    required ScannerSettings scannerSettings,
    required EncoderSettingsData encoderSettings,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('scanner_preset', selectedPreset.name);

    if (selectedPreset == ScannerPreset.custom) {
      await prefs.setString(
        'scanner_custom_settings',
        scannerSettings.toJsonString(),
      );
    }

    await prefs.setInt('encoder_fps', encoderSettings.fps);
    await prefs.setString('encoder_ecc', encoderSettings.ecc);
    await prefs.setInt('encoder_packet_size', encoderSettings.packetSize);
    await prefs.setDouble(
      'encoder_raptorq_overhead',
      encoderSettings.raptorqOverhead,
    );
    await prefs.setInt('encoder_target_size', encoderSettings.targetSize);
    await prefs.setBool(
      'encoder_compression',
      encoderSettings.compressionEnabled,
    );
    await prefs.setBool('encoder_force_chunk', encoderSettings.forceChunkMode);
    await prefs.setInt(
      'encoder_custom_chunk_size',
      encoderSettings.customChunkSize,
    );
  }

  Future<DesktopCameraSelectionState> loadDesktopCameraSelection() async {
    if (!supportsDesktopCameraSelection) {
      return const DesktopCameraSelectionState(
        devices: <String>[],
        selectedDeviceName: null,
      );
    }

    final devices = await _loadDesktopCameraDevices();
    final preferredDevice = await _loadPreferredDesktopCameraName();
    final effectiveDevice = devices.isEmpty
        ? null
        : (preferredDevice != null && devices.contains(preferredDevice)
              ? preferredDevice
              : devices.first);

    return DesktopCameraSelectionState(
      devices: devices,
      selectedDeviceName: effectiveDevice,
    );
  }

  Future<DesktopCameraSelectionState> saveDesktopCameraPreference(
    String? deviceName,
  ) async {
    await _savePreferredDesktopCameraName(deviceName);
    final devices = await _loadDesktopCameraDevices();
    return DesktopCameraSelectionState(
      devices: devices,
      selectedDeviceName: normalizeDesktopCameraName(deviceName),
    );
  }

  Future<MobileCameraFacingPreference> saveMobileCameraPreference(
    MobileCameraFacingPreference facing,
  ) async {
    await _savePreferredMobileCameraFacing(facing);
    return facing;
  }
}
