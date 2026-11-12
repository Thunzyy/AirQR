import 'dart:typed_data';

import 'incomplete_scans.dart';

typedef ScannerGetIncompleteScanByIdCallback =
    Future<IncompleteScan?> Function(String scanId);
typedef ScannerResumeSessionCallback = Future<void> Function(String scanId);
typedef ScannerGetPacketsWithRemoteCallback =
    Future<List<Uint8List>> Function(String scanId);

class ScannerResumeLoadResult {
  final String currentScanId;
  final int receivedPackets;
  final int expectedPackets;
  final int totalPackets;
  final String? currentFilename;
  final double progress;
  final List<Uint8List> packets;
  final bool isExplicitResume;
  final bool lockSessionIdToCurrent;
  final int remoteReceivedPackets;
  final int remoteExpectedPackets;
  final String status;

  const ScannerResumeLoadResult({
    required this.currentScanId,
    required this.receivedPackets,
    required this.expectedPackets,
    this.totalPackets = 0,
    required this.currentFilename,
    required this.progress,
    required this.packets,
    required this.isExplicitResume,
    required this.lockSessionIdToCurrent,
    required this.remoteReceivedPackets,
    required this.remoteExpectedPackets,
    required this.status,
  });
}

class ScannerResumeController {
  final ScannerGetIncompleteScanByIdCallback _getIncompleteScanById;
  final ScannerResumeSessionCallback _resumeSession;
  final ScannerGetPacketsWithRemoteCallback _getPacketsWithRemote;

  ScannerResumeController({
    ScannerGetIncompleteScanByIdCallback? getIncompleteScanById,
    ScannerResumeSessionCallback? resumeSession,
    ScannerGetPacketsWithRemoteCallback? getPacketsWithRemote,
  }) : _getIncompleteScanById =
           getIncompleteScanById ?? IncompleteScanService.getById,
       _resumeSession = resumeSession ?? IncompleteScanService.resumeSession,
       _getPacketsWithRemote =
           getPacketsWithRemote ?? IncompleteScanService.getPacketsWithRemote;

  Future<ScannerResumeLoadResult> loadResume(String scanId) async {
    final scanInfo = await _getIncompleteScanById(scanId);
    final receivedPackets = scanInfo?.receivedPackets ?? 0;
    final expectedPackets = scanInfo?.expectedPackets ?? 0;
    final currentFilename = normalizeScanFilename(scanInfo?.filename);
    final progress = scanInfo?.progress ?? 0.0;

    await _resumeSession(scanId);
    final packets = await _getPacketsWithRemote(scanId);

    return ScannerResumeLoadResult(
      currentScanId: scanId,
      receivedPackets: receivedPackets,
      expectedPackets: expectedPackets,
      totalPackets: 0,
      currentFilename: currentFilename,
      progress: progress,
      packets: packets,
      isExplicitResume: true,
      lockSessionIdToCurrent: true,
      remoteReceivedPackets: 0,
      remoteExpectedPackets: 0,
      status: 'Resuming scan... (${packets.length} packets)',
    );
  }
}
