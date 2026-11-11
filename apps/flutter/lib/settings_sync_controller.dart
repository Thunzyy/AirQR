import 'sync_service.dart';
import 'sync_settings.dart';

class SettingsSyncFeedback {
  final String message;
  final bool isSuccess;

  const SettingsSyncFeedback._({
    required this.message,
    required this.isSuccess,
  });

  factory SettingsSyncFeedback.connectionSuccess([
    String message = 'Connected!',
  ]) {
    return SettingsSyncFeedback._(message: message, isSuccess: true);
  }

  factory SettingsSyncFeedback.syncSuccess({
    required int uploadedCount,
    required int downloadedCount,
  }) {
    return SettingsSyncFeedback._(
      message: 'Synced: $uploadedCount up, $downloadedCount down',
      isSuccess: true,
    );
  }

  factory SettingsSyncFeedback.error(String message) {
    return SettingsSyncFeedback._(message: message, isSuccess: false);
  }
}

typedef SaveSyncSettingsCallback = Future<void> Function(SyncSettings settings);
typedef ClearSyncCacheCallback = void Function();
typedef TestSyncConnectionCallback =
    Future<SyncResult> Function(SyncSettings settings);
typedef RunSyncCallback = Future<SyncResult> Function();

class SettingsSyncController {
  final SaveSyncSettingsCallback _saveSettings;
  final ClearSyncCacheCallback _clearCache;
  final TestSyncConnectionCallback _testConnection;
  final RunSyncCallback _runSync;

  SettingsSyncController({
    SaveSyncSettingsCallback? saveSettings,
    ClearSyncCacheCallback? clearCache,
    TestSyncConnectionCallback? testConnection,
    RunSyncCallback? runSync,
  }) : _saveSettings = saveSettings ?? SyncSettingsService.save,
       _clearCache = clearCache ?? SyncService.clearCache,
       _testConnection = testConnection ?? SyncService.testConnection,
       _runSync = runSync ?? SyncService.syncAll;

  SyncSettings buildDraft({
    required SyncSettings baseSettings,
    required String serverUrl,
    required String username,
    required String password,
  }) {
    final trimmedUrl = serverUrl.trim();
    return SyncSettings(
      enabled: baseSettings.enabled,
      serverUrl: trimmedUrl == '/'
          ? trimmedUrl
          : trimmedUrl.replaceFirst(RegExp(r'/+$'), ''),
      username: username.isEmpty ? null : username,
      password: password.isEmpty ? null : password,
      syncScanned: baseSettings.syncScanned,
      syncGenerated: baseSettings.syncGenerated,
      autoSync: baseSettings.autoSync,
    );
  }

  Future<void> saveSettings(SyncSettings settings) async {
    await _saveSettings(settings);
    _clearCache();
  }

  Future<SettingsSyncFeedback> testConnection(SyncSettings draft) async {
    try {
      final result = await _testConnection(draft);
      if (result.success) {
        await saveSettings(draft);
        return SettingsSyncFeedback.connectionSuccess();
      }
      return SettingsSyncFeedback.error(result.error ?? 'Connection failed');
    } catch (error) {
      return SettingsSyncFeedback.error('Connection failed: $error');
    }
  }

  Future<SettingsSyncFeedback> performSync() async {
    try {
      final result = await _runSync();
      if (result.success) {
        return SettingsSyncFeedback.syncSuccess(
          uploadedCount: result.uploadedCount,
          downloadedCount: result.downloadedCount,
        );
      }
      return SettingsSyncFeedback.error(result.error ?? 'Sync failed');
    } catch (error) {
      return SettingsSyncFeedback.error('Sync failed: $error');
    }
  }
}
