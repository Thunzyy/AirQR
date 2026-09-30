typedef ScannerControllerWaitForIdleCallback = Future<void> Function();
typedef ScannerControllerStopCallback<T> = Future<void> Function(T controller);
typedef ScannerControllerDisposeCallback<T> = Future<void> Function(T controller);
typedef ScannerControllerFactory<T> = T Function();
typedef ScannerControllerLogCallback = void Function(String message);
typedef ScannerMountedCallback = bool Function();
typedef ScannerDisposedCallback = bool Function();

sealed class ScannerMobileControllerReloadStartTransition {
  const ScannerMobileControllerReloadStartTransition();
}

class ScannerMobileControllerReloadSkippedTransition
    extends ScannerMobileControllerReloadStartTransition {
  const ScannerMobileControllerReloadSkippedTransition();
}

class ScannerMobileControllerReloadStartedTransition
    extends ScannerMobileControllerReloadStartTransition {
  final bool isReloading;
  final bool isCaptureActive;
  final bool isTorchOn;
  final bool isProcessing;

  const ScannerMobileControllerReloadStartedTransition({
    required this.isReloading,
    required this.isCaptureActive,
    required this.isTorchOn,
    required this.isProcessing,
  });
}

class ScannerMobileControllerReloadFinishTransition<T> {
  final T controller;
  final String status;
  final bool isReloading;
  final bool isCaptureActive;

  const ScannerMobileControllerReloadFinishTransition({
    required this.controller,
    required this.status,
    required this.isReloading,
    required this.isCaptureActive,
  });
}

class ScannerMobileControllerController {
  const ScannerMobileControllerController();

  ScannerMobileControllerReloadStartTransition beginReload({
    required bool isDisposed,
    required bool supportsMobileScanner,
  }) {
    if (isDisposed || !supportsMobileScanner) {
      return const ScannerMobileControllerReloadSkippedTransition();
    }

    return const ScannerMobileControllerReloadStartedTransition(
      isReloading: true,
      isCaptureActive: false,
      isTorchOn: false,
      isProcessing: false,
    );
  }

  Future<ScannerMobileControllerReloadFinishTransition<T>?> performReload<T>({
    required T? oldController,
    required ScannerControllerWaitForIdleCallback waitForIdle,
    required ScannerControllerStopCallback<T> stopController,
    required ScannerControllerDisposeCallback<T> disposeController,
    required ScannerControllerFactory<T> createController,
    required ScannerMountedCallback isMounted,
    required ScannerDisposedCallback isDisposed,
    required ScannerControllerLogCallback log,
  }) async {
    await waitForIdle();

    if (oldController != null) {
      try {
        await stopController(oldController);
        await disposeController(oldController);
      } catch (error) {
        log('Error disposing controller: $error');
      }
    }

    if (!isMounted() || isDisposed()) {
      return null;
    }

    return ScannerMobileControllerReloadFinishTransition<T>(
      controller: createController(),
      status: 'Scanning...',
      isReloading: false,
      isCaptureActive: true,
    );
  }
}
