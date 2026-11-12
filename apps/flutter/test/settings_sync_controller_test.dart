import 'package:airqr_mobile/settings_sync_controller.dart';
import 'package:airqr_mobile/sync_service.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('Native server connection', () {
    tearDown(() => SyncService.setHttpClientForTesting(null));

    test('same-origin explains the native URL requirement', () async {
      SyncService.setHttpClientForTesting(
        MockClient((_) async {
          fail('A relative server URL must never make a request');
        }),
      );
      final result = await SyncService.testConnection(
        const SyncSettings(enabled: true, serverUrl: 'same-origin'),
      );

      expect(result.success, isFalse);
      expect(result.error, contains('full server URL'));
    });

    test(
      'uses the draft credentials and requests only one history entry',
      () async {
        SyncService.setHttpClientForTesting(
          MockClient((request) async {
            expect(
              request.url.toString(),
              'https://example.test/api/history?limit=1',
            );
            expect(request.headers['authorization'], 'Basic YWxpY2U6c2VjcmV0');
            return http.Response('[]', 200);
          }),
        );
        final result = await SyncService.testConnection(
          const SyncSettings(
            enabled: true,
            serverUrl: 'https://example.test/',
            username: 'alice',
            password: 'secret',
          ),
        );

        expect(result.success, isTrue);
      },
    );

    test('reports rate limiting after one request', () async {
      var requests = 0;
      SyncService.setHttpClientForTesting(
        MockClient((_) async {
          requests++;
          return http.Response('', 429);
        }),
      );
      final result = await SyncService.testConnection(
        const SyncSettings(enabled: true, serverUrl: 'https://example.test'),
      );

      expect(requests, 1);
      expect(result.error, contains('429'));
    });
  });

  group('SettingsSyncController', () {
    test('buildDraft normalizes blank credentials to null', () {
      final controller = SettingsSyncController();

      final draft = controller.buildDraft(
        baseSettings: const SyncSettings(enabled: true),
        serverUrl: ' https://example.test/ ',
        username: '',
        password: '',
      );

      expect(draft.serverUrl, 'https://example.test');
      expect(draft.username, isNull);
      expect(draft.password, isNull);
    });

    test('clearing credentials removes the previous values from the draft', () {
      final draft = SettingsSyncController().buildDraft(
        baseSettings: const SyncSettings(username: 'alice', password: 'secret'),
        serverUrl: 'https://example.test',
        username: '',
        password: '',
      );

      expect(draft.authHeader, isNull);
      expect(draft.password, isNull);
    });

    test(
      'testConnection persists draft and returns success feedback',
      () async {
        SyncSettings? saved;
        var cacheCleared = false;

        final controller = SettingsSyncController(
          saveSettings: (settings) async => saved = settings,
          clearCache: () => cacheCleared = true,
          testConnection: (draft) async {
            expect(saved, isNull);
            expect(draft.username, 'alice');
            return SyncResult.ok();
          },
        );

        final feedback = await controller.testConnection(
          const SyncSettings(
            enabled: true,
            serverUrl: 'https://example.test',
            username: 'alice',
            password: 'secret',
          ),
        );

        expect(saved?.serverUrl, 'https://example.test');
        expect(saved?.username, 'alice');
        expect(saved?.password, 'secret');
        expect(cacheCleared, isTrue);
        expect(feedback.isSuccess, isTrue);
        expect(feedback.message, 'Connected!');
      },
    );

    test('failed connection leaves the saved settings intact', () async {
      final controller = SettingsSyncController(
        saveSettings: (_) async => fail('Unverified credentials were saved'),
        clearCache: () => fail('The active connection was invalidated'),
        testConnection: (_) async => SyncResult.error('Authentication failed'),
      );

      final feedback = await controller.testConnection(
        const SyncSettings(enabled: true, serverUrl: 'https://example.test'),
      );

      expect(feedback.isSuccess, isFalse);
      expect(feedback.message, 'Authentication failed');
    });

    test('performSync formats uploaded and downloaded counts', () async {
      final controller = SettingsSyncController(
        runSync: () async => SyncResult.ok(uploaded: 2, downloaded: 5),
      );

      final feedback = await controller.performSync();

      expect(feedback.isSuccess, isTrue);
      expect(feedback.message, 'Synced: 2 up, 5 down');
    });

    test(
      'performSync converts unexpected exceptions to error feedback',
      () async {
        final controller = SettingsSyncController(
          runSync: () async => throw StateError('connection interrupted'),
        );

        final feedback = await controller.performSync();

        expect(feedback.isSuccess, isFalse);
        expect(feedback.message, contains('connection interrupted'));
      },
    );
  });
}
