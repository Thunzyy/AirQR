import 'dart:io';
import 'dart:typed_data';

import 'package:airqr_mobile/encoder_download_controller.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

class SavePicker extends FilePicker {
  String? destination;
  String? suggestedName;
  List<String>? extensions;

  @override
  Future<String?> saveFile({
    String? dialogTitle,
    String? fileName,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Uint8List? bytes,
    bool lockParentWindow = false,
  }) async {
    suggestedName = fileName;
    extensions = allowedExtensions;
    return destination;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory temp;
  late SavePicker picker;

  setUp(() async {
    temp = await Directory.systemTemp.createTemp('airqr-encoder-export-');
    picker = SavePicker();
    FilePicker.platform = picker;
  });
  tearDown(() async {
    FilePicker.platform = SavePicker();
    await temp.delete(recursive: true);
  });

  for (final extension in ['gif', 'zip']) {
    test(
      'encoder $extension saves exact bytes to the chosen Windows path',
      () async {
        final destination = p.join(
          temp.path,
          'Dossier avec accents é',
          'export.$extension',
        );
        picker.destination = destination;
        final payload = Uint8List.fromList(List.generate(8192, (i) => i % 256));
        final result = await EncoderDownloadController().download(
          data: payload,
          fileName: 'generated.$extension',
          mimeType: extension == 'gif' ? 'image/gif' : 'application/zip',
          totalFrames: 10,
          minFrames: 8,
          timestamp: 1,
          recordHistory: false,
        );
        expect(picker.suggestedName, 'generated.$extension');
        expect(picker.extensions, [extension]);
        expect(result!.savedPath, destination);
        expect(await File(destination).readAsBytes(), orderedEquals(payload));
      },
      skip: !Platform.isWindows,
    );
  }

  test(
    'cancel encoder Save As does not record history or report a saved file',
    () async {
      var recorded = false;
      final result =
          await EncoderDownloadController(
            recordGeneratedDownload:
                ({
                  required path,
                  required mimeType,
                  required totalFrames,
                  required minFrames,
                  chunkMinFrames,
                  required timestamp,
                }) async {
                  recorded = true;
                },
          ).download(
            data: Uint8List.fromList([71, 73, 70]),
            fileName: 'cancel.gif',
            mimeType: 'image/gif',
            totalFrames: 1,
            minFrames: 1,
            timestamp: 1,
          );
      expect(picker.suggestedName, 'cancel.gif');
      expect(result, isNull);
      expect(recorded, isFalse);
      expect(await temp.list().toList(), isEmpty);
    },
    skip: !Platform.isWindows,
  );
}
