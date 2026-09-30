import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';

import 'history_service.dart';
import 'note_detection.dart';
import 'versioned_filename.dart';

class ScannerHistorySaveResult {
  final String filePath;
  final String fileName;
  final int timestamp;

  const ScannerHistorySaveResult({
    required this.filePath,
    required this.fileName,
    required this.timestamp,
  });
}

typedef ScannerWriteScannedFileCallback =
    Future<String> Function({
      required Uint8List data,
      required String fileName,
    });
typedef ScannerRecordScannedHistoryCallback =
    Future<void> Function({
      required String path,
      required int timestamp,
      required String? serverSessionId,
      required String? mimeType,
    });

class ScannerHistorySaveController {
  final ScannerWriteScannedFileCallback _writeScannedFile;
  final ScannerRecordScannedHistoryCallback _recordScannedHistory;

  static Future<String> _defaultWriteScannedFile({
    required Uint8List data,
    required String fileName,
  }) async {
    final appDir = await getApplicationDocumentsDirectory();
    final resolvedFileName = isNoteFilename(fileName)
        ? await resolveUniqueFilenameInDirectory(
            directory: appDir,
            filename: getDisplayNoteFilename(fileName),
          )
        : fileName;
    final filePath = path.join(appDir.path, resolvedFileName);
    await File(filePath).writeAsBytes(data);
    return filePath;
  }

  static Future<void> _defaultRecordScannedHistory({
    required String path,
    required int timestamp,
    required String? serverSessionId,
    required String? mimeType,
  }) {
    return HistoryService.add(
      path: path,
      origin: 'scanned',
      mimeType: mimeType,
      timestamp: timestamp,
      serverSessionId: serverSessionId,
    );
  }

  ScannerHistorySaveController({
    ScannerWriteScannedFileCallback? writeScannedFile,
    ScannerRecordScannedHistoryCallback? recordScannedHistory,
  }) : _writeScannedFile = writeScannedFile ?? _defaultWriteScannedFile,
       _recordScannedHistory =
           recordScannedHistory ?? _defaultRecordScannedHistory;

  Future<ScannerHistorySaveResult> save({
    required List<int> data,
    required String? filename,
    required String? sessionId,
  }) async {
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final fileName = filename ?? 'received_$timestamp.bin';
    final mimeType = isNoteFilename(fileName) ? 'text/plain' : null;
    final filePath = await _writeScannedFile(
      data: Uint8List.fromList(data),
      fileName: fileName,
    );
    await _recordScannedHistory(
      path: filePath,
      timestamp: timestamp,
      serverSessionId: sessionId,
      mimeType: mimeType,
    );
    final savedName = path.basename(filePath);
    return ScannerHistorySaveResult(
      filePath: filePath,
      fileName: savedName,
      timestamp: timestamp,
    );
  }
}
