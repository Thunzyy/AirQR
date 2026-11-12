import 'dart:async';
import 'dart:io';

import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/scanner_local_decode_controller.dart';
import 'package:airqr_mobile/src/rust/api/simple.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

ScannerLocalDecodeState scanState(String id) => ScannerLocalDecodeState(
  currentScanId: id,
  completionHandled: false,
  displayReceivedPackets: 0,
  displayExpectedPackets: 0,
  progress: 0,
  scanDurationSeconds: 0,
  syncSourceName: 'Local',
);

DecodeStatus progressResult(int count) => DecodeStatus(
  status: 'Progress',
  percent: count.toDouble(),
  receivedPackets: count,
  expectedPackets: 100,
  totalPackets: 100,
  durationMs: BigInt.zero,
  filename: 'fixture.bin',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('plugins.flutter.io/path_provider');
  late Directory directory;

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('airqr-persistence-');
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async => directory.path);
  });

  tearDown(() async {
    IncompleteScanService.setPacketFileWriterForTesting(null);
    IncompleteScanService.onMetadataSavedForTesting = null;
    IncompleteScanService.clearCurrentScan();
    await IncompleteScanService.flushPending();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
    await directory.delete(recursive: true);
  });

  Future<void> queuePacket(String id, int count, {Uint8List? bytes}) =>
      IncompleteScanService.recordProgressPacket(
        sessionId: id,
        packetData: bytes ?? Uint8List.fromList([count]),
        progress: count / 100,
        receivedPackets: count,
        expectedPackets: 100,
        filename: 'fixture.bin',
      );

  test('slow disk does not hold the live progress transition', () async {
    final id = await IncompleteScanService.startNewSession(
      sessionId: 'slow-disk',
    );
    final releaseDisk = Completer<void>();
    IncompleteScanService.setPacketFileWriterForTesting((handle, bytes) async {
      await releaseDisk.future;
      await handle.writeFrom(bytes);
    });
    final controller = ScannerLocalDecodeController(
      uploadPacketToServer:
          ({
            required sessionId,
            required packetData,
            filename,
            resultType,
            receivedPackets,
            expectedPackets,
          }) async => true,
    );
    var displayed = false;
    final update = controller
        .applyResult(
          result: progressResult(1),
          rawBytes: Uint8List.fromList([1, 2, 3]),
          state: scanState(id),
          localSyncSourceName: 'Local',
        )
        .then((transition) {
          displayed = transition is ScannerLocalProgressTransition;
        });
    await Future<void>.delayed(const Duration(milliseconds: 100));
    try {
      expect(
        displayed,
        isTrue,
        reason: 'The progress transition must not wait for the disk writer.',
      );
    } finally {
      releaseDisk.complete();
      await update;
      await Future<void>.delayed(const Duration(milliseconds: 600));
    }
    expect(await IncompleteScanService.getPackets(id), [
      [1, 2, 3],
    ]);
  });

  test(
    'batches metadata once for 16 packets and owns the queued bytes',
    () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'batches',
      );
      final releaseDisk = Completer<void>();
      var metadataWrites = 0;
      IncompleteScanService.onMetadataSavedForTesting = () => metadataWrites++;
      IncompleteScanService.setPacketFileWriterForTesting((
        handle,
        bytes,
      ) async {
        await releaseDisk.future;
        await handle.writeFrom(bytes);
      });
      final bytes = Uint8List.fromList([1]);
      await queuePacket(id, 1, bytes: bytes);
      bytes[0] = 99;
      for (var i = 2; i <= 40; i++) {
        await queuePacket(id, i);
      }
      expect(metadataWrites, 0);
      releaseDisk.complete();
      await IncompleteScanService.flushPending();
      expect(metadataWrites, 3);
      final packets = await IncompleteScanService.getPackets(id);
      expect(
        packets.map((bytes) => bytes.single),
        unorderedEquals(List.generate(40, (i) => i + 1)),
      );
      final restored = await IncompleteScanService.getById(id);
      expect(restored!.receivedPackets, 40);
      expect(restored.filename, 'fixture.bin');
    },
  );

  test(
    'session switching drains old writes and ignores a late old packet',
    () async {
      final oldId = await IncompleteScanService.startNewSession(
        sessionId: 'old-session',
      );
      await queuePacket(oldId, 1);
      final releaseDisk = Completer<void>();
      final writing = Completer<void>();
      IncompleteScanService.setPacketFileWriterForTesting((
        handle,
        bytes,
      ) async {
        if (!writing.isCompleted) writing.complete();
        await releaseDisk.future;
        await handle.writeFrom(bytes);
      });
      final flushing = IncompleteScanService.flushPending();
      await writing.future;
      var switched = false;
      final switching =
          IncompleteScanService.startNewSession(sessionId: 'new-session').then((
            id,
          ) {
            switched = true;
            return id;
          });
      await Future<void>.delayed(Duration.zero);
      expect(switched, isFalse);
      releaseDisk.complete();
      await flushing;
      final newId = await switching;
      await queuePacket(oldId, 2);
      await queuePacket(newId, 3);
      await IncompleteScanService.flushPending();
      expect(await IncompleteScanService.getPackets(oldId), [
        [1],
      ]);
      expect(await IncompleteScanService.getPackets(newId), [
        [3],
      ]);
    },
  );

  test(
    'reset keeps accepted packets resumable and cannot mix sessions',
    () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'reset-session',
      );
      for (var i = 1; i <= 5; i++) {
        await queuePacket(id, i);
      }
      IncompleteScanService.clearCurrentScan();
      expect(IncompleteScanService.currentScanId, isNull);
      await IncompleteScanService.flushPending();
      await IncompleteScanService.resumeSession(id);
      expect((await IncompleteScanService.getById(id))!.receivedPackets, 5);
      expect(await IncompleteScanService.getPackets(id), hasLength(5));
      await queuePacket(id, 6);
      await IncompleteScanService.flushPending();
      expect(await IncompleteScanService.getPackets(id), hasLength(6));
    },
  );

  test(
    'failed session switch keeps the old session retryable before decode',
    () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'switch-error',
      );
      await queuePacket(id, 1);
      IncompleteScanService.setPacketFileWriterForTesting((_, _) async {
        throw const FileSystemException('storage unavailable');
      });
      await expectLater(
        IncompleteScanService.startNewSession(sessionId: 'other'),
        throwsA(isA<FileSystemException>()),
      );
      expect(IncompleteScanService.currentScanId, id);
      await expectLater(
        IncompleteScanService.waitForPacketCapacity(1),
        throwsA(isA<FileSystemException>()),
      );
      IncompleteScanService.setPacketFileWriterForTesting(null);
      await IncompleteScanService.waitForPacketCapacity(1);
      await queuePacket(id, 2);
      await IncompleteScanService.flushPending();
      expect(await IncompleteScanService.getPackets(id), [
        [1],
        [2],
      ]);
      expect(IncompleteScanService.persistenceError.value, isNull);
      expect(await IncompleteScanService.getById('other'), isNull);
    },
  );

  test(
    'partial write failure retries immutable files without losing packets',
    () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'write-retry',
      );
      await queuePacket(id, 1);
      await queuePacket(id, 2);
      var fail = true;
      var writes = 0;
      IncompleteScanService.setPacketFileWriterForTesting((
        handle,
        bytes,
      ) async {
        writes++;
        await handle.writeFrom(bytes);
        if (bytes.single == 2 && fail) {
          throw const FileSystemException('disk full');
        }
      });
      await expectLater(
        IncompleteScanService.flushPending(),
        throwsA(isA<FileSystemException>()),
      );
      expect(
        IncompleteScanService.persistenceError.value,
        contains('disk full'),
      );
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getString('airqr_incomplete_scans'),
        contains('"receivedPackets":0'),
      );
      fail = false;
      await IncompleteScanService.flushPending();
      expect(writes, 3);
      expect(IncompleteScanService.persistenceError.value, isNull);
      expect(await IncompleteScanService.getPackets(id), [
        [1],
        [2],
      ]);
      expect((await IncompleteScanService.getById(id))!.receivedPackets, 2);
    },
  );

  test('delete during a write cannot recreate files or metadata', () async {
    final id = await IncompleteScanService.startNewSession(
      sessionId: 'delete-queued',
    );
    await queuePacket(id, 1);
    final releaseDisk = Completer<void>();
    final writing = Completer<void>();
    IncompleteScanService.setPacketFileWriterForTesting((handle, bytes) async {
      if (!writing.isCompleted) writing.complete();
      await releaseDisk.future;
      await handle.writeFrom(bytes);
    });
    final flushing = IncompleteScanService.flushPending();
    await writing.future;
    await queuePacket(id, 2);
    final deleting = IncompleteScanService.remove(id);
    releaseDisk.complete();
    await Future.wait([flushing, deleting]);
    await queuePacket(id, 3);
    await IncompleteScanService.flushPending();
    expect(await IncompleteScanService.getPackets(id), isEmpty);
    expect(await IncompleteScanService.getById(id), isNull);
    expect(
      await Directory('${directory.path}/incomplete_scans/$id').exists(),
      isFalse,
    );
  });

  test(
    'completion waits for queued packets then removes the incomplete scan',
    () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'completed',
      );
      await queuePacket(id, 1);
      final releaseDisk = Completer<void>();
      final writing = Completer<void>();
      IncompleteScanService.setPacketFileWriterForTesting((
        handle,
        bytes,
      ) async {
        writing.complete();
        await releaseDisk.future;
        await handle.writeFrom(bytes);
      });
      var finished = false;
      final completion = IncompleteScanService.completeCurrentScan().then(
        (_) => finished = true,
      );
      await writing.future;
      expect(finished, isFalse);
      releaseDisk.complete();
      await completion;
      expect(IncompleteScanService.currentScanId, isNull);
      expect(await IncompleteScanService.getAll(), isEmpty);
      expect(await IncompleteScanService.getPackets(id), isEmpty);
    },
  );

  test(
    'deleting then immediately reusing an ID preserves the new session',
    () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'reused-id',
      );
      await queuePacket(id, 1);
      final deleting = IncompleteScanService.remove(id);
      final restarting = IncompleteScanService.startNewSession(sessionId: id);
      await Future.wait([deleting, restarting]);
      await queuePacket(id, 1, bytes: Uint8List.fromList([99]));
      await IncompleteScanService.flushPending();
      expect(IncompleteScanService.currentScanId, id);
      expect(await IncompleteScanService.getPackets(id), [
        [99],
      ]);
      expect((await IncompleteScanService.getById(id))!.receivedPackets, 1);
    },
  );

  test(
    'incoming packets wait for replacement and cannot overtake it',
    () async {
      final id = await IncompleteScanService.startNewSession(
        sessionId: 'replace-queued',
      );
      await queuePacket(id, 1);
      await IncompleteScanService.flushPending();
      final replacing = Completer<void>();
      final release = Completer<void>();
      IncompleteScanService.setPacketSessionHookForTesting((operation) async {
        if (operation == 'replace') {
          replacing.complete();
          await release.future;
        }
      });
      try {
        final replacement = IncompleteScanService.replacePackets(id, [
          [8],
        ]);
        await replacing.future;
        var admitted = false;
        final incoming = queuePacket(id, 2).then((_) => admitted = true);
        await Future<void>.delayed(Duration.zero);
        expect(admitted, isFalse);
        release.complete();
        await Future.wait([replacement, incoming]);
        await IncompleteScanService.flushPending();
        expect(await IncompleteScanService.getPackets(id), [
          [8],
          [2],
        ]);
      } finally {
        if (!release.isCompleted) release.complete();
        IncompleteScanService.setPacketSessionHookForTesting(null);
      }
    },
  );
}
