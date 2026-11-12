import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/settings_maintenance_service.dart';
import 'package:airqr_mobile/sync_settings.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('SettingsMaintenanceService', () {
    test('clearAllLocalData removes history, incomplete scans and clears prefs', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'some_pref': 'value',
      });

      final removedPaths = <String>[];
      final removedScans = <String>[];
      var clearedCurrentScan = false;
      SyncSettings? savedSyncSettings;

      final service = SettingsMaintenanceService(
        loadHistoryItems: () async => <HistoryItem>[
          HistoryItem(
            path: '/tmp/file-a.gif',
            timestamp: 1,
            size: 10,
            origin: 'generated',
          ),
        ],
        removeHistoryItem: (path) async => removedPaths.add(path),
        loadIncompleteScans: () async => <IncompleteScan>[
          IncompleteScan(
            id: 'scan-1',
            startTimestamp: 10,
            lastUpdateTimestamp: 20,
            progress: 0.5,
            receivedPackets: 5,
            expectedPackets: 10,
          ),
        ],
        removeIncompleteScan: (scanId) async => removedScans.add(scanId),
        clearCurrentScan: () => clearedCurrentScan = true,
        saveSyncSettings: (settings) async => savedSyncSettings = settings,
      );

      await service.clearAllLocalData();

      expect(removedPaths, ['/tmp/file-a.gif']);
      expect(removedScans, ['scan-1']);
      expect(clearedCurrentScan, isTrue);
      expect(savedSyncSettings, isNotNull);
      expect(savedSyncSettings!.enabled, isFalse);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getKeys(), isEmpty);
    });
  });
}
