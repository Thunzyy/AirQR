import 'history.dart';
import 'incomplete_scans.dart';
import 'sync_service.dart';
import 'parse/wire.dart';

typedef ScannerGetHistoryCallback = Future<List<HistoryItem>> Function();
typedef ScannerFetchSessionInfoCallback =
    Future<WireObject?> Function(String sessionId);
typedef ScannerRemoveIncompleteScanCallback =
    Future<void> Function(String sessionId);

class ScannerSessionResolutionResult {
  final String? sessionId;
  final bool lockToCurrent;
  final bool skipSession;
  final Set<String> ignoredCompletedSessionIds;

  const ScannerSessionResolutionResult({
    required this.sessionId,
    required this.lockToCurrent,
    required this.skipSession,
    required this.ignoredCompletedSessionIds,
  });
}

class ScannerSessionResolutionController {
  final ScannerGetHistoryCallback _getHistory;
  final ScannerFetchSessionInfoCallback _fetchSessionInfo;
  final ScannerRemoveIncompleteScanCallback _removeIncompleteScan;

  ScannerSessionResolutionController({
    ScannerGetHistoryCallback? getHistory,
    ScannerFetchSessionInfoCallback? fetchSessionInfo,
    ScannerRemoveIncompleteScanCallback? removeIncompleteScan,
  }) : _getHistory = getHistory ?? HistoryService.getHistory,
       _fetchSessionInfo = fetchSessionInfo ?? SyncService.fetchSessionInfo,
       _removeIncompleteScan = removeIncompleteScan ?? IncompleteScanService.remove;

  Future<ScannerSessionResolutionResult> resolve({
    required String? qrSessionId,
    required bool isExplicitResume,
    required Set<String> ignoredCompletedSessionIds,
  }) async {
    if (qrSessionId == null || isExplicitResume) {
      return ScannerSessionResolutionResult(
        sessionId: qrSessionId,
        lockToCurrent: false,
        skipSession: false,
        ignoredCompletedSessionIds: ignoredCompletedSessionIds,
      );
    }

    if (ignoredCompletedSessionIds.contains(qrSessionId)) {
      return ScannerSessionResolutionResult(
        sessionId: null,
        lockToCurrent: false,
        skipSession: true,
        ignoredCompletedSessionIds: ignoredCompletedSessionIds,
      );
    }

    final updatedIgnored = Set<String>.from(ignoredCompletedSessionIds);
    final localHistory = await _getHistory();
    final alreadyInLocalHistory = localHistory.any(
      (item) => item.origin == 'scanned' && item.serverId == qrSessionId,
    );
    if (alreadyInLocalHistory) {
      updatedIgnored.add(qrSessionId);
      await _removeIncompleteScan(qrSessionId);
      return ScannerSessionResolutionResult(
        sessionId: null,
        lockToCurrent: false,
        skipSession: true,
        ignoredCompletedSessionIds: updatedIgnored,
      );
    }

    final server = await _fetchSessionInfo(qrSessionId);
    if (server == null) {
      return ScannerSessionResolutionResult(
        sessionId: qrSessionId,
        lockToCurrent: false,
        skipSession: false,
        ignoredCompletedSessionIds: updatedIgnored,
      );
    }

    final completed =
        server['completed'] == true ||
        (asWireString(server['status'])?.toLowerCase() == 'complete');

    if (completed) {
      updatedIgnored.add(qrSessionId);
      await _removeIncompleteScan(qrSessionId);
      return ScannerSessionResolutionResult(
        sessionId: null,
        lockToCurrent: false,
        skipSession: true,
        ignoredCompletedSessionIds: updatedIgnored,
      );
    }

    return ScannerSessionResolutionResult(
      sessionId: qrSessionId,
      lockToCurrent: false,
      skipSession: false,
      ignoredCompletedSessionIds: updatedIgnored,
    );
  }
}
