import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app/app_preferences.dart';
import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'camera_preferences.dart';
import 'encoder_defaults.dart';
import 'l10n/app_localizations.dart';
import 'local_sync_server_controller.dart';
import 'offline_web_server_controller.dart';
import 'scanner_config.dart';
import 'settings_maintenance_service.dart';
import 'settings_export_config_controller.dart';
import 'settings_page_controller.dart';
import 'settings_page_helpers.dart';
import 'settings_page_sections.dart';
import 'settings_page_widgets.dart';
import 'settings_sync_controller.dart';
import 'sync_settings.dart';
import 'websocket_sync.dart';

enum SettingsPageSectionTarget { offlineWeb }

double settingsBottomNavigationClearance(BuildContext context) {
  final scaledLabelHeight = MediaQuery.textScalerOf(context).scale(12);
  final navigationHeight = scaledLabelHeight > 18
      ? 22 + 34 + 4 + (scaledLabelHeight * 1.15 * 2)
      : 84.0;
  final safeBottom = math.max(MediaQuery.viewPaddingOf(context).bottom, 14.0);
  return navigationHeight + safeBottom + 16;
}

class SettingsPage extends StatefulWidget {
  final ValueNotifier<int> settingsChangedNotifier;
  final bool isActive;
  final SettingsPageController? pageController;
  final SettingsSyncController? syncController;
  final SettingsMaintenanceService? maintenanceService;
  final SettingsExportConfigController? exportConfigController;
  final LocalSyncServerController? localServerController;
  final OfflineWebServerController? offlineWebServerController;
  final SettingsPageSectionTarget? requestedSection;
  final int requestedSectionRevision;

  const SettingsPage({
    super.key,
    required this.settingsChangedNotifier,
    this.isActive = true,
    this.pageController,
    this.syncController,
    this.maintenanceService,
    this.exportConfigController,
    this.localServerController,
    this.offlineWebServerController,
    this.requestedSection,
    this.requestedSectionRevision = 0,
  });

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

enum _SettingsSection {
  encoder,
  scanner,
  sync,
  offlineWeb,
  appearance,
  logging,
  about,
}

enum _ServerConnectivityStatus { connected, unavailable }

class _SettingsMenuEntry {
  final _SettingsSection section;
  final String iconName;
  final String label;
  final String description;

  const _SettingsMenuEntry({
    required this.section,
    required this.iconName,
    required this.label,
    required this.description,
  });
}

class _LocalServerDialogResult {
  final String username;
  final String password;
  final int port;

  const _LocalServerDialogResult({
    required this.username,
    required this.password,
    required this.port,
  });
}

class _SettingsPageState extends State<SettingsPage> {
  late final SettingsPageController _pageController;
  late final SettingsSyncController _syncController;
  late final SettingsMaintenanceService _maintenanceService;
  late final SettingsExportConfigController _exportConfigController;
  late final LocalSyncServerController _localServerController;
  late final OfflineWebServerController _offlineWebServerController;
  final TextEditingController _serverUrlController = TextEditingController();
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  final TextEditingController _exportDirController = TextEditingController();

  late ScannerPreset _selectedPreset;
  late ScannerSettings _settings;
  bool _isLoading = true;

  late DetectionSpeed _detectionSpeed;
  late int _detectionTimeoutMs;
  late CameraResolutionPreset _resolution;
  late bool _torchEnabled;

  int _fps = EncoderDefaults.fps;
  String _ecc = EncoderDefaults.errorCorrection;
  int _packetSize = EncoderDefaults.packetSize;
  double _raptorqOverhead = EncoderDefaults.raptorqOverhead;
  int _targetSize = EncoderDefaults.targetQrSize;
  bool _compressionEnabled = EncoderDefaults.compressionEnabled;
  bool _forceChunkMode = false;
  int _customChunkSize = 10;

  List<String> _desktopCameraDevices = const [];
  String? _selectedDesktopCameraName;
  MobileCameraFacingPreference _mobileCameraFacing =
      MobileCameraFacingPreference.back;

  SyncSettings _syncSettings = const SyncSettings();
  SettingsExportConfig _exportConfig = const SettingsExportConfig();
  bool _isSyncTesting = false;
  SettingsSyncFeedback? _syncFeedback;
  _ServerConnectivityStatus _serverConnectivityStatus =
      _ServerConnectivityStatus.unavailable;
  bool _isSyncing = false;
  bool _isStartingLocalServer = false;
  String? _localServerFeedback;
  bool _isStartingOfflineWebServer = false;
  String? _offlineWebServerFeedback;
  bool _isExportConfigLoading = false;
  String? _exportConfigError;
  bool _exportConfigSaved = false;
  Timer? _exportConfigSavedTimer;
  StreamSubscription<bool>? _serverConnectionSubscription;
  _SettingsSection? _selectedSettingsSection;

  static const primaryColor = AirQrTheme.accentBlue;
  static const _aboutVersion = 'v1.0';
  static const _aboutAuthor = 'Thunzyy';
  static final Uri _aboutAuthorUrl = Uri.parse('https://github.com/Thunzyy');
  static final Uri _aboutRepoUrl = Uri.parse(
    'https://github.com/Thunzyy/AirQR',
  );

