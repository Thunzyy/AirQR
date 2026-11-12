import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';

import 'file_export.dart';
import 'sync_service.dart';
import 'safe_local_file_writer.dart';
import 'server_id.dart';

class ScannerResultDownloadOutcome {
  final String sourcePath;
  final String? savedPath;
  final bool downloadedFromServer;

  const ScannerResultDownloadOutcome({
    required this.sourcePath,
    required this.savedPath,
    required this.downloadedFromServer,
  });
}

typedef ScannerResultFileExistsCallback = Future<bool> Function(String path);
typedef ScannerResultDownloadFileCallback =
    Future<Uint8List?> Function(String sessionId);
typedef ScannerResultPersistTempFileCallback =
    Future<String> Function({
      required Uint8List data,
      required String fileName,
    });
typedef ScannerResultSaveFileCallback =
    Future<String?> Function({
      required String sourcePath,
      required String fileName,
    });

class ScannerResultDownloadController {
  final ScannerResultFileExistsCallback _fileExists;
  final ScannerResultDownloadFileCallback _downloadScannedFile;
  final ScannerResultPersistTempFileCallback _persistTempFile;
  final ScannerResultSaveFileCallback _saveFile;

  static Future<bool> _defaultFileExists(String pathValue) {
    return File(pathValue).exists();
  }

  static Future<Uint8List?> _defaultDownloadScannedFile(
    String sessionId,
  ) async {
    final fileBytes = await SyncService.downloadFile(
      id: sessionId,
      origin: 'scanned',
    );
    if (fileBytes == null) return null;
    return Uint8List.fromList(fileBytes);
  }

  static Future<String> _defaultPersistTempFile({
    required Uint8List data,
    required String fileName,
  }) async {
    final appDir = await getApplicationDocumentsDirectory();
    return SafeLocalFileWriter.writeBytes(appDir, fileName, data);
  }

  static Future<String?> _defaultSaveFile({
    required String sourcePath,
    required String fileName,
  }) {
    return saveExistingFileToDevice(
      sourcePath: sourcePath,
      fileName: fileName,
    );
  }

  ScannerResultDownloadController({
    ScannerResultFileExistsCallback? fileExists,
    ScannerResultDownloadFileCallback? downloadScannedFile,
    ScannerResultPersistTempFileCallback? persistTempFile,
    ScannerResultSaveFileCallback? saveFile,
  }) : _fileExists = fileExists ?? _defaultFileExists,
       _downloadScannedFile =
           downloadScannedFile ?? _defaultDownloadScannedFile,
       _persistTempFile = persistTempFile ?? _defaultPersistTempFile,
       _saveFile = saveFile ?? _defaultSaveFile;

  Future<ScannerResultDownloadOutcome> save({
    required String? cachedPath,
    required String? sessionId,
    required String? fileName,
  }) async {
    var sourcePath = cachedPath;
    var downloadedFromServer = false;

    if (sourcePath == null || !await _fileExists(sourcePath)) {
      if (sessionId == null || sessionId.isEmpty) {
        throw StateError('No cached file or resumable session is available');
      }
      final serverId = ServerId.tryParse(sessionId);
      if (serverId == null) {
        throw FormatException('Invalid server ID', sessionId);
      }

      final fileBytes = await _downloadScannedFile(serverId.value);
      if (fileBytes == null || fileBytes.isEmpty) {
        throw Exception('Unable to download completed file from server');
      }

      final fallbackName =
          fileName ?? 'received_${DateTime.now().millisecondsSinceEpoch}.bin';
      final safeFileName = SafeLocalFileWriter.safeBasename(fallbackName);
      sourcePath = await _persistTempFile(
        data: fileBytes,
        fileName: safeFileName,
      );
      downloadedFromServer = true;
    }

    final resolvedFileName = path.basename(sourcePath);
    final savedPath = await _saveFile(
      sourcePath: sourcePath,
      fileName: resolvedFileName,
    );

    return ScannerResultDownloadOutcome(
      sourcePath: sourcePath,
      savedPath: savedPath,
      downloadedFromServer: downloadedFromServer,
    );
  }
}
