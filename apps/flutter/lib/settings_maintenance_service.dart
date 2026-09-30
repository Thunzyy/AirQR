import 'package:shared_preferences/shared_preferences.dart';

import 'history_item.dart';
import 'history_service.dart';
import 'incomplete_scans.dart';
import 'sync_settings.dart';

typedef LoadHistoryItemsCallback = Future<List<HistoryItem>> Function();
typedef RemoveHistoryItemCallback = Future<void> Function(String path);
typedef LoadIncompleteScansCallback = Future<List<IncompleteScan>> Function();
typedef RemoveIncompleteScanCallback = Future<void> Function(String scanId);
typedef ClearCurrentScanCallback = void Function();
typedef SaveSyncSettingsCallback = Future<void> Function(SyncSettings settings);
typedef LoadPreferencesCallback = Future<SharedPreferences> Function();

class SettingsMaintenanceService {
  final LoadHistoryItemsCallback _loadHistoryItems;
  final RemoveHistoryItemCallback _removeHistoryItem;
  final LoadIncompleteScansCallback _loadIncompleteScans;
  final RemoveIncompleteScanCallback _removeIncompleteScan;
  final ClearCurrentScanCallback _clearCurrentScan;
  final SaveSyncSettingsCallback _saveSyncSettings;
  final LoadPreferencesCallback _loadPreferences;

  SettingsMaintenanceService({
    LoadHistoryItemsCallback? loadHistoryItems,
    RemoveHistoryItemCallback? removeHistoryItem,
    LoadIncompleteScansCallback? loadIncompleteScans,
    RemoveIncompleteScanCallback? removeIncompleteScan,
    ClearCurrentScanCallback? clearCurrentScan,
    SaveSyncSettingsCallback? saveSyncSettings,
    LoadPreferencesCallback? loadPreferences,
  }) : _loadHistoryItems = loadHistoryItems ?? HistoryService.getHistory,
       _removeHistoryItem = removeHistoryItem ?? HistoryService.remove,
       _loadIncompleteScans = loadIncompleteScans ?? IncompleteScanService.getAll,
       _removeIncompleteScan =
           removeIncompleteScan ?? IncompleteScanService.remove,
       _clearCurrentScan =
           clearCurrentScan ?? IncompleteScanService.clearCurrentScan,
       _saveSyncSettings = saveSyncSettings ?? SyncSettingsService.save,
       _loadPreferences =
           loadPreferences ?? SharedPreferences.getInstance;

  Future<void> clearAllLocalData() async {
    final historyItems = await _loadHistoryItems();
    for (final item in historyItems) {
      await _removeHistoryItem(item.path);
    }

    final incompleteScans = await _loadIncompleteScans();
    for (final scan in incompleteScans) {
      await _removeIncompleteScan(scan.id);
    }
    _clearCurrentScan();

    await _saveSyncSettings(const SyncSettings());

    final prefs = await _loadPreferences();
    await prefs.clear();
  }
}