  bool get _isDarkMode => Theme.of(context).brightness == Brightness.dark;
  Color get _pageBackgroundColor => AirQrTheme.background(context);
  Color get _cardBackgroundColor => AirQrTheme.card(context);
  Color get _fieldBackgroundColor => AirQrTheme.actionSurface(context);
  Color get _primaryTextColor => AirQrTheme.textPrimary(context);
  Color get _secondaryTextColor => AirQrTheme.textSecondary(context);
  Color get _subtleBorderColor => AirQrTheme.controlBorder(context);
  Color get _segmentedBackgroundColor => AirQrTheme.navSurface(context);
  Color get _clearButtonBackgroundColor => AirQrTheme.actionSurface(context);
  Color get _clearButtonForegroundColor => AirQrTheme.textPrimary(context);
  Color get _dangerSnackColor => AirQrTheme.destructive;
  bool get _supportsDesktopCameraSelection =>
      Platform.isWindows || Platform.isLinux;
  bool get _supportsMobileCameraSelection =>
      Platform.isAndroid || Platform.isIOS || Platform.isMacOS;

  @override
  void initState() {
    super.initState();
    _pageController = widget.pageController ?? SettingsPageController();
    _syncController = widget.syncController ?? SettingsSyncController();
    _maintenanceService =
        widget.maintenanceService ?? SettingsMaintenanceService();
    _exportConfigController =
        widget.exportConfigController ?? SettingsExportConfigController();
    _localServerController =
        widget.localServerController ?? LocalSyncServerController();
    _offlineWebServerController =
        widget.offlineWebServerController ?? OfflineWebServerController();
    _serverConnectionSubscription = WebSocketSyncService
        .instance
        .connectionStates
        .listen(_onServerConnectionChanged);
    _selectedSettingsSection = _settingsSectionFor(widget.requestedSection);
    _loadSettings();
  }

  @override
  void didUpdateWidget(covariant SettingsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.requestedSectionRevision != oldWidget.requestedSectionRevision) {
      final targetSection = _settingsSectionFor(widget.requestedSection);
      if (targetSection != null) {
        setState(() {
          _selectedSettingsSection = targetSection;
        });
      }
    }
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _exportDirController.dispose();
    _exportConfigSavedTimer?.cancel();
    _serverConnectionSubscription?.cancel();
    super.dispose();
  }

  void _onServerConnectionChanged(bool connected) {
    if (!mounted) return;
    setState(() {
      _serverConnectivityStatus = connected
          ? _ServerConnectivityStatus.connected
          : _ServerConnectivityStatus.unavailable;
    });
  }

  _SettingsSection? _settingsSectionFor(SettingsPageSectionTarget? target) {
    switch (target) {
      case SettingsPageSectionTarget.offlineWeb:
        return _SettingsSection.offlineWeb;
      case null:
        return null;
    }
  }

  Future<void> _loadSettings() async {
    final snapshot = await _pageController.load();

    _selectedPreset = snapshot.selectedPreset;
    _settings = snapshot.scannerSettings;
    _fps = snapshot.encoderSettings.fps;
    _ecc = snapshot.encoderSettings.ecc;
    _packetSize = snapshot.encoderSettings.packetSize;
    _raptorqOverhead = snapshot.encoderSettings.raptorqOverhead;
    _targetSize = snapshot.encoderSettings.targetSize;
    _compressionEnabled = snapshot.encoderSettings.compressionEnabled;
    _forceChunkMode = snapshot.encoderSettings.forceChunkMode;
    _customChunkSize = snapshot.encoderSettings.customChunkSize;
    _syncSettings = snapshot.syncSettings;
    _serverConnectivityStatus = WebSocketSyncService.instance.isConnected
        ? _ServerConnectivityStatus.connected
        : _ServerConnectivityStatus.unavailable;
    _serverUrlController.text = _syncSettings.serverUrl;
    _usernameController.text = _syncSettings.username ?? '';
    _passwordController.text = _syncSettings.password ?? '';
    _desktopCameraDevices = snapshot.desktopCameraSelection.devices;
    _selectedDesktopCameraName =
        snapshot.desktopCameraSelection.selectedDeviceName;
    _mobileCameraFacing = snapshot.mobileCameraFacing;

    _detectionSpeed = _settings.detectionSpeed;
    _detectionTimeoutMs = _settings.detectionTimeoutMs;
    _resolution = _settings.resolutionPreset;
    _torchEnabled = _settings.torchEnabled;

    if (!mounted) return;
    setState(() {
      _isLoading = false;
    });
    if (_syncSettings.isConfigured) {
      unawaited(_loadExportConfig());
    }
    unawaited(_refreshLocalServerStatus());
  }

  Future<void> _refreshLocalServerStatus() async {
    try {
      await _localServerController.refreshStatus();
    } catch (_) {
      // Local server restoration is best-effort; settings must remain usable
      // even if the platform cannot expose the app support directory.
    }
    if (!mounted) return;
    final restoredLocalServerUrl = _localServerController.serverUrl;
    var shouldPersistRestoredUrl = false;
    setState(() {
      if (restoredLocalServerUrl != null &&
          _shouldReplaceWithRestoredLocalServerUrl(
            _serverUrlController.text.trim(),
          )) {
        _serverUrlController.text = restoredLocalServerUrl;
        _syncSettings = _syncSettings.copyWith(
          serverUrl: restoredLocalServerUrl,
        );
        shouldPersistRestoredUrl = true;
      }
    });
    if (shouldPersistRestoredUrl) {
      unawaited(_saveSyncSettings());
    }
  }

  Future<void> _loadDesktopCameraSettings() async {
    final selection = await _pageController.loadDesktopCameraSelection();
    _desktopCameraDevices = selection.devices;
    _selectedDesktopCameraName = selection.selectedDeviceName;
  }

  Future<void> _saveDesktopCameraPreference(String? deviceName) async {
    final selection = await _pageController.saveDesktopCameraPreference(
      deviceName,
    );
    if (!mounted) return;
    setState(() {
      _desktopCameraDevices = selection.devices;
      _selectedDesktopCameraName = selection.selectedDeviceName;
    });
    widget.settingsChangedNotifier.value++;
  }

