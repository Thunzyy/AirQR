import 'dart:async';
import 'dart:io';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'airqr_theme.dart';
import 'file_export.dart';
import 'l10n/app_localizations.dart';
import 'history_item.dart';
import 'generated_history_viewer.dart';
import 'history_page_actions.dart';
import 'history_query.dart';
import 'history_page_refresh.dart';
import 'history_page_widgets.dart';
import 'incomplete_scans.dart';
import 'local_file_opener.dart';
import 'note_view.dart';
import 'websocket_sync.dart';

class HistoryPage extends StatefulWidget {
  final void Function(String scanId)? onResumeRequested;
  final bool isActive;
  final HistoryPageRefreshController? refreshController;
  final Duration refreshInterval;
  final Future<void> Function(String path)? fileSaver;

  const HistoryPage({
    super.key,
    this.onResumeRequested,
    this.isActive = true,
    this.refreshController,
    this.refreshInterval = const Duration(seconds: 5),
    this.fileSaver,
  });

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

enum _HistoryPresentationEntryKind { header, gap, incomplete, completed }

class _HistoryPresentationEntry {
  final _HistoryPresentationEntryKind kind;
  final String? sectionKey;
  final double? gap;
  final IncompleteScan? scan;
  final HistoryItem? item;

  const _HistoryPresentationEntry._(
    this.kind, {
    this.sectionKey,
    this.gap,
    this.scan,
    this.item,
  });

  const _HistoryPresentationEntry.header(String sectionKey)
    : this._(_HistoryPresentationEntryKind.header, sectionKey: sectionKey);

  const _HistoryPresentationEntry.gap(double height)
    : this._(_HistoryPresentationEntryKind.gap, gap: height);

  const _HistoryPresentationEntry.incomplete(IncompleteScan scan)
    : this._(_HistoryPresentationEntryKind.incomplete, scan: scan);

  const _HistoryPresentationEntry.completed(HistoryItem item)
    : this._(_HistoryPresentationEntryKind.completed, item: item);
}

class _HistoryPageState extends State<HistoryPage> with WidgetsBindingObserver {
  List<HistoryItem> _items = [];
  List<IncompleteScan> _incompleteScans = [];
  ({HistoryItem item, String content})? _notePreview;
  String _filter = 'all'; // 'all' | 'scanned' | 'generated'
  String _searchQuery = '';
  bool _searchOpen = false;
  HistorySortOption _sortBy = HistorySortOption.dateDesc;
  bool _syncEnabled = false;
  bool _isSyncingNow = false;
  final TextEditingController _searchController = TextEditingController();
  Timer? _refreshTimer;
  static const _historySortPrefKey = 'airqr_history_sort';
  static const _syncInterval = Duration(
    seconds: 10,
  ); // Don't sync more often than this
  late final HistoryPageRefreshController _refreshController;
  final HistoryPageActions _actions = HistoryPageActions();
  StreamSubscription<SyncEvent>? _wsSubscription;
  bool _refreshInFlight = false;
  bool _refreshRequested = false;
  bool _forceRefreshRequested = false;
  Completer<void>? _queuedRefreshCompleter;
  int _activationRevision = 0;
  bool _appIsResumed = true;

  @override
  void initState() {
    super.initState();
    _refreshController =
        widget.refreshController ??
        HistoryPageRefreshController(syncInterval: _syncInterval);
    WidgetsBinding.instance.addObserver(this);
    _appIsResumed =
        WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    _loadSortPreference();
    if (widget.isActive) {
      unawaited(_refresh());
      _startAutoRefresh();
    }
    _setupWebSocketListener();
  }

  @override
  void didUpdateWidget(covariant HistoryPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isActive == widget.isActive) return;
    if (widget.isActive) {
      unawaited(_refresh());
      _startAutoRefresh();
    } else {
      _cancelRefreshWork();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cancelRefreshWork();
    _searchController.dispose();
    _wsSubscription?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _appIsResumed = state == AppLifecycleState.resumed;
    if (_appIsResumed && widget.isActive) {
      unawaited(_refresh());
      _startAutoRefresh();
    } else {
      _cancelRefreshWork();
    }
  }

