import 'dart:convert';
import 'dart:io';

import 'package:airqr_mobile/main.dart';
import 'package:airqr_mobile/resume_service.dart';
import 'package:airqr_mobile/src/rust/frb_generated.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:integration_test/integration_test.dart';

http.Client _buildClient({required bool insecure}) {
  if (!insecure) return http.Client();
  final io = HttpClient()
    ..badCertificateCallback = (X509Certificate cert, String host, int port) {
      return true;
    };
  return IOClient(io);
}

Map<String, String> _authHeaders({
  required String username,
  required String password,
}) {
  final token = base64Encode(utf8.encode('$username:$password'));
  return <String, String>{
    'Authorization': 'Basic $token',
    'Content-Type': 'application/json',
  };
}

List<int> _packetBytes(int index, {int size = 810}) {
  final seed = utf8.encode('pkt-$index-flutter-ui-e2e');
  final out = <int>[];
  while (out.length < size) {
    out.addAll(seed);
  }
  return out.sublist(0, size);
}

Future<void> _uploadPacket({
  required http.Client client,
  required String serverUrl,
  required String username,
  required String password,
  required String sessionId,
  required int packetIndex,
  required int expectedPackets,
  required String deviceName,
  required String deviceId,
}) async {
  final uri = Uri.parse('$serverUrl/api/scan/packet');
  final payload = <String, dynamic>{
    'sessionId': sessionId,
    'packetBase64': base64Encode(_packetBytes(packetIndex)),
    'expectedPackets': expectedPackets,
    'totalPackets': expectedPackets,
    'receivedPackets': 0,
    'filename': 'cross-device-realtime.bin',
    'deviceName': deviceName,
    'deviceId': deviceId,
    'isStreaming': false,
  };

  late final http.Response resp;
  try {
    resp = await client
        .post(
          uri,
          headers: _authHeaders(username: username, password: password),
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 12));
  } catch (e) {
    throw TestFailure(
      'uploadPacket network failure to $uri: $e. '
      'If running from Android device, ensure this URL is reachable from device '
      '(use a public/domain URL or pass a device-specific URL in runner).',
    );
  }

  if (resp.statusCode != 200) {
    throw TestFailure(
      'uploadPacket failed: status=${resp.statusCode}, body=${resp.body}',
    );
  }
  final body = jsonDecode(resp.body) as Map<String, dynamic>;
  if (body['ok'] != true) {
    throw TestFailure('uploadPacket response not ok: $body');
  }
}

Future<Map<String, dynamic>> _fetchSession({
  required http.Client client,
  required String serverUrl,
  required String username,
  required String password,
  required String sessionId,
}) async {
  final uri = Uri.parse('$serverUrl/api/scan/session/$sessionId');
  late final http.Response resp;
  try {
    resp = await client
        .get(
          uri,
          headers: _authHeaders(username: username, password: password),
        )
        .timeout(const Duration(seconds: 12));
  } catch (e) {
    throw TestFailure('fetchSession network failure to $uri: $e');
  }
  if (resp.statusCode != 200) {
    throw TestFailure(
      'fetchSession failed: status=${resp.statusCode}, body=${resp.body}',
    );
  }
  return jsonDecode(resp.body) as Map<String, dynamic>;
}

int _readIntByKey(WidgetTester tester, String keyName) {
  final finder = find.byKey(Key(keyName));
  if (finder.evaluate().isEmpty) return -1;
  final widget = tester.widget<Text>(finder.first);
  final raw = widget.data ?? widget.textSpan?.toPlainText() ?? '';
  return int.tryParse(raw.trim()) ?? -1;
}

String _readTextByKey(WidgetTester tester, String keyName) {
  final finder = find.byKey(Key(keyName));
  if (finder.evaluate().isEmpty) return '';
  final widget = tester.widget<Text>(finder.first);
  return (widget.data ?? widget.textSpan?.toPlainText() ?? '').trim();
}

Future<void> _waitForCondition({
  required WidgetTester tester,
  required bool Function() condition,
  required String description,
  Duration timeout = const Duration(seconds: 30),
  Duration tick = const Duration(milliseconds: 250),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(tick);
    if (condition()) return;
  }
  throw TestFailure('Timed out waiting for: $description');
}

