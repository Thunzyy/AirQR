import 'dart:io';

import 'package:airqr_mobile/history_bulk_export.dart';
import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

void main() {
  group('historyBulkZipFileName', () {
    test('uses airqr-history-YYYYMMDD-HHmm.zip with zero padding', () {
      expect(
        historyBulkZipFileName(DateTime(2026, 3, 7, 9, 5)),
        'airqr-history-20260307-0905.zip',
      );
      expect(
        historyBulkZipFileName(DateTime(2026, 11, 29, 23, 59)),
        'airqr-history-20261129-2359.zip',
      );
    });
  });

  group('dedupeArchiveEntryNames', () {
    test('keeps unique names untouched', () {
      expect(dedupeArchiveEntryNames(<String>['a.txt', 'b.gif', 'c']), <String>[
        'a.txt',
        'b.gif',
        'c',
      ]);
    });

    test('suffixes duplicates with (2), (3) before the extension', () {
      expect(
        dedupeArchiveEntryNames(<String>['a.txt', 'a.txt', 'b', 'a.txt', 'b']),
        <String>['a.txt', 'a (2).txt', 'b', 'a (3).txt', 'b (2)'],
      );
    });

    test('treats names case-insensitively and skips taken suffixes', () {
      expect(
        dedupeArchiveEntryNames(<String>['a.txt', 'a (2).txt', 'A.TXT']),
        <String>['a.txt', 'a (2).txt', 'A (3).TXT'],
      );
    });
  });

  group('buildHistoryBulkZip', () {
    late Directory tempDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('airqr-bulk-zip-test');
    });

    tearDown(() async {
      if (await tempDir.exists()) await tempDir.delete(recursive: true);
    });

    test('writes one zip with every file and deduped entry names', () async {
      final first = Directory(p.join(tempDir.path, 'one'))..createSync();
      final second = Directory(p.join(tempDir.path, 'two'))..createSync();
      final a = File(p.join(first.path, 'note.txt'))..writeAsStringSync('one');
      final b = File(p.join(second.path, 'note.txt'))..writeAsStringSync('two');
      final c = File(p.join(first.path, 'anim.gif'))
        ..writeAsBytesSync(<int>[1, 2, 3]);
      final out = Directory(p.join(tempDir.path, 'out'))..createSync();

      final zip = await buildHistoryBulkZip(
        filePaths: <String>[a.path, b.path, c.path],
        outputDirectory: out,
        now: DateTime(2026, 1, 2, 3, 4),
      );

      expect(zip, isNotNull);
      expect(p.basename(zip!.path), 'airqr-history-20260102-0304.zip');
      expect(p.dirname(zip.path), out.path);
      final archive = ZipDecoder().decodeBytes(await zip.readAsBytes());
      final entries = <String, List<int>>{
        for (final file in archive.files)
          file.name: List<int>.from(file.content as List<int>),
      };
      expect(entries.keys, <String>['note.txt', 'note (2).txt', 'anim.gif']);
      expect(String.fromCharCodes(entries['note.txt']!), 'one');
      expect(String.fromCharCodes(entries['note (2).txt']!), 'two');
      expect(entries['anim.gif'], <int>[1, 2, 3]);
    });

    test('stores entries without deflating them', () async {
      final source = File(p.join(tempDir.path, 'clip.gif'))
        ..writeAsBytesSync(List<int>.filled(4096, 7));
      final out = Directory(p.join(tempDir.path, 'stored'))..createSync();

      final zip = await buildHistoryBulkZip(
        filePaths: <String>[source.path],
        outputDirectory: out,
        now: DateTime(2026, 1, 2, 3, 4),
      );

      final archive = ZipDecoder().decodeBytes(await zip!.readAsBytes());
      expect(archive.files.single.compressionType, ArchiveFile.STORE);
    });

    test('skips missing files and returns null when nothing remains', () async {
      final existing = File(p.join(tempDir.path, 'kept.bin'))
        ..writeAsBytesSync(<int>[9]);
      final zip = await buildHistoryBulkZip(
        filePaths: <String>[p.join(tempDir.path, 'gone.bin'), existing.path],
        outputDirectory: tempDir,
        now: DateTime(2026, 1, 1),
      );
      final archive = ZipDecoder().decodeBytes(await zip!.readAsBytes());
      expect(archive.files.map((file) => file.name), <String>['kept.bin']);

      final empty = await buildHistoryBulkZip(
        filePaths: <String>[p.join(tempDir.path, 'gone.bin')],
        outputDirectory: tempDir,
        now: DateTime(2026, 1, 1),
      );
      expect(empty, isNull);
    });
  });
}