  Future<void> _refreshDesktopCameraDevices() async {
    await _loadDesktopCameraSettings();
    if (!mounted) return;
    setState(() {});
  }

  Future<void> _saveMobileCameraPreference(
    MobileCameraFacingPreference facing,
  ) async {
    final savedFacing = await _pageController.saveMobileCameraPreference(
      facing,
    );
    if (!mounted) return;
    setState(() {
      _mobileCameraFacing = savedFacing;
    });
    widget.settingsChangedNotifier.value++;
  }

  Future<void> _saveSettings() async {
    await _pageController.saveSettings(
      selectedPreset: _selectedPreset,
      scannerSettings: _settings,
      encoderSettings: EncoderSettingsData(
        fps: _fps,
        ecc: _ecc,
        packetSize: _packetSize,
        raptorqOverhead: _raptorqOverhead,
        targetSize: _targetSize,
        compressionEnabled: _compressionEnabled,
        forceChunkMode: _forceChunkMode,
        customChunkSize: _customChunkSize,
      ),
    );

    widget.settingsChangedNotifier.value++;
  }

  void _onPresetChanged(ScannerPreset? preset) {
    if (preset == null) return;
    setState(() {
      _selectedPreset = preset;
      if (preset != ScannerPreset.custom) {
        _settings = ScannerSettings.fromPreset(preset);
        _detectionSpeed = _settings.detectionSpeed;
        _detectionTimeoutMs = _settings.detectionTimeoutMs;
        _resolution = _settings.resolutionPreset;
        _torchEnabled = _settings.torchEnabled;
      }
    });
    _saveSettings();
  }

  void _onAdvancedChanged() {
    setState(() {
      _selectedPreset = ScannerPreset.custom;
      _settings = ScannerSettings(
        detectionSpeed: _detectionSpeed,
        detectionTimeoutMs: _detectionTimeoutMs,
        resolutionPreset: _resolution,
        formats: [BarcodeFormat.qrCode],
        torchEnabled: _torchEnabled,
      );
    });
    _saveSettings();
  }

  Future<void> _saveSyncSettings() async {
    _syncSettings = await _syncController.saveDraft(
      baseSettings: _syncSettings,
      serverUrl: _serverUrlController.text,
      username: _usernameController.text,
      password: _passwordController.text,
    );
    widget.settingsChangedNotifier.value++;
    if (_syncSettings.isConfigured) {
      unawaited(_loadExportConfig());
    }
  }

  Future<void> _testSyncConnection() async {
    setState(() {
      _isSyncTesting = true;
      _syncFeedback = null;
    });

    final feedback = await _syncController.testConnection(
      baseSettings: _syncSettings,
      serverUrl: _serverUrlController.text,
      username: _usernameController.text,
      password: _passwordController.text,
    );

    if (!mounted) return;
    setState(() {
      _isSyncTesting = false;
      _syncFeedback = feedback;
      _serverConnectivityStatus = feedback.isSuccess
          ? _ServerConnectivityStatus.connected
          : _ServerConnectivityStatus.unavailable;
      _syncSettings = _syncController.buildDraft(
        baseSettings: _syncSettings,
        serverUrl: _serverUrlController.text,
        username: _usernameController.text,
        password: _passwordController.text,
      );
    });
    if (_syncSettings.isConfigured && feedback.isSuccess) {
      unawaited(_loadExportConfig());
    }
  }

