import 'package:airqr_mobile/scanner_config.dart';
import 'package:airqr_mobile/scanner_settings_controller.dart';
import 'package:airqr_mobile/camera_preferences.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ScannerSettingsController', () {
    setUp(() {
      SharedPreferences.setMockInitialValues(<String, Object>{});
    });

    test(
      'load selects custom scanner settings and requests reload when signature changes',
      () async {
        final controller = ScannerSettingsController(
          loadPreferences: () async => <String, Object?>{
            'scanner_preset': 'custom',
            'scanner_custom_settings': ScannerSettings(
              detectionSpeed: DetectionSpeed.normal,
              detectionTimeoutMs: 600,
              resolutionPreset: CameraResolutionPreset.high,
              formats: const <BarcodeFormat>[BarcodeFormat.qrCode],
              torchEnabled: true,
            ).toJsonString(),
          },
          loadPreferredDesktopCameraName: () async => 'Desk Cam',
        );

        final result = await controller.load(
          state: const ScannerSettingsLoadState(
            lastScannerSettingsSignature: 'old-signature',
            supportsMobileScanner: true,
            supportsDesktopCamera: true,
            hasController: true,
          ),
        );

        expect(result.selectedPreset, ScannerPreset.custom);
        expect(result.currentSettings.detectionSpeed, DetectionSpeed.normal);
        expect(result.currentSettings.detectionTimeoutMs, 600);
        expect(
          result.currentSettings.resolutionPreset,
          CameraResolutionPreset.high,
        );
        expect(result.currentSettings.torchEnabled, isTrue);
        expect(result.preferredDesktopCameraName, 'Desk Cam');
        expect(result.needsControllerReload, isTrue);
        expect(result.nextScannerSettingsSignature, isNot('old-signature'));
      },
    );

    test(
      'load falls back to fast settings for invalid preset/custom json and avoids reload when signature matches',
      () async {
        final controller = ScannerSettingsController(
          loadPreferences: () async => <String, Object?>{
            'scanner_preset': 'nope',
            'scanner_custom_settings': '{bad json',
          },
        );

        final expectedSettings = ScannerSettings.fast();
        final expectedSignature = ScannerSettingsController.computeSignature(
          ScannerPreset.fast,
          expectedSettings,
        );

        final result = await controller.load(
          state: ScannerSettingsLoadState(
            lastScannerSettingsSignature: expectedSignature,
            supportsMobileScanner: true,
            supportsDesktopCamera: false,
            hasController: true,
          ),
        );

        expect(result.selectedPreset, ScannerPreset.fast);
        expect(
          result.currentSettings.detectionSpeed,
          expectedSettings.detectionSpeed,
        );
        expect(
          result.currentSettings.detectionTimeoutMs,
          expectedSettings.detectionTimeoutMs,
        );
        expect(result.preferredDesktopCameraName, isNull);
        expect(result.needsControllerReload, isFalse);
        expect(result.nextScannerSettingsSignature, expectedSignature);
      },
    );

    test(
      'load requests controller initialization when mobile scanning is supported and no controller exists',
      () async {
        final controller = ScannerSettingsController(
          loadPreferences: () async => const <String, Object?>{},
        );

        final result = await controller.load(
          state: const ScannerSettingsLoadState(
            lastScannerSettingsSignature: null,
            supportsMobileScanner: true,
            supportsDesktopCamera: false,
            hasController: false,
          ),
        );

        expect(result.selectedPreset, ScannerPreset.fast);
        expect(result.needsControllerReload, isTrue);
      },
    );

    test(
      'load applies mobile camera preference to the reload signature',
      () async {
        final settings = ScannerSettings.fast();
        final backSignature = ScannerSettingsController.computeSignature(
          ScannerPreset.fast,
          settings,
          MobileCameraFacingPreference.back,
        );
        final controller = ScannerSettingsController(
          loadPreferences: () async => const <String, Object?>{},
          loadPreferredMobileCameraFacing: () async =>
              MobileCameraFacingPreference.front,
        );

        final result = await controller.load(
          state: ScannerSettingsLoadState(
            lastScannerSettingsSignature: backSignature,
            supportsMobileScanner: true,
            supportsDesktopCamera: false,
            hasController: true,
          ),
        );

        expect(
          result.preferredMobileCameraFacing,
          MobileCameraFacingPreference.front,
        );
        expect(result.needsControllerReload, isTrue);
        expect(result.nextScannerSettingsSignature, isNot(backSignature));
      },
    );
  });
}
