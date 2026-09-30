import 'package:airqr_mobile/sync_settings.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('SyncSettings', () {
    test('copyWith overrides only provided values', () {
      const settings = SyncSettings(
        enabled: true,
        serverUrl: 'https://example.test',
        username: 'alice',
        password: 'secret',
        syncScanned: false,
      );

      final updated = settings.copyWith(syncGenerated: false, autoSync: false);

      expect(updated.enabled, isTrue);
      expect(updated.serverUrl, 'https://example.test');
      expect(updated.username, 'alice');
      expect(updated.password, 'secret');
      expect(updated.syncScanned, isFalse);
      expect(updated.syncGenerated, isFalse);
      expect(updated.autoSync, isFalse);
    });

    test('serializes and deserializes all fields', () {
      const settings = SyncSettings(
        enabled: true,
        serverUrl: 'https://example.test',
        username: 'alice',
        password: 'secret',
        syncScanned: false,
        syncGenerated: false,
        autoSync: false,
      );

      final json = settings.toJson();
      final roundTrip = SyncSettings.fromJson(json);

      expect(roundTrip.toJson(), json);
    });

    test('isConfigured requires enabled and a valid URL', () {
      const disabled = SyncSettings(enabled: false, serverUrl: 'https://example.test');
      const invalid = SyncSettings(enabled: true, serverUrl: 'not a url');
      const valid = SyncSettings(enabled: true, serverUrl: 'https://example.test');

      expect(disabled.isConfigured, isFalse);
      expect(invalid.isConfigured, isFalse);
      expect(valid.isConfigured, isTrue);
    });

    test('builds basic auth header only when credentials are complete', () {
      const complete = SyncSettings(username: 'alice', password: 'secret');
      const missingPassword = SyncSettings(username: 'alice');

      expect(complete.authHeader, 'Basic YWxpY2U6c2VjcmV0');
      expect(missingPassword.authHeader, isNull);
    });
  });
}
