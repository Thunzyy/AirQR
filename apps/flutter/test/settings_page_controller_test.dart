import 'package:airqr_mobile/scanner_config.dart';
import 'package:airqr_mobile/settings_page_controller.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SettingsPageController', () {
    setUp(() {
      SharedPreferences.setMockInitialValues(<String, Object>{});
    });

    test('load uses encoder defaults when preferences are empty', () async {
      final controller = SettingsPageController(
        loadDesktopCameraDevicesCallback: () async => const <String>[],
        loadPreferredDesktopCameraNameCallback: () async => null,
      );

      final settings = (await controller.load()).encoderSettings;

      expect(settings.fps, 10);
      expect(settings.packetSize, 1500);
      expect(settings.ecc, 'LOW');
      expect(settings.targetSize, 177);
      expect(settings.raptorqOverhead, 1.3);
      expect(settings.compressionEnabled, isTrue);
    });

    test('load restores persisted scanner and encoder settings', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'scanner_preset': 'custom',
        'scanner_custom_settings': ScannerSettings(
          detectionSpeed: DetectionSpeed.normal,
          detectionTimeoutMs: 450,
          resolutionPreset: CameraResolutionPreset.high,
          formats: const [BarcodeFormat.qrCode],
          torchEnabled: true,
        ).toJsonString(),
        'encoder_fps': 18,
        'encoder_ecc': 'HIGH',
        'encoder_packet_size': 1400,
        'encoder_raptorq_overhead': 1.35,
        'encoder_target_size': 220,
        'encoder_compression': false,
        'encoder_force_chunk': true,
      });

      final controller = SettingsPageController(
        loadDesktopCameraDevicesCallback: () async => const <String>[],
        loadPreferredDesktopCameraNameCallback: () async => null,
      );

      final snapshot = await controller.load();

      expect(snapshot.selectedPreset, ScannerPreset.custom);
      expect(snapshot.scannerSettings.detectionTimeoutMs, 450);
      expect(snapshot.scannerSettings.torchEnabled, isTrue);
      expect(snapshot.encoderSettings.fps, 18);
      expect(snapshot.encoderSettings.ecc, 'HIGH');
      expect(snapshot.encoderSettings.packetSize, 1400);
      expect(snapshot.encoderSettings.targetSize, 220);
      expect(snapshot.encoderSettings.raptorqOverhead, 1.35);
      expect(snapshot.encoderSettings.compressionEnabled, isFalse);
      expect(snapshot.encoderSettings.forceChunkMode, isTrue);
    });

    test('saveSettings persists scanner preset and encoder values', () async {
      final controller = SettingsPageController(
        loadDesktopCameraDevicesCallback: () async => const <String>[],
        loadPreferredDesktopCameraNameCallback: () async => null,
      );

      await controller.saveSettings(
        selectedPreset: ScannerPreset.fast,
        scannerSettings: ScannerSettings.fast(),
        encoderSettings: const EncoderSettingsData(
          fps: 12,
          ecc: 'LOW',
          packetSize: 900,
          raptorqOverhead: 1.1,
          targetSize: 180,
          compressionEnabled: true,
          forceChunkMode: false,
        ),
      );

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('scanner_preset'), 'fast');
      expect(prefs.getInt('encoder_fps'), 12);
      expect(prefs.getString('encoder_ecc'), 'LOW');
      expect(prefs.getInt('encoder_packet_size'), 900);
    });

    test('loadDesktopCameraSelection prefers saved camera when available', () async {
      final controller = SettingsPageController(
        loadDesktopCameraDevicesCallback: () async => const <String>[
          'Front Cam',
          'Rear Cam',
        ],
        loadPreferredDesktopCameraNameCallback: () async => 'Rear Cam',
      );

      final selection = await controller.loadDesktopCameraSelection();

      expect(selection.devices, hasLength(2));
      expect(selection.selectedDeviceName, 'Rear Cam');
    });
  });
}