  /// Listen to WebSocket events for real-time sync updates.
  void _setupWebSocketListener() {
    _wsSubscription = WebSocketSyncService.instance.events.listen((event) {
      debugPrint('📡 HistoryPage: WebSocket event received: ${event.type}');

      switch (event.type) {
        case 'scan-progress':
          // Another device is scanning - update incomplete scans list
          debugPrint(
            '📡 HistoryPage: scan-progress event, refreshing incomplete scans',
          );
          unawaited(_refresh());
          break;

        case 'scan-complete':
          // Another device completed a scan - force sync to download the file
          debugPrint('📡 HistoryPage: scan-complete event, forcing sync');
          _downloadCompletedScan(event.payload);
          break;

        case 'history':
          // History update from server
          debugPrint('📡 HistoryPage: history event, refreshing');
          unawaited(_refresh());
          break;

        case 'delete':
          // Item deleted on server
          debugPrint('📡 HistoryPage: delete event, refreshing');
          unawaited(_refresh());
          break;
      }
    });
  }

  /// Download a completed scan from the server when another device finishes.
  Future<void> _downloadCompletedScan(Object? payload) async {
    final result = await _refreshController.downloadCompletedScan(payload);

    switch (result.status) {
      case HistoryCompletedScanDownloadStatus.downloaded:
        if (!mounted) return;
        await _refresh();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(
                context,
              )!.history_scanCompleted(result.filename ?? result.sessionId!),
            ),
            backgroundColor: AirQrTheme.success,
          ),
        );
        break;
      case HistoryCompletedScanDownloadStatus.missingSessionId:
        debugPrint('📡 HistoryPage: scan-complete missing sessionId');
        break;
      case HistoryCompletedScanDownloadStatus.failed:
        debugPrint(
          '📡 HistoryPage: Error downloading completed scan: ${result.error}',
        );
        break;
    }
  }

  void _startAutoRefresh() {
    _refreshTimer?.cancel();
    if (!widget.isActive || !_appIsResumed) return;
    _refreshTimer = Timer.periodic(widget.refreshInterval, (_) {
      unawaited(_refresh());
    });
  }

  Future<void> _refresh({bool forceSync = false}) async {
    if (!widget.isActive || !_appIsResumed) return;
    if (_refreshInFlight) {
      _refreshRequested = true;
      _forceRefreshRequested = _forceRefreshRequested || forceSync;
      return (_queuedRefreshCompleter ??= Completer<void>()).future;
    }
    _refreshInFlight = true;
    final revision = _activationRevision;
    try {
      final snapshot = await _refreshController.refresh(forceSync: forceSync);
      if (!mounted ||
          !widget.isActive ||
          !_appIsResumed ||
          revision != _activationRevision) {
        return;
      }
      setState(() {
        _items = snapshot.items;
        _incompleteScans = snapshot.incompleteScans;
        _syncEnabled = snapshot.syncEnabled;
      });
    } finally {
      _refreshInFlight = false;
      final queuedCompleter = _queuedRefreshCompleter;
      if (mounted && widget.isActive && _appIsResumed && _refreshRequested) {
        final queuedForceSync = _forceRefreshRequested;
        _refreshRequested = false;
        _forceRefreshRequested = false;
        _queuedRefreshCompleter = null;
        unawaited(_runQueuedRefresh(queuedForceSync, queuedCompleter));
      } else {
        _refreshRequested = false;
        _forceRefreshRequested = false;
        _queuedRefreshCompleter = null;
        if (queuedCompleter != null && !queuedCompleter.isCompleted) {
          queuedCompleter.complete();
        }
      }
    }
  }

  Future<void> _runQueuedRefresh(
    bool forceSync,
    Completer<void>? completer,
  ) async {
    try {
      await _refresh(forceSync: forceSync);
      if (completer != null && !completer.isCompleted) {
        completer.complete();
      }
    } catch (error, stackTrace) {
      if (completer != null && !completer.isCompleted) {
        completer.completeError(error, stackTrace);
      }
    }
  }

  void _completeQueuedRefresh() {
    final completer = _queuedRefreshCompleter;
    _queuedRefreshCompleter = null;
    if (completer != null && !completer.isCompleted) {
      completer.complete();
    }
  }

  void _cancelRefreshWork() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _activationRevision++;
    _refreshRequested = false;
    _forceRefreshRequested = false;
    _completeQueuedRefresh();
  }

  List<HistoryItem> get _filteredItems {
    return filterHistoryItems(
      _items,
      originFilter: _filter,
      searchQuery: _searchQuery,
      sortBy: _sortBy,
    );
  }

  List<IncompleteScan> get _filteredIncompleteScans {
    if (_filter == 'generated') return const <IncompleteScan>[];
    final query = _searchQuery.trim().toLowerCase();
    if (query.isEmpty) return _incompleteScans;
    return _incompleteScans.where((scan) {
      final displayName = resolveScanDisplayName(scan.filename, scan.id);
      final formattedDate = _formatDate(scan.lastUpdateTimestamp);
      final isoDate = DateTime.fromMillisecondsSinceEpoch(
        scan.lastUpdateTimestamp,
        isUtc: true,
      ).toIso8601String();
      return displayName.toLowerCase().contains(query) ||
          scan.id.toLowerCase().contains(query) ||
          formattedDate.toLowerCase().contains(query) ||
          isoDate.toLowerCase().contains(query);
    }).toList();
  }

  Map<String, List<HistoryItem>> get _groupedItems {
    return groupHistoryItems(_filteredItems);
  }

  Future<void> _loadSortPreference() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_historySortPrefKey);
    final next = historySortOptionFromStoredValue(stored);
    if (!mounted) return;
    setState(() {
      _sortBy = next;
    });
  }

  Future<void> _saveSortPreference(HistorySortOption option) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _historySortPrefKey,
      historySortOptionToStoredValue(option),
    );
  }

  void _onSortSelected(HistorySortOption option) {
    if (_sortBy == option) return;
    setState(() {
      _sortBy = option;
    });
    unawaited(_saveSortPreference(option));
  }

  Future<void> _syncNowFromSearchbar() async {
    if (_isSyncingNow) return;
    setState(() {
      _isSyncingNow = true;
    });
    try {
      await _refresh(forceSync: true);
    } finally {
      if (mounted) {
        setState(() {
          _isSyncingNow = false;
        });
      }
    }
  }

  String _sortOptionIconName(HistorySortOption option) {
    switch (option) {
      case HistorySortOption.dateDesc:
      case HistorySortOption.sizeDesc:
      case HistorySortOption.nameDesc:
        return 'arrow_downward';
      case HistorySortOption.dateAsc:
      case HistorySortOption.sizeAsc:
      case HistorySortOption.nameAsc:
        return 'arrow_upward';
    }
  }

  String _sortOptionLabel(AppLocalizations l10n, HistorySortOption option) {
    switch (option) {
      case HistorySortOption.dateDesc:
        return l10n.history_sortNewest;
      case HistorySortOption.dateAsc:
        return l10n.history_sortOldest;
      case HistorySortOption.sizeDesc:
        return l10n.history_sortLargest;
      case HistorySortOption.sizeAsc:
        return l10n.history_sortSmallest;
      case HistorySortOption.nameAsc:
        return l10n.history_sortNameAscending;
      case HistorySortOption.nameDesc:
        return l10n.history_sortNameDescending;
    }
  }

  String _sortTooltip(AppLocalizations l10n) => l10n.history_sort;

  String _clearHistoryTooltip(AppLocalizations l10n) =>
      l10n.history_clearHistory;

  String _historySectionTitle(AppLocalizations l10n, String sectionKey) {
    switch (sectionKey) {
      case 'today':
        return l10n.common_today.toUpperCase();
      case 'yesterday':
        return l10n.common_yesterday.toUpperCase();
      default:
        return sectionKey;
    }
  }

  Future<void> _deleteFile(String path) async {
    HistoryItem? deletedItem;
    for (final item in _items) {
      if (item.path == path) {
        deletedItem = item;
        break;
      }
    }
    if (deletedItem != null) {
      _refreshController.invalidateRemoteMaterialization(deletedItem);
    }

    // Immediately remove from state to avoid "Dismissible still in tree" error
    setState(() {
      _items.removeWhere((item) => item.path == path);
    });

    final result = await _actions.deleteHistoryItem(deletedItem);
    if (result.shouldShowServerDeleteFailure) {
      _showServerDeleteFailedSnackBar();
    }
  }

  Future<void> _keepLocal(String path) async {
    final result = await _actions.keepLocal(path);
    await _refresh();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppLocalizations.of(context)!.history_localOnly(result.fileName),
          ),
          backgroundColor: AirQrTheme.accentBlue,
        ),
      );
    }
  }

  Future<HistoryItem?> _materializeForAction(HistoryItem item) async {
    final result = await _refreshController.materializeRemoteItem(item);
    if (!mounted) return null;
    if (result.status == HistoryMaterializationStatus.failed) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(
                context,
              )!.history_errorSaving(result.error.toString()),
            ),
            backgroundColor: AirQrTheme.destructive,
          ),
        );
      }
      return null;
    }

    final localItem = result.item!;
    if (result.status == HistoryMaterializationStatus.materialized && mounted) {
      setState(() {
        final index = _items.indexOf(item);
        if (index >= 0) _items[index] = localItem;
      });
    }
    return localItem;
  }

  Future<void> _keepLocalOnDemand(HistoryItem item) async {
    final localItem = await _materializeForAction(item);
    if (localItem == null) return;
    await _keepLocal(localItem.path);
  }

  Future<void> _syncItem(HistoryItem item) async {
    final result = await _actions.syncItem(item);
    await _showSyncItemResult(result);
    await _refresh();
  }

  Future<void> _showSyncItemResult(HistorySyncItemResult result) async {
    if (!mounted) return;

    switch (result.status) {
      case HistorySyncItemStatus.queued:
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(context)!.history_syncQueued(result.fileName),
            ),
            backgroundColor: AirQrTheme.success,
          ),
        );
        break;
      case HistorySyncItemStatus.syncNotConfigured:
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(context)!.history_syncNotConfigured,
            ),
            backgroundColor: AirQrTheme.progressOrange,
          ),
        );
        break;
      case HistorySyncItemStatus.fileNotFound:
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)!.history_fileNotFound),
            backgroundColor: AirQrTheme.destructive,
          ),
        );
        break;
      case HistorySyncItemStatus.failed:
        debugPrint('Sync error: ${result.error}');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(
                context,
              )!.history_syncFailed(result.error.toString()),
            ),
            backgroundColor: AirQrTheme.destructive,
          ),
        );
        break;
    }
  }

  Future<void> _syncIncompleteScan(IncompleteScan scan) async {
    final result = await _actions.syncIncompleteScan(scan);
    await _showSyncItemResult(result);
    await _refresh();
  }

  Future<void> _keepLocalIncompleteScan(IncompleteScan scan) async {
    final result = await _actions.keepLocalIncompleteScan(scan);
    await _refresh();
    if (!mounted) return;

    switch (result.status) {
      case HistoryIncompleteKeepLocalStatus.saved:
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(context)!.history_localOnly(result.fileName),
            ),
            backgroundColor: result.shouldShowServerDeleteFailure
                ? AirQrTheme.progressOrange
                : AirQrTheme.accentBlue,
          ),
        );
        if (result.shouldShowServerDeleteFailure) {
          _showServerDeleteFailedSnackBar();
        }
        break;
      case HistoryIncompleteKeepLocalStatus.packetsUnavailable:
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)!.history_fileNotFound),
            backgroundColor: AirQrTheme.destructive,
          ),
        );
        break;
      case HistoryIncompleteKeepLocalStatus.failed:
        debugPrint('Keep local incomplete error: ${result.error}');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(
                context,
              )!.history_syncFailed(result.error.toString()),
            ),
            backgroundColor: AirQrTheme.destructive,
          ),
        );
        break;
    }
  }

  Future<void> _confirmClearHistory() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AirQrTheme.card(context),
        title: Text(
          l10n.history_clearHistoryTitle,
          style: TextStyle(color: AirQrTheme.textPrimary(context)),
        ),
        content: Text(
          l10n.history_clearHistoryMessage,
          style: TextStyle(color: AirQrTheme.textSecondary(context)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(
              l10n.common_cancel,
              style: TextStyle(color: AirQrTheme.textSecondary(context)),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              l10n.common_delete,
              style: TextStyle(color: AirQrTheme.dangerText(context)),
            ),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await _clearHistory();
    }
  }

  Future<void> _clearHistory() async {
    final itemsToDelete = List<HistoryItem>.of(_items);
    final scansToDelete = List<IncompleteScan>.of(_incompleteScans);

    if (itemsToDelete.isEmpty && scansToDelete.isEmpty) return;

    _refreshController.invalidateRemoteMaterializations(itemsToDelete);

    setState(() {
      _items = [];
      _incompleteScans = [];
    });

    final result = await _actions.clearHistory(
      items: itemsToDelete,
      incompleteScans: scansToDelete,
      syncEnabled: _syncEnabled,
    );

    if (result.shouldShowServerDeleteFailure) {
      _showServerDeleteFailedSnackBar();
    }

    await _refresh();
  }

  Future<void> _confirmDelete(String path, String fileName) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AirQrTheme.card(context),
        title: Text(
          AppLocalizations.of(context)!.history_deleteFileTitle,
          style: TextStyle(color: AirQrTheme.textPrimary(context)),
        ),
        content: Text(
          AppLocalizations.of(context)!.history_deleteFileConfirm(fileName),
          style: TextStyle(color: AirQrTheme.textSecondary(context)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(
              AppLocalizations.of(context)!.common_cancel,
              style: TextStyle(color: AirQrTheme.textSecondary(context)),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              AppLocalizations.of(context)!.common_delete,
              style: TextStyle(color: AirQrTheme.dangerText(context)),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _deleteFile(path);
    }
  }

  void _resumeScan(IncompleteScan scan) {
    widget.onResumeRequested?.call(scan.id);
  }

  Future<void> _deleteIncompleteScan(String scanId) async {
    IncompleteScan? deletedScan;
    for (final scan in _incompleteScans) {
      if (scan.id == scanId) {
        deletedScan = scan;
        break;
      }
    }

    // Immediately remove from state to avoid "Dismissible still in tree" error
    setState(() {
      _incompleteScans.removeWhere((scan) => scan.id == scanId);
    });

    final result = await _actions.deleteIncompleteScan(
      deletedScan,
      syncEnabled: _syncEnabled,
    );
    if (result.shouldShowServerDeleteFailure) {
      _showServerDeleteFailedSnackBar();
    }
  }

  void _showServerDeleteFailedSnackBar() {
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(l10n.history_serverDeleteFailed),
        backgroundColor: AirQrTheme.progressOrange,
      ),
    );
  }

  Future<void> _saveFileToDevice(String path) async {
    try {
      final file = File(path);
      if (!await file.exists()) return;

      final name = p.basename(path);
      final filePath = await saveExistingFileToDevice(
        sourcePath: path,
        fileName: name,
      );

      if (mounted && filePath != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)!.decoder_fileSaved),
          ),
        );
      }
    } catch (e) {
      debugPrint('Save error: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(context)!.history_errorSaving(e.toString()),
            ),
          ),
        );
      }
    }
  }

  Future<void> _saveHistoryItemOnDemand(HistoryItem item) async {
    final localItem = await _materializeForAction(item);
    if (localItem == null) return;
    await (widget.fileSaver ?? _saveFileToDevice)(localItem.path);
  }

  String _formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
    return DateFormat('MMM d, y HH:mm').format(date);
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  String _formatNoteFooterDateTime(HistoryItem item) {
    final date = DateTime.fromMillisecondsSinceEpoch(item.timestamp);
    return DateFormat('yyyy-MM-dd - HH:mm').format(date);
  }

  String? _serverSyncSummary(BuildContext context, IncompleteScan scan) {
    final serverReceived = scan.serverReceivedPackets;
    if (serverReceived == null || scan.receivedPackets <= serverReceived) {
      return null;
    }
    final serverExpected = scan.serverExpectedPackets ?? scan.expectedPackets;
    return AppLocalizations.of(
      context,
    )!.history_serverSyncPackets(serverReceived, serverExpected);
  }

  Future<void> _viewNote(HistoryItem item) async {
    try {
      final file = File(item.path);
      if (!await file.exists()) return;
      final content = const Utf8Decoder(
        allowMalformed: true,
      ).convert(await file.readAsBytes());
      if (!mounted) return;
      setState(() {
        _notePreview = (item: item, content: content);
      });
    } catch (error) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.history_errorSaving(error.toString())),
          backgroundColor: AirQrTheme.destructive,
        ),
      );
    }
  }

  Future<void> _viewHistoryItem(HistoryItem item) async {
    if (usesGeneratedGifViewer(item)) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => GeneratedHistoryViewerPage(
            item: item,
            onDownload: () => _saveFileToDevice(item.path),
          ),
        ),
      );
      return;
    }

    if (item.isTextPreviewable) {
      await _viewNote(item);
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context)!;
    try {
      final file = File(item.path);
      if (!await file.exists()) return;
      final opened = await openLocalFile(item.path);
      if (!opened && mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text(l10n.history_previewOpenFailed)),
        );
      }
    } catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.history_previewOpenError(e.toString()))),
      );
    }
  }

  Future<void> _viewHistoryItemOnDemand(HistoryItem item) async {
    final localItem = await _materializeForAction(item);
    if (localItem == null) return;
    await _viewHistoryItem(localItem);
  }

  List<HistorySortMenuValue> _buildSortMenuItems(AppLocalizations l10n) {
    return HistorySortOption.values.map((option) {
      final selected = option == _sortBy;
      return HistorySortMenuValue(
        label: _sortOptionLabel(l10n, option),
        iconName: _sortOptionIconName(option),
        selected: selected,
        value: option,
      );
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final notePreview = _notePreview;
    if (notePreview != null) {
      final item = notePreview.item;
      final content = notePreview.content;
      final footerDateTime = _formatNoteFooterDateTime(item);
      final footerSize = _formatSize(item.size);
      final footerStyle = Theme.of(context).textTheme.labelMedium?.copyWith(
        color: AirQrTheme.textMuted(context),
        fontWeight: FontWeight.w500,
      );
      return NoteViewerScaffold(
        filename: p.basename(item.path),
        content: content,
        onBack: () {
          setState(() {
            _notePreview = null;
          });
        },
        bottomClearance: 124,
        toolbarActions: [
          NoteToolbarIconButton(
            iconName: 'content_copy',
            tooltip: l10n.common_copy,
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: content));
              if (!mounted) return;
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text(l10n.scanner_noteCopied)));
            },
          ),
          NoteToolbarIconButton(
            iconName: 'download',
            tooltip: l10n.common_download,
            onPressed: () => _saveFileToDevice(item.path),
          ),
        ],
        footerTrailing: Row(
          key: const Key('note_view_footer_metadata'),
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                footerDateTime,
                key: const Key('note_view_footer_date'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.right,
                style: footerStyle,
              ),
            ),
            Text(' - ', style: footerStyle),
            Text(
              footerSize,
              key: const Key('note_view_footer_size'),
              maxLines: 1,
              style: footerStyle,
            ),
          ],
        ),
      );
    }
    final backgroundColor = AirQrTheme.background(context);
    final cardColor = AirQrTheme.card(context);
    const primaryColor = AirQrTheme.accentBlue;
    const successColor = AirQrTheme.success;
    const warningColor = AirQrTheme.progressOrange;
    final generatedColor = AirQrTheme.accentText(context);

    final grouped = _groupedItems;
    final filteredIncompleteScans = _filteredIncompleteScans;
    final sectionKeys = historySectionKeys(grouped, sortBy: _sortBy);
    final hasContent =
        _filteredItems.isNotEmpty || filteredIncompleteScans.isNotEmpty;
    final hasAnyHistory = _items.isNotEmpty || _incompleteScans.isNotEmpty;
    final presentationEntries = <_HistoryPresentationEntry>[];
    if (filteredIncompleteScans.isNotEmpty) {
      presentationEntries
        ..add(const _HistoryPresentationEntry.header('__incomplete__'))
        ..add(const _HistoryPresentationEntry.gap(4))
        ..addAll(
          filteredIncompleteScans.map(_HistoryPresentationEntry.incomplete),
        )
        ..add(const _HistoryPresentationEntry.gap(12));
    }
    for (final sectionKey in sectionKeys) {
      presentationEntries
        ..add(_HistoryPresentationEntry.header(sectionKey))
        ..add(const _HistoryPresentationEntry.gap(4))
        ..addAll(grouped[sectionKey]!.map(_HistoryPresentationEntry.completed))
        ..add(const _HistoryPresentationEntry.gap(8));
    }
    presentationEntries.add(const _HistoryPresentationEntry.gap(100));

    return Scaffold(
      backgroundColor: backgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            HistorySearchToolbar(
              searchController: _searchController,
              searchOpen: _searchOpen,
              searchQuery: _searchQuery,
              searchHint: l10n.history_searchFiles,
              connected: _syncEnabled,
              connectedLabel: l10n.history_connected,
              refreshTooltip: l10n.history_refresh,
              clearSearchTooltip: l10n.history_clearSearch,
              onToggleSearch: () {
                setState(() {
                  _searchOpen = !_searchOpen;
                  if (!_searchOpen) {
                    _searchController.clear();
                    _searchQuery = '';
                  }
                });
              },
              onClearSearch: () {
                _searchController.clear();
                setState(() => _searchQuery = '');
              },
              onSearchChanged: (value) => setState(() => _searchQuery = value),
              sortTooltip: _sortTooltip(l10n),
              sortItems: _buildSortMenuItems(l10n),
              onSortSelected: (menuValue) =>
                  _onSortSelected(menuValue.value as HistorySortOption),
              onRefresh: _refresh,
              canClearHistory: hasAnyHistory,
              clearHistoryTooltip: _clearHistoryTooltip(l10n),
              onClearHistory: _confirmClearHistory,
              syncEnabled: _syncEnabled,
              isSyncingNow: _isSyncingNow,
              syncTooltip: l10n.history_syncToServer,
              onSyncNow: _syncNowFromSearchbar,
              cardColor: cardColor,
              primaryColor: primaryColor,
            ),
            HistoryFilterToggle(
              selectedFilter: _filter,
              cardColor: AirQrTheme.navSurface(context),
              selectedColor: AirQrTheme.navActive(context),
              allLabel: l10n.history_all,
              scannedLabel: l10n.history_scanned,
              generatedLabel: l10n.history_generated,
              onChanged: (value) => setState(() => _filter = value),
            ),
            Expanded(
              child: !hasContent
                  ? HistoryEmptyState(
                      filter: _filter,
                      scannedLabel: l10n.history_noFilesScanned,
                      generatedLabel: l10n.history_noFilesGenerated,
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: presentationEntries.length,
                      itemBuilder: (context, index) {
                        final entry = presentationEntries[index];
                        switch (entry.kind) {
                          case _HistoryPresentationEntryKind.header:
                            return HistorySectionHeader(
                              title: entry.sectionKey == '__incomplete__'
                                  ? l10n.history_incompleteScans
                                  : _historySectionTitle(
                                      l10n,
                                      entry.sectionKey!,
                                    ),
                            );
                          case _HistoryPresentationEntryKind.gap:
                            return SizedBox(height: entry.gap!);
                          case _HistoryPresentationEntryKind.incomplete:
                            final scan = entry.scan!;
                            return IncompleteHistoryCard(
                              scan: scan,
                              cardColor: cardColor,
                              warningColor: warningColor,
                              displayName: resolveScanDisplayName(
                                scan.filename,
                                scan.id,
                              ),
                              packetsSummary: AppLocalizations.of(context)!
                                  .history_packets(
                                    scan.receivedPackets,
                                    scan.expectedPackets,
                                  ),
                              serverSyncSummary: _serverSyncSummary(
                                context,
                                scan,
                              ),
                              formattedDate: _formatDate(
                                scan.lastUpdateTimestamp,
                              ),
                              keepLocalLabel: l10n.history_keepLocal,
                              syncLabel: l10n.history_syncToServer,
                              resumeLabel: l10n.history_resumeScan,
                              deleteLabel: l10n.history_deleteIncomplete,
                              onSync: _syncEnabled && !scan.isRemote
                                  ? () => _syncIncompleteScan(scan)
                                  : null,
                              onKeepLocal: _syncEnabled && scan.isRemote
                                  ? () => _keepLocalIncompleteScan(scan)
                                  : null,
                              onResume: () => _resumeScan(scan),
                              onDelete: () => _deleteIncompleteScan(scan.id),
                            );
                          case _HistoryPresentationEntryKind.completed:
                            final item = entry.item!;
                            return CompletedHistoryCard(
                              item: item,
                              cardColor: cardColor,
                              successColor: _filter == 'scanned'
                                  ? successColor
                                  : generatedColor,
                              subtitle:
                                  '${_formatDate(item.timestamp)} • ${_formatSize(item.size)}',
                              viewLabel: l10n.common_open,
                              keepLocalLabel: l10n.history_keepLocal,
                              syncLabel: l10n.history_syncToServer,
                              saveLabel: l10n.common_download,
                              deleteLabel: l10n.common_delete,
                              onView: item.isPreviewable
                                  ? () => _viewHistoryItemOnDemand(item)
                                  : null,
                              onKeepLocal: item.isSynced
                                  ? () => _keepLocalOnDemand(item)
                                  : null,
                              onSync: item.isLocalOnly
                                  ? () => _syncItem(item)
                                  : null,
                              onSave: () => _saveHistoryItemOnDemand(item),
                              onDelete: () => _confirmDelete(
                                item.path,
                                p.basename(item.path),
                              ),
                              onDismissed: () => _deleteFile(item.path),
                            );
                        }
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
