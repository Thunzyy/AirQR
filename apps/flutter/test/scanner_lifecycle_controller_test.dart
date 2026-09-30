import 'package:airqr_mobile/scanner_lifecycle_controller.dart';
import 'package:airqr_mobile/scanner_settings_controller.dart';
import 'package:airqr_mobile/scanner_config.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerLifecycleController', () {
    test('applyLoadedSettings schedules a deferred reload when scanner tab is hidden', () {
      final controller = ScannerLifecycleController();

      final decision = controller.applyLoadedSettings(
        settingsResult: ScannerSettingsLoadResult(
          selectedPreset: ScannerPreset.fast,
          currentSettings: ScannerSettings.fast(),
          preferredDesktopCameraName: null,
          nextScannerSettingsSignature: 'sig-1',
          needsControllerReload: true,
        ),
        supportsMobileScanner: true,
        widgetIsActive: false,
        isDisposed: false,
        mounted: true,
      );

      expect(decision.shouldReloadControllerNow, isFalse);
      expect(decision.reloadControllerWhenActive, isTrue);
      expect(decision.shouldRefreshDesktopState, isFalse);
    });

    test('applyLoadedSettings requests an immediate reload when scanner tab is visible', () {
      final controller = ScannerLifecycleController();

      final decision = controller.applyLoadedSettings(
        settingsResult: ScannerSettingsLoadResult(
          selectedPreset: ScannerPreset.fast,
          currentSettings: ScannerSettings.fast(),
          preferredDesktopCameraName: null,
          nextScannerSettingsSignature: 'sig-2',
          needsControllerReload: true,
        ),
        supportsMobileScanner: true,
        widgetIsActive: true,
        isDisposed: false,
        mounted: true,
      );

      expect(decision.shouldReloadControllerNow, isTrue);
      expect(decision.reloadControllerWhenActive, isFalse);
      expect(decision.shouldRefreshDesktopState, isFalse);
    });

    test('applyLoadedSettings refreshes desktop state when no mobile scanner is available', () {
      final controller = ScannerLifecycleController();

      final decision = controller.applyLoadedSettings(
        settingsResult: ScannerSettingsLoadResult(
          selectedPreset: ScannerPreset.fast,
          currentSettings: ScannerSettings.fast(),
          preferredDesktopCameraName: 'Desk Cam',
          nextScannerSettingsSignature: 'sig-3',
          needsControllerReload: false,
        ),
        supportsMobileScanner: false,
        widgetIsActive: true,
        isDisposed: false,
        mounted: true,
      );

      expect(decision.shouldRefreshDesktopState, isTrue);
      expect(decision.shouldReloadControllerNow, isFalse);
      expect(decision.reloadControllerWhenActive, isFalse);
    });

    test('handleVisibilityChange prefers pending reload over immediate camera start', () {
      final controller = ScannerLifecycleController();

      final decision = controller.handleVisibilityChange(
        oldIsActive: false,
        newIsActive: true,
        supportsMobileScanner: true,
        reloadControllerWhenActive: true,
      );

      expect(decision.enableWakelock, isTrue);
      expect(decision.disableWakelock, isFalse);
      expect(decision.shouldReloadController, isTrue);
      expect(decision.shouldStartController, isFalse);
      expect(decision.shouldStopController, isFalse);
      expect(decision.shouldCheckPendingResume, isTrue);
      expect(decision.nextReloadControllerWhenActive, isFalse);
    });

    test('handleVisibilityChange stops the mobile scanner when tab becomes inactive', () {
      final controller = ScannerLifecycleController();

      final decision = controller.handleVisibilityChange(
        oldIsActive: true,
        newIsActive: false,
        supportsMobileScanner: true,
        reloadControllerWhenActive: false,
      );

      expect(decision.enableWakelock, isFalse);
      expect(decision.disableWakelock, isTrue);
      expect(decision.shouldReloadController, isFalse);
      expect(decision.shouldStartController, isFalse);
      expect(decision.shouldStopController, isTrue);
      expect(decision.shouldCheckPendingResume, isFalse);
    });
  });
}
