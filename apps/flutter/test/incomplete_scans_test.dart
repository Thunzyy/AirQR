import 'dart:async';
import 'dart:collection';
import 'dart:io';

import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

final class ThrowingBytes extends ListBase<int> {
  @override
  int get length => 1;

  @override
  set length(int value) => throw UnsupportedError('immutable');

  @override
  int operator [](int index) => throw StateError('conversion failed');

  @override
  void operator []=(int index, int value) =>
      throw UnsupportedError('immutable');
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const pathProviderChannel = MethodChannel('plugins.flutter.io/path_provider');

  group('IncompleteScan', () {
    test(
      'fromServerJson maps web or server resume payloads into a resumable scan',
      () {
        final scan = IncompleteScan.fromServerJson(const <String, dynamic>{
          'sessionId': 'scan-web-1',
          'receivedCount': 18,
          'expectedPackets': 86,
          'filename': 'cross-device-realtime.bin',
          'createdAt': '2026-04-06T10:00:00.000Z',
          'updatedAt': '2026-04-06T10:00:05.000Z',
          'deviceName': 'Chrome Web',
          'deviceId': 'chrome-web',
        });

        expect(scan.id, 'scan-web-1');
        expect(scan.receivedPackets, 18);
        expect(scan.expectedPackets, 86);
        expect(scan.progress, closeTo(18 / 86, 0.0001));
        expect(scan.filename, 'cross-device-realtime.bin');
        expect(scan.isRemote, isTrue);
        expect(scan.deviceName, 'Chrome Web');
        expect(scan.deviceId, 'chrome-web');
        expect(scan.startTimestamp, 1775469600000);
        expect(scan.lastUpdateTimestamp, 1775469605000);
      },
    );

    test(
      'resolveScanDisplayName falls back to generated scan label when server filename is missing',
      () {
        expect(
          resolveScanDisplayName(null, 'scan_1743933600000'),
          'Scan 1743933600000',
        );
      },
    );

    test(
      'fromServerJson prefers canonical decode threshold and caps incomplete progress',
      () {
        final scan = IncompleteScan.fromServerJson(const <String, dynamic>{
          'sessionId': 'scan-threshold',
          'receivedCount': 3635,
          'totalPackets': 1374,
          'scanState': <String, dynamic>{'decodeThreshold': 12753},
          'completionPercent': 100,
        });

        expect(scan.receivedPackets, 3635);
        expect(scan.expectedPackets, 12753);
        expect(scan.progress, 0.999);
        expect(scan.serverReceivedPackets, 3635);
        expect(scan.serverExpectedPackets, 12753);
      },
    );

    final invalidRemoteIds = <String, Object?>{
      'object': <String, Object?>{'nested': true},
      'boolean': true,
      'traversal': '../outside',
      'parent directory': '..',
      'absolute path': '/tmp/outside',
      'drive path': r'C:\outside',
      'UNC path': r'\\server\share',
      'padded': ' scan-1 ',
    };

    for (final entry in invalidRemoteIds.entries) {
      test('fromServerJson rejects ${entry.key} session ID', () {
        expect(
          () => IncompleteScan.fromServerJson(<String, dynamic>{
            'sessionId': entry.value,
          }),
          throwsFormatException,
        );
      });
    }

    test('fromServerJson rejects conflicting exact ID aliases', () {
      expect(
        () => IncompleteScan.fromServerJson(const <String, dynamic>{
          'id': 'scan-one',
          'sessionId': 'scan-two',
        }),
        throwsFormatException,
      );
    });

    test('session ID normalization preserves exact valid local IDs only', () {
      expect(normalizeScanSessionId('local_scan-123'), 'local_scan-123');
      expect(normalizeScanSessionId(' local_scan-123 '), isNull);
      expect(normalizeScanSessionId('../local_scan-123'), isNull);
    });

    test('json roundtrip preserves server sync counters', () {
      final scan = IncompleteScan(
        id: 'scan-sync',
        startTimestamp: 1,
        lastUpdateTimestamp: 2,
        progress: 0.5,
        receivedPackets: 200,
        expectedPackets: 400,
        serverReceivedPackets: 120,
        serverExpectedPackets: 400,
      );

      final restored = IncompleteScan.fromJson(scan.toJson());

      expect(restored.serverReceivedPackets, 120);
      expect(restored.serverExpectedPackets, 400);
    });

    test(
      'formatIncompleteProgressPercent preserves the 99.9 incomplete cap',
      () {
        expect(formatIncompleteProgressPercent(1.0), '99.9');
        expect(formatIncompleteProgressPercent(0.425), '42.5');
        expect(formatIncompleteProgressPercent(0.4), '40');
      },
    );
  });

