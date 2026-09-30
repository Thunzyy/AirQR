import 'scanner_settings_controller.dart';

class ScannerSettingsLifecycleDecision {
  final bool shouldReloadControllerNow;
  final bool reloadControllerWhenActive;
  final bool shouldRefreshDesktopState;

  const ScannerSettingsLifecycleDecision({
    required this.shouldReloadControllerNow,
    required this.reloadControllerWhenActive,
    required this.shouldRefreshDesktopState,
  });
}

class ScannerVisibilityChangeDecision {
  final bool enableWakelock;
  final bool disableWakelock;
  final bool shouldReloadController;
  final bool shouldStartController;
  final bool shouldStopController;
  final bool shouldCheckPendingResume;
  final bool nextReloadControllerWhenActive;

  const ScannerVisibilityChangeDecision({
    required this.enableWakelock,
    required this.disableWakelock,
    required this.shouldReloadController,
    required this.shouldStartController,
    required this.shouldStopController,
    required this.shouldCheckPendingResume,
    required this.nextReloadControllerWhenActive,
  });
}

class ScannerLifecycleController {
  const ScannerLifecycleController();

  ScannerSettingsLifecycleDecision applyLoadedSettings({
    required ScannerSettingsLoadResult settingsResult,
    required bool supportsMobileScanner,
    required bool widgetIsActive,
    required bool isDisposed,
    required bool mounted,
  }) {
    if (supportsMobileScanner) {
      if (settingsResult.needsControllerReload) {
        if (widgetIsActive) {
          return const ScannerSettingsLifecycleDecision(
            shouldReloadControllerNow: true,
            reloadControllerWhenActive: false,
            shouldRefreshDesktopState: false,
          );
        }

        return const ScannerSettingsLifecycleDecision(
          shouldReloadControllerNow: false,
          reloadControllerWhenActive: true,
          shouldRefreshDesktopState: false,
        );
      }

      return const ScannerSettingsLifecycleDecision(
        shouldReloadControllerNow: false,
        reloadControllerWhenActive: false,
        shouldRefreshDesktopState: false,
      );
    }

    return ScannerSettingsLifecycleDecision(
      shouldReloadControllerNow: false,
      reloadControllerWhenActive: false,
      shouldRefreshDesktopState: !isDisposed && mounted,
    );
  }

  ScannerVisibilityChangeDecision handleVisibilityChange({
    required bool oldIsActive,
    required bool newIsActive,
    required bool supportsMobileScanner,
    required bool reloadControllerWhenActive,
  }) {
    if (oldIsActive == newIsActive) {
      return ScannerVisibilityChangeDecision(
        enableWakelock: false,
        disableWakelock: false,
        shouldReloadController: false,
        shouldStartController: false,
        shouldStopController: false,
        shouldCheckPendingResume: false,
        nextReloadControllerWhenActive: reloadControllerWhenActive,
      );
    }

    if (newIsActive) {
      return ScannerVisibilityChangeDecision(
        enableWakelock: true,
        disableWakelock: false,
        shouldReloadController:
            supportsMobileScanner && reloadControllerWhenActive,
        shouldStartController:
            supportsMobileScanner && !reloadControllerWhenActive,
        shouldStopController: false,
        shouldCheckPendingResume: true,
        nextReloadControllerWhenActive: false,
      );
    }

    return ScannerVisibilityChangeDecision(
      enableWakelock: false,
      disableWakelock: true,
      shouldReloadController: false,
      shouldStartController: false,
      shouldStopController: supportsMobileScanner,
      shouldCheckPendingResume: false,
      nextReloadControllerWhenActive: reloadControllerWhenActive,
    );
  }
}
