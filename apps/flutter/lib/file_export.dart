import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_file_dialog/flutter_file_dialog.dart';
import 'package:path/path.dart' as p;

import 'safe_local_file_writer.dart';

typedef FileExportPathPicker =
    Future<String?> Function({required String fileName, String? dialogTitle});

typedef FileExportMobileSaver =
    Future<String?> Function({
      required String sourcePath,
      required String fileName,
    });

/// Save-as for History / Decoder / Scanner.
///
/// [FlutterFileDialog] is Android/iOS only. Calling it on Windows throws
/// [MissingPluginException], which Microsoft Store flagged as 10.1.2.10
/// ("error saving file: MissingPluginException" when downloading a GIF
/// from History). Desktop uses the native [FilePicker.saveFile] dialog.
bool fileExportUsesDesktopPicker() =>
    !kIsWeb && (Platform.isWindows || Platform.isLinux || Platform.isMacOS);

Future<String?> saveExistingFileToDevice({
  required String sourcePath,
  required String fileName,
  String? dialogTitle,
  bool? useDesktopPicker,
  FileExportPathPicker? pickSavePath,
  FileExportMobileSaver? saveOnMobile,
}) async {
  final safeName = SafeLocalFileWriter.safeBasename(fileName);
  final desktop = useDesktopPicker ?? fileExportUsesDesktopPicker();

  if (desktop) {
    final picker = pickSavePath ?? _pickDesktopSavePath;
    final destPath = await picker(fileName: safeName, dialogTitle: dialogTitle);
    if (destPath == null || destPath.isEmpty) {
      return null;
    }
    return _copyToDestination(sourcePath: sourcePath, destPath: destPath);
  }

  try {
    final mobile = saveOnMobile ?? _saveOnMobile;
    return await mobile(sourcePath: sourcePath, fileName: safeName);
  } on MissingPluginException {
    return saveExistingFileToDevice(
      sourcePath: sourcePath,
      fileName: fileName,
      dialogTitle: dialogTitle,
      useDesktopPicker: true,
      pickSavePath: pickSavePath,
    );
  }
}

Future<String?> saveBytesToDevice({
  required List<int> data,
  required String fileName,
  String? dialogTitle,
  bool? useDesktopPicker,
  FileExportPathPicker? pickSavePath,
  FileExportMobileSaver? saveOnMobile,
}) async {
  final safeName = SafeLocalFileWriter.safeBasename(fileName);
  final desktop = useDesktopPicker ?? fileExportUsesDesktopPicker();

  if (desktop) {
    final picker = pickSavePath ?? _pickDesktopSavePath;
    final destPath = await picker(fileName: safeName, dialogTitle: dialogTitle);
    if (destPath == null || destPath.isEmpty) {
      return null;
    }
    final dest = File(destPath);
    await dest.parent.create(recursive: true);
    await dest.writeAsBytes(data, flush: true);
    return destPath;
  }

  final tempPath = p.join(Directory.systemTemp.path, safeName);
  await File(tempPath).writeAsBytes(data, flush: true);
  return saveExistingFileToDevice(
    sourcePath: tempPath,
    fileName: safeName,
    dialogTitle: dialogTitle,
    useDesktopPicker: false,
    pickSavePath: pickSavePath,
    saveOnMobile: saveOnMobile,
  );
}

Future<String?> _pickDesktopSavePath({
  required String fileName,
  String? dialogTitle,
}) {
  final extension = p.extension(fileName).replaceFirst('.', '');
  return FilePicker.platform.saveFile(
    dialogTitle: dialogTitle ?? 'Save file',
    fileName: fileName,
    type: extension.isEmpty ? FileType.any : FileType.custom,
    allowedExtensions: extension.isEmpty ? null : <String>[extension],
    lockParentWindow: true,
  );
}

Future<String?> _saveOnMobile({
  required String sourcePath,
  required String fileName,
}) {
  return FlutterFileDialog.saveFile(
    params: SaveFileDialogParams(
      sourceFilePath: sourcePath,
      fileName: fileName,
    ),
  );
}

Future<String> _copyToDestination({
  required String sourcePath,
  required String destPath,
}) async {
  final source = File(sourcePath);
  if (!await source.exists()) {
    throw FileSystemException('Source file is missing', sourcePath);
  }
  final normalizedSource = p.normalize(sourcePath);
  final normalizedDest = p.normalize(destPath);
  if (p.equals(normalizedSource, normalizedDest)) {
    return destPath;
  }
  final dest = File(destPath);
  await dest.parent.create(recursive: true);
  await dest.writeAsBytes(await source.readAsBytes(), flush: true);
  return destPath;
}