  group('IncompleteScanService filesystem boundary', () {
    late Directory tempDir;
    late Directory outsideDir;
    late File sentinel;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('airqr-incomplete-safe');
      outsideDir = Directory('${tempDir.path}${Platform.pathSeparator}outside');
      await outsideDir.create();
      sentinel = File(
        '${outsideDir.path}${Platform.pathSeparator}sentinel.bin',
      );
      await sentinel.writeAsBytes(const <int>[7, 8, 9]);
      SharedPreferences.setMockInitialValues(<String, Object>{});
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(pathProviderChannel, (call) async {
            if (call.method == 'getApplicationDocumentsDirectory') {
              return tempDir.path;
            }
            return null;
          });
    });

    tearDown(() async {
      IncompleteScanService.clearCurrentScan();
      IncompleteScanService.setPacketFileWriterForTesting(null);
      IncompleteScanService.setPacketSessionHookForTesting(null);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(pathProviderChannel, null);
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test(
      'malicious IDs cannot read delete or recreate outside directories',
      () async {
        const malicious = '../outside';

        expect(await IncompleteScanService.getPackets(malicious), isEmpty);
        await IncompleteScanService.resumeSession(malicious);
        await IncompleteScanService.remove(malicious);
        await IncompleteScanService.replacePackets(malicious, const <List<int>>[
          <int>[1, 2, 3],
        ]);

        expect(IncompleteScanService.currentScanId, isNull);
        expect(await sentinel.exists(), isTrue);
        expect(await sentinel.readAsBytes(), <int>[7, 8, 9]);
      },
    );

    test('valid local IDs still retain packet storage behavior', () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'local_scan-123',
      );
      await IncompleteScanService.savePacket(
        0,
        Uint8List.fromList(<int>[4, 5]),
      );

      expect(id, 'local_scan-123');
      expect(await IncompleteScanService.getPackets(id), <List<int>>[
        <int>[4, 5],
      ]);
      await IncompleteScanService.replacePackets(id, const <List<int>>[
        <int>[8],
        <int>[9],
      ]);
      expect(await IncompleteScanService.getPackets(id), <List<int>>[
        <int>[8],
        <int>[9],
      ]);
    });

    test(
      'packet child symlink cannot read or overwrite an outside file',
      () async {
        final id = await IncompleteScanService.startNewSession(
          sessionId: 'linked-packet-scan',
        );
        final packetLink = Link(
          '${tempDir.path}${Platform.pathSeparator}incomplete_scans'
          '${Platform.pathSeparator}$id${Platform.pathSeparator}packet_0.bin',
        );
        try {
          await packetLink.create(sentinel.path);
        } on FileSystemException catch (error) {
          markTestSkipped('File symlink creation unavailable: $error');
          return;
        }

        await IncompleteScanService.savePacket(
          0,
          Uint8List.fromList(<int>[1, 2, 3]),
        );

        expect(await IncompleteScanService.getPackets(id), isEmpty);
        await IncompleteScanService.replacePackets(id, const <List<int>>[
          <int>[4],
        ]);
        await IncompleteScanService.remove(id);
        expect(await sentinel.readAsBytes(), <int>[7, 8, 9]);
        if (await packetLink.exists()) await packetLink.delete();
      },
    );

