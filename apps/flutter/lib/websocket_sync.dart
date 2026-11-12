// airqr_mobile/lib/websocket_sync.dart

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/io.dart';
import 'sync_settings.dart';
import 'utils.dart';
import 'parse/wire.dart';

/// Keeps retry traffic bounded while allowing enabled server sync to recover
/// after arbitrarily long network or server outages.
Duration webSocketReconnectDelay(int attempt) {
  if (attempt >= 5) return const Duration(seconds: 30);
  final boundedAttempt = math.max(1, attempt);
  return Duration(seconds: 1 << boundedAttempt);
}

/// Device identification for cross-device sync.
class DeviceInfo {
  final String deviceId;
  final String deviceName;

  const DeviceInfo({required this.deviceId, required this.deviceName});

  WireObject toJson() => {
    'deviceId': deviceId,
    'deviceName': deviceName,
  };
}

/// Event from WebSocket server.
class SyncEvent {
  final String type;
  final WireObject payload;

  SyncEvent({required this.type, required Object? payload})
    : payload = asWireObject(payload);

  factory SyncEvent.fromJson(Object? json) {
    final object = asWireObject(json);
    return SyncEvent(
      type: asWireString(object['type']) ?? '',
      payload: object['payload'],
    );
  }
}

/// WebSocket sync service for Flutter with reconnection support.
class WebSocketSyncService {
  static WebSocketSyncService? _instance;
  static WebSocketSyncService get instance =>
      _instance ??= WebSocketSyncService._();

  WebSocketSyncService._();

  WebSocketChannel? _channel;
  StreamSubscription<Object?>? _subscription;
  Timer? _reconnectTimer;
  Timer? _pingTimer;

  SyncSettings? _settings;
  DeviceInfo? _deviceInfo;
  String? _clientId;
  bool _connected = false;
  int _reconnectAttempts = 0;

  final _eventController = StreamController<SyncEvent>.broadcast();
  Stream<SyncEvent> get events => _eventController.stream;
  final _connectionStateController = StreamController<bool>.broadcast();
  Stream<bool> get connectionStates => _connectionStateController.stream;

  bool get isConnected => _connected;
  DeviceInfo? get deviceInfo => _deviceInfo;

  void _setConnected(bool connected) {
    if (_connected == connected) return;
    _connected = connected;
    _connectionStateController.add(connected);
  }

  /// Initialize device info.
  Future<void> _initDeviceInfo() async {
    if (_deviceInfo != null) return;

    final prefs = await SharedPreferences.getInstance();
    String? deviceId = prefs.getString('airqr_device_id');
    String? deviceName = prefs.getString('airqr_device_name');

    if (deviceId == null) {
      deviceId =
          'mobile-${DateTime.now().millisecondsSinceEpoch}-${_randomString(6)}';
      await prefs.setString('airqr_device_id', deviceId);
    }

    if (deviceName == null) {
      try {
        final deviceInfoPlugin = DeviceInfoPlugin();
        if (Platform.isAndroid) {
          final info = await deviceInfoPlugin.androidInfo;
          deviceName = '${info.brand} ${info.model}';
        } else if (Platform.isIOS) {
          final info = await deviceInfoPlugin.iosInfo;
          deviceName = info.utsname.machine;
        } else {
          deviceName = 'Mobile Device';
        }
      } catch (e) {
        deviceName = 'Mobile Device';
      }
      await prefs.setString('airqr_device_name', deviceName);
    }

    _deviceInfo = DeviceInfo(deviceId: deviceId, deviceName: deviceName);
  }

  String _randomString(int length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    final random = DateTime.now().microsecondsSinceEpoch;
    return List.generate(
      length,
      (i) => chars[(random + i * 7) % chars.length],
    ).join();
  }

  /// Connect to WebSocket server.
  Future<void> connect(SyncSettings settings) async {
    if (!settings.isConfigured) {
      debugPrint('WebSocketSync: Not configured, skipping');
      return;
    }

    final sameEndpoint =
        _settings?.serverUrl == settings.serverUrl &&
        _settings?.username == settings.username &&
        _settings?.password == settings.password;

    if ((_connected || _subscription != null) && sameEndpoint) {
      // Already connected (or connecting) to this endpoint.
      return;
    }

    if (_connected || _subscription != null || _channel != null) {
      // Reconfigure cleanly when endpoint/auth changes.
      disconnect();
    }

    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _settings = settings;
    _reconnectAttempts = 0;
    await _initDeviceInfo();
    _connectWebSocket();
  }

