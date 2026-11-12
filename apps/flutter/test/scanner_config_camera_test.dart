import 'package:airqr_mobile/scanner_config.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

void main() {
  test('scanner controller starts with the requested camera facing', () {
    final frontController = ScannerSettings.fast().createController(
      facing: CameraFacing.front,
    );
    final defaultController = ScannerSettings.fast().createController();

    expect(frontController.facing, CameraFacing.front);
    expect(defaultController.facing, CameraFacing.back);

    frontController.dispose();
    defaultController.dispose();
  });
}
