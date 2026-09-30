import 'package:airqr_mobile/local_file_opener.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:open_filex/open_filex.dart';

void main() {
  test('opens a local file through the safe platform plugin', () async {
    String? receivedPath;

    final opened = await openLocalFile(
      '/generated/preview.gif',
      platformOpen: (path) async {
        receivedPath = path;
        return OpenResult();
      },
    );

    expect(receivedPath, '/generated/preview.gif');
    expect(opened, isTrue);
  });

  test('reports a platform open failure', () async {
    final opened = await openLocalFile(
      '/generated/preview.gif',
      platformOpen: (_) async => OpenResult(type: ResultType.noAppToOpen),
    );

    expect(opened, isFalse);
  });
}
