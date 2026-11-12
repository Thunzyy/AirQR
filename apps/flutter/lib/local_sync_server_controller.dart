import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'parse/wire.dart';

class LocalSyncServerProcessSpec {
  final String executable;
  final List<String> args;
  final String workingDirectory;
  final Map<String, String> environment;
  final ProcessStartMode mode;

  const LocalSyncServerProcessSpec({
    required this.executable,
    required this.args,
    required this.workingDirectory,
    required this.environment,
    this.mode = ProcessStartMode.normal,
  });
}

class LocalSyncServerLaunchResult {
  final bool success;
  final String? serverUrl;
  final String? error;

  const LocalSyncServerLaunchResult._({
    required this.success,
    this.serverUrl,
    this.error,
  });

  factory LocalSyncServerLaunchResult.ok(String serverUrl) {
    return LocalSyncServerLaunchResult._(success: true, serverUrl: serverUrl);
  }

  factory LocalSyncServerLaunchResult.failed(String error) {
    return LocalSyncServerLaunchResult._(success: false, error: error);
  }
}

typedef LocalSyncServerProcessStarter =
    Future<Process> Function(LocalSyncServerProcessSpec spec);

typedef LocalSyncServerAddressResolver = Future<String?> Function();

typedef LocalSyncServerProcessInspector =
    Future<bool> Function(LocalSyncServerProcessState state);

typedef LocalSyncServerPidKiller = bool Function(int pid);

class LocalSyncServerProcessState {
  final int pid;
  final String serverUrl;
  final int port;
  final String serverScriptPath;

  const LocalSyncServerProcessState({
    required this.pid,
    required this.serverUrl,
    required this.port,
    required this.serverScriptPath,
  });

  Map<String, Object> toJson() {
    return <String, Object>{
      'pid': pid,
      'serverUrl': serverUrl,
      'port': port,
      'serverScriptPath': serverScriptPath,
    };
  }

  static LocalSyncServerProcessState? fromJson(Object? value) {
    final object = tryWireObject(value);
    if (object == null) return null;
    final pid = asWireInt(object['pid']);
    final serverUrl = asWireString(object['serverUrl']);
    final port = asWireInt(object['port']);
    final serverScriptPath = asWireString(object['serverScriptPath']);
    if (pid == null ||
        serverUrl == null ||
        port == null ||
        serverScriptPath == null) {
      return null;
    }
    return LocalSyncServerProcessState(
      pid: pid,
      serverUrl: serverUrl,
      port: port,
      serverScriptPath: serverScriptPath,
    );
  }
}

class LocalSyncServerController {
  final Directory? repoRoot;
  final Directory? appDataDirectory;
  final String pythonExecutable;
  final LocalSyncServerProcessStarter _processStarter;
  final LocalSyncServerAddressResolver _addressResolver;
  final LocalSyncServerProcessInspector _processInspector;
  final LocalSyncServerPidKiller _pidKiller;

  Process? _serverProcess;
  int? _serverPid;
  String? _serverUrl;

  LocalSyncServerController({
    this.repoRoot,
    this.appDataDirectory,
    String? pythonExecutable,
    LocalSyncServerProcessStarter? processStarter,
    LocalSyncServerAddressResolver? addressResolver,
    LocalSyncServerProcessInspector? processInspector,
    LocalSyncServerPidKiller? pidKiller,
  }) : pythonExecutable =
           pythonExecutable ?? (Platform.isWindows ? 'python' : 'python3'),
       _processStarter = processStarter ?? _startProcess,
       _addressResolver = addressResolver ?? _resolveLanAddress,
       _processInspector = processInspector ?? _isKnownServerProcessRunning,
       _pidKiller = pidKiller ?? ((pid) => Process.killPid(pid));

  bool get canStartOnThisPlatform {
    if (kIsWeb) return false;
    return Platform.isWindows || Platform.isLinux || Platform.isMacOS;
  }

  bool get isRunning => _serverProcess != null || _serverPid != null;

  String? get serverUrl => _serverUrl;

  Future<void> refreshStatus() async {
    if (_serverProcess != null) return;
    final state = await _readState();
    if (state == null) {
      _serverPid = null;
      _serverUrl = null;
      return;
    }

    final running = await _processInspector(state);
    if (!running) {
      _serverPid = null;
      _serverUrl = null;
      await _deleteState();
      return;
    }

    _serverPid = state.pid;
    _serverUrl = state.serverUrl;
  }

