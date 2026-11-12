import 'dart:async';
import 'dart:io';

import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  for (final boundary in ['background', 'leave-tab', 'dispose']) {
    testWidgets('$boundary flushes a partial batch before its timer', (
      tester,
    ) async {
      final directory = (await tester.runAsync(
        () => Directory.systemTemp.createTemp('airqr-lifecycle-'),
      ))!;
      final settings = ValueNotifier<int>(0);
      final messenger = tester.binding.defaultBinaryMessenger;
      const pathChannel = MethodChannel('plugins.flutter.io/path_provider');
      const cameraChannel = MethodChannel('flutter_lite_camera');
      const wakeChannel =
          'dev.flutter.pigeon.wakelock_plus_platform_interface.WakelockPlusApi.toggle';
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      messenger.setMockMethodCallHandler(
        pathChannel,
        (_) async => directory.path,
      );
      messenger.setMockMethodCallHandler(
        cameraChannel,
        (_) async => <String>[],
      );
      messenger.setMockMessageHandler(
        wakeChannel,
        (_) async => const StandardMessageCodec().encodeMessage([null]),
      );

      Future<void> showScanner(bool active) => tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: ScannerPage(
            settingsChangedNotifier: settings,
            isActive: active,
          ),
        ),
      );

      await showScanner(true);
      await tester.pump(const Duration(milliseconds: 100));
      final id = (await tester.runAsync(
        () => IncompleteScanService.startNewSession(
          sessionId: 'lifecycle-$boundary',
        ),
      ))!;
      final written = Completer<void>();
      IncompleteScanService.onMetadataSavedForTesting = () {
        if (!written.isCompleted) written.complete();
      };
      // This timer belongs to the widget test's fake clock. No 500 ms pump is
      // performed below: only the lifecycle hook can trigger this flush.
      await IncompleteScanService.recordProgressPacket(
        sessionId: id,
        packetData: Uint8List.fromList([4, 5, 6]),
        progress: 0.1,
        receivedPackets: 1,
        expectedPackets: 10,
      );
      expect(written.isCompleted, isFalse);
      if (boundary == 'background') {
        tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      } else if (boundary == 'leave-tab') {
        await showScanner(false);
      } else {
        await tester.pumpWidget(const SizedBox.shrink());
      }
      await tester.pump();
      // Let real filesystem futures complete while keeping the fake queue
      // timer stopped. The callback is a successful metadata commit receipt.
      for (var i = 0; i < 300 && !written.isCompleted; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)),
        );
        await tester.pump();
      }
      expect(written.isCompleted, isTrue);
      expect(
        await tester.runAsync(() => IncompleteScanService.getPackets(id)),
        [
          [4, 5, 6],
        ],
      );

      await tester.pumpWidget(const SizedBox.shrink());
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.runAsync(() async {
        IncompleteScanService.clearCurrentScan();
        await IncompleteScanService.flushPending();
        await directory.delete(recursive: true);
      });
      IncompleteScanService.onMetadataSavedForTesting = null;
      messenger.setMockMethodCallHandler(pathChannel, null);
      messenger.setMockMethodCallHandler(cameraChannel, null);
      messenger.setMockMessageHandler(wakeChannel, null);
      settings.dispose();
      expect(tester.takeException(), isNull);
    });
  }
}
