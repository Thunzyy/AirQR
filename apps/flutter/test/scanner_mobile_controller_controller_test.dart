import 'package:airqr_mobile/scanner_mobile_controller_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ScannerMobileControllerController', () {
    test('beginReload skips when scanner cannot reload', () {
      final controller = ScannerMobileControllerController();

      expect(
        controller.beginReload(
          isDisposed: true,
          supportsMobileScanner: true,
        ),
        isA<ScannerMobileControllerReloadSkippedTransition>(),
      );
      expect(
        controller.beginReload(
          isDisposed: false,
          supportsMobileScanner: false,
        ),
        isA<ScannerMobileControllerReloadSkippedTransition>(),
      );
    });

    test('beginReload returns page state updates for a valid reload', () {
      final controller = ScannerMobileControllerController();

      final transition = controller.beginReload(
        isDisposed: false,
        supportsMobileScanner: true,
      );

      expect(
        transition,
        isA<ScannerMobileControllerReloadStartedTransition>(),
      );
      final started =
          transition as ScannerMobileControllerReloadStartedTransition;
      expect(started.isReloading, isTrue);
      expect(started.isCaptureActive, isFalse);
      expect(started.isTorchOn, isFalse);
      expect(started.isProcessing, isFalse);
    });

    test('performReload waits, disposes old controller and creates a new one', () async {
      final controller = ScannerMobileControllerController();
      final calls = <String>[];

      final result = await controller.performReload<String>(
        oldController: 'old-controller',
        waitForIdle: () async {
          calls.add('wait');
        },
        stopController: (value) async {
          calls.add('stop:$value');
        },
        disposeController: (value) async {
          calls.add('dispose:$value');
        },
        createController: () {
          calls.add('create');
          return 'new-controller';
        },
        isMounted: () => true,
        isDisposed: () => false,
        log: calls.add,
      );

      expect(calls, ['wait', 'stop:old-controller', 'dispose:old-controller', 'create']);
      expect(result, isNotNull);
      expect(result!.controller, 'new-controller');
      expect(result.status, 'Scanning...');
      expect(result.isReloading, isFalse);
      expect(result.isCaptureActive, isTrue);
    });

    test('performReload skips controller creation when widget is no longer active', () async {
      final controller = ScannerMobileControllerController();
      final calls = <String>[];

      final result = await controller.performReload<String>(
        oldController: 'old-controller',
        waitForIdle: () async {
          calls.add('wait');
        },
        stopController: (value) async {
          calls.add('stop:$value');
        },
        disposeController: (value) async {
          calls.add('dispose:$value');
        },
        createController: () {
          calls.add('create');
          return 'new-controller';
        },
        isMounted: () => false,
        isDisposed: () => false,
        log: calls.add,
      );

      expect(result, isNull);
      expect(calls, ['wait', 'stop:old-controller', 'dispose:old-controller']);
    });
  });
}
