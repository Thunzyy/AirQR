import 'dart:async';
import 'dart:io';

import 'package:airqr_mobile/local_sync_server_controller.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeProcess implements Process {
  _FakeProcess(this.pid, {Future<int>? exitCodeFuture})
    : _exitCodeFuture = exitCodeFuture ?? Future<int>.value(0);

  @override
  final int pid;

  final Future<int> _exitCodeFuture;
  bool killed = false;

  @override
  Future<int> get exitCode => _exitCodeFuture;

  @override
  bool kill([ProcessSignal signal = ProcessSignal.sigterm]) {
    killed = true;
    return true;
  }

  @override
  IOSink get stdin => throw UnimplementedError();

  @override
  Stream<List<int>> get stdout => const Stream<List<int>>.empty();

  @override
  Stream<List<int>> get stderr => const Stream<List<int>>.empty();
}

void main() {
  group('LocalSyncServerController', () {
    late Directory tempDir;
    late Directory repoRoot;
    late Directory appDataDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('airqr-server-test-');
      repoRoot = Directory('${tempDir.path}/repo');
      appDataDir = Directory('${tempDir.path}/app-data');
      await Directory(
        '${repoRoot.path}/services/sync-server',
      ).create(recursive: true);
      await File(
        '${repoRoot.path}/services/sync-server/server.py',
      ).writeAsString('print("server")');
    });

    tearDown(() async {
      await _deleteTempDirWithRetry(tempDir);
    });

    test(
      'creates the configured user before starting the Python server',
      () async {
        final specs = <LocalSyncServerProcessSpec>[];
        final controller = LocalSyncServerController(
          repoRoot: repoRoot,
          appDataDirectory: appDataDir,
          addressResolver: () async => '192.168.1.36',
          processStarter: (spec) async {
            specs.add(spec);
            return _FakeProcess(specs.length);
          },
        );

        final result = await controller.start(
          username: 'admin',
          password: 'secret',
          port: 9090,
        );

        expect(result.success, isTrue);
        expect(result.serverUrl, 'http://192.168.1.36:9090');
        expect(controller.isRunning, isTrue);
        expect(specs, hasLength(2));
        expect(
          specs.first.args,
          containsAll(<String>[
            '--create-user',
            'admin',
            '--password',
            'secret',
          ]),
        );
        expect(
          specs.last.args,
          containsAll(<String>[
            '--port',
            '9090',
            '--ws-port',
            '9090',
            '--host',
            '0.0.0.0',
          ]),
        );
        expect(specs.last.environment['AIRQR_BOOTSTRAP_USERNAME'], 'admin');
        expect(specs.last.environment['AIRQR_BOOTSTRAP_PASSWORD'], 'secret');
      },
    );

    test('falls back to loopback when no LAN address is available', () async {
      final controller = LocalSyncServerController(
        repoRoot: repoRoot,
        appDataDirectory: appDataDir,
        addressResolver: () async => null,
        processStarter: (spec) async => _FakeProcess(1),
      );

      final result = await controller.start(
        username: 'admin',
        password: 'secret',
        port: 9090,
      );

      expect(result.success, isTrue);
      expect(result.serverUrl, 'http://127.0.0.1:9090');
    });

    test(
      'does not start a second server while one is already running',
      () async {
        var starts = 0;
        final controller = LocalSyncServerController(
          repoRoot: repoRoot,
          appDataDirectory: appDataDir,
          processStarter: (spec) async {
            starts++;
            return _FakeProcess(starts);
          },
        );

        final first = await controller.start(
          username: 'admin',
          password: 'secret',
          port: 8081,
        );
        final second = await controller.start(
          username: 'other',
          password: 'secret',
          port: 8082,
        );

        expect(first.success, isTrue);
        expect(second.success, isFalse);
        expect(second.error, contains('already running'));
        expect(starts, 2);
      },
    );

    test('stops the running server process', () async {
      _FakeProcess? serverProcess;
      final serverExit = Completer<int>();
      var starts = 0;
      final controller = LocalSyncServerController(
        repoRoot: repoRoot,
        appDataDirectory: appDataDir,
        addressResolver: () async => '192.168.1.36',
        processStarter: (spec) async {
          starts++;
          if (starts == 2) {
            serverProcess = _FakeProcess(2, exitCodeFuture: serverExit.future);
            return serverProcess!;
          }
          return _FakeProcess(1);
        },
      );

      final result = await controller.start(
        username: 'admin',
        password: 'secret',
        port: 9090,
      );
      await controller.stop();

      expect(result.success, isTrue);
      expect(serverProcess?.killed, isTrue);
      expect(controller.isRunning, isFalse);
      expect(controller.serverUrl, isNull);

      serverExit.complete(0);
    });

    test('restores and stops a remembered local server process', () async {
      final serverExit = Completer<int>();
      var starts = 0;
      final firstController = LocalSyncServerController(
        repoRoot: repoRoot,
        appDataDirectory: appDataDir,
        addressResolver: () async => '192.168.1.36',
        processStarter: (spec) async {
          starts++;
          if (starts == 2) {
            return _FakeProcess(4242, exitCodeFuture: serverExit.future);
          }
          return _FakeProcess(1);
        },
      );

      final startResult = await firstController.start(
        username: 'admin',
        password: 'secret',
        port: 9090,
      );
      expect(startResult.success, isTrue);

      int? killedPid;
      final restoredController = LocalSyncServerController(
        repoRoot: repoRoot,
        appDataDirectory: appDataDir,
        processInspector: (state) async {
          expect(state.pid, 4242);
          expect(state.serverUrl, 'http://192.168.1.36:9090');
          return true;
        },
        pidKiller: (pid) {
          killedPid = pid;
          return true;
        },
      );

      await restoredController.refreshStatus();

      expect(restoredController.isRunning, isTrue);
      expect(restoredController.serverUrl, 'http://192.168.1.36:9090');

      await restoredController.stop();

      expect(killedPid, 4242);
      expect(restoredController.isRunning, isFalse);
      expect(restoredController.serverUrl, isNull);
      expect(
        await File(
          '${appDataDir.path}/local-sync-server/server-state.json',
        ).exists(),
        isFalse,
      );

      serverExit.complete(0);
    });
  });
}

Future<void> _deleteTempDirWithRetry(Directory directory) async {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      if (await directory.exists()) {
        await directory.delete(recursive: true);
      }
      return;
    } on FileSystemException {
      if (attempt == 2) rethrow;
      await Future<void>.delayed(const Duration(milliseconds: 80));
    }
  }
}