  void _connectWebSocket() {
    if (_settings == null) return;

    final httpUri = Uri.tryParse(_settings!.serverUrl);
    if (httpUri == null) {
      debugPrint('WebSocketSync: Invalid server URL');
      return;
    }

    // WS routing modes:
    // - Explicit port => legacy direct mode (HTTP X / WS X+1).
    // - No explicit port => same public origin path routing (reverse proxy / tunnel).
    final wsScheme = httpUri.scheme == 'https' ? 'wss' : 'ws';
    final wsUri = httpUri.hasPort
        ? Uri(
            scheme: wsScheme,
            host: httpUri.host,
            port: httpUri.port == 8081 ? 8082 : (httpUri.port + 1),
            path: '/api/v1/ws/events',
          )
        : Uri(scheme: wsScheme, host: httpUri.host, path: '/api/v1/ws/events');

    debugPrint('WebSocketSync: Connecting to $wsUri');

    try {
      final allowInsecureTls =
          kDebugMode && wsScheme == 'wss' && isLocalDevHost(httpUri.host);
      final HttpClient? customClient = allowInsecureTls
          ? (HttpClient()
              ..badCertificateCallback =
                  (X509Certificate cert, String host, int port) => true)
          : null;

      _channel = IOWebSocketChannel.connect(wsUri, customClient: customClient);

      _subscription = _channel!.stream.listen(
        (message) {
          // SAFETY: web_socket_channel delivers untyped frames.
          _onMessage(message as Object?);
        },
        onError: (Object error) {
          debugPrint('WebSocketSync: Error - $error');
          _handleDisconnect();
        },
        onDone: () {
          debugPrint('WebSocketSync: Connection closed');
          _handleDisconnect();
        },
      );

      // Send hello immediately
      _sendHello();
    } catch (e) {
      debugPrint('WebSocketSync: Failed to connect - $e');
      _handleDisconnect();
    }
  }

  void _sendHello() {
    if (_channel == null || _deviceInfo == null) return;

    final hello = <String, Object?>{
      'type': 'hello',
      'protocol': 'airqr-events',
      'version': 1,
      'deviceId': _deviceInfo!.deviceId,
      'deviceName': _deviceInfo!.deviceName,
    };

    if (_settings?.username != null && _settings?.password != null) {
      hello['username'] = _settings!.username!;
      hello['password'] = _settings!.password!;
    }

    _channel!.sink.add(jsonEncode(hello));
  }

  void _onMessage(Object? message) {
    try {
      final text = message is String
          ? message
          : message is List<int>
          ? utf8.decode(message)
          : null;
      if (text == null) return;
      final data = tryWireObject(parseJsonText(text));
      if (data == null) return;
      final type = asWireString(data['type']);

      switch (type) {
        case 'welcome':
          _clientId = asWireString(data['clientId']);
          _setConnected(true);
          _reconnectAttempts = 0;
          debugPrint('WebSocketSync: Connected as $_clientId');
          _startPing();
          break;

        case 'error':
          debugPrint('WebSocketSync: Server error - ${data['message']}');
          if (data['fatal'] == true) {
            disconnect();
          }
          break;

        case 'pong':
          // Heartbeat response
          break;

        case 'history':
        case 'scan-progress':
        case 'scan-complete':
        case 'delete':
          _eventController.add(SyncEvent.fromJson(data));
          break;

        default:
          debugPrint('WebSocketSync: Unknown message type - $type');
      }
    } catch (e) {
      debugPrint('WebSocketSync: Failed to parse message - $e');
    }
  }

  void _handleDisconnect() {
    _stopPing();
    _setConnected(false);
    _clientId = null;
    _channel = null;
    _subscription?.cancel();
    _subscription = null;

    if (_settings == null || (_reconnectTimer?.isActive ?? false)) return;

    _reconnectAttempts++;
    final delay = webSocketReconnectDelay(_reconnectAttempts);
    debugPrint(
      'WebSocketSync: Reconnecting in ${delay.inSeconds}s (attempt $_reconnectAttempts)',
    );

    _reconnectTimer = Timer(delay, () {
      _reconnectTimer = null;
      if (_settings != null) _connectWebSocket();
    });
  }

  void _startPing() {
    _stopPing();
    _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_connected && _channel != null) {
        try {
          _channel!.sink.add(jsonEncode({'type': 'ping'}));
        } catch (e) {
          debugPrint('WebSocketSync: Ping failed - $e');
        }
      }
    });
  }

  void _stopPing() {
    _pingTimer?.cancel();
    _pingTimer = null;
  }

  /// Send a packet to server via WebSocket.
  void sendPacket({
    required String sessionId,
    required List<int> packetBytes,
    String? filename,
    int? receivedPackets,
    int? expectedPackets,
  }) {
    if (!_connected || _channel == null || _deviceInfo == null) {
      debugPrint('WebSocketSync: Not connected, cannot send packet');
      return;
    }

    final message = <String, Object?>{
      'type': 'packet',
      'sessionId': sessionId,
      'packetBase64': base64Encode(packetBytes),
      'deviceId': _deviceInfo!.deviceId,
      'deviceName': _deviceInfo!.deviceName,
      'capturedAt': DateTime.now().toUtc().toIso8601String(),
      if (filename != null) 'filename': filename,
      if (receivedPackets != null) 'receivedPackets': receivedPackets,
      if (expectedPackets != null) 'expectedPackets': expectedPackets,
    };

    try {
      _channel!.sink.add(jsonEncode(message));
    } catch (e) {
      debugPrint('WebSocketSync: Failed to send packet - $e');
    }
  }

  /// Disconnect and cleanup.
  void disconnect() {
    _stopPing();
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _subscription?.cancel();
    _subscription = null;
    _channel?.sink.close();
    _channel = null;
    _setConnected(false);
    _clientId = null;
    _settings = null;
  }

  /// Dispose resources.
  void dispose() {
    disconnect();
    _eventController.close();
    _connectionStateController.close();
  }
}
