import 'dart:convert';
import 'dart:io';

import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_page_actions.dart';
import 'package:airqr_mobile/history_service.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:airqr_mobile/sync_service.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('HistoryPageActions', () {
    late HistoryPageActions actions;
    late Directory tempDir;

    setUp(() async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      SyncService.clearCache();
      actions = HistoryPageActions();
      tempDir = await Directory.systemTemp.createTemp('airqr-history-actions');
    });

    tearDown(() async {
      SyncService.setHttpClientForTesting(null);
      SyncService.clearCache();
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('deleteHistoryItem removes local file and history entry', () async {
      final file = File('${tempDir.path}/generated.gif');
      await file.writeAsBytes(const <int>[1, 2, 3, 4]);

      final item = HistoryItem(
        path: file.path,
        timestamp: 1,
        size: 4,
        origin: 'generated',
      );
      await HistoryService.addItem(item);

      final storedItem = (await HistoryService.getHistory()).single;
      final result = await actions.deleteHistoryItem(storedItem);

      expect(result.shouldShowServerDeleteFailure, isFalse);
      expect(await file.exists(), isFalse);
      expect(await HistoryService.getHistory(), isEmpty);
    });

    test('keepLocal marks synced item as local-only', () async {
      final file = File('${tempDir.path}/scan.bin');
      await file.writeAsBytes(const <int>[9, 8, 7]);

      await HistoryService.addItem(
        HistoryItem(
          path: file.path,
          timestamp: 42,
          size: 3,
          origin: 'scanned',
          isSynced: true,
          serverId: 'server-session',
        ),
      );

      final result = await actions.keepLocal(file.path);
      final updated = (await HistoryService.getHistory()).single;

      expect(result.fileName, 'scan.bin');
      expect(updated.isLocalOnly, isTrue);
      expect(updated.isSynced, isFalse);
      expect(updated.serverId, isNull);
    });

    test(
      'syncItem returns syncNotConfigured when sync is unavailable',
      () async {
        final file = File('${tempDir.path}/report.zip');
        await file.writeAsBytes(const <int>[5, 4, 3, 2, 1]);

        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(
          'airqr_sync_settings',
          jsonEncode(
            const SyncSettings(enabled: false, serverUrl: '').toJson(),
          ),
        );

        final result = await actions.syncItem(
          HistoryItem(
            path: file.path,
            timestamp: 99,
            size: 5,
            origin: 'generated',
            isLocalOnly: true,
          ),
        );

        expect(result.status, HistorySyncItemStatus.syncNotConfigured);
        expect(result.fileName, 'report.zip');
      },
    );

    test('clearHistory removes all local history files', () async {
      final generatedFile = File('${tempDir.path}/generated.gif');
      final scannedFile = File('${tempDir.path}/scan.bin');
      await generatedFile.writeAsBytes(const <int>[1, 2, 3]);
      await scannedFile.writeAsBytes(const <int>[4, 5, 6]);

      await HistoryService.addItem(
        HistoryItem(
          path: generatedFile.path,
          timestamp: 1,
          size: 3,
          origin: 'generated',
        ),
      );
      await HistoryService.addItem(
        HistoryItem(
          path: scannedFile.path,
          timestamp: 2,
          size: 3,
          origin: 'scanned',
        ),
      );

      final result = await actions.clearHistory(
        items: await HistoryService.getHistory(),
        incompleteScans: const [],
        syncEnabled: false,
      );

      expect(result.shouldShowServerDeleteFailure, isFalse);
      expect(await generatedFile.exists(), isFalse);
      expect(await scannedFile.exists(), isFalse);
      expect(await HistoryService.getHistory(), isEmpty);
    });

    for (final origin in ['scanned', 'generated']) {
      test(
        'manual $origin sync confirms upload and preserves session identity',
        () async {
          SharedPreferences.setMockInitialValues({
            'airqr_sync_settings': jsonEncode(
              const SyncSettings(
                enabled: true,
                serverUrl: 'https://airqr.test',
              ).toJson(),
            ),
          });
          final file = File('${tempDir.path}/payload.bin');
          await file.writeAsBytes([1, 2, 3]);
          final item = HistoryItem(
            path: file.path,
            timestamp: 99,
            size: 3,
            origin: origin,
            serverId: 'shared-session',
            isLocalOnly: true,
          );
          await HistoryService.addItem(item);
          var statusCode = 503;
          final requests = <http.Request>[];
          SyncService.setHttpClientForTesting(
            MockClient((request) async {
              requests.add(request);
              return http.Response('{}', statusCode);
            }),
          );

          final failed = await actions.syncItem(item);
          expect(failed.status, HistorySyncItemStatus.failed);
          var stored = (await HistoryService.getHistory()).single;
          expect(stored.isSynced, isFalse);
          expect(stored.isLocalOnly, isTrue);

          statusCode = 200;
          final retry = await actions.syncItem(item);
          expect(retry.status, HistorySyncItemStatus.synced);
          stored = (await HistoryService.getHistory()).single;
          expect(stored.isSynced, isTrue);
          expect(stored.isLocalOnly, isFalse);
          expect(stored.serverId, 'shared-session');
          expect(requests, hasLength(2));
          for (final request in requests) {
            expect(request.url.queryParameters.values, contains('shared-session'));
            expect(request.bodyBytes, [1, 2, 3]);
          }
        },
      );

      test(
        'disabled $origin synchronization is not reported as success',
        () async {
          SharedPreferences.setMockInitialValues({
            'airqr_sync_settings': jsonEncode(
              SyncSettings(
                enabled: true,
                serverUrl: 'https://airqr.test',
                syncScanned: origin != 'scanned',
                syncGenerated: origin != 'generated',
              ).toJson(),
            ),
          });
          var requests = 0;
          SyncService.setHttpClientForTesting(
            MockClient((request) async {
              requests++;
              return http.Response('{}', 200);
            }),
          );
          final result = await actions.syncItem(
            HistoryItem(
              path: '${tempDir.path}/unused.bin',
              timestamp: 99,
              size: 3,
              origin: origin,
            ),
          );
          expect(result.status, HistorySyncItemStatus.syncNotConfigured);
          expect(requests, 0);
        },
      );
    }
  });
}
