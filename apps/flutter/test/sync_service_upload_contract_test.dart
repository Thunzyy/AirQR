import 'dart:convert';

import 'package:airqr_mobile/sync_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'airqr_sync_settings': jsonEncode(<String, dynamic>{
        'enabled': true,
        'serverUrl': 'https://airqr.test',
        'syncScanned': true,
        'syncGenerated': true,
      }),
    });
    SyncService.clearCache();
  });

  tearDown(() {
    SyncService.setHttpClientForTesting(null);
    SyncService.clearCache();
  });

  test('generated upload uses the server binary contract', () async {
    http.Request? captured;
    SyncService.setHttpClientForTesting(
      MockClient((request) async {
        captured = request;
        return http.Response('{"ok":true}', 200);
      }),
    );

    final result = await SyncService.uploadGenerated(
      historyId: 'history-1',
      filename: 'payload.gif',
      fileBytes: const <int>[1, 2, 3],
      mimeType: 'application/json',
      createdAt: '2026-07-15T10:00:00Z',
      totalFrames: 12,
      minFrames: 8,
    );

    expect(result.success, isTrue);
    expect(captured!.headers['content-type'], 'application/octet-stream');
    expect(captured!.bodyBytes, const <int>[1, 2, 3]);
    expect(captured!.url.queryParameters['historyId'], 'history-1');
    expect(captured!.url.queryParameters['filename'], 'payload.gif');
    expect(captured!.url.queryParameters['mimeType'], 'application/json');
    expect(captured!.url.queryParameters['createdAt'], '2026-07-15T10:00:00Z');
    expect(captured!.url.queryParameters['totalFrames'], '12');
    expect(captured!.url.queryParameters['minFrames'], '8');
  });

  test('completed scan upload uses the server binary contract', () async {
    http.Request? captured;
    SyncService.setHttpClientForTesting(
      MockClient((request) async {
        captured = request;
        return http.Response('{"ok":true}', 200);
      }),
    );

    final result = await SyncService.uploadScan(
      sessionId: 'scan-1',
      filename: 'scan.bin',
      fileBytes: const <int>[4, 5, 6],
      mimeType: 'application/octet-stream',
      completedAt: '2026-07-15T10:00:00Z',
      totalChunks: 3,
      chunksCompleted: 3,
    );

    expect(result.success, isTrue);
    expect(captured!.headers['content-type'], 'application/octet-stream');
    expect(captured!.bodyBytes, const <int>[4, 5, 6]);
    expect(captured!.url.queryParameters['sessionId'], 'scan-1');
    expect(captured!.url.queryParameters['filename'], 'scan.bin');
    expect(captured!.url.queryParameters['fileSize'], '3');
    expect(captured!.url.queryParameters['totalChunks'], '3');
    expect(captured!.url.queryParameters['chunksCompleted'], '3');
  });
}
