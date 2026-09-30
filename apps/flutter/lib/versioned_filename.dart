import 'dart:io';

import 'package:path/path.dart' as p;

Future<String> resolveUniqueFilenameInDirectory({
  required Directory directory,
  required String filename,
}) async {
  var candidate = filename;
  var index = 2;
  while (await File(p.join(directory.path, candidate)).exists()) {
    final extension = p.extension(filename);
    final basename = extension.isEmpty
        ? filename
        : filename.substring(0, filename.length - extension.length);
    candidate = '$basename ($index)$extension';
    index += 1;
  }
  return candidate;
}
