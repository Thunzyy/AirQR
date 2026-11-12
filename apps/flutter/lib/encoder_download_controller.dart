import 'dart:typed_data';

import 'encoder_storage_service.dart';

class EncoderDownloadResult {
  final String savedPath;
  final bool historyRecorded;

  const EncoderDownloadResult({
    required this.savedPath,
    required this.historyRecorded,
  });
}

typedef SaveEncoderBinaryFileCallback =
    Future<String?> Function({
      required Uint8List data,
      required String fileName,
    });
typedef RecordEncoderDownloadCallback =
    Future<void> Function({
      required String path,
      required String mimeType,
      required int totalFrames,
      required int minFrames,
      List<int>? chunkMinFrames,
      required int timestamp,
    });

class EncoderDownloadController {
  final SaveEncoderBinaryFileCallback _saveBinaryFile;
  final RecordEncoderDownloadCallback _recordGeneratedDownload;

  static Future<String?> _defaultSaveBinaryFile({
    required Uint8List data,
    required String fileName,
  }) {
    return EncoderStorageService().saveBinaryFile(
      data: data,
      fileName: fileName,
    );
  }

  static Future<void> _defaultRecordGeneratedDownload({
    required String path,
    required String mimeType,
    required int totalFrames,
    required int minFrames,
    List<int>? chunkMinFrames,
    required int timestamp,
  }) {
    return EncoderStorageService().recordGeneratedDownload(
      path: path,
      mimeType: mimeType,
      totalFrames: totalFrames,
      minFrames: minFrames,
      chunkMinFrames: chunkMinFrames,
      timestamp: timestamp,
    );
  }

  EncoderDownloadController({
    SaveEncoderBinaryFileCallback? saveBinaryFile,
    RecordEncoderDownloadCallback? recordGeneratedDownload,
  }) : _saveBinaryFile = saveBinaryFile ?? _defaultSaveBinaryFile,
       _recordGeneratedDownload =
           recordGeneratedDownload ?? _defaultRecordGeneratedDownload;

  Future<EncoderDownloadResult?> download({
    required Uint8List data,
    required String fileName,
    required String mimeType,
    required int totalFrames,
    required int minFrames,
    List<int>? chunkMinFrames,
    required int timestamp,
    bool recordHistory = true,
  }) async {
    final savedPath = await _saveBinaryFile(data: data, fileName: fileName);
    if (savedPath == null) return null;

    if (!recordHistory) {
      return EncoderDownloadResult(
        savedPath: savedPath,
        historyRecorded: false,
      );
    }

    try {
      await _recordGeneratedDownload(
        path: savedPath,
        mimeType: mimeType,
        totalFrames: totalFrames,
        minFrames: minFrames,
        chunkMinFrames: chunkMinFrames,
        timestamp: timestamp,
      );
      return EncoderDownloadResult(savedPath: savedPath, historyRecorded: true);
    } catch (_) {
      return EncoderDownloadResult(
        savedPath: savedPath,
        historyRecorded: false,
      );
    }
  }
}
