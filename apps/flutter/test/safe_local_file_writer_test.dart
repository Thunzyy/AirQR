import 'dart:io';
import 'dart:isolate';

import 'package:airqr_mobile/safe_local_file_writer.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;

void main() {
  group('SafeLocalFileWriter', () {
    late Directory targetDirectory;

    setUp(() async {
      targetDirectory = await Directory.systemTemp.createTemp(
        'airqr-safe-download',
      );
    });

    tearDown(() async {
      SafeLocalFileWriter.setBeforeCommitForTesting(null);
      SafeLocalFileWriter.setAfterReserveForTesting(null);
      if (await targetDirectory.exists()) {
        await targetDirectory.delete(recursive: true);
      }
    });

    final cases = <String, String>{
      '../payload.zip': 'payload.zip',
      r'..\payload.zip': 'payload.zip',
      r'../nested\payload.zip': 'payload.zip',
      '/etc/passwd': 'passwd',
      r'C:\Windows\payload.exe': 'payload.exe',
      r'C:payload.txt': 'payload.txt',
      r'\\server\share\payload.bin': 'payload.bin',
      '': 'download.bin',
      '.': 'download.bin',
      '..': 'download.bin',
      '../': 'download.bin',
      'CON': '_CON',
      'nul.txt': '_nul.txt',
      'bad<name>.tar.gz': 'bad_name_.tar.gz',
      'trailing. ': 'trailing',
      'résumé_日本語.pdf': 'résumé_日本語.pdf',
    };

    for (final entry in cases.entries) {
      test('normalizes and writes ${entry.key} as ${entry.value}', () async {
        final resolved = await SafeLocalFileWriter.writeBytes(
          targetDirectory,
          entry.key,
          const <int>[7],
        );

        final canonicalRoot = await targetDirectory.resolveSymbolicLinks();
        expect(p.basename(resolved), entry.value);
        expect(p.isWithin(canonicalRoot, resolved), isTrue);
        expect(
          await File(resolved).readAsBytes(),
          orderedEquals(const <int>[7]),
        );
      });
    }

    test('adds a numeric suffix without losing a useful extension', () async {
      await File(
        p.join(targetDirectory.path, 'archive.tar.gz'),
      ).writeAsBytes(const <int>[1]);

      final resolved = await SafeLocalFileWriter.writeBytes(
        targetDirectory,
        '../archive.tar.gz',
        const <int>[2],
      );

      expect(p.basename(resolved), 'archive.tar (1).gz');
      expect(await File(resolved).readAsBytes(), orderedEquals(const <int>[2]));
    });

    test('treats an existing directory as a filename collision', () async {
      await Directory(p.join(targetDirectory.path, 'archive.zip')).create();

      final resolved = await SafeLocalFileWriter.writeBytes(
        targetDirectory,
        'archive.zip',
        const <int>[3],
      );

      expect(p.basename(resolved), 'archive (1).zip');
    });

    test('separate isolates atomically commit unique complete files', () async {
      final root = targetDirectory.path;
      final paths = await Future.wait(
        List<Future<String>>.generate(8, (index) {
          return Isolate.run(() {
            return SafeLocalFileWriter.writeBytes(
              Directory(root),
              'shared.bin',
              <int>[index],
            );
          });
        }),
      );

      expect(paths.map(p.basename).toSet(), hasLength(8));
      for (var index = 0; index < paths.length; index++) {
        expect(await File(paths[index]).readAsBytes(), <int>[index]);
      }
    });

    test(
      'treats an existing symlink or reparse point as a collision',
      () async {
        final outside = File(
          p.join(targetDirectory.parent.path, 'outside.bin'),
        );
        addTearDown(() async {
          if (await outside.exists()) await outside.delete();
        });
        await outside.writeAsBytes(const <int>[9]);
        await Link(
          p.join(targetDirectory.path, 'payload.bin'),
        ).create(outside.path);

        final resolved = await SafeLocalFileWriter.writeBytes(
          targetDirectory,
          'payload.bin',
          const <int>[1, 2, 3],
        );

        expect(p.basename(resolved), 'payload (1).bin');
        expect(await outside.readAsBytes(), orderedEquals(const <int>[9]));
      },
    );

    test(
      'treats an actual Windows junction as a collision',
      () async {
        final junctionTarget = await Directory.systemTemp.createTemp(
          'airqr-junction-target',
        );
        final junctionPath = p.join(targetDirectory.path, 'payload.bin');
        addTearDown(() async {
          if (await Link(junctionPath).exists()) {
            await Link(junctionPath).delete();
          } else if (await Directory(junctionPath).exists()) {
            await Directory(junctionPath).delete();
          }
          if (await junctionTarget.exists()) {
            await junctionTarget.delete(recursive: true);
          }
        });
        final result = await Process.run('cmd.exe', <String>[
          '/c',
          'mklink',
          '/J',
          junctionPath,
          junctionTarget.path,
        ]);
        if (result.exitCode != 0) {
          markTestSkipped(
            'Windows junction creation unavailable: ${result.stderr}',
          );
          return;
        }

        final resolved = await SafeLocalFileWriter.writeBytes(
          targetDirectory,
          'payload.bin',
          const <int>[6],
        );

        expect(p.basename(resolved), 'payload (1).bin');
        expect(await junctionTarget.list().toList(), isEmpty);
      },
      skip: !Platform.isWindows ? 'Windows-only junction/reparse test' : false,
    );

    test('replacement race cannot redirect the committed write', () async {
      final outside = File(
        p.join(targetDirectory.parent.path, 'race-outside.bin'),
      );
      addTearDown(() async {
        if (await outside.exists()) await outside.delete();
      });
      await outside.writeAsBytes(const <int>[9]);
      var replaced = false;
      SafeLocalFileWriter.setBeforeCommitForTesting((candidate) async {
        if (replaced) return;
        replaced = true;
        await Link(candidate).create(outside.path);
      });

      final resolved = await SafeLocalFileWriter.writeBytes(
        targetDirectory,
        'payload.bin',
        const <int>[1, 2, 3],
      );

      expect(p.basename(resolved), 'payload (1).bin');
      expect(
        await File(resolved).readAsBytes(),
        orderedEquals(const <int>[1, 2, 3]),
      );
      expect(await outside.readAsBytes(), orderedEquals(const <int>[9]));
    });

    test(
      'returns a path under the canonical target for a directory link',
      () async {
        final realDirectory = await Directory.systemTemp.createTemp(
          'airqr-real-download',
        );
        final linkedDirectory = Link(
          p.join(targetDirectory.parent.path, 'airqr-linked-download'),
        );
        addTearDown(() async {
          if (await linkedDirectory.exists()) await linkedDirectory.delete();
          if (await realDirectory.exists()) {
            await realDirectory.delete(recursive: true);
          }
        });
        await linkedDirectory.create(realDirectory.path);

        final resolved = await SafeLocalFileWriter.writeBytes(
          Directory(linkedDirectory.path),
          '../payload.bin',
          const <int>[4],
        );

        final canonicalRoot = await realDirectory.resolveSymbolicLinks();
        expect(p.isWithin(canonicalRoot, resolved), isTrue);
        expect(
          await File(resolved).readAsBytes(),
          orderedEquals(const <int>[4]),
        );
      },
    );

    test('deletes the reserved file when writing fails', () async {
      SafeLocalFileWriter.setAfterReserveForTesting((candidate) {
        expect(File(candidate).existsSync(), isTrue);
        throw StateError('injected write failure');
      });

      await expectLater(
        SafeLocalFileWriter.writeBytes(
          targetDirectory,
          'payload.bin',
          const <int>[1],
        ),
        throwsStateError,
      );

      expect(await targetDirectory.list().toList(), isEmpty);
    });
  });
}
