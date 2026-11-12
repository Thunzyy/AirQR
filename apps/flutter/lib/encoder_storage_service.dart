import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:path_provider/path_provider.dart';

import 'history_service.dart';
import 'file_export.dart';
import 'note_detection.dart';
import 'versioned_filename.dart';

typedef EncoderDocumentsDirectoryLoader = Future<Directory> Function();
typedef EncoderHistoryAddCallback =
    Future<void> Function({
      required String path,
      required String origin,
      String? mimeType,
      int? totalFrames,
      int? minFrames,
      List<int>? chunkMinFrames,
      int? timestamp,
      bool syncToServer,
      bool isSynced,
      String? serverId,
      String? serverSessionId,
    });

class EncoderStorageService {
  final EncoderDocumentsDirectoryLoader _loadDocumentsDirectory;
  final EncoderHistoryAddCallback _addHistoryItem;

  EncoderStorageService({
    EncoderDocumentsDirectoryLoader? loadDocumentsDirectory,
    EncoderHistoryAddCallback? addHistoryItem,
  }) : _loadDocumentsDirectory =
           loadDocumentsDirectory ?? getApplicationDocumentsDirectory,
       _addHistoryItem = addHistoryItem ?? HistoryService.add;

  Future<Uint8List> zipFolder(Directory directory) async {
    final archive = Archive();
    await _addFolderToArchive(archive, directory, directory.path);
    final zipData = ZipEncoder().encode(archive);
    if (zipData == null) {
      throw Exception('Failed to create ZIP');
    }
    return Uint8List.fromList(zipData);
  }

  Future<void> saveGeneratedToHistory({
    required Uint8List data,
    required String fileName,
    required String mimeType,
    required int totalFrames,
    required int minFrames,
    List<int>? chunkMinFrames,
  }) async {
    final documentsDirectory = await _loadDocumentsDirectory();
    final resolvedFileName = isNoteMimeType(mimeType)
        ? await resolveUniqueFilenameInDirectory(
            directory: documentsDirectory,
            filename: fileName,
          )
        : fileName;
    final file = File('${documentsDirectory.path}/$resolvedFileName');
    await file.writeAsBytes(data);
    await _addHistoryItem(
      path: file.path,
      origin: 'generated',
      mimeType: mimeType,
      totalFrames: totalFrames,
      minFrames: minFrames,
      chunkMinFrames: chunkMinFrames,
    );
  }

  Future<String?> saveBinaryFile({
    required Uint8List data,
    required String fileName,
  }) {
    // Every platform exports through its supported destination picker.
    // A private documents-directory fallback is not a user-visible download.
    return saveBytesToDevice(data: data, fileName: fileName);
  }

  Future<void> recordGeneratedDownload({
    required String path,
    required String mimeType,
    required int totalFrames,
    required int minFrames,
    List<int>? chunkMinFrames,
    required int timestamp,
  }) async {
    await _addHistoryItem(
      path: path,
      origin: 'generated',
      mimeType: mimeType,
      totalFrames: totalFrames,
      minFrames: minFrames,
      chunkMinFrames: chunkMinFrames,
      timestamp: timestamp,
    );
  }

  Future<void> _addFolderToArchive(
    Archive archive,
    Directory directory,
    String basePath,
  ) async {
    final entities = directory.listSync(recursive: true);
    for (final entity in entities) {
      if (entity is! File) continue;
      final relativePath = entity.path.replaceFirst(
        '$basePath${Platform.pathSeparator}',
        '',
      );
      final data = await entity.readAsBytes();
      archive.addFile(ArchiveFile(relativePath, data.length, data));
    }
  }
}
