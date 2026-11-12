import 'dart:async';

import 'package:airqr_mobile/scanner_operation_controller.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'reset drains the old packet before clearing and accepts a new scan',
    () async {
      final controller = ScannerOperationController();
      final decode = Completer<void>();
      final events = <String>[];
      final oldFrame = controller.process((generation) async {
        await decode.future;
        events.add('old packet saved');
        if (controller.isCurrent(generation)) events.add('stale progress');
      });
      final reset = controller.restart(() async => events.add('decoder reset'));
      await controller.process((_) async => events.add('premature frame'));
      expect(controller.isBusy, isTrue);
      decode.complete();
      await Future.wait([oldFrame, reset]);
      await controller.process((_) async => events.add('new frame'));
      expect(events, ['old packet saved', 'decoder reset', 'new frame']);
      expect(controller.isBusy, isFalse);
    },
  );

  test('double reset is coalesced and failed reset permits retry', () async {
    final controller = ScannerOperationController();
    final reset = Completer<void>();
    final first = controller.restart(() => reset.future);
    final second = controller.restart(() async => fail('duplicate reset'));
    expect(identical(first, second), isTrue);
    final failure = expectLater(first, throwsStateError);
    reset.completeError(StateError('decoder unavailable'));
    await failure;
    expect(controller.isBusy, isFalse);
    await controller.restart(() async {});
    var scanned = false;
    await controller.process((_) async => scanned = true);
    expect(scanned, isTrue);
  });
}
