import 'package:airqr_mobile/settings_sync_controller.dart';
import 'package:airqr_mobile/sync_service.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('SettingsSyncController', () {
    test('buildDraft normalizes blank credentials to null', () {
      final controller = SettingsSyncController();

      final draft = controller.buildDraft(
        baseSettings: const SyncSettings(enabled: true),
        serverUrl: ' https://example.test ',
        username: '',
        password: '',
      );

      expect(draft.serverUrl, 'https://example.test');
      expect(draft.username, isNull);
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
          testConnection: () async => SyncResult.ok(),
        );

        final feedback = await controller.testConnection(
          baseSettings: const SyncSettings(enabled: true),
          serverUrl: 'https://example.test',
          username: 'alice',
          password: 'secret',
        );

        expect(saved?.serverUrl, 'https://example.test');
        expect(saved?.username, 'alice');
        expect(saved?.password, 'secret');
        expect(cacheCleared, isTrue);
        expect(feedback.isSuccess, isTrue);
        expect(feedback.message, 'Connected!');
      },
    );

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