    test(
      'recursive packet cleanup unlinks hardlinks without altering their target',
      () async {
        final id = await IncompleteScanService.startNewSession(
          sessionId: 'hardlinked-packet-scan',
        );
        final packetPath =
            '${tempDir.path}${Platform.pathSeparator}incomplete_scans'
            '${Platform.pathSeparator}$id${Platform.pathSeparator}packet_0.bin';
        final result = Platform.isWindows
            ? await Process.run('cmd.exe', <String>[
                '/c',
                'mklink',
                '/H',
                packetPath,
                sentinel.path,
              ])
            : await Process.run('ln', <String>[sentinel.path, packetPath]);
        if (result.exitCode != 0) {
          markTestSkipped('Hardlink creation unavailable: ${result.stderr}');
          return;
        }

        await IncompleteScanService.replacePackets(id, const <List<int>>[
          <int>[4],
        ]);
        expect(await sentinel.readAsBytes(), <int>[7, 8, 9]);
        expect(await IncompleteScanService.getPackets(id), <List<int>>[
          <int>[4],
        ]);

        final secondHardlink = File(
          '${tempDir.path}${Platform.pathSeparator}incomplete_scans'
          '${Platform.pathSeparator}$id${Platform.pathSeparator}packet_1.bin',
        );
        final secondResult = Platform.isWindows
            ? await Process.run('cmd.exe', <String>[
                '/c',
                'mklink',
                '/H',
                secondHardlink.path,
                sentinel.path,
              ])
            : await Process.run('ln', <String>[
                sentinel.path,
                secondHardlink.path,
              ]);
        expect(secondResult.exitCode, 0, reason: '${secondResult.stderr}');
        await IncompleteScanService.remove(id);

        expect(await sentinel.readAsBytes(), <int>[7, 8, 9]);
        expect(await secondHardlink.exists(), isFalse);
      },
    );

    test('packet indices and names remain canonical', () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'canonical-packet-scan',
      );
      await IncompleteScanService.savePacket(-1, Uint8List.fromList(<int>[9]));
      final sessionDir = Directory(
        '${tempDir.path}${Platform.pathSeparator}incomplete_scans'
        '${Platform.pathSeparator}$id',
      );
      await File(
        '${sessionDir.path}${Platform.pathSeparator}unexpected.bin',
      ).writeAsBytes(const <int>[8]);
      await File(
        '${sessionDir.path}${Platform.pathSeparator}packet_01.bin',
      ).writeAsBytes(const <int>[1]);
      await File(
        '${sessionDir.path}${Platform.pathSeparator}packet_1.bin',
      ).writeAsBytes(const <int>[2]);
      for (final alias in const <String>[
        'packet_+1.bin',
        'packet_ 1.bin',
        'packet_999999999999999999999999999999999999999.bin',
      ]) {
        await File(
          '${sessionDir.path}${Platform.pathSeparator}$alias',
        ).writeAsBytes(const <int>[3]);
      }

