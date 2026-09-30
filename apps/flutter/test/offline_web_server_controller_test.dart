import 'dart:io';

import 'package:airqr_mobile/offline_web_server_controller.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

void main() {
  group('OfflineWebServerController', () {
    late OfflineWebServerController controller;

    tearDown(() async {
      await controller.stop();
    });

    test(
      'serves the portable web app for root, aliases, and SPA routes',
      () async {
        controller = OfflineWebServerController(
          preferredPort: 0,
          maxPort: 0,
          htmlLoader: () async =>
              '<!doctype html><title>AirQR Portable</title>',
          addressResolver: () async => [InternetAddress.loopbackIPv4],
        );

        final result = await controller.start();

        expect(result.success, isTrue, reason: result.error);
        expect(controller.isRunning, isTrue);
        expect(controller.port, greaterThan(0));
        expect(controller.serverUrl, 'http://127.0.0.1:${controller.port}');
        expect(controller.networkUrls, ['http://127.0.0.1:${controller.port}']);

        for (final path in [
          '/',
          '/portable',
          '/airqr-portable.html',
          '/decoder',
        ]) {
          final response = await http.get(
            Uri.parse('http://127.0.0.1:${controller.port}$path'),
          );
          expect(response.statusCode, 200, reason: path);
          expect(response.body, contains('AirQR Portable'), reason: path);
          expect(response.headers['content-type'], contains('text/html'));
          expect(response.headers['cross-origin-opener-policy'], 'same-origin');
          expect(
            response.headers['cross-origin-embedder-policy'],
            'require-corp',
          );
        }
      },
    );

    test('rejects non read-only methods', () async {
      controller = OfflineWebServerController(
        preferredPort: 0,
        maxPort: 0,
        htmlLoader: () async => '<!doctype html><title>AirQR Portable</title>',
        addressResolver: () async => [InternetAddress.loopbackIPv4],
      );
      await controller.start();

      final response = await http.post(
        Uri.parse('http://127.0.0.1:${controller.port}/'),
      );

      expect(response.statusCode, 405);
    });

    test('stop closes the server', () async {
      controller = OfflineWebServerController(
        preferredPort: 0,
        maxPort: 0,
        htmlLoader: () async => '<!doctype html><title>AirQR Portable</title>',
        addressResolver: () async => [InternetAddress.loopbackIPv4],
      );
      await controller.start();
      final port = controller.port;

      await controller.stop();

      expect(controller.isRunning, isFalse);
      expect(controller.serverUrl, isNull);
      expect(controller.port, isNull);

      expect(
        http
            .get(Uri.parse('http://127.0.0.1:$port/'))
            .timeout(const Duration(milliseconds: 300)),
        throwsA(isA<Object>()),
      );
    });

    test('prefers private IPv4 addresses for the displayed URL', () async {
      controller = OfflineWebServerController(
        preferredPort: 0,
        maxPort: 0,
        htmlLoader: () async => '<!doctype html><title>AirQR Portable</title>',
        addressResolver: () async => [
          InternetAddress.loopbackIPv4,
          InternetAddress('8.8.8.8'),
          InternetAddress('192.168.1.36'),
        ],
      );

      final result = await controller.start();

      expect(result.success, isTrue, reason: result.error);
      expect(controller.serverUrl, 'http://192.168.1.36:${controller.port}');
      expect(controller.networkUrls.first, controller.serverUrl);
    });

    test(
      'prioritizes home LAN IPv4 addresses before VPN and virtual adapters',
      () async {
        controller = OfflineWebServerController(
          preferredPort: 0,
          maxPort: 0,
          htmlLoader: () async =>
              '<!doctype html><title>AirQR Portable</title>',
          addressResolver: () async => [
            InternetAddress('10.5.0.2'),
            InternetAddress('172.27.160.1'),
            InternetAddress('192.168.15.254'),
            InternetAddress('192.168.0.50'),
            InternetAddress('192.168.1.36'),
            InternetAddress('192.168.1.110'),
          ],
        );

        final result = await controller.start();

        expect(result.success, isTrue, reason: result.error);
        expect(controller.serverUrl, 'http://192.168.1.110:${controller.port}');
        expect(controller.networkUrls, [
          'http://192.168.1.110:${controller.port}',
          'http://192.168.1.36:${controller.port}',
          'http://192.168.0.50:${controller.port}',
          'http://192.168.15.254:${controller.port}',
          'http://172.27.160.1:${controller.port}',
          'http://10.5.0.2:${controller.port}',
        ]);
      },
    );
  });
}
