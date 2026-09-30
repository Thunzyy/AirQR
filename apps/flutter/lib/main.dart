import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:flutter/services.dart';

export 'app/app_shell.dart' show MyApp;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'app/app_shell.dart';
import 'airqr_theme.dart';
import 'camera_preferences.dart';
import 'l10n/app_localizations.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:airqr_mobile/src/rust/api/simple.dart';
import 'package:airqr_mobile/src/rust/frb_generated.dart';
import 'incomplete_scans.dart';
import 'note_detection.dart';
import 'resume_service.dart';
import 'scanner_barcode_flow_controller.dart';
import 'scanner_config.dart';
import 'scanner_live_session_controller.dart';
import 'scanner_lifecycle_controller.dart';
import 'scanner_completion_flow_controller.dart';
import 'scanner_local_decode_controller.dart';
import 'scanner_local_result_controller.dart';
import 'scanner_frame_controller.dart';
import 'scanner_mobile_controller_controller.dart';
import 'scanner_page_state_controller.dart';
import 'scanner_page_chrome.dart';
import 'qr_overlay_painter.dart';
import 'scanner_remote_event_controller.dart';
import 'scanner_remote_snapshot_controller.dart';
import 'scanner_resume_controller.dart';
import 'scanner_resume_flow_controller.dart';
import 'scanner_resume_replay_controller.dart';
import 'scanner_result_download_controller.dart';
import 'scanner_result_view.dart';
import 'scanner_session_progress.dart';
import 'scanner_session_resolution_controller.dart';
import 'scanner_settings_controller.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'websocket_sync.dart';
import 'sync_service.dart';
import 'sync_settings.dart';
import 'desktop_camera_scanner.dart';
import 'utils.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    NativeBootstrap(
      initialize: () => RustLib.init(),
      builder: () => MyApp(
        buildScannerPage:
            ({required settingsChangedNotifier, required isActive}) {
              return ScannerPage(
                settingsChangedNotifier: settingsChangedNotifier,
                isActive: isActive,
              );
            },
      ),
    ),
  );
}

enum _NativeBootstrapStatus { loading, failed, ready }

class NativeBootstrap extends StatefulWidget {
  final Future<void> Function() initialize;
  final Widget Function() builder;

  const NativeBootstrap({
    super.key,
    required this.initialize,
    required this.builder,
  });

  @override
  State<NativeBootstrap> createState() => _NativeBootstrapState();
}

class _NativeBootstrapState extends State<NativeBootstrap> {
  _NativeBootstrapStatus _status = _NativeBootstrapStatus.loading;
  bool _initializationInFlight = false;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize({bool showLoading = false}) async {
    if (_initializationInFlight || !mounted) return;
    _initializationInFlight = true;

    try {
      if (showLoading) {
        setState(() {
          _status = _NativeBootstrapStatus.loading;
        });
      }
      await widget.initialize();
      if (!mounted) return;
      setState(() {
        _status = _NativeBootstrapStatus.ready;
      });
    } catch (error, stackTrace) {
      debugPrint('Native initialization failed: $error');
      debugPrintStack(stackTrace: stackTrace);
      if (!mounted) return;
      setState(() {
        _status = _NativeBootstrapStatus.failed;
      });
    } finally {
      _initializationInFlight = false;
    }
  }

  @override
  void dispose() {
    _initializationInFlight = false;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_status == _NativeBootstrapStatus.ready) {
      return widget.builder();
    }

