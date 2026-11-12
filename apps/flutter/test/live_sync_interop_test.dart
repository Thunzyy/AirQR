// Opt-in smoke against a disposable real sync server. Never use production data.
// Run upload, verify/download in the web client, then run download.
import 'dart:convert';
import 'dart:io';

import 'package:airqr_mobile/sync_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _url = String.fromEnvironment('AIRQR_LIVE_SYNC_URL');
const _phase = String.fromEnvironment('AIRQR_LIVE_SYNC_PHASE');
final _payload = List<int>.generate(65792, (index) => index % 256);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final previousHttpOverrides = HttpOverrides.current;
  tearDown(() {
    HttpOverrides.global = previousHttpOverrides;
    SyncService.clearCache();
  });
  setUp(() {
    final uri = Uri.parse(_url);
    expect(uri.host, anyOf('127.0.0.1', 'localhost'));
    HttpOverrides.global = null;
    SharedPreferences.setMockInitialValues({
      'airqr_sync_settings': jsonEncode({
        'enabled': true,
        'serverUrl': _url,
        'syncScanned': true,
        'syncGenerated': true,
      }),
    });
    SyncService.clearCache();
  });

  test(
    'native client uploads generated and scanned binary files',
    () async {
      final generated = await SyncService.uploadGenerated(
        historyId: 'parity-native-generated',
        filename: 'native-generated.bin',
        fileBytes: _payload,
        mimeType: 'application/octet-stream',
        totalFrames: 100,
        minFrames: 75,
      );
      expect(generated.success, isTrue, reason: generated.error);
      expect(generated.uploadedCount, 1);
      final scanned = await SyncService.uploadScan(
        sessionId: 'parity-native-scanned',
        filename: 'native-scanned.bin',
        fileBytes: _payload.reversed.toList(),
        mimeType: 'application/octet-stream',
      );
      expect(scanned.success, isTrue, reason: scanned.error);
      expect(scanned.uploadedCount, 1);
    },
    skip: _url.isEmpty || _phase != 'upload',
  );

  test(
    'native client downloads exact bytes uploaded by the web client',
    () async {
      final history = await SyncService.fetchServerHistory();
      expect(history, isA<ServerHistorySnapshot>());
      expect((history as ServerHistorySnapshot).items.length, 4);
      expect(
        await SyncService.downloadFile(
          id: 'parity-web-generated',
          origin: 'generated',
        ),
        _payload,
      );
      expect(
        await SyncService.downloadFile(
          id: 'parity-web-scanned',
          origin: 'scanned',
        ),
        _payload.reversed.toList(),
      );
    },
    skip: _url.isEmpty || _phase != 'download',
  );
}
