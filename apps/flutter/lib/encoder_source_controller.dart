import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as path;

class PickedSourceFile {
  final String path;
  final String name;

  const PickedSourceFile({
    required this.path,
    required this.name,
  });
}

class EncoderSelectedSource {
  final File selectedFile;
  final Uint8List data;
  final String fileName;

  const EncoderSelectedSource({
    required this.selectedFile,
    required this.data,
    required this.fileName,
  });
}

typedef PickSourceFileCallback =
    Future<PickedSourceFile?> Function({List<String>? allowedExtensions});
typedef PickSourceDirectoryCallback = Future<String?> Function();
typedef ReadSourceFileBytesCallback = Future<Uint8List> Function(String path);
typedef ZipSourceDirectoryCallback = Future<Uint8List> Function(Directory dir);

class EncoderSourceController {
  final PickSourceFileCallback _pickFile;
  final PickSourceDirectoryCallback _pickDirectory;
  final ReadSourceFileBytesCallback _readFileBytes;
  final ZipSourceDirectoryCallback _zipDirectory;

  EncoderSourceController({
    required PickSourceFileCallback pickFile,
    required PickSourceDirectoryCallback pickDirectory,
    ReadSourceFileBytesCallback? readFileBytes,
    required ZipSourceDirectoryCallback zipDirectory,
  }) : _pickFile = pickFile,
       _pickDirectory = pickDirectory,
       _readFileBytes = readFileBytes ?? _defaultReadFileBytes,
       _zipDirectory = zipDirectory;

  Future<EncoderSelectedSource?> pickSingleFile() async {
    final pickedFile = await _pickFile();
    return _loadPickedFile(pickedFile);
  }

  Future<EncoderSelectedSource?> pickZipFile() async {
    final pickedFile = await _pickFile(allowedExtensions: const ['zip']);
    return _loadPickedFile(pickedFile);
  }

  Future<EncoderSelectedSource?> pickFolder() async {
    final directoryPath = await _pickDirectory();
    if (directoryPath == null) {
      return null;
    }

    final directory = Directory(directoryPath);
    final zipData = await _zipDirectory(directory);
    return EncoderSelectedSource(
      selectedFile: File(directoryPath),
      data: zipData,
      fileName: '${path.basename(directoryPath)}.zip',
    );
  }

  Future<EncoderSelectedSource?> _loadPickedFile(
    PickedSourceFile? pickedFile,
  ) async {
    if (pickedFile == null) {
      return null;
    }

    final data = await _readFileBytes(pickedFile.path);
    return EncoderSelectedSource(
      selectedFile: File(pickedFile.path),
      data: data,
      fileName: pickedFile.name,
    );
  }

  static Future<Uint8List> _defaultReadFileBytes(String path) {
    return File(path).readAsBytes();
  }
}