      expect(await IncompleteScanService.getPackets(id), <List<int>>[
        <int>[2],
      ]);
      expect(
        await File(
          '${sessionDir.path}${Platform.pathSeparator}packet_-1.bin',
        ).exists(),
        isFalse,
      );
    });

    test(
      'byte conversion failure leaves no readable packet reservation',
      () async {
        final id = await IncompleteScanService.startNewSession(
          sessionId: 'throwing-packet-scan',
        );

        await expectLater(
          IncompleteScanService.replacePackets(id, <List<int>>[
            ThrowingBytes(),
          ]),
          throwsStateError,
        );

        expect(await IncompleteScanService.getPackets(id), isEmpty);
        final packet = File(
          '${tempDir.path}${Platform.pathSeparator}incomplete_scans'
          '${Platform.pathSeparator}$id${Platform.pathSeparator}packet_0.bin',
        );
        expect(await packet.exists(), isFalse);
      },
    );

    test('partial staging write failure leaves no readable packet', () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'partial-packet-scan',
      );
      IncompleteScanService.setPacketFileWriterForTesting((
        handle,
        bytes,
      ) async {
        await handle.writeByte(bytes.first);
        throw const FileSystemException('injected write failure');
      });

      await IncompleteScanService.savePacket(
        0,
        Uint8List.fromList(<int>[1, 2, 3]),
      );

      expect(await IncompleteScanService.getPackets(id), isEmpty);
      final sessionDir = Directory(
        '${tempDir.path}${Platform.pathSeparator}incomplete_scans'
        '${Platform.pathSeparator}$id',
      );
      expect(await sessionDir.list(followLinks: false).toList(), isEmpty);
    });

    test(
      'existing packet is immutable when a later write is attempted',
      () async {
        final id = await IncompleteScanService.startNewSession(
          sessionId: 'immutable-packet-scan',
        );
        await IncompleteScanService.savePacket(
          0,
          Uint8List.fromList(<int>[4, 5]),
        );
        var writerCalled = false;
        IncompleteScanService.setPacketFileWriterForTesting((
          handle,
          bytes,
        ) async {
          writerCalled = true;
          throw const FileSystemException('must not overwrite');
        });

        await IncompleteScanService.savePacket(0, Uint8List.fromList(<int>[9]));

        expect(writerCalled, isFalse);
        expect(await IncompleteScanService.getPackets(id), <List<int>>[
          <int>[4, 5],
        ]);
      },
    );

    test('concurrent saves serialize the immutable packet commit', () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'concurrent-packet-scan',
      );
      final firstWriterStarted = Completer<void>();
      final releaseWriters = Completer<void>();
      var writerCalls = 0;
      IncompleteScanService.setPacketFileWriterForTesting((
        handle,
        bytes,
      ) async {
        writerCalls++;
        if (!firstWriterStarted.isCompleted) firstWriterStarted.complete();
        await releaseWriters.future;
        await handle.writeFrom(bytes);
      });

      final first = IncompleteScanService.savePacket(
        0,
        Uint8List.fromList(<int>[1]),
      );
      await firstWriterStarted.future;
      final second = IncompleteScanService.savePacket(
        0,
        Uint8List.fromList(<int>[2]),
      );
      await Future<void>.delayed(const Duration(milliseconds: 50));
      final callsBeforeRelease = writerCalls;
      releaseWriters.complete();
      await Future.wait<void>(<Future<void>>[first, second]);

      expect(callsBeforeRelease, 1);
      expect(writerCalls, 1);
      expect(await IncompleteScanService.getPackets(id), <List<int>>[
        <int>[1],
      ]);
    });

    test('replace waits for an in-flight save transaction', () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'replace-race-scan',
      );
      final writerStarted = Completer<void>();
      final releaseWriter = Completer<void>();
      var writerCalls = 0;
      IncompleteScanService.setPacketFileWriterForTesting((
        handle,
        bytes,
      ) async {
        writerCalls++;
        if (writerCalls == 1) {
          writerStarted.complete();
          await releaseWriter.future;
        }
        await handle.writeFrom(bytes);
      });

      final save = IncompleteScanService.savePacket(
        0,
        Uint8List.fromList(<int>[1]),
      );
      await writerStarted.future;
      var replaceCompleted = false;
      final replace = IncompleteScanService.replacePackets(
        id,
        const <List<int>>[
          <int>[8],
        ],
      ).then((_) => replaceCompleted = true);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      final completedBeforeRelease = replaceCompleted;
      releaseWriter.complete();
      await Future.wait<void>(<Future<void>>[save, replace]);
      expect(completedBeforeRelease, isFalse);
      expect(await IncompleteScanService.getPackets(id), <List<int>>[
        <int>[8],
      ]);
    });

    test('remove waits for an in-flight save transaction', () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'remove-race-scan',
      );
      final writerStarted = Completer<void>();
      final releaseWriter = Completer<void>();
      IncompleteScanService.setPacketFileWriterForTesting((
        handle,
        bytes,
      ) async {
        if (!writerStarted.isCompleted) {
          writerStarted.complete();
          await releaseWriter.future;
        }
        await handle.writeFrom(bytes);
      });

      final save = IncompleteScanService.savePacket(
        0,
        Uint8List.fromList(<int>[1]),
      );
      await writerStarted.future;
      var removeCompleted = false;
      final remove = IncompleteScanService.remove(
        id,
      ).then((_) => removeCompleted = true);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      final completedBeforeRelease = removeCompleted;
      releaseWriter.complete();
      await Future.wait<void>(<Future<void>>[save, remove]);
      expect(completedBeforeRelease, isFalse);
      expect(await IncompleteScanService.getPackets(id), isEmpty);
    });

    test(
      'save cannot resurrect a session while remove owns the transaction',
      () async {
        final id = await IncompleteScanService.startNewSession(
          sessionId: 'remove-first-race-scan',
        );
        final removeLocked = Completer<void>();
        final releaseRemove = Completer<void>();
        IncompleteScanService.setPacketSessionHookForTesting((operation) async {
          if (operation == 'remove') {
            removeLocked.complete();
            await releaseRemove.future;
          }
        });

        final remove = IncompleteScanService.remove(id);
        await removeLocked.future;
        final save = IncompleteScanService.savePacket(
          0,
          Uint8List.fromList(<int>[7]),
        );
        releaseRemove.complete();
        await Future.wait<void>(<Future<void>>[remove, save]);

        expect(await IncompleteScanService.getPackets(id), isEmpty);
        final sessionDir = Directory(
          '${tempDir.path}${Platform.pathSeparator}incomplete_scans'
          '${Platform.pathSeparator}$id',
        );
        expect(await sessionDir.exists(), isFalse);
      },
    );

    test(
      'Windows case aliases cannot share or mutate an exact session directory',
      () async {
        const exactId = 'CaseSensitiveScan';
        const aliasId = 'casesensitivescan';
        await IncompleteScanService.startNewSession(sessionId: exactId);
        await IncompleteScanService.savePacket(0, Uint8List.fromList(<int>[1]));

        await Future.wait<void>(<Future<void>>[
          IncompleteScanService.remove(aliasId),
          IncompleteScanService.replacePackets(aliasId, const <List<int>>[
            <int>[9],
          ]),
          IncompleteScanService.savePacket(1, Uint8List.fromList(<int>[2])),
        ]);

        expect(IncompleteScanService.currentScanId, exactId);
        expect(await IncompleteScanService.getPackets(aliasId), isEmpty);
        expect(await IncompleteScanService.getPackets(exactId), <List<int>>[
          <int>[1],
          <int>[2],
        ]);
      },
      skip: !Platform.isWindows
          ? 'Windows case-insensitive path regression'
          : false,
    );

    test(
      'queued Windows case alias revalidates after exact directory creation',
      () async {
        const exactId = 'QueuedCaseScan';
        const aliasId = 'queuedcasescan';
        final exactLocked = Completer<void>();
        final aliasPrechecked = Completer<void>();
        final releaseExact = Completer<void>();
        var replaceHooks = 0;
        var prelockHooks = 0;
        IncompleteScanService.setPacketSessionHookForTesting((operation) async {
          if (operation == 'replace-prelock' && prelockHooks++ == 1) {
            aliasPrechecked.complete();
          }
          if (operation == 'replace' && replaceHooks++ == 0) {
            exactLocked.complete();
            await releaseExact.future;
          }
        });

        final exactReplace = IncompleteScanService.replacePackets(
          exactId,
          const <List<int>>[
            <int>[1],
          ],
        );
        await exactLocked.future;
        final aliasReplace = IncompleteScanService.replacePackets(
          aliasId,
          const <List<int>>[
            <int>[9],
          ],
        );
        await aliasPrechecked.future;
        releaseExact.complete();
        await Future.wait<void>(<Future<void>>[exactReplace, aliasReplace]);

        expect(await IncompleteScanService.getPackets(aliasId), isEmpty);
        expect(await IncompleteScanService.getPackets(exactId), <List<int>>[
          <int>[1],
        ]);
      },
      skip: !Platform.isWindows
          ? 'Windows case-insensitive queue regression'
          : false,
    );

    test(
      'canonical containment rejects a packet-directory junction',
      () async {
        final root = Directory(
          '${tempDir.path}${Platform.pathSeparator}incomplete_scans',
        );
        await root.create();
        final junction = Directory(
          '${root.path}${Platform.pathSeparator}linked-scan',
        );
        final result = await Process.run('cmd.exe', <String>[
          '/c',
          'mklink',
          '/J',
          junction.path,
          outsideDir.path,
        ]);
        if (result.exitCode != 0) {
          markTestSkipped(
            'Windows junction creation unavailable: ${result.stderr}',
          );
          return;
        }

        expect(await IncompleteScanService.getPackets('linked-scan'), isEmpty);
        await IncompleteScanService.replacePackets(
          'linked-scan',
          const <List<int>>[
            <int>[1, 2, 3],
          ],
        );
        await IncompleteScanService.remove('linked-scan');

        expect(await sentinel.exists(), isTrue);
        expect(await sentinel.readAsBytes(), <int>[7, 8, 9]);
        if (await junction.exists()) await junction.delete();
      },
      skip: !Platform.isWindows ? 'Windows-only junction test' : false,
    );

    test(
      'canonical containment rejects an incomplete root junction inside app data',
      () async {
        final redirectedRoot = Directory(
          '${tempDir.path}${Platform.pathSeparator}generated',
        );
        await redirectedRoot.create();
        final rootJunction = Directory(
          '${tempDir.path}${Platform.pathSeparator}incomplete_scans',
        );
        final result = await Process.run('cmd.exe', <String>[
          '/c',
          'mklink',
          '/J',
          rootJunction.path,
          redirectedRoot.path,
        ]);
        if (result.exitCode != 0) {
          markTestSkipped(
            'Windows junction creation unavailable: ${result.stderr}',
          );
          return;
        }

        await IncompleteScanService.replacePackets(
          'scan-safe',
          const <List<int>>[
            <int>[1, 2, 3],
          ],
        );

        final redirectedScan = Directory(
          '${redirectedRoot.path}${Platform.pathSeparator}scan-safe',
        );
        expect(await redirectedScan.exists(), isFalse);
        if (await rootJunction.exists()) await rootJunction.delete();
      },
      skip: !Platform.isWindows ? 'Windows-only junction test' : false,
    );

    test(
      'canonical containment rejects a scan junction to a sibling scan',
      () async {
        final root = Directory(
          '${tempDir.path}${Platform.pathSeparator}incomplete_scans',
        );
        final victim = Directory(
          '${root.path}${Platform.pathSeparator}victim-scan',
        );
        await victim.create(recursive: true);
        final victimPacket = File(
          '${victim.path}${Platform.pathSeparator}packet_0.bin',
        );
        await victimPacket.writeAsBytes(const <int>[6, 6, 6]);
        final alias = Directory(
          '${root.path}${Platform.pathSeparator}alias-scan',
        );
        final result = await Process.run('cmd.exe', <String>[
          '/c',
          'mklink',
          '/J',
          alias.path,
          victim.path,
        ]);
        if (result.exitCode != 0) {
          markTestSkipped(
            'Windows junction creation unavailable: ${result.stderr}',
          );
          return;
        }

        expect(await IncompleteScanService.getPackets('alias-scan'), isEmpty);
        await IncompleteScanService.replacePackets(
          'alias-scan',
          const <List<int>>[
            <int>[1],
          ],
        );
        await IncompleteScanService.remove('alias-scan');

        expect(await victimPacket.exists(), isTrue);
        expect(await victimPacket.readAsBytes(), <int>[6, 6, 6]);
        if (await alias.exists()) await alias.delete();
      },
      skip: !Platform.isWindows ? 'Windows-only junction test' : false,
    );
  });
}
