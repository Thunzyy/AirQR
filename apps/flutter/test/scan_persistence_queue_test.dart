import 'dart:async';

import 'package:airqr_mobile/scan_persistence_queue.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('admits live packets while one writer drains ordered batches', () async {
    final release = Completer<void>();
    final batches = <List<int>>[];
    final queue = ScanPersistenceQueue<int>(
      sizeOf: (_) => 1200,
      writeBatch: (batch) async {
        await release.future;
        batches.add(batch);
      },
    );
    for (var i = 0; i < 20; i++) {
      await queue.add(i);
    }
    expect(queue.pendingCount, 20);
    expect(queue.pendingBytes, 24000);
    expect(batches, isEmpty);
    release.complete();
    await queue.close();
    expect(batches.map((batch) => batch.length), [16, 4]);
    expect(batches.expand((batch) => batch), List.generate(20, (i) => i));
    expect(queue.pendingBytes, 0);
  });

  test(
    'packet and byte bounds apply to in-flight writes and producers',
    () async {
      final release = Completer<void>();
      final committed = <int>[];
      final queue = ScanPersistenceQueue<int>(
        batchSize: 1,
        maxPackets: 4,
        maxBytes: 4,
        sizeOf: (_) => 2,
        writeBatch: (batch) async {
          await release.future;
          committed.addAll(batch);
        },
      );
      await queue.add(1);
      await queue.add(2);
      var thirdAdmitted = false;
      final third = queue.add(3).then((_) => thirdAdmitted = true);
      await Future<void>.delayed(Duration.zero);
      expect(thirdAdmitted, isFalse);
      expect(queue.pendingBytes, 4);
      release.complete();
      await third;
      await queue.close();
      expect(committed, [1, 2, 3]);
      await expectLater(queue.add(4), throwsStateError);
    },
  );

  test(
    'a short batch flushes on its deadline without another camera frame',
    () async {
      final committed = Completer<List<int>>();
      final queue = ScanPersistenceQueue<int>(
        interval: const Duration(milliseconds: 20),
        sizeOf: (_) => 1,
        writeBatch: (batch) async => committed.complete(batch),
      );
      await queue.add(7);
      expect(await committed.future.timeout(const Duration(seconds: 2)), [7]);
      await queue.close();
    },
  );

  test(
    'failed batches remain retryable and success clears the error',
    () async {
      var fail = true;
      final attempts = <List<int>>[];
      final errors = <Object?>[];
      final queue = ScanPersistenceQueue<int>(
        sizeOf: (_) => 2,
        onError: errors.add,
        writeBatch: (batch) async {
          attempts.add(batch);
          if (fail) throw StateError('disk full');
        },
      );
      await queue.add(1);
      await queue.add(2);
      await expectLater(queue.flush(), throwsStateError);
      expect(queue.pendingCount, 2);
      expect(queue.pendingBytes, 4);
      fail = false;
      await queue.close();
      expect(attempts, [
        [1, 2],
        [1, 2],
      ]);
      expect(errors.first, isA<StateError>());
      expect(errors.last, isNull);
      expect(queue.pendingCount, 0);
    },
  );

  test(
    'explicit deletion waits for the writer and prevents later writes',
    () async {
      final release = Completer<void>();
      final committed = <int>[];
      final queue = ScanPersistenceQueue<int>(
        batchSize: 1,
        sizeOf: (_) => 1,
        writeBatch: (batch) async {
          await release.future;
          committed.addAll(batch);
        },
      );
      await queue.add(1);
      await queue.add(2);
      var discarded = false;
      final discard = queue.discard().then((_) => discarded = true);
      await Future<void>.delayed(Duration.zero);
      expect(discarded, isFalse);
      release.complete();
      await discard;
      expect(committed, [1]);
      expect(queue.pendingBytes, 0);
      await expectLater(queue.add(3), throwsStateError);
      await queue.flush();
      expect(committed, [1]);
    },
  );

  test('concurrent producers cannot exceed the backlog cap', () async {
    final release = Completer<void>();
    final committed = <int>[];
    final queue = ScanPersistenceQueue<int>(
      batchSize: 4,
      maxPackets: 8,
      maxBytes: 16,
      sizeOf: (_) => 2,
      writeBatch: (batch) async {
        await release.future;
        committed.addAll(batch);
      },
    );
    final producers = List.generate(40, (i) => queue.add(i));
    await Future<void>.delayed(Duration.zero);
    expect(queue.pendingCount, 8);
    expect(queue.pendingBytes, 16);
    release.complete();
    await Future.wait(producers);
    await queue.close();
    expect(committed, List.generate(40, (i) => i));
  });

  test('oversized packets are rejected before allocating a backlog', () async {
    final queue = ScanPersistenceQueue<int>(
      maxBytes: 2,
      sizeOf: (value) => value,
      writeBatch: (_) async {},
    );
    await expectLater(queue.add(3), throwsArgumentError);
    expect(queue.pendingBytes, 0);
    await queue.close();
  });
}