  Future<void> _loadExportConfig() async {
    if (!_syncSettings.isConfigured) return;
    setState(() {
      _isExportConfigLoading = true;
      _exportConfigError = null;
    });

    try {
      final config = await _exportConfigController.load(_syncSettings);
      if (!mounted) return;
      setState(() {
        _exportConfig = config;
        _exportDirController.text = config.exportDir ?? '';
        _isExportConfigLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isExportConfigLoading = false;
        _exportConfigError = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _saveExportConfig(Object? updates) async {
    final settings = _syncController.buildDraft(
      baseSettings: _syncSettings,
      serverUrl: _serverUrlController.text,
      username: _usernameController.text,
      password: _passwordController.text,
    );
    if (!settings.isConfigured) return;

    setState(() {
      _isExportConfigLoading = true;
      _exportConfigError = null;
      _exportConfigSaved = false;
    });

    try {
      final config = await _exportConfigController.save(settings, updates);
      if (!mounted) return;
      _exportConfigSavedTimer?.cancel();
      _exportConfigSavedTimer = Timer(const Duration(seconds: 2), () {
        if (!mounted) return;
        setState(() => _exportConfigSaved = false);
      });
      setState(() {
        _syncSettings = settings;
        _exportConfig = config;
        _exportDirController.text = config.exportDir ?? '';
        _isExportConfigLoading = false;
        _exportConfigSaved = true;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isExportConfigLoading = false;
        _exportConfigError = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _performSync() async {
    setState(() {
      _isSyncing = true;
      _syncFeedback = null;
    });

    final feedback = await _syncController.performSync();

    if (!mounted) return;
    setState(() {
      _isSyncing = false;
      _syncFeedback = feedback;
      _serverConnectivityStatus = feedback.isSuccess
          ? _ServerConnectivityStatus.connected
          : _ServerConnectivityStatus.unavailable;
    });
  }

  int _defaultLocalServerPort() {
    final uri = Uri.tryParse(_serverUrlController.text.trim());
    if (uri != null && uri.hasPort) {
      return uri.port;
    }
    return 8081;
  }

  bool _shouldReplaceWithRestoredLocalServerUrl(String currentUrl) {
    if (currentUrl.isEmpty) return true;
    final uri = Uri.tryParse(currentUrl);
    final host = uri?.host.toLowerCase();
    return host == '127.0.0.1' ||
        host == 'localhost' ||
        host == '0.0.0.0' ||
        host == '::1';
  }

  Future<void> _showLocalServerDialog() async {
    final l10n = AppLocalizations.of(context)!;
    final username = TextEditingController(
      text: _usernameController.text.trim().isEmpty
          ? 'admin'
          : _usernameController.text.trim(),
    );
    final password = TextEditingController(
      text: _passwordController.text.isEmpty
          ? 'admin'
          : _passwordController.text,
    );
    final port = TextEditingController(
      text: _defaultLocalServerPort().toString(),
    );

    final result = await showDialog<_LocalServerDialogResult>(
      context: context,
      builder: (dialogContext) {
        final palette = _sectionPalette();
        return AlertDialog(
          backgroundColor: palette.cardBackgroundColor,
          title: Text(
            l10n.settings_localServerDialogTitle,
            style: TextStyle(color: palette.primaryTextColor),
          ),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  key: const Key('local-server-username'),
                  controller: username,
                  style: TextStyle(color: palette.primaryTextColor),
                  decoration: InputDecoration(
                    labelText: l10n.settings_username,
                    labelStyle: TextStyle(color: palette.secondaryTextColor),
                    filled: true,
                    fillColor: palette.fieldBackgroundColor,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('local-server-password'),
                  controller: password,
                  obscureText: true,
                  style: TextStyle(color: palette.primaryTextColor),
                  decoration: InputDecoration(
                    labelText: l10n.settings_password,
                    labelStyle: TextStyle(color: palette.secondaryTextColor),
                    filled: true,
                    fillColor: palette.fieldBackgroundColor,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('local-server-port'),
                  controller: port,
                  keyboardType: TextInputType.number,
                  style: TextStyle(color: palette.primaryTextColor),
                  decoration: InputDecoration(
                    labelText: l10n.settings_localServerPort,
                    labelStyle: TextStyle(color: palette.secondaryTextColor),
                    filled: true,
                    fillColor: palette.fieldBackgroundColor,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              style: TextButton.styleFrom(
                foregroundColor: palette.primaryTextColor,
                shape: const StadiumBorder(),
                padding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 12,
                ),
              ),
              child: Text(l10n.common_cancel),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: AirQrTheme.primaryButtonSurface(dialogContext),
                foregroundColor: AirQrTheme.primaryButtonForeground(
                  dialogContext,
                ),
                shape: const StadiumBorder(),
                padding: const EdgeInsets.symmetric(
                  horizontal: 22,
                  vertical: 12,
                ),
              ),
              onPressed: () {
                Navigator.of(dialogContext).pop(
                  _LocalServerDialogResult(
                    username: username.text,
                    password: password.text,
                    port: int.tryParse(port.text) ?? 8081,
                  ),
                );
              },
              child: Text(l10n.settings_startServer),
            ),
          ],
        );
      },
    );

    if (result == null) return;
    await _startLocalServer(result);
  }

  Future<void> _startLocalServer(_LocalServerDialogResult request) async {
    setState(() {
      _isStartingLocalServer = true;
      _localServerFeedback = null;
      _syncFeedback = null;
    });

    final result = await _localServerController.start(
      username: request.username,
      password: request.password,
      port: request.port,
    );

    if (!mounted) return;
    if (!result.success || result.serverUrl == null) {
      setState(() {
        _isStartingLocalServer = false;
        _localServerFeedback =
            result.error ??
            AppLocalizations.of(context)!.settings_localServerStartFailed;
      });
      return;
    }

    _serverUrlController.text = result.serverUrl!;
    _usernameController.text = request.username.trim();
    _passwordController.text = request.password;
    _syncSettings = _syncSettings.copyWith(
      enabled: true,
      serverUrl: result.serverUrl,
      username: request.username.trim(),
      password: request.password,
    );
    await _saveSyncSettings();
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _isStartingLocalServer = false;
      _localServerFeedback = l10n.settings_localServerRunningOn(
        result.serverUrl!,
      );
    });
    await _testSyncConnection();
  }

  Future<void> _stopLocalServer() async {
    await _localServerController.stop();
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _isStartingLocalServer = false;
      _localServerFeedback = l10n.settings_localServerStopped;
      _serverConnectivityStatus = _ServerConnectivityStatus.unavailable;
    });
  }

  Future<void> _startOfflineWebServer() async {
    setState(() {
      _isStartingOfflineWebServer = true;
      _offlineWebServerFeedback = null;
    });

    final result = await _offlineWebServerController.start();

    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _isStartingOfflineWebServer = false;
      _offlineWebServerFeedback = result.success && result.serverUrl != null
          ? l10n.settings_offlineWebRunningOn(result.serverUrl!)
          : result.error ?? l10n.settings_offlineWebStartFailed;
    });
  }

  Future<void> _stopOfflineWebServer() async {
    await _offlineWebServerController.stop();
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _isStartingOfflineWebServer = false;
      _offlineWebServerFeedback = l10n.settings_offlineWebStopped;
    });
  }

  Future<void> _copyOfflineWebServerUrl(String url) async {
    await Clipboard.setData(ClipboardData(text: url));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(AppLocalizations.of(context)!.settings_offlineWebCopied),
        backgroundColor: AirQrTheme.success,
      ),
    );
  }

  Future<void> _openOfflineWebServerUrl(String url) async {
    await _openExternalUrl(Uri.parse(url));
  }

  SettingsSectionPalette _sectionPalette() {
    return SettingsSectionPalette(
      isDarkMode: _isDarkMode,
      primaryColor: primaryColor,
      cardBackgroundColor: _cardBackgroundColor,
      fieldBackgroundColor: _fieldBackgroundColor,
      primaryTextColor: _primaryTextColor,
      secondaryTextColor: _secondaryTextColor,
      subtleBorderColor: _subtleBorderColor,
      segmentedBackgroundColor: _segmentedBackgroundColor,
      clearButtonBackgroundColor: _clearButtonBackgroundColor,
      clearButtonForegroundColor: _clearButtonForegroundColor,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        backgroundColor: _pageBackgroundColor,
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return PopScope(
      canPop: !widget.isActive || _selectedSettingsSection == null,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && widget.isActive && _selectedSettingsSection != null) {
          setState(() {
            _selectedSettingsSection = null;
          });
        }
      },
      child: Scaffold(
        backgroundColor: _pageBackgroundColor,
        body: SafeArea(
          child: _selectedSettingsSection == null
              ? _buildSettingsMenu(context)
              : _buildSettingsDetail(context),
        ),
      ),
    );
  }

  Widget _buildSettingsMenu(BuildContext context) {
    final entries = _settingsMenuEntries(context);
    return ListView(
      key: const Key('settings-menu-list'),
      padding: EdgeInsets.fromLTRB(
        16,
        8,
        16,
        settingsBottomNavigationClearance(context),
      ),
      children: [
        Container(
          decoration: BoxDecoration(
            color: _cardBackgroundColor,
            borderRadius: AirQrRadii.card,
            border: Border.all(color: _subtleBorderColor),
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            children: [
              for (final entry in entries)
                _SettingsMenuRow(
                  entry: entry,
                  textColor: _primaryTextColor,
                  secondaryTextColor: _secondaryTextColor,
                  hoverColor: _fieldBackgroundColor,
                  onTap: () {
                    setState(() {
                      _selectedSettingsSection = entry.section;
                    });
                  },
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSettingsDetail(BuildContext context) {
    final selectedSection = _selectedSettingsSection;
    final selectedEntry = _settingsMenuEntries(
      context,
    ).firstWhere((entry) => entry.section == selectedSection);

    return ListView(
      key: const Key('settings-detail-list'),
      padding: EdgeInsets.fromLTRB(
        16,
        8,
        16,
        settingsBottomNavigationClearance(context),
      ),
      children: [
        _SettingsDetailHeader(
          title: selectedEntry.label,
          textColor: _primaryTextColor,
          buttonColor: _fieldBackgroundColor,
          borderColor: _subtleBorderColor,
          onBack: () {
            setState(() {
              _selectedSettingsSection = null;
            });
          },
        ),
        const SizedBox(height: 16),
        ..._buildSelectedSectionWidgets(context, selectedSection),
      ],
    );
  }

  List<Widget> _buildSelectedSectionWidgets(
    BuildContext context,
    _SettingsSection? section,
  ) {
    switch (section) {
      case _SettingsSection.encoder:
        return [_buildEncoderSection()];
      case _SettingsSection.scanner:
        return [
          _buildScannerPresetSection(),
          const SizedBox(height: 16),
          _buildScannerAdvancedSection(context),
        ];
      case _SettingsSection.sync:
        return [_buildSyncSection()];
      case _SettingsSection.offlineWeb:
        return [_buildOfflineWebSection()];
      case _SettingsSection.appearance:
        return [_buildAppearanceSection(context)];
      case _SettingsSection.logging:
        return [_SettingsLoggingSection(palette: _sectionPalette())];
      case _SettingsSection.about:
        return [_buildAboutSection()];
      case null:
        return const [];
    }
  }

  Widget _buildEncoderSection() {
    return SettingsEncoderSection(
      palette: _sectionPalette(),
      fps: _fps,
      ecc: _ecc,
      packetSize: _packetSize,
      raptorqOverhead: _raptorqOverhead,
      targetSize: _targetSize,
      compressionEnabled: _compressionEnabled,
      forceChunkMode: _forceChunkMode,
      customChunkSize: _customChunkSize,
      onFpsChanged: (v) => setState(() => _fps = v.round()),
      onPersist: _saveSettings,
      onEccChanged: (v) => setState(() {
        _ecc = v;
        _saveSettings();
      }),
      onPacketSizeChanged: (v) => setState(() => _packetSize = v.round()),
      onRaptorqOverheadChanged: (v) =>
          setState(() => _raptorqOverhead = double.parse(v.toStringAsFixed(2))),
      onTargetSizeChanged: (v) => setState(() => _targetSize = v.round()),
      onCompressionChanged: (v) {
        setState(() => _compressionEnabled = v);
        _saveSettings();
      },
      onForceChunkModeChanged: (v) {
        setState(() => _forceChunkMode = v);
        _saveSettings();
      },
      onCustomChunkSizeChanged: (v) =>
          setState(() => _customChunkSize = v.round()),
    );
  }

  Widget _buildScannerPresetSection() {
    return SettingsScannerPresetSection(
      palette: _sectionPalette(),
      selectedPreset: _selectedPreset,
      onPresetChanged: _onPresetChanged,
    );
  }

  Widget _buildScannerAdvancedSection(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SettingsScannerAdvancedSection(
      palette: _sectionPalette(),
      resolutionValue: _resolutionToString(_resolution),
      onResolutionChanged: (v) {
        setState(() {
          _resolution = _stringToResolution(v);
          _onAdvancedChanged();
        });
      },
      detectionSpeedValue: _detectionSpeedToString(_detectionSpeed, l10n),
      detectionSpeedOptions: [l10n.settings_fast, l10n.settings_accurate],
      onDetectionSpeedChanged: (v) {
        setState(() {
          _detectionSpeed = _stringToDetectionSpeed(v, l10n);
          _onAdvancedChanged();
        });
      },
      detectionTimeoutMs: _detectionTimeoutMs,
      onDetectionTimeoutChanged: (v) =>
          setState(() => _detectionTimeoutMs = v.round()),
      onDetectionTimeoutPersist: _onAdvancedChanged,
      torchEnabled: _torchEnabled,
      onTorchChanged: (v) {
        setState(() {
          _torchEnabled = v;
          _onAdvancedChanged();
        });
      },
      supportsDesktopCameraSelection: _supportsDesktopCameraSelection,
      supportsMobileCameraSelection: _supportsMobileCameraSelection,
      desktopCameraDevices: _desktopCameraDevices,
      selectedDesktopCameraName: _selectedDesktopCameraName,
      mobileCameraFacing: _mobileCameraFacing,
      onSaveDesktopCameraPreference: _saveDesktopCameraPreference,
      onRefreshDesktopCameraDevices: _refreshDesktopCameraDevices,
      onSaveMobileCameraPreference: _saveMobileCameraPreference,
    );
  }

  Widget _buildSyncSection() {
    return SettingsSyncSection(
      palette: _sectionPalette(),
      syncSettings: _syncSettings,
      serverUrlController: _serverUrlController,
      usernameController: _usernameController,
      passwordController: _passwordController,
      isSyncTesting: _isSyncTesting,
      syncFeedback: _syncFeedback,
      isServerConnected:
          _serverConnectivityStatus == _ServerConnectivityStatus.connected,
      isSyncing: _isSyncing,
      canLaunchLocalServer: _localServerController.canStartOnThisPlatform,
      isStartingLocalServer: _isStartingLocalServer,
      isLocalServerRunning: _localServerController.isRunning,
      localServerUrl: _localServerController.serverUrl,
      localServerFeedback: _localServerFeedback,
      exportConfig: _exportConfig,
      exportDirController: _exportDirController,
      isExportConfigLoading: _isExportConfigLoading,
      exportConfigError: _exportConfigError,
      exportConfigSaved: _exportConfigSaved,
      onSyncEnabledChanged: (v) async {
        setState(() {
          _syncSettings = _syncSettings.copyWith(enabled: v);
          if (!v) {
            _serverConnectivityStatus = _ServerConnectivityStatus.unavailable;
          }
          if (v && _serverUrlController.text.isEmpty) {
            _serverUrlController.text = 'https://airqr.example.com';
            _syncSettings = _syncSettings.copyWith(
              serverUrl: _serverUrlController.text,
            );
          }
        });
        await _saveSyncSettings();
      },
      onSaveSyncDraft: () async {
        setState(() {
          _serverConnectivityStatus = _ServerConnectivityStatus.unavailable;
        });
        await _saveSyncSettings();
      },
      onSyncScannedChanged: (v) {
        setState(() {
          _syncSettings = _syncSettings.copyWith(syncScanned: v);
        });
        _saveSyncSettings();
      },
      onSyncGeneratedChanged: (v) {
        setState(() {
          _syncSettings = _syncSettings.copyWith(syncGenerated: v);
        });
        _saveSyncSettings();
      },
      onAutoSyncChanged: (v) {
        setState(() {
          _syncSettings = _syncSettings.copyWith(autoSync: v);
        });
        _saveSyncSettings();
      },
      onTestConnection: _testSyncConnection,
      onPerformSync: _performSync,
      onLaunchLocalServer: _showLocalServerDialog,
      onStopLocalServer: _stopLocalServer,
      onExportEnabledChanged: (v) => _saveExportConfig({'enabled': v}),
      onExportScannedChanged: (v) => _saveExportConfig({'exportScanned': v}),
      onExportGeneratedChanged: (v) =>
          _saveExportConfig({'exportGenerated': v}),
      onSaveExportDirectory: () => _saveExportConfig({
        'exportDir': _exportDirController.text.trim().isEmpty
            ? null
            : _exportDirController.text.trim(),
      }),
    );
  }

  Widget _buildOfflineWebSection() {
    return SettingsOfflineWebServerSection(
      palette: _sectionPalette(),
      isStarting: _isStartingOfflineWebServer,
      isRunning: _offlineWebServerController.isRunning,
      serverUrl: _offlineWebServerController.serverUrl,
      networkUrls: _offlineWebServerController.networkUrls,
      feedback: _offlineWebServerFeedback,
      onStart: _startOfflineWebServer,
      onStop: _stopOfflineWebServer,
      onCopyUrl: _copyOfflineWebServerUrl,
      onOpenUrl: _openOfflineWebServerUrl,
    );
  }

  Widget _buildAppearanceSection(BuildContext context) {
    return SettingsAppearanceSection(
      palette: _sectionPalette(),
      languageValue: _getLanguageDropdownValue(context),
      onLanguageChanged: (value) {
        if (value == 'system') {
          AppPreferencesScope.setLocale(context, null);
        } else if (value != null) {
          AppPreferencesScope.setLocale(context, Locale(value));
        }
      },
      themeValue: _getThemeDropdownValue(context),
      onThemeChanged: (value) => AppPreferencesScope.setThemeMode(
        context,
        _themeModeFromDropdown(value),
      ),
      onClearAllAppData: _confirmClearAllAppData,
    );
  }

  Widget _buildAboutSection() {
    return SettingsAboutSection(
      palette: _sectionPalette(),
      version: _aboutVersion,
      author: _aboutAuthor,
      onOpenAuthorUrl: () => _openExternalUrl(_aboutAuthorUrl),
      onOpenRepoUrl: () => _openExternalUrl(_aboutRepoUrl),
    );
  }

  List<_SettingsMenuEntry> _settingsMenuEntries(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return [
      _SettingsMenuEntry(
        section: _SettingsSection.encoder,
        iconName: 'qr_code_2',
        label: l10n.settings_encoderMenu,
        description:
            '$_fps ${l10n.common_fps} - $_packetSize ${l10n.common_bytes}',
      ),
      _SettingsMenuEntry(
        section: _SettingsSection.scanner,
        iconName: 'qr_code_scanner',
        label: l10n.settings_scannerMenu,
        description: _scannerPresetLabel(context, _selectedPreset),
      ),
      _SettingsMenuEntry(
        section: _SettingsSection.sync,
        iconName: 'cloud',
        label: l10n.settings_serverSyncMenu,
        description: _syncSettings.enabled
            ? l10n.settings_syncEnabled
            : l10n.settings_syncDisabled,
      ),
      _SettingsMenuEntry(
        section: _SettingsSection.offlineWeb,
        iconName: 'wifi_tethering',
        label: l10n.settings_offlineWebTitle,
        description: _offlineWebServerController.isRunning
            ? _offlineWebServerController.serverUrl ??
                  l10n.settings_offlineWebRunning
            : l10n.settings_offlineWebMenuDesc,
      ),
      _SettingsMenuEntry(
        section: _SettingsSection.appearance,
        iconName: 'settings',
        label: l10n.settings_appearanceMenu,
        description: _themeLabel(context),
      ),
      _SettingsMenuEntry(
        section: _SettingsSection.logging,
        iconName: 'description',
        label: l10n.settings_loggingMenu,
        description: l10n.settings_logInfo,
      ),
      _SettingsMenuEntry(
        section: _SettingsSection.about,
        iconName: 'info',
        label: l10n.settings_aboutMenu,
        description: _aboutVersion,
      ),
    ];
  }

  String _scannerPresetLabel(BuildContext context, ScannerPreset preset) {
    final l10n = AppLocalizations.of(context)!;
    switch (preset) {
      case ScannerPreset.turbo:
        return l10n.settings_preset_turbo;
      case ScannerPreset.fast:
        return l10n.settings_preset_fast;
      case ScannerPreset.balanced:
        return l10n.settings_preset_balanced;
      case ScannerPreset.reliable:
        return l10n.settings_preset_reliable;
      case ScannerPreset.custom:
        return l10n.settings_preset_custom;
      case ScannerPreset.silent:
        return l10n.settings_preset_silent;
    }
  }

  String _themeLabel(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    switch (_getThemeDropdownValue(context)) {
      case 'light':
        return l10n.settings_themeLight;
      case 'dark':
        return l10n.settings_themeDark;
      default:
        return l10n.settings_themeSystem;
    }
  }

  String _getLanguageDropdownValue(BuildContext context) {
    return settingsLanguageDropdownValue(
      AppPreferencesScope.getLocale(context),
    );
  }

  String _getThemeDropdownValue(BuildContext context) {
    return settingsThemeDropdownValue(
      AppPreferencesScope.getThemeMode(context),
    );
  }

  ThemeMode _themeModeFromDropdown(String value) {
    return settingsThemeModeFromDropdown(value);
  }

  Future<void> _confirmClearAllAppData() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: _cardBackgroundColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          l10n.settings_clearData,
          style: TextStyle(
            color: _primaryTextColor,
            fontWeight: FontWeight.w700,
          ),
        ),
        content: Text(
          l10n.settings_clearDataConfirm,
          style: TextStyle(color: _secondaryTextColor),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.common_cancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AirQrTheme.destructive,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: const StadiumBorder(),
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.common_delete),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await _maintenanceService.clearAllLocalData();
      if (!mounted) return;
      AppPreferencesScope.setLocale(context, null);
      AppPreferencesScope.setThemeMode(context, ThemeMode.system);
      await _loadSettings();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.settings_clearDataFailed),
          backgroundColor: _dangerSnackColor,
        ),
      );
    }
  }

  Future<void> _openExternalUrl(Uri uri) async {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  String _resolutionToString(CameraResolutionPreset resolution) {
    return settingsResolutionToString(resolution);
  }

  CameraResolutionPreset _stringToResolution(String value) {
    return settingsResolutionFromString(value);
  }

  String _detectionSpeedToString(
    DetectionSpeed detectionSpeed,
    AppLocalizations l10n,
  ) {
    return settingsDetectionSpeedToString(detectionSpeed, l10n);
  }

  DetectionSpeed _stringToDetectionSpeed(String value, AppLocalizations l10n) {
    return settingsDetectionSpeedFromString(value, l10n);
  }
}

class _SettingsMenuRow extends StatelessWidget {
  final _SettingsMenuEntry entry;
  final Color textColor;
  final Color secondaryTextColor;
  final Color hoverColor;
  final VoidCallback onTap;

  const _SettingsMenuRow({
    required this.entry,
    required this.textColor,
    required this.secondaryTextColor,
    required this.hoverColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        hoverColor: hoverColor,
        highlightColor: hoverColor.withValues(alpha: 0.7),
        splashColor: Colors.transparent,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 64),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 10),
            child: Row(
              children: [
                SizedBox(
                  width: 42,
                  child: Center(
                    child: AirQrIcon(
                      entry.iconName,
                      size: 30,
                      color: textColor,
                    ),
                  ),
                ),
                const SizedBox(width: 18),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        entry.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 20,
                          height: 1.2,
                          fontWeight: FontWeight.w600,
                          color: textColor,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        entry.description,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                          color: secondaryTextColor,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SettingsDetailHeader extends StatelessWidget {
  final String title;
  final Color textColor;
  final Color buttonColor;
  final Color borderColor;
  final VoidCallback onBack;

  const _SettingsDetailHeader({
    required this.title,
    required this.textColor,
    required this.buttonColor,
    required this.borderColor,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Semantics(
          container: true,
          label: AppLocalizations.of(context)!.settings_backToSettings,
          button: true,
          onTap: onBack,
          child: ExcludeSemantics(
            child: SizedBox(
              width: 48,
              height: 48,
              child: Center(
                child: Material(
                  key: const Key('settings-detail-back-visual'),
                  color: buttonColor,
                  shape: CircleBorder(side: BorderSide(color: borderColor)),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: onBack,
                    child: SizedBox(
                      width: 36,
                      height: 36,
                      child: Center(
                        child: AirQrIcon(
                          'arrow_back',
                          key: const Key('settings-detail-back-icon'),
                          size: 20,
                          color: textColor,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(color: textColor),
          ),
        ),
      ],
    );
  }
}

class _SettingsLoggingSection extends StatefulWidget {
  final SettingsSectionPalette palette;

  const _SettingsLoggingSection({required this.palette});

  @override
  State<_SettingsLoggingSection> createState() =>
      _SettingsLoggingSectionState();
}

class _SettingsLoggingSectionState extends State<_SettingsLoggingSection> {
  static const _levels = ['debug', 'info', 'warn', 'error'];
  static const _modules = [
    'services',
    'workers',
    'hooks',
    'scanner',
    'ui',
    'app',
  ];

  String _level = 'info';
  final Set<String> _enabledModules = {..._modules};

  @override
  Widget build(BuildContext context) {
    final palette = widget.palette;
    final l10n = AppLocalizations.of(context)!;
    final levelLabels = <String, String>{
      'debug': l10n.settings_logDebug,
      'info': l10n.settings_logInfo,
      'warn': l10n.settings_logWarn,
      'error': l10n.settings_logError,
    };
    final moduleLabels = <String, String>{
      'services': l10n.settings_moduleServices,
      'workers': l10n.settings_moduleWorkers,
      'hooks': l10n.settings_moduleHooks,
      'scanner': l10n.settings_moduleScanner,
      'ui': l10n.settings_moduleUi,
      'app': l10n.settings_moduleApp,
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SettingsCard(
          backgroundColor: palette.cardBackgroundColor,
          borderColor: palette.subtleBorderColor,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.settings_logLevel,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: palette.primaryTextColor,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  SettingsSegmentedControl(
                    options: _levels
                        .map((level) => levelLabels[level]!)
                        .toList(),
                    value: levelLabels[_level]!,
                    onChanged: (next) => setState(
                      () => _level = levelLabels.entries
                          .firstWhere((entry) => entry.value == next)
                          .key,
                    ),
                    selectedColor: AirQrTheme.navActive(context),
                    backgroundColor: AirQrTheme.controlSurface(context),
                    unselectedTextColor: palette.secondaryTextColor,
                  ),
                ],
              ),
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SizedBox(
              width: double.infinity,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.settings_modules,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: palette.primaryTextColor,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final module in _modules)
                          _SettingsLoggingChip(
                            label: moduleLabels[module]!,
                            selected: _enabledModules.contains(module),
                            palette: palette,
                            onTap: () => setState(() {
                              if (_enabledModules.contains(module)) {
                                _enabledModules.remove(module);
                              } else {
                                _enabledModules.add(module);
                              }
                            }),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            Padding(
              padding: const EdgeInsets.all(16),
              child: FilledButton(
                onPressed: () => setState(() {
                  _level = 'info';
                  _enabledModules
                    ..clear()
                    ..addAll(_modules);
                }),
                style: FilledButton.styleFrom(
                  backgroundColor: AirQrTheme.actionSurface(context),
                  foregroundColor: palette.primaryTextColor,
                  disabledBackgroundColor: palette.fieldBackgroundColor,
                  disabledForegroundColor: palette.secondaryTextColor,
                  minimumSize: const Size.fromHeight(48),
                  shape: const StadiumBorder(),
                  elevation: 0,
                  shadowColor: Colors.transparent,
                ),
                child: Text(
                  l10n.settings_resetToDefaults,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _SettingsLoggingChip extends StatelessWidget {
  final String label;
  final bool selected;
  final SettingsSectionPalette palette;
  final VoidCallback? onTap;

  const _SettingsLoggingChip({
    required this.label,
    required this.selected,
    required this.palette,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final surfaceColor = selected
        ? AirQrTheme.primaryButtonSurface(context)
        : AirQrTheme.controlSurface(context);
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: Semantics(
        button: true,
        selected: selected,
        enabled: onTap != null,
        label: label,
        onTap: onTap,
        child: ExcludeSemantics(
          child: TweenAnimationBuilder<Color?>(
            duration: settingsAnimationDuration(
              context,
              const Duration(milliseconds: 180),
            ),
            curve: Curves.easeOut,
            tween: ColorTween(end: surfaceColor),
            builder: (context, animatedSurfaceColor, child) {
              return Material(
                color: animatedSurfaceColor ?? surfaceColor,
                shape: const StadiumBorder(),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  excludeFromSemantics: true,
                  canRequestFocus: onTap != null,
                  onTap: onTap,
                  customBorder: const StadiumBorder(),
                  overlayColor: AirQrTheme.interactionOverlay(context),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 48),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Center(
                        child: Text(
                          label,
                          style: Theme.of(context).textTheme.labelMedium
                              ?.copyWith(
                                color: selected
                                    ? AirQrTheme.primaryButtonForeground(
                                        context,
                                      )
                                    : palette.secondaryTextColor,
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
