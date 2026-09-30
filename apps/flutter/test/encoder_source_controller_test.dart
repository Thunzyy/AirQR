import 'dart:io';
import 'dart:typed_data';

import 'package:airqr_mobile/encoder_source_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('EncoderSourceController', () {
    test('pickSingleFile loads file bytes and keeps file name', () async {
      final tempDirectory = await Directory.systemTemp.createTemp(
        'encoder-source-single',
      );
      addTearDown(() => tempDirectory.delete(recursive: true));
      final file = File('${tempDirectory.path}/demo.bin');
      await file.writeAsBytes(const <int>[1, 2, 3, 4]);

      final controller = EncoderSourceController(
        pickFile: ({allowedExtensions}) async => PickedSourceFile(
          path: file.path,
          name: 'demo.bin',
        ),
        pickDirectory: () async => null,
        zipDirectory: (_) async => Uint8List(0),
      );

      final source = await controller.pickSingleFile();

      expect(source, isNotNull);
      expect(source!.fileName, 'demo.bin');
      expect(source.selectedFile.path, file.path);
      expect(source.data, orderedEquals(const <int>[1, 2, 3, 4]));
    });

    test('pickZipFile requests zip extension and returns selected source', () async {
      List<String>? receivedExtensions;
      final controller = EncoderSourceController(
        pickFile: ({allowedExtensions}) async {
          receivedExtensions = allowedExtensions;
          return const PickedSourceFile(
            path: '/tmp/archive.zip',
            name: 'archive.zip',
          );
        },
        pickDirectory: () async => null,
        readFileBytes: (_) async => Uint8List.fromList(const <int>[9, 8, 7]),
        zipDirectory: (_) async => Uint8List(0),
      );

      final source = await controller.pickZipFile();

      expect(receivedExtensions, const <String>['zip']);
      expect(source, isNotNull);
      expect(source!.fileName, 'archive.zip');
      expect(source.data, orderedEquals(const <int>[9, 8, 7]));
    });

    test('pickFolder zips directory and names output after folder basename', () async {
      final tempDirectory = await Directory.systemTemp.createTemp(
        'encoder-source-folder',
      );
      addTearDown(() => tempDirectory.delete(recursive: true));

      Directory? zippedDirectory;
      final controller = EncoderSourceController(
        pickFile: ({allowedExtensions}) async => null,
        pickDirectory: () async => tempDirectory.path,
        zipDirectory: (directory) async {
          zippedDirectory = directory;
          return Uint8List.fromList(const <int>[5, 6, 7]);
        },
      );

      final source = await controller.pickFolder();
      final folderName =
          tempDirectory.path.split(Platform.pathSeparator).last;

      expect(zippedDirectory?.path, tempDirectory.path);
      expect(source, isNotNull);
      expect(source!.selectedFile.path, tempDirectory.path);
      expect(source.fileName, '$folderName.zip');
      expect(source.data, orderedEquals(const <int>[5, 6, 7]));
    });

    test('pickSingleFile returns null when selection is cancelled', () async {
      final controller = EncoderSourceController(
        pickFile: ({allowedExtensions}) async => null,
        pickDirectory: () async => null,
        zipDirectory: (_) async => Uint8List(0),
      );

      final source = await controller.pickSingleFile();

      expect(source, isNull);
    });
  });
}
