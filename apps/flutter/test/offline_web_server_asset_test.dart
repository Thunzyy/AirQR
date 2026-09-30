import 'dart:io';

import 'package:airqr_mobile/offline_web_server_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('loads the bundled portable web app asset by default', () async {
    final controller = OfflineWebServerController(
      preferredPort: 0,
      maxPort: 0,
      addressResolver: () async => [InternetAddress.loopbackIPv4],
    );

    final result = await controller.start();

    expect(result.success, isTrue, reason: result.error);
    expect(controller.isRunning, isTrue);
    expect(controller.serverUrl, 'http://127.0.0.1:${controller.port}');

    await controller.stop();
  });
}