    final failed = _status == _NativeBootstrapStatus.failed;
    return MaterialApp(
      title: 'AirQR',
      debugShowCheckedModeBanner: false,
      theme: buildAirQrLightTheme(),
      darkTheme: buildAirQrDarkTheme(),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(
        key: failed
            ? const Key('native-bootstrap-failed')
            : const Key('native-bootstrap-loading'),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Semantics(
              liveRegion: true,
              child: failed
                  ? Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const _NativeInitFailureText(),
                        const SizedBox(height: 16),
                        FilledButton(
                          key: const Key('native-bootstrap-retry'),
                          onPressed: () => _initialize(showLoading: true),
                          child: const _NativeRetryLabel(),
                        ),
                      ],
                    )
                  : const Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text('AirQR'),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NativeInitFailureText extends StatelessWidget {
  const _NativeInitFailureText();

  @override
  Widget build(BuildContext context) {
    return Text(
      AppLocalizations.of(context)!.errors_nativeInitFailed,
      textAlign: TextAlign.center,
    );
  }
}

class _NativeRetryLabel extends StatelessWidget {
  const _NativeRetryLabel();

  @override
  Widget build(BuildContext context) {
    return Text(AppLocalizations.of(context)!.common_retry);
  }
}

class ScannerPage extends StatefulWidget {
  final ValueNotifier<int> settingsChangedNotifier;
  final bool isActive;

  const ScannerPage({
    super.key,
    required this.settingsChangedNotifier,
    required this.isActive,
  });

  @override
  State<ScannerPage> createState() => _ScannerPageState();
}

class _ScannerPageState extends State<ScannerPage> {
  String _status = "Scanning...";
  double _progress = 0.0;
  bool _isScanning = true;
  bool _isCaptureActive = true;
  MobileScannerController? controller;
  Color _overlayColor = Colors.transparent;
  Timer? _resetTimer;
  List<Offset> _corners = [];
  Size? _imageSize;
  int _lastUpdateTime = 0;
  bool _isReloading = false;
  bool _isDisposed = false;
  bool _isResuming = false; // Add flag to prevent concurrent resumes
  bool _isExplicitResume =
      false; // True when user explicitly resumed a session — prevents session switching on QR stream ID mismatch
  bool _isTorchOn = false; // Track torch state locally

  int _fps = 0;
  int _framesInCurrentSecond = 0;
  int _lastFpsUpdate = 0;
  int? _currentChunkNumber;
  int? _currentChunkTotal;
  int _currentChunkFramesScanned = 0;
  int? _localExactTotalPackets;
  int? _currentStreamSessionId;
  final ScannerChunkFrameCounter _chunkFrameCounter =
      ScannerChunkFrameCounter();
  Uint8List? _lastProcessedBytes;

  late ScannerSettings _currentSettings;
  String? _lastScannerSettingsSignature;
  bool _reloadControllerWhenActive = false;
  String? _preferredDesktopCameraName;
  MobileCameraFacingPreference _preferredMobileCameraFacing =
      MobileCameraFacingPreference.back;

  String? _currentScanId;
  String? _currentFilename;
  int _receivedPackets = 0; // Track received packets from decoder
  int _expectedPackets = 0; // Track expected packets from decoder
  int _totalPackets = 0; // Track total packets from decoder
  bool _completionHandled = false; // Guard against double completion
  int _remoteReceivedPackets = 0;
  int _remoteExpectedPackets = 0;
  int _remoteTotalPackets = 0;
  int _remoteMissingPackets = 0;
  List<ScannerChunkProgressInfo> _remoteChunks =
      const <ScannerChunkProgressInfo>[];
  bool _syncScannedEnabled = false;
  bool _lockSessionIdToCurrent = false;
  String? _syncSourceName;
  int? _scanStartedAtMs;
  String? _resultFilename;
  String? _resultSessionId;
  String? _resultSavedPath;
  String? _resultSubtitle;
  bool _resultIsNote = false;
  String? _resultNoteContent;
  int? _resultFileSizeBytes;
  double _resultDurationSeconds = 0.0;
  bool _isSavingResultToDevice = false;
  DateTime? _lastRemoteProgressFetch;
  bool _remoteProgressInFlight = false;
  StreamSubscription<SyncEvent>? _wsSubscription;
  Timer? _globalCountersPollTimer;
  final Set<String> _ignoredCompletedSessionIds = <String>{};

  final GlobalKey<DesktopCameraScannerState> _desktopScannerKey =
      GlobalKey<DesktopCameraScannerState>();
  final ScannerLifecycleController _scannerLifecycleController =
      const ScannerLifecycleController();
  final ScannerCompletionFlowController _scannerCompletionFlowController =
      ScannerCompletionFlowController(log: debugPrint);
  late final ScannerBarcodeFlowController _scannerBarcodeFlowController;
  late final ScannerLiveSessionController _scannerLiveSessionController;
  final ScannerLocalDecodeController _scannerLocalDecodeController =
      ScannerLocalDecodeController();
  final ScannerLocalResultController _scannerLocalResultController =
      const ScannerLocalResultController();
  final ScannerFrameController _scannerFrameController =
      const ScannerFrameController();
  final ScannerMobileControllerController _scannerMobileControllerController =
      const ScannerMobileControllerController();
  final ScannerPageStateController _scannerPageStateController =
      const ScannerPageStateController();
  late final ScannerRemoteEventController _scannerRemoteEventController;
  final ScannerRemoteSnapshotController _scannerRemoteSnapshotController =
      ScannerRemoteSnapshotController();
  final ScannerResumeController _scannerResumeController =
      ScannerResumeController();
  final ScannerResumeFlowController _scannerResumeFlowController =
      const ScannerResumeFlowController();
  final ScannerResumeReplayController _scannerResumeReplayController =
      ScannerResumeReplayController();
  final ScannerResultDownloadController _scannerResultDownloadController =
      ScannerResultDownloadController();
  final ScannerSettingsController _scannerSettingsController =
      ScannerSettingsController();
  final ScannerSessionResolutionController _scannerSessionResolutionController =
      ScannerSessionResolutionController();

  bool get _supportsMobileScanner =>
      Platform.isAndroid || Platform.isIOS || Platform.isMacOS;
  bool get _supportsDesktopCamera => Platform.isWindows || Platform.isLinux;
  bool get _canScanLocally => _supportsMobileScanner || _supportsDesktopCamera;

  bool get _hasServerCounters =>
      _remoteReceivedPackets > 0 || _remoteExpectedPackets > 0;
  bool get _preferServerCounters =>
      _syncScannedEnabled && (_isExplicitResume || _hasServerCounters);

  int get _displayReceivedPackets {
    if (_preferServerCounters) {
      return max(_receivedPackets, _remoteReceivedPackets);
    }
    return _receivedPackets;
  }

  int get _displayExpectedPackets {
    final chunksThreshold = scannerProgressDecodeThresholdFromChunks(
      _remoteChunks,
    );
    if (_preferServerCounters) {
      return max(_expectedPackets, chunksThreshold ?? _remoteExpectedPackets);
    }
    return _expectedPackets;
  }

  int? get _displayTotalPackets {
    final chunksTotal = scannerProgressExactTotalFromChunks(_remoteChunks);
    final total = _preferServerCounters
        ? chunksTotal ??
              (_remoteTotalPackets > 0
                  ? _remoteTotalPackets
                  : _localExactTotalPackets ?? 0)
        : _localExactTotalPackets ?? 0;
    return total > 0 ? total : null;
  }

  int? get _displayMissingPackets {
    if (!_preferServerCounters) return null;
    if (_remoteChunks.isNotEmpty) return _remoteMissingPackets;
    return _remoteMissingPackets > 0 ? _remoteMissingPackets : null;
  }

  List<ScannerChunkProgressInfo> get _displayChunks => _preferServerCounters
      ? _remoteChunks
      : const <ScannerChunkProgressInfo>[];

  bool get _hasSessionProgressStatus =>
      _status.startsWith('Session progress:') &&
      _preferServerCounters &&
      _displayExpectedPackets > 0;

  double _computeDisplayProgress(double fallback) {
    final expected = _displayExpectedPackets;
    if (expected > 0) {
      return _displayReceivedPackets / expected;
    }
    return fallback;
  }

  String _localSyncSourceName() {
    final deviceNameRaw = WebSocketSyncService.instance.deviceInfo?.deviceName;
    final deviceName = deviceNameRaw?.trim();
    if (deviceName != null && deviceName.isNotEmpty) return deviceName;
    if (Platform.isIOS) return 'iOS App';
    if (Platform.isAndroid) return 'Android App';
    return 'This Device';
  }

  void _trackStreamFrameInfo(ScannerStreamFrameInfo streamFrameInfo) {
    if (_currentStreamSessionId != streamFrameInfo.sessionId) {
      _currentStreamSessionId = streamFrameInfo.sessionId;
      _localExactTotalPackets = null;
    }
    final chunkUpdate = _chunkFrameCounter.accept(streamFrameInfo);
    _currentChunkNumber = streamFrameInfo.chunkNumber;
    _currentChunkTotal = streamFrameInfo.chunkTotal;
    _currentChunkFramesScanned = chunkUpdate.framesScanned;
    _localExactTotalPackets =
        chunkUpdate.exactSessionTotal ?? _localExactTotalPackets;
  }

  @override
  void initState() {
    super.initState();
    _scannerLiveSessionController = ScannerLiveSessionController(
      resolveFreshSession: _resolveSessionForFreshScan,
    );
    _scannerBarcodeFlowController = ScannerBarcodeFlowController(
      ensureSession: ({required qrSessionId, required state}) =>
          _scannerLiveSessionController.ensureSession(
            qrSessionId: qrSessionId,
            state: state,
          ),
      applyLocalDecode:
          ({
            required result,
            required rawBytes,
            required state,
            required localSyncSourceName,
          }) => _scannerLocalDecodeController.applyResult(
            result: result,
            rawBytes: rawBytes,
            state: state,
            localSyncSourceName: localSyncSourceName,
          ),
      applyProgressResult:
          ({required transition, required state, required nowMillis}) =>
              _scannerLocalResultController.applyProgress(
                transition: transition,
                state: state,
                nowMillis: nowMillis,
              ),
      applyCompletionResult: ({required transition}) =>
          _scannerLocalResultController.applyCompletion(transition: transition),
      applyErrorResult: (transition) =>
          _scannerLocalResultController.applyError(transition),
    );
    _scannerRemoteEventController = ScannerRemoteEventController(
      adoptRemoteSession: (sessionId) =>
          IncompleteScanService.startNewSession(sessionId: sessionId),
    );
    _currentSettings = ScannerSettings.fromPreset(ScannerPreset.fast);
    _syncSourceName = _localSyncSourceName();
    widget.settingsChangedNotifier.addListener(_onSettingsChanged);
    _loadSettings();
    if (widget.isActive) {
      WakelockPlus.enable();
    }
    _refreshSyncConnection();
    _setupWebSocketListener();
    _startGlobalCountersPolling();
  }

  Future<void> _refreshSyncConnection() async {
    final settings = await SyncSettingsService.load();
    final syncEnabled = settings.isConfigured && settings.syncScanned;
    if (syncEnabled) {
      await WebSocketSyncService.instance.connect(settings);
    } else {
      WebSocketSyncService.instance.disconnect();
    }
    _syncScannedEnabled = syncEnabled;
    if (mounted && !_isDisposed) {
      final localSource = _localSyncSourceName();
      if (_syncSourceName != localSource || !_syncScannedEnabled) {
        setState(() {
          _syncScannedEnabled = syncEnabled;
          if (!syncEnabled) {
            _remoteReceivedPackets = 0;
            _remoteExpectedPackets = 0;
            _remoteMissingPackets = 0;
            _remoteChunks = const <ScannerChunkProgressInfo>[];
          }
          _syncSourceName = localSource;
        });
      }
    }
  }

  void _setupWebSocketListener() {
    _wsSubscription?.cancel();
    _wsSubscription = WebSocketSyncService.instance.events.listen((event) {
      switch (event.type) {
        case 'scan-progress':
          _handleRemoteScanProgress(event);
          break;
        case 'scan-complete':
          _handleRemoteScanComplete(event);
          break;
      }
    });
  }

  Future<void> _syncGlobalCountersFromServer({
    String? sessionId,
    bool force = false,
  }) async {
    final request = _scannerRemoteSnapshotController.prepareRequest(
      state: ScannerRemoteSnapshotRequestState(
        syncScannedEnabled: _syncScannedEnabled,
        currentScanId: _currentScanId,
        remoteProgressInFlight: _remoteProgressInFlight,
        lastRemoteProgressFetch: _lastRemoteProgressFetch,
      ),
      sessionId: sessionId,
      force: force,
      now: DateTime.now(),
    );
    if (request == null) return;

    _lastRemoteProgressFetch = request.nextLastRemoteProgressFetch;
    _remoteProgressInFlight = true;

    try {
      final sessionInfo = await SyncService.fetchSessionInfo(
        request.targetSessionId,
      );
      if (!mounted || _isDisposed) return;

      final snapshotResult = await _scannerRemoteSnapshotController
          .applySnapshot(
            state: ScannerRemoteSnapshotState(
              currentScanId: _currentScanId,
              displayReceivedPackets: _displayReceivedPackets,
              displayExpectedPackets: _displayExpectedPackets,
              displayTotalPackets: _displayTotalPackets ?? 0,
              remoteReceivedPackets: _remoteReceivedPackets,
              remoteExpectedPackets: _remoteExpectedPackets,
              remoteTotalPackets: _remoteTotalPackets,
              remoteMissingPackets: _remoteMissingPackets,
              remoteChunks: _remoteChunks,
              progress: _progress,
              currentFilename: _currentFilename,
            ),
            targetSessionId: request.targetSessionId,
            sessionInfo: sessionInfo,
          );
      if (snapshotResult == null) return;

      if (mounted && !_isDisposed) {
        setState(() {
          _remoteReceivedPackets = snapshotResult.remoteReceivedPackets;
          _remoteExpectedPackets = snapshotResult.remoteExpectedPackets;
          _remoteTotalPackets = snapshotResult.remoteTotalPackets;
          _remoteMissingPackets = snapshotResult.remoteMissingPackets;
          _remoteChunks = snapshotResult.remoteChunks;
          _currentFilename = snapshotResult.currentFilename;
          _progress = snapshotResult.progress;
          _status = snapshotResult.status;
        });
      }
    } finally {
      _remoteProgressInFlight = false;
    }
  }

  void _startGlobalCountersPolling() {
    _globalCountersPollTimer?.cancel();
    _globalCountersPollTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted ||
          _isDisposed ||
          !_syncScannedEnabled ||
          _currentScanId == null) {
        return;
      }
      unawaited(_syncGlobalCountersFromServer());
    });
  }

  Future<void> _handleRemoteScanProgress(SyncEvent event) async {
    final transition = await _scannerRemoteEventController.handleProgress(
      state: ScannerRemoteEventState(
        canScanLocally: _canScanLocally,
        currentScanId: _currentScanId,
        completionHandled: _completionHandled,
        displayReceivedPackets: _displayReceivedPackets,
        displayExpectedPackets: _displayExpectedPackets,
        displayTotalPackets: _displayTotalPackets ?? 0,
        remoteReceivedPackets: _remoteReceivedPackets,
        remoteExpectedPackets: _remoteExpectedPackets,
        remoteTotalPackets: _remoteTotalPackets,
        remoteMissingPackets: _remoteMissingPackets,
        remoteChunks: _remoteChunks,
        progress: _progress,
        currentFilename: _currentFilename,
        syncSourceName: _syncSourceName,
        scanDurationSeconds: _scanDurationSeconds(),
      ),
      event: event,
    );
    if (!mounted || _isDisposed) return;

    if (transition case ScannerRemoteProgressIgnoredTransition()) {
      return;
    }
    if (transition case ScannerRemoteProgressSnapshotTransition snapshot) {
      _currentScanId = snapshot.currentScanId;
      _completionHandled = snapshot.completionHandled;
      await _syncGlobalCountersFromServer(
        sessionId: snapshot.snapshotSessionId,
      );
      return;
    }
    if (transition case ScannerRemoteProgressUpdateTransition result) {
      setState(() {
        _currentScanId = result.currentScanId;
        _completionHandled = result.completionHandled;
        _remoteReceivedPackets = result.remoteReceivedPackets;
        _remoteExpectedPackets = result.remoteExpectedPackets;
        _remoteTotalPackets = result.remoteTotalPackets;
        _remoteMissingPackets = result.remoteMissingPackets;
        _remoteChunks = result.remoteChunks;
        _currentFilename = result.currentFilename;
        _progress = result.progress;
        _status = result.status;
        _syncSourceName = result.syncSourceName;
      });
    }
  }

  Future<void> _handleRemoteScanComplete(SyncEvent event) async {
    final result = await _scannerRemoteEventController.handleCompletion(
      state: ScannerRemoteEventState(
        canScanLocally: _canScanLocally,
        currentScanId: _currentScanId,
        completionHandled: _completionHandled,
        displayReceivedPackets: _displayReceivedPackets,
        displayExpectedPackets: _displayExpectedPackets,
        displayTotalPackets: _displayTotalPackets ?? 0,
        remoteReceivedPackets: _remoteReceivedPackets,
        remoteExpectedPackets: _remoteExpectedPackets,
        remoteTotalPackets: _remoteTotalPackets,
        remoteMissingPackets: _remoteMissingPackets,
        remoteChunks: _remoteChunks,
        progress: _progress,
        currentFilename: _currentFilename,
        syncSourceName: _syncSourceName,
        scanDurationSeconds: _scanDurationSeconds(),
      ),
      event: event,
    );

    if (result == null) return;

    _completionHandled = result.completionHandled;
    _isCaptureActive = result.isCaptureActive;
    _isProcessing = result.isProcessing;

    if (controller != null && !_isDisposed) {
      try {
        await controller!.stop();
      } catch (_) {}
    }

    if (mounted && !_isDisposed) {
      setState(() {
        _currentScanId = result.currentScanId;
        _isExplicitResume = result.isExplicitResume;
        _receivedPackets = result.receivedPackets;
        _expectedPackets = result.expectedPackets;
        _totalPackets = result.totalPackets;
        _currentFilename = result.currentFilename;
        _remoteReceivedPackets = result.remoteReceivedPackets;
        _remoteExpectedPackets = result.remoteExpectedPackets;
        _remoteTotalPackets = result.remoteTotalPackets;
        _remoteMissingPackets = result.remoteMissingPackets;
        _remoteChunks = result.remoteChunks;
        _lastRemoteProgressFetch = result.lastRemoteProgressFetch;
        _progress = result.progress;
        _isScanning = result.isScanning;
        _resultFilename = result.resultFilename;
        _resultSessionId = result.resultSessionId;
        _resultIsNote = result.resultIsNote;
        _resultNoteContent = result.resultNoteContent;
        _resultFileSizeBytes = result.resultFileSizeBytes;
        _resultDurationSeconds = result.resultDurationSeconds;
        _resultSavedPath = result.resultSavedPath;
        _resultSubtitle = result.resultSubtitle;
        _status = result.status;
        if (result.shouldClearCorners) {
          _corners = [];
        }
      });
    }

    if (result.resultIsNote &&
        _resultNoteContent == null &&
        result.resultSessionId.isNotEmpty) {
      try {
        final fileBytes = await SyncService.downloadFile(
          id: result.resultSessionId,
          origin: 'scanned',
        );
        if (fileBytes != null && mounted && !_isDisposed) {
          setState(() {
            _resultNoteContent = decodeNoteContent(fileBytes);
          });
        }
      } catch (_) {
        // Keep the result view usable even if the eager note fetch fails.
      }
    }

    if (mounted && !_isDisposed) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.snackBarMessage),
          backgroundColor: AirQrTheme.success,
        ),
      );
    }
  }

  double _scanDurationSeconds() {
    final startedAtMs = _scanStartedAtMs;
    if (startedAtMs == null || startedAtMs <= 0) {
      return 0.0;
    }
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final elapsedMs = max(0, nowMs - startedAtMs);
    return elapsedMs / 1000.0;
  }

  Future<ScannerSessionResolutionResult> _resolveSessionForFreshScan(
    String? qrSessionId,
  ) async {
    final result = await _scannerSessionResolutionController.resolve(
      qrSessionId: qrSessionId,
      isExplicitResume: _isExplicitResume,
      ignoredCompletedSessionIds: _ignoredCompletedSessionIds,
    );
    _ignoredCompletedSessionIds
      ..clear()
      ..addAll(result.ignoredCompletedSessionIds);
    return result;
  }

  @override
  void dispose() {
    _isDisposed = true;
    widget.settingsChangedNotifier.removeListener(_onSettingsChanged);
    _resetTimer?.cancel();
    _wsSubscription?.cancel();
    _globalCountersPollTimer?.cancel();
    if (_supportsMobileScanner) {
      try {
        controller?.stop();
      } catch (_) {}
    }
    try {
      controller?.dispose();
    } catch (_) {}
    WakelockPlus.disable();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _checkPendingResume();
  }

  @override
  void didUpdateWidget(covariant ScannerPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    final decision = _scannerLifecycleController.handleVisibilityChange(
      oldIsActive: oldWidget.isActive,
      newIsActive: widget.isActive,
      supportsMobileScanner: _supportsMobileScanner,
      reloadControllerWhenActive: _reloadControllerWhenActive,
    );
    _reloadControllerWhenActive = decision.nextReloadControllerWhenActive;

    if (decision.enableWakelock) {
      WakelockPlus.enable();
    }
    if (decision.disableWakelock) {
      WakelockPlus.disable();
    }
    if (decision.shouldReloadController) {
      unawaited(_reloadController());
    } else if (decision.shouldStartController) {
      try {
        controller?.start();
      } catch (_) {}
    }
    if (decision.shouldStopController) {
      try {
        controller?.stop();
      } catch (_) {}
    }
    if (decision.shouldCheckPendingResume) {
      _checkPendingResume();
    }
  }

  void _checkPendingResume() {
    if (_isDisposed || !mounted || _isResuming) return;

    final scanId = ResumeService().consumePendingResume();
    if (scanId != null) {
      Future.delayed(const Duration(milliseconds: 300), () {
        if (!mounted || _isDisposed) return;
        resumeScan(scanId);
      });
    }
  }

  void _onSettingsChanged() {
    _loadSettings();
    _refreshSyncConnection();
  }

  Future<void> resumeScan(String scanId) async {
    if (_isDisposed || !mounted || _isResuming) return;

    _isResuming = true;
    final beginResume = _scannerResumeFlowController.beginResume();
    _completionHandled = beginResume.completionHandled;
    if (beginResume.shouldClearLastProcessedBytes) {
      _lastProcessedBytes = null;
    }
    var completedDuringResume = beginResume.completedDuringResume;

    // Freeze live capture immediately to avoid creating/switching sessions while resume is restoring state.
    if (mounted && !_isDisposed) {
      setState(() {
        _isCaptureActive = beginResume.isCaptureActive;
      });
    }
    _isProcessing = beginResume.isProcessing;

    try {
      debugPrint('🔄 RESUME_LOG: Starting resume for scanId=$scanId');

      resetDecoder();
      final resumeState = await _scannerResumeController.loadResume(scanId);
      final loadedResume = _scannerResumeFlowController.applyLoadedResume(
        resumeState: resumeState,
        localSyncSourceName: _localSyncSourceName(),
      );
      _receivedPackets = loadedResume.receivedPackets;
      _expectedPackets = loadedResume.expectedPackets;
      _totalPackets = loadedResume.totalPackets;
      _currentFilename = loadedResume.currentFilename;
      _remoteReceivedPackets = loadedResume.remoteReceivedPackets;
      _remoteExpectedPackets = loadedResume.remoteExpectedPackets;
      _remoteTotalPackets = 0;
      _remoteMissingPackets = 0;
      _remoteChunks = const <ScannerChunkProgressInfo>[];
      _lastRemoteProgressFetch = loadedResume.lastRemoteProgressFetch;
      _currentScanId = loadedResume.currentScanId;
      _isExplicitResume = loadedResume.isExplicitResume;
      _lockSessionIdToCurrent = loadedResume.lockSessionIdToCurrent;
      _scanStartedAtMs = loadedResume.scanStartedAtMs;

      debugPrint(
        '🔄 RESUME_LOG: _currentScanId set to $scanId (explicit resume, session locked)',
      );
      await _syncGlobalCountersFromServer(sessionId: scanId, force: true);
      final packets = resumeState.packets;
      _chunkFrameCounter.reset();
      _currentStreamSessionId = null;
      _currentChunkNumber = null;
      _currentChunkTotal = null;
      _currentChunkFramesScanned = 0;
      _localExactTotalPackets = null;
      for (final packet in packets) {
        final streamFrameInfo = _scannerFrameController.parseStreamFrameInfo(
          packet,
        );
        if (streamFrameInfo != null) {
          _trackStreamFrameInfo(streamFrameInfo);
        }
      }

      debugPrint(
        '🔄 RESUME_LOG: Loaded ${packets.length} packets for scanId=$scanId',
      );

      if (!mounted || _isDisposed) {
        return;
      }

      // Show initial stats immediately
      setState(() {
        _status = loadedResume.status;
        _progress = loadedResume.progress;
        _isScanning = loadedResume.isScanning;
        _syncSourceName = loadedResume.syncSourceName;
      });

      final replayResult = await _scannerResumeReplayController.replay(
        packets: packets,
        currentScanId: _currentScanId,
        completionHandled: _completionHandled,
        processChunk: (packet) => processChunk(data: packet),
        scanDurationSeconds: _scanDurationSeconds,
        onProgress: (progressUpdate, packetIndex, totalPackets) {
          if (_isDisposed || !mounted) {
            return;
          }
          _receivedPackets = progressUpdate.receivedPackets;
          _expectedPackets = progressUpdate.expectedPackets;
          _totalPackets = progressUpdate.totalPackets;

          debugPrint(
            '🔄 RESUME_LOG: Replayed packet ${packetIndex + 1}/$totalPackets, received=$_receivedPackets, expected=$_expectedPackets',
          );

          setState(() {
            _progress = progressUpdate.progress;
            if (!_hasSessionProgressStatus) {
              _status = progressUpdate.status;
            }
          });
        },
      );

      if (_isDisposed || !mounted) {
        return;
      }

      if (replayResult case ScannerResumeReplayCompletedResult(
        :final completionUpdate,
      )) {
        _completionHandled = completionUpdate.completionHandled;
        completedDuringResume = completionUpdate.completedDuringResume;
        _currentScanId = completionUpdate.currentScanId;
        _receivedPackets = completionUpdate.receivedPackets;
        _expectedPackets = completionUpdate.expectedPackets;
        _totalPackets = completionUpdate.totalPackets;
        _currentFilename = completionUpdate.currentFilename;
        _remoteReceivedPackets = completionUpdate.remoteReceivedPackets;
        _remoteExpectedPackets = completionUpdate.remoteExpectedPackets;
        _remoteTotalPackets = 0;
        _remoteMissingPackets = 0;
        _remoteChunks = const <ScannerChunkProgressInfo>[];

        if (!_isDisposed && mounted) {
          setState(() {
            _progress = completionUpdate.progress;
            _status = completionUpdate.status;
            _resultFilename = completionUpdate.resultFilename;
            _resultSessionId = completionUpdate.resultSessionId;
            _resultIsNote = completionUpdate.resultIsNote;
            _resultNoteContent = completionUpdate.resultNoteContent;
            _resultFileSizeBytes = completionUpdate.resultFileSizeBytes;
            _resultDurationSeconds = completionUpdate.resultDurationSeconds;
            _resultSavedPath = completionUpdate.resultSavedPath;
            _resultSubtitle = completionUpdate.resultSubtitle;
            _isScanning = completionUpdate.isScanning;
            if (completionUpdate.shouldClearCorners) {
              _corners = [];
            }
          });
        }

        final completionFlow = await _scannerCompletionFlowController.finalize(
          data: completionUpdate.fileData,
          filename: completionUpdate.resultFilename,
          sessionId: completionUpdate.resultSessionId,
          stopController: controller != null && !_isDisposed
              ? () => controller!.stop()
              : null,
        );
        if (!_isDisposed && mounted) {
          if (completionFlow
              case ScannerCompletionFlowSavedTransition success) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(SnackBar(content: Text(success.snackBarMessage)));
            setState(() {
              _resultSavedPath = success.filePath;
            });
          } else if (completionFlow
              case ScannerCompletionFlowFailedTransition failure) {
            setState(() {
              _status = failure.status;
            });
          }
        }
        return;
      }

      if (replayResult case ScannerResumeReplayInterruptedResult(
        :final error,
        :final stackTrace,
        :final failedPacketIndex,
        :final totalPackets,
      )) {
        debugPrint(
          '🔄 RESUME_LOG: Replay failed at packet ${failedPacketIndex + 1}/$totalPackets: $error',
        );
        debugPrint('🔄 RESUME_LOG: Replay stack: $stackTrace');
      }

      if (!mounted || _isDisposed) {
        return;
      }

      debugPrint(
        '🔄 RESUME_LOG: Resume finished. _currentScanId=$_currentScanId, received=$_receivedPackets, expected=$_expectedPackets',
      );

      // Auto-start scanning after resume - keep the restored packet counts!
      final finishResume = _scannerResumeFlowController.finishResume(
        localSyncSourceName: _localSyncSourceName(),
      );
      setState(() {
        if (!_hasSessionProgressStatus) {
          _status = finishResume.status;
        }
        _isCaptureActive = finishResume.isCaptureActive;
        _syncSourceName = finishResume.syncSourceName;
      });
    } catch (e, stackTrace) {
      debugPrint('🔄 RESUME_LOG: resumeScan failed for $scanId: $e');
      debugPrint('🔄 RESUME_LOG: resumeScan stack: $stackTrace');
      if (mounted && !_isDisposed) {
        final errorTransition = _scannerResumeFlowController.applyResumeError(
          e,
        );
        setState(() {
          _status = errorTransition.status;
        });
      }
    } finally {
      _isResuming = false;
      if (!completedDuringResume && mounted && !_isDisposed && _isScanning) {
        setState(() {
          _isCaptureActive = true;
        });
      }
    }
  }

  Future<void> _loadSettings() async {
    final settingsResult = await _scannerSettingsController.load(
      state: ScannerSettingsLoadState(
        lastScannerSettingsSignature: _lastScannerSettingsSignature,
        supportsMobileScanner: _supportsMobileScanner,
        supportsDesktopCamera: _supportsDesktopCamera,
        hasController: controller != null,
      ),
    );
    _currentSettings = settingsResult.currentSettings;
    _preferredDesktopCameraName = settingsResult.preferredDesktopCameraName;
    _preferredMobileCameraFacing = settingsResult.preferredMobileCameraFacing;
    _lastScannerSettingsSignature = settingsResult.nextScannerSettingsSignature;

    final decision = _scannerLifecycleController.applyLoadedSettings(
      settingsResult: settingsResult,
      supportsMobileScanner: _supportsMobileScanner,
      widgetIsActive: widget.isActive,
      isDisposed: _isDisposed,
      mounted: mounted,
    );
    _reloadControllerWhenActive = decision.reloadControllerWhenActive;

    if (decision.shouldReloadControllerNow) {
      await _reloadController();
    }
    if (decision.shouldRefreshDesktopState) {
      setState(() {});
    }
  }

  Future<void> _reloadController() async {
    final startReload = _scannerMobileControllerController.beginReload(
      isDisposed: _isDisposed,
      supportsMobileScanner: _supportsMobileScanner,
    );
    if (startReload case ScannerMobileControllerReloadSkippedTransition()) {
      return;
    }
    final start = startReload as ScannerMobileControllerReloadStartedTransition;

    setState(() {
      _isReloading = start.isReloading;
      _isCaptureActive = start.isCaptureActive;
      _isTorchOn = start.isTorchOn;
    });

    _isProcessing = start.isProcessing;
    final oldController = controller;
    controller = null;

    final finishReload = await _scannerMobileControllerController
        .performReload<MobileScannerController>(
          oldController: oldController,
          waitForIdle: () =>
              Future<void>.delayed(const Duration(milliseconds: 150)),
          stopController: (existingController) => existingController.stop(),
          disposeController: (existingController) =>
              existingController.dispose(),
          createController: () => _currentSettings.createController(
            facing:
                _preferredMobileCameraFacing ==
                    MobileCameraFacingPreference.front
                ? CameraFacing.front
                : CameraFacing.back,
          ),
          isMounted: () => mounted,
          isDisposed: () => _isDisposed,
          log: debugPrint,
        );
    if (finishReload == null) return;

    setState(() {
      controller = finishReload.controller;
      _status = finishReload.status;
      _isReloading = finishReload.isReloading;
      _isCaptureActive = finishReload.isCaptureActive;
    });
  }

  bool _isProcessing = false;

  Future<void> _selectMobileCamera(CameraFacing facing) async {
    final activeController = controller;
    if (activeController == null ||
        activeController.value.cameraDirection == facing) {
      return;
    }
    await activeController.switchCamera();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_isDisposed ||
        _isReloading ||
        _isResuming ||
        !_isScanning ||
        !_isCaptureActive) {
      return;
    }

    // Drop frame if we are already processing one
    if (_isProcessing) return;

    _isProcessing = true;
    // Process asynchronously to not block the camera stream
    _processBarcode(capture).whenComplete(() {
      if (!_isDisposed) {
        _isProcessing = false;
      }
    });
  }

  Future<void> _processBarcode(BarcodeCapture capture) async {
    if (_isDisposed) return;

    final List<Barcode> barcodes = capture.barcodes;
    for (final barcode in barcodes) {
      if (_isDisposed) return;

      if (barcode.rawBytes != null) {
        final frameTransition = _scannerFrameController.handleFrame(
          rawBytes: barcode.rawBytes!,
          state: ScannerFrameState(
            lastProcessedBytes: _lastProcessedBytes,
            fps: _fps,
            framesInCurrentSecond: _framesInCurrentSecond,
            lastFpsUpdate: _lastFpsUpdate,
          ),
          nowMillis: DateTime.now().millisecondsSinceEpoch,
        );
        debugPrint('DartScanner: ${frameTransition.debugInfo}');

        if (frameTransition case ScannerFrameIgnoredDuplicateTransition()) {
          return;
        }
        final acceptedFrame = frameTransition as ScannerFrameAcceptedTransition;
        _lastProcessedBytes = acceptedFrame.lastProcessedBytes;
        _fps = acceptedFrame.fps;
        _framesInCurrentSecond = acceptedFrame.framesInCurrentSecond;
        _lastFpsUpdate = acceptedFrame.lastFpsUpdate;
        _currentChunkNumber = acceptedFrame.currentChunkNumber;
        _currentChunkTotal = acceptedFrame.currentChunkTotal;
        final streamFrameInfo = acceptedFrame.streamFrameInfo;
        if (streamFrameInfo != null) {
          _trackStreamFrameInfo(streamFrameInfo);
        }
        final now = acceptedFrame.nowMillis;

        if (!_isDisposed && mounted) {
          setState(() {
            _corners = barcode.corners;
            _imageSize = capture.size;
            _overlayColor = AirQrTheme.success;
          });
        }

        _resetTimer?.cancel();
        _resetTimer = Timer(const Duration(milliseconds: 100), () {
          if (mounted && !_isDisposed) {
            setState(() {
              _corners = [];
              _overlayColor = Colors.transparent;
            });
          }
        });

        // debugPrint('DartScanner: Calling Rust processChunk...');
        late final DecodeStatus result;
        try {
          result = await processChunk(data: barcode.rawBytes!);
          // debugPrint('DartScanner: processChunk returned status=${result.status}');
          debugPrint(
            '🔍 SCAN_LOG: processChunk -> Status=${result.status} Pkts=${result.receivedPackets}/${result.expectedPackets} (${result.percent}%) File=${result.filename}',
          );
        } catch (e, stackTrace) {
          debugPrint('DartScanner: Exception invoking processChunk: $e');
          debugPrint('DartScanner: StackTrace: $stackTrace');
          if (!mounted || _isDisposed) return;
          setState(() {
            _status = "Error processing chunk: $e";
          });
          return;
        }

        if (!mounted || _isDisposed) return;

        final flowTransition = await _scannerBarcodeFlowController.handle(
          result: result,
          rawBytes: barcode.rawBytes!,
          state: ScannerBarcodeFlowState(
            currentScanId: _currentScanId,
            isExplicitResume: _isExplicitResume,
            lockSessionIdToCurrent: _lockSessionIdToCurrent,
            completionHandled: _completionHandled,
            currentFilename: _currentFilename,
            currentTotalPackets: _totalPackets,
            remoteReceivedPackets: _remoteReceivedPackets,
            remoteExpectedPackets: _remoteExpectedPackets,
            remoteTotalPackets: _remoteTotalPackets,
            remoteMissingPackets: _remoteMissingPackets,
            remoteChunks: _remoteChunks,
            lastRemoteProgressFetch: _lastRemoteProgressFetch,
            scanStartedAtMs: _scanStartedAtMs,
            displayReceivedPackets: _displayReceivedPackets,
            displayExpectedPackets: _displayExpectedPackets,
            progress: _progress,
            scanDurationSeconds: _scanDurationSeconds(),
            syncSourceName: _syncSourceName,
            serverAuthoritative: _syncScannedEnabled && _isExplicitResume,
            lastUpdateTime: _lastUpdateTime,
            framesInCurrentSecond: _framesInCurrentSecond,
          ),
          nowMillis: now,
          localSyncSourceName: _localSyncSourceName(),
        );

        if (flowTransition case ScannerBarcodeIgnoredTransition()) {
          if (result.status == 'Completed') {
            debugPrint(
              'SCAN_LOG: Completion already handled, ignoring duplicate',
            );
          }
          return;
        }

        if (flowTransition
            case ScannerBarcodeProgressFlowTransition progressFlow) {
          _currentScanId = progressFlow.session.currentScanId;
          _isExplicitResume = progressFlow.session.isExplicitResume;
          _lockSessionIdToCurrent = progressFlow.session.lockSessionIdToCurrent;
          _completionHandled = progressFlow.session.completionHandled;
          _currentFilename = progressFlow.session.currentFilename;
          _remoteReceivedPackets = progressFlow.session.remoteReceivedPackets;
          _remoteExpectedPackets = progressFlow.session.remoteExpectedPackets;
          _remoteTotalPackets = progressFlow.session.remoteTotalPackets;
          _remoteMissingPackets = progressFlow.session.remoteMissingPackets;
          _remoteChunks = progressFlow.session.remoteChunks;
          _lastRemoteProgressFetch =
              progressFlow.session.lastRemoteProgressFetch;
          _scanStartedAtMs = progressFlow.scanStartedAtMs;
          if (progressFlow.shouldForceGlobalCounterRefresh) {
            unawaited(_syncGlobalCountersFromServer(force: true));
          }

          _receivedPackets = progressFlow.progressUpdate.receivedPackets;
          _expectedPackets = progressFlow.progressUpdate.expectedPackets;
          _totalPackets = progressFlow.progressUpdate.totalPackets;
          _currentFilename = progressFlow.progressUpdate.currentFilename;
          if (progressFlow.progressUpdate.shouldRefreshGlobalCounters) {
            unawaited(_syncGlobalCountersFromServer());
          }

          debugPrint(
            'SCAN_LOG: Progress $_receivedPackets/$_expectedPackets (${result.percent}%) localSessionId=$_currentScanId qrSessionId=${progressFlow.qrSessionId}',
          );

          if (progressFlow.progressUpdate.shouldApplyWidgetUpdate) {
            _lastUpdateTime = progressFlow.progressUpdate.lastUpdateTime;
            if (!_isDisposed && mounted) {
              setState(() {
                _progress = progressFlow.progressUpdate.progress;
                if (!_hasSessionProgressStatus) {
                  _status = progressFlow.progressUpdate.status;
                }
                if (_syncSourceName !=
                    progressFlow.progressUpdate.syncSourceName) {
                  _syncSourceName = progressFlow.progressUpdate.syncSourceName;
                }
              });
            }
          } else {
            _progress = progressFlow.progressUpdate.progress;
            if (_syncSourceName != progressFlow.progressUpdate.syncSourceName) {
              _syncSourceName = progressFlow.progressUpdate.syncSourceName;
            }
          }
          return;
        }

        if (flowTransition
            case ScannerBarcodeCompletedFlowTransition completedFlow) {
          final completionUpdate = completedFlow.completionUpdate;
          _completionHandled = completionUpdate.completionHandled;
          _currentScanId = completionUpdate.currentScanId;
          _receivedPackets = completionUpdate.receivedPackets;
          _expectedPackets = completionUpdate.expectedPackets;
          _totalPackets = completionUpdate.totalPackets;
          _currentFilename = completionUpdate.currentFilename;
          _remoteReceivedPackets = completionUpdate.remoteReceivedPackets;
          _remoteExpectedPackets = completionUpdate.remoteExpectedPackets;
          _remoteTotalPackets = 0;
          _remoteMissingPackets = 0;
          _remoteChunks = const <ScannerChunkProgressInfo>[];

          if (!_isDisposed && mounted) {
            setState(() {
              _progress = completionUpdate.progress;
              _status = completionUpdate.status;
              _resultFilename = completionUpdate.resultFilename;
              _resultSessionId = completionUpdate.resultSessionId;
              _resultIsNote = completionUpdate.resultIsNote;
              _resultNoteContent = completionUpdate.resultNoteContent;
              _resultFileSizeBytes = completionUpdate.resultFileSizeBytes;
              _resultDurationSeconds = completionUpdate.resultDurationSeconds;
              _resultSavedPath = completionUpdate.resultSavedPath;
              _resultSubtitle = completionUpdate.resultSubtitle;
              _isScanning = completionUpdate.isScanning;
              if (completionUpdate.shouldClearCorners) {
                _corners = [];
              }
            });
          }

          final completionFlow = await _scannerCompletionFlowController
              .finalize(
                data: completionUpdate.fileData,
                filename: completionUpdate.resultFilename,
                sessionId: completionUpdate.resultSessionId,
                stopController: controller != null && !_isDisposed
                    ? () => controller!.stop()
                    : null,
              );
          if (!_isDisposed && mounted) {
            if (completionFlow
                case ScannerCompletionFlowSavedTransition success) {
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text(success.snackBarMessage)));
              setState(() {
                _resultSavedPath = success.filePath;
              });
            } else if (completionFlow
                case ScannerCompletionFlowFailedTransition failure) {
              setState(() {
                _status = failure.status;
              });
            }
          }
          return;
        }

        if (flowTransition case ScannerBarcodeErrorFlowTransition errorFlow) {
          if (!_isDisposed && mounted) {
            setState(() {
              _status = errorFlow.errorUpdate.status;
            });
          }
          return;
        }
      }
    }
  }

  void _reset() {
    if (_isDisposed || _isReloading) return;

    resetDecoder();
    IncompleteScanService.clearCurrentScan();
    _ignoredCompletedSessionIds.clear();
    final resetUpdate = _scannerPageStateController.applyReset(
      localSyncSourceName: _localSyncSourceName(),
    );
    _currentScanId = resetUpdate.currentScanId;
    _receivedPackets = resetUpdate.receivedPackets;
    _expectedPackets = resetUpdate.expectedPackets;
    _totalPackets = resetUpdate.totalPackets;
    _currentFilename = resetUpdate.currentFilename;
    _remoteReceivedPackets = resetUpdate.remoteReceivedPackets;
    _remoteExpectedPackets = resetUpdate.remoteExpectedPackets;
    _remoteTotalPackets = resetUpdate.remoteTotalPackets;
    _remoteMissingPackets = resetUpdate.remoteMissingPackets;
    _remoteChunks = const <ScannerChunkProgressInfo>[];
    _lockSessionIdToCurrent = resetUpdate.lockSessionIdToCurrent;
    _scanStartedAtMs = resetUpdate.scanStartedAtMs;
    _resultFilename = resetUpdate.resultFilename;
    _resultSessionId = resetUpdate.resultSessionId;
    _resultSavedPath = resetUpdate.resultSavedPath;
    _resultSubtitle = resetUpdate.resultSubtitle;
    _resultIsNote = resetUpdate.resultIsNote;
    _resultNoteContent = resetUpdate.resultNoteContent;
    _resultFileSizeBytes = resetUpdate.resultFileSizeBytes;
    _resultDurationSeconds = resetUpdate.resultDurationSeconds;
    _isSavingResultToDevice = resetUpdate.isSavingResultToDevice;
    _lastRemoteProgressFetch = resetUpdate.lastRemoteProgressFetch;
    _completionHandled = resetUpdate.completionHandled;
    _currentChunkNumber = null;
    _currentChunkTotal = null;
    _currentChunkFramesScanned = 0;
    _localExactTotalPackets = null;
    _currentStreamSessionId = null;
    _chunkFrameCounter.reset();

    if (!_isDisposed && mounted) {
      setState(() {
        _status = resetUpdate.status;
        _progress = resetUpdate.progress;
        _isScanning = resetUpdate.isScanning;
        _isCaptureActive = resetUpdate.isCaptureActive;
        _isProcessing = resetUpdate.isProcessing;
        _lastProcessedBytes = null;
        _overlayColor = resetUpdate.overlayColor;
        _corners = resetUpdate.corners;
        _fps = resetUpdate.fps;
        _framesInCurrentSecond = resetUpdate.framesInCurrentSecond;
        _lastFpsUpdate = resetUpdate.lastFpsUpdate;
        _syncSourceName = resetUpdate.syncSourceName;
      });
    }

    // MobileScanner widget will automatically start the controller when mounted
    // because autoStart is true by default.
    // Removing manual start() here to prevent "controllerInitializing" race condition.
    /*
    if (controller != null && !_isDisposed) {
      try {
        controller!.start();
      } catch (e) {
        debugPrint('Error starting controller: $e');
      }
    }
    */
  }

  Future<void> _saveCurrentResultToDevice() async {
    final startSaving = _scannerPageStateController.beginSavingResult(
      isSavingResultToDevice: _isSavingResultToDevice,
      isDisposed: _isDisposed,
    );
    if (startSaving case ScannerSaveResultSkippedTransition()) {
      return;
    }

    setState(() {
      _isSavingResultToDevice =
          (startSaving as ScannerSaveResultStartedTransition)
              .isSavingResultToDevice;
    });

    try {
      final outcome = await _scannerResultDownloadController.save(
        cachedPath: _resultSavedPath,
        sessionId: _resultSessionId,
        fileName: _resultFilename,
      );
      final successUpdate = _scannerPageStateController.applySaveResultSuccess(
        sourcePath: outcome.sourcePath,
      );
      _resultSavedPath = successUpdate.resultSavedPath;

      final savedPath = outcome.savedPath;
      if (mounted && !_isDisposed && savedPath != null) {
        final l10n = AppLocalizations.of(context)!;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(l10n.decoder_fileSaved)));
      }
    } catch (e) {
      if (mounted && !_isDisposed) {
        final l10n = AppLocalizations.of(context)!;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.scanner_errorSaving(e.toString()))),
        );
      }
    } finally {
      if (mounted && !_isDisposed) {
        final finishSaving = _scannerPageStateController.finishSavingResult(
          currentSavedPath: _resultSavedPath,
        );
        setState(() {
          _isSavingResultToDevice = finishSaving.isSavingResultToDevice;
          _resultSavedPath = finishSaving.resultSavedPath;
        });
      }
    }
  }

  Future<void> _copyCurrentResultNote() async {
    final noteContent = _resultNoteContent;
    if (noteContent == null || noteContent.isEmpty) {
      return;
    }
    await Clipboard.setData(ClipboardData(text: noteContent));
    if (mounted && !_isDisposed) {
      final l10n = AppLocalizations.of(context)!;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.scanner_noteCopied)));
    }
  }

  Future<void> _toggleTorch() async {
    try {
      await controller?.toggleTorch();
      setState(() {
        _isTorchOn = !_isTorchOn;
      });
    } catch (_) {
      // Torch not available.
    }
  }

  @override
  Widget build(BuildContext context) {
    final displayProgress = _computeDisplayProgress(_progress);
    final isComplete = displayProgress >= 1.0;
    final Color primaryColor = AirQrTheme.accentText(context);
    final Color successColor = AirQrTheme.success;
    final showMobileCamera =
        _supportsMobileScanner && !_isReloading && controller != null;
    final showDesktopCamera = _supportsDesktopCamera;
    final showPreview = showMobileCamera || showDesktopCamera;

    if (!_isScanning) {
      final filename = _resultFilename ?? _currentFilename ?? 'file.bin';
      final sizeLabel = _resultFileSizeBytes != null
          ? formatBytes(_resultFileSizeBytes!)
          : null;
      final durationLabel = _resultDurationSeconds > 0
          ? '${_resultDurationSeconds.toStringAsFixed(1)}s'
          : null;
      final canDownload =
          !_resultIsNote &&
          !_isSavingResultToDevice &&
          ((_resultSavedPath != null && _resultSavedPath!.isNotEmpty) ||
              (_resultSessionId != null && _resultSessionId!.isNotEmpty));
      return ScannerResultView(
        primaryColor: primaryColor,
        successColor: successColor,
        filename: filename,
        sizeLabel: sizeLabel,
        durationLabel: durationLabel,
        subtitle: _resultSubtitle,
        previewPath: _resultSavedPath,
        isNote: _resultIsNote,
        noteContent: _resultNoteContent,
        canDownload: canDownload,
        isSaving: _isSavingResultToDevice,
        onDownload: _saveCurrentResultToDevice,
        onCopy: _copyCurrentResultNote,
        onClose: _reset,
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          Positioned.fill(
            child: RepaintBoundary(
              key: const Key('scanner-live-preview-repaint-boundary'),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  showMobileCamera
                      ? MobileScanner(
                          key: ValueKey(
                            '${_currentSettings.hashCode}-'
                            '${_preferredMobileCameraFacing.name}',
                          ),
                          controller: controller,
                          onDetect: _onDetect,
                          fit: BoxFit.cover,
                        )
                      : (showDesktopCamera
                            ? DesktopCameraScanner(
                                key: _desktopScannerKey,
                                enabled:
                                    widget.isActive &&
                                    _isScanning &&
                                    _isCaptureActive,
                                decodeThrottleMs:
                                    _currentSettings.detectionTimeoutMs,
                                preferredResolution:
                                    _currentSettings.resolutionSize,
                                preferredDeviceName:
                                    _preferredDesktopCameraName,
                                onDetect: (bytes, corners, imageSize) {
                                  _onDetect(
                                    BarcodeCapture(
                                      barcodes: [
                                        Barcode(
                                          rawBytes: bytes,
                                          corners: corners,
                                        ),
                                      ],
                                      size: imageSize,
                                    ),
                                  );
                                },
                              )
                            : (_supportsMobileScanner
                                  ? const Center(
                                      child: CircularProgressIndicator(),
                                    )
                                  : _buildDesktopScannerPlaceholder(context))),
                  if (showPreview)
                    ColoredBox(color: Colors.black.withValues(alpha: 0.2)),
                  if (_corners.isNotEmpty && _imageSize != null)
                    LayoutBuilder(
                      builder: (context, constraints) {
                        return CustomPaint(
                          painter: QROverlayPainter(
                            corners: _corners,
                            imageSize: _imageSize!,
                            widgetSize: Size(
                              constraints.maxWidth,
                              constraints.maxHeight,
                            ),
                            color: _overlayColor,
                          ),
                        );
                      },
                    ),
                ],
              ),
            ),
          ),
          ScannerChromeOverlay(
            fps: _fps,
            syncSourceName: _syncSourceName,
            showMobileCamera: showMobileCamera,
            showDesktopCamera: showDesktopCamera,
            isTorchOn: _isTorchOn,
            currentChunkNumber: _currentChunkNumber,
            currentChunkTotal: _currentChunkTotal,
            displayReceivedPackets: _displayReceivedPackets,
            displayExpectedPackets: _displayExpectedPackets,
            displayTotalPackets: _displayTotalPackets,
            localChunkFramesScanned: _currentChunkFramesScanned,
            displayMissingPackets: _displayMissingPackets,
            displayChunks: _displayChunks,
            displayProgress: displayProgress,
            isComplete: isComplete,
            status: _status,
            primaryColor: primaryColor,
            successColor: successColor,
            onToggleTorch: showMobileCamera
                ? () {
                    _toggleTorch();
                  }
                : null,
            onOpenMobileCameraSelector: showMobileCamera
                ? () {
                    showScannerCameraSelectorSheet(
                      context,
                      onSelectBackCamera: () {
                        unawaited(_selectMobileCamera(CameraFacing.back));
                      },
                      onSelectFrontCamera: () {
                        unawaited(_selectMobileCamera(CameraFacing.front));
                      },
                    );
                  }
                : null,
            onOpenDesktopCameraSelector: showDesktopCamera
                ? () {
                    _desktopScannerKey.currentState?.showCameraSelector(
                      context,
                    );
                  }
                : null,
            onOpenHelp: () {
              showScannerHelpDialog(context);
            },
            onReset: _reset,
          ),
        ],
      ),
    );
  }

  Widget _buildDesktopScannerPlaceholder(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final title = l10n?.scanner_title ?? 'Scanner';
    final tip = l10n?.settings_scannerTip;
    return ScannerDesktopPlaceholder(title: title, tip: tip);
  }
}