  Future<LocalSyncServerLaunchResult> start({
    required String username,
    required String password,
    int port = 8081,
  }) async {
    if (!canStartOnThisPlatform) {
      return LocalSyncServerLaunchResult.failed(
        'Local server launch is only available on desktop.',
      );
    }
    if (_serverProcess != null) {
      return LocalSyncServerLaunchResult.failed(
        'Local server is already running.',
      );
    }

    final trimmedUsername = username.trim();
    if (trimmedUsername.isEmpty || password.isEmpty) {
      return LocalSyncServerLaunchResult.failed(
        'Username and password are required.',
      );
    }

    if (port < 1 || port > 65535) {
      return LocalSyncServerLaunchResult.failed('Invalid port: $port');
    }

    try {
      final root = repoRoot ?? await _findRepoRoot();
      final serverDir = Directory(p.join(root.path, 'services', 'sync-server'));
      final serverFile = File(p.join(serverDir.path, 'server.py'));
      if (!await serverFile.exists()) {
        return LocalSyncServerLaunchResult.failed(
          'Sync server not found at ${serverFile.path}',
        );
      }

      final dataDir =
          appDataDirectory ?? await getApplicationSupportDirectory();
      final localServerDir = Directory(
        p.join(dataDir.path, 'local-sync-server'),
      );
      final storageDir = Directory(p.join(localServerDir.path, 'storage'));
      await storageDir.create(recursive: true);
      final usersFile = File(p.join(localServerDir.path, 'users.json'));

      final baseEnvironment = <String, String>{
        'AIRQR_BOOTSTRAP_USERNAME': trimmedUsername,
        'AIRQR_BOOTSTRAP_PASSWORD': password,
      };

      final createUser = await _processStarter(
        LocalSyncServerProcessSpec(
          executable: pythonExecutable,
          workingDirectory: serverDir.path,
          environment: baseEnvironment,
          args: <String>[
            serverFile.path,
            '--create-user',
            trimmedUsername,
            '--password',
            password,
            '--users-file',
            usersFile.path,
            '--storage-dir',
            storageDir.path,
          ],
        ),
      );
      await _drainProcessOutput(createUser, prefix: 'airqr-server-user');
      final createUserExit = await createUser.exitCode;
      if (createUserExit != 0) {
        return LocalSyncServerLaunchResult.failed(
          'Could not create local server user (exit $createUserExit).',
        );
      }

      final process = await _processStarter(
        LocalSyncServerProcessSpec(
          executable: pythonExecutable,
          workingDirectory: serverDir.path,
          environment: baseEnvironment,
          args: <String>[
            serverFile.path,
            '--port',
            '$port',
            '--ws-port',
            '$port',
            '--host',
            '0.0.0.0',
            '--users-file',
            usersFile.path,
            '--storage-dir',
            storageDir.path,
          ],
        ),
      );
      _serverProcess = process;
      _serverPid = process.pid;
      final reachableHost = await _addressResolver() ?? '127.0.0.1';
      _serverUrl = 'http://$reachableHost:$port';
      await _writeState(
        LocalSyncServerProcessState(
          pid: process.pid,
          serverUrl: _serverUrl!,
          port: port,
          serverScriptPath: serverFile.path,
        ),
      );
      await _drainProcessOutput(process, prefix: 'airqr-server');
      unawaited(
        process.exitCode.then((_) async {
          if (identical(_serverProcess, process)) {
            _serverProcess = null;
            _serverPid = null;
            _serverUrl = null;
            await _deleteState();
          }
        }),
      );
      return LocalSyncServerLaunchResult.ok(_serverUrl!);
    } catch (error) {
      return LocalSyncServerLaunchResult.failed(error.toString());
    }
  }

  Future<void> stop() async {
    final process = _serverProcess;
    final pid = process?.pid ?? _serverPid;
    if (process != null) {
      process.kill();
      try {
        await process.exitCode.timeout(const Duration(seconds: 3));
      } on TimeoutException {
        // The app should still clear its owned local-server state even if the
        // OS takes longer to reap the terminated Python process.
      }
    } else if (pid != null) {
      _pidKiller(pid);
    }
    _serverProcess = null;
    _serverPid = null;
    _serverUrl = null;
    await _deleteState();
  }

  static Future<Process> _startProcess(LocalSyncServerProcessSpec spec) {
    return Process.start(
      spec.executable,
      spec.args,
      workingDirectory: spec.workingDirectory,
      environment: spec.environment,
      mode: spec.mode,
    );
  }