Future<void> _verifyServerReachable({
  required http.Client client,
  required String serverUrl,
}) async {
  final uri = Uri.parse('$serverUrl/health');
  try {
    final resp =
        await client.get(uri).timeout(const Duration(seconds: 8));
    if (resp.statusCode != 200) {
      throw TestFailure(
        'Server health check failed: status=${resp.statusCode} on $uri',
      );
    }
  } catch (e) {
    throw TestFailure(
      'Server not reachable from device at $uri: $e. '
      'Use a URL reachable from the Android phone (not only from host PC).',
    );
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    await RustLib.init();
  });

  testWidgets('scanner resume stays realtime and server-consistent', (
    WidgetTester tester,
  ) async {
    const serverUrlRaw = String.fromEnvironment(
      'AIRQR_TEST_SERVER_URL',
      defaultValue: '',
    );
    const username = String.fromEnvironment(
      'AIRQR_TEST_USERNAME',
      defaultValue: 'admin',
    );
    const password = String.fromEnvironment(
      'AIRQR_TEST_PASSWORD',
      defaultValue: 'admin',
    );
    const insecureRaw = String.fromEnvironment(
      'AIRQR_TEST_INSECURE',
      defaultValue: 'false',
    );
    final insecure = insecureRaw.toLowerCase() == 'true';

    final serverUrl = serverUrlRaw.trim();
    if (serverUrl.isEmpty) {
      throw TestFailure(
        'AIRQR_TEST_SERVER_URL is required. '
        'Example: --dart-define=AIRQR_TEST_SERVER_URL=https://192.168.1.100:8081',
      );
    }

    final client = _buildClient(insecure: insecure);
    addTearDown(client.close);

    await _verifyServerReachable(client: client, serverUrl: serverUrl);

    // Ensure scanner sync is enabled and points to the real server.
    await SyncSettingsService.save(
      SyncSettings(
        enabled: true,
        serverUrl: serverUrl,
        username: username,
        password: password,
        syncScanned: true,
        syncGenerated: true,
        autoSync: true,
      ),
    );

    final sessionId = DateTime.now().millisecondsSinceEpoch.toString();
    const expectedPackets = 86;
    const webSeedPackets = 10;
    const flutterMorePackets = 8;
    const finalPackets = webSeedPackets + flutterMorePackets;

    // Simulate web app initialization.
    for (int i = 0; i < webSeedPackets; i++) {
      await _uploadPacket(
        client: client,
        serverUrl: serverUrl,
        username: username,
        password: password,
        sessionId: sessionId,
        packetIndex: i,
        expectedPackets: expectedPackets,
        deviceName: 'iOS Browser E2E',
        deviceId: 'ios-browser-e2e',
      );
    }

    // Simulate user opening scanner resume from history flow.
    ResumeService().requestResume(sessionId);

    await tester.pumpWidget(
      MyApp(
        buildScannerPage: ({
          required settingsChangedNotifier,
          required isActive,
        }) {
          return ScannerPage(
            settingsChangedNotifier: settingsChangedNotifier,
            isActive: isActive,
          );
        },
      ),
    );
    await tester.pump(const Duration(seconds: 1));

    await _waitForCondition(
      tester: tester,
      description: 'scanner shows seeded packet count',
      timeout: const Duration(seconds: 40),
      condition: () =>
          _readIntByKey(tester, 'scanner_stat_scanned_value') >= webSeedPackets,
    );

    await _waitForCondition(
      tester: tester,
      description: 'scanner min packets target is populated',
      condition: () =>
          _readIntByKey(tester, 'scanner_stat_min_value') == expectedPackets,
    );

    // Simulate remote flutter progression coming from another device.
    for (int i = webSeedPackets; i < finalPackets; i++) {
      await _uploadPacket(
        client: client,
        serverUrl: serverUrl,
        username: username,
        password: password,
        sessionId: sessionId,
        packetIndex: i,
        expectedPackets: expectedPackets,
        deviceName: 'Android Flutter E2E',
        deviceId: 'android-flutter-e2e',
      );
    }

    await _waitForCondition(
      tester: tester,
      description: 'scanner reaches final packet count',
      timeout: const Duration(seconds: 40),
      condition: () =>
          _readIntByKey(tester, 'scanner_stat_scanned_value') == finalPackets,
    );

    final syncSource = _readTextByKey(tester, 'scanner_sync_source');
    expect(syncSource.contains('Android Flutter E2E'), isTrue);

    final session = await _fetchSession(
      client: client,
      serverUrl: serverUrl,
      username: username,
      password: password,
      sessionId: sessionId,
    );
    final receivedServer =
        int.tryParse(
          '${session['receivedCount'] ?? session['receivedPackets'] ?? 0}',
        ) ??
        0;
    final expectedServer =
        int.tryParse(
          '${session['expectedPackets'] ?? session['totalPackets'] ?? 0}',
        ) ??
        0;

    expect(receivedServer, finalPackets);
    expect(expectedServer, greaterThanOrEqualTo(expectedPackets));
    expect(_readIntByKey(tester, 'scanner_stat_scanned_value'), receivedServer);
  });
}
