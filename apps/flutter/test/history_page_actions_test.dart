import 'dart:convert';
import 'dart:io';

import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_page_actions.dart';
import 'package:airqr_mobile/history_service.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('HistoryPageActions', () {
    late HistoryPageActions actions;
    late Directory tempDir;

    setUp(() async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      actions = HistoryPageActions();
      tempDir = await Directory.systemTemp.createTemp('airqr-history-actions');
    });

    tearDown(() async {
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
  });
}