  static Future<void> _drainProcessOutput(
    Process process, {
    required String prefix,
  }) async {
    process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) => debugPrint('$prefix: $line'));
    process.stderr
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .listen((line) => debugPrint('$prefix: $line'));
  }

  Future<Directory> _getLocalServerDirectory() async {
    final dataDir = appDataDirectory ?? await getApplicationSupportDirectory();
    final localServerDir = Directory(p.join(dataDir.path, 'local-sync-server'));
    await localServerDir.create(recursive: true);
    return localServerDir;
  }

  Future<File> _getStateFile() async {
    final localServerDir = await _getLocalServerDirectory();
    return File(p.join(localServerDir.path, 'server-state.json'));
  }

  Future<void> _writeState(LocalSyncServerProcessState state) async {
    final stateFile = await _getStateFile();
    await stateFile.writeAsString(jsonEncode(state.toJson()));
  }

  Future<LocalSyncServerProcessState?> _readState() async {
    final stateFile = await _getStateFile();
    if (!await stateFile.exists()) return null;
    try {
      return LocalSyncServerProcessState.fromJson(
        parseJsonText(await stateFile.readAsString()),
      );
    } catch (_) {
      await _deleteState();
      return null;
    }
  }

  Future<void> _deleteState() async {
    final stateFile = await _getStateFile();
    try {
      if (await stateFile.exists()) {
        await stateFile.delete();
      }
    } on FileSystemException {
      // The server process can exit while tests or the OS are already cleaning
      // the local app-data directory. Deleting this marker must be idempotent.
    }
  }

  static Future<Directory> _findRepoRoot() async {
    var current = Directory.current;
    while (true) {
      final serverFile = File(
        p.join(current.path, 'services', 'sync-server', 'server.py'),
      );
      if (await serverFile.exists()) {
        return current;
      }
      final parent = current.parent;
      if (parent.path == current.path) {
        throw StateError(
          'Could not find AirQR repo root from ${Directory.current.path}',
        );
      }
      current = parent;
    }
  }

  static Future<String?> _resolveLanAddress() async {
    final interfaces = await NetworkInterface.list(
      includeLoopback: false,
      type: InternetAddressType.IPv4,
    );

    final addresses = interfaces
        .expand((networkInterface) => networkInterface.addresses)
        .where((address) => _isPrivateIpv4Address(address.address))
        .map((address) => address.address)
        .toList();

    if (addresses.isEmpty) return null;
    addresses.sort((left, right) {
      int score(String address) {
        if (address.startsWith('192.168.')) return 0;
        if (address.startsWith('10.')) return 1;
        if (address.startsWith('172.')) return 2;
        return 3;
      }

      final scoreCompare = score(left).compareTo(score(right));
      return scoreCompare != 0 ? scoreCompare : left.compareTo(right);
    });
    return addresses.first;
  }

  static bool _isPrivateIpv4Address(String address) {
    final parts = address.split('.');
    if (parts.length != 4) return false;
    final octets = parts.map(int.tryParse).toList();
    if (octets.any((octet) => octet == null || octet < 0 || octet > 255)) {
      return false;
    }

    final first = octets[0]!;
    final second = octets[1]!;
    return first == 10 ||
        (first == 192 && second == 168) ||
        (first == 172 && second >= 16 && second <= 31);
  }

  static Future<bool> _isKnownServerProcessRunning(
    LocalSyncServerProcessState state,
  ) async {
    if (state.pid <= 0) return false;
    try {
      final commandLine = await _processCommandLine(state.pid);
      if (commandLine == null || commandLine.isEmpty) return false;
      final normalizedCommand = commandLine.replaceAll('\\', '/');
      final normalizedScript = state.serverScriptPath.replaceAll('\\', '/');
      return normalizedCommand.contains(normalizedScript) ||
          normalizedCommand.contains('/services/sync-server/server.py');
    } catch (_) {
      return false;
    }
  }

  static Future<String?> _processCommandLine(int pid) async {
    if (Platform.isWindows) {
      final result = await Process.run('powershell', <String>[
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process -Filter "ProcessId=$pid" | '
            'Select-Object -ExpandProperty CommandLine',
      ]);
      if (result.exitCode != 0) return null;
      return result.stdout.toString().trim();
    }

    if (Platform.isLinux || Platform.isMacOS) {
      final result = await Process.run('ps', <String>[
        '-p',
        '$pid',
        '-o',
        'command=',
      ]);
      if (result.exitCode != 0) return null;
      return result.stdout.toString().trim();
    }

    return null;
  }
}
