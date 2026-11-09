import 'dart:io';

import 'package:archive/archive.dart';
import 'package:path/path.dart' as p;

/// `airqr-history-YYYYMMDD-HHmm.zip` for a bulk History download.
String historyBulkZipFileName(DateTime now) {
  String two(int value) => value.toString().padLeft(2, '0');
  final date =
      '${now.year.toString().padLeft(4, '0')}${two(now.month)}'
      '${two(now.day)}';
  return 'airqr-history-$date-${two(now.hour)}${two(now.minute)}.zip';
}

/// Makes archive entry names unique (case-insensitively, so the archive
/// extracts cleanly on Windows/macOS) by suffixing " (2)", " (3)", ...
/// before the extension.
List<String> dedupeArchiveEntryNames(Iterable<String> names) {
  final taken = <String>{};
  final result = <String>[];
  for (final name in names) {
    var candidate = name;
    if (taken.contains(candidate.toLowerCase())) {
      final extension = p.extension(name);
      final stem = name.substring(0, name.length - extension.length);
      var index = 2;
      do {
        candidate = '$stem ($index)$extension';
        index++;
      } while (taken.contains(candidate.toLowerCase()));
    }
    taken.add(candidate.toLowerCase());
    result.add(candidate);
  }
  return result;
}

/// Zips [filePaths] (flat, by basename) into [outputDirectory].
///
/// Missing files are skipped. Returns null when no file could be added.
Future<File?> buildHistoryBulkZip({
  required List<String> filePaths,
  required Directory outputDirectory,
  required DateTime now,
}) async {
  final existing = <File>[];
  for (final path in filePaths) {
    final file = File(path);
    if (await file.exists()) existing.add(file);
  }
  if (existing.isEmpty) return null;

  final names = dedupeArchiveEntryNames(
    existing.map((file) => p.basename(file.path)),
  );
  final archive = Archive();
  for (var index = 0; index < existing.length; index++) {
    final bytes = await existing[index].readAsBytes();
    // Stored, not deflated: history files (GIFs, ZIPs, media) are already
    // compressed, and deflating them on the UI thread only adds jank.
    archive.addFile(
      ArchiveFile(names[index], bytes.length, bytes)..compress = false,
    );
  }

  final encoded = ZipEncoder().encode(archive);
  if (encoded == null) return null;
  final zip = File(p.join(outputDirectory.path, historyBulkZipFileName(now)));
  await zip.writeAsBytes(encoded, flush: true);
  return zip;
}
