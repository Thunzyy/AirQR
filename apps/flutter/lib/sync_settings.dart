import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'parse/wire.dart';

/// Settings for server synchronization.
class SyncSettings {
  final bool enabled;
  final String serverUrl;
  final String? username;
  final String? password;
  final bool syncScanned;
  final bool syncGenerated;
  final bool autoSync; // Auto-sync after scan/generate

  const SyncSettings({
    this.enabled = false,
    this.serverUrl = '',
    this.username,
    this.password,
    this.syncScanned = true,
    this.syncGenerated = true,
    this.autoSync = true,
  });

  SyncSettings copyWith({
    bool? enabled,
    String? serverUrl,
    String? username,
    String? password,
    bool? syncScanned,
    bool? syncGenerated,
    bool? autoSync,
  }) {
    return SyncSettings(
      enabled: enabled ?? this.enabled,
      serverUrl: serverUrl ?? this.serverUrl,
      username: username ?? this.username,
      password: password ?? this.password,
      syncScanned: syncScanned ?? this.syncScanned,
      syncGenerated: syncGenerated ?? this.syncGenerated,
      autoSync: autoSync ?? this.autoSync,
    );
  }

  WireObject toJson() => {
    'enabled': enabled,
    'serverUrl': serverUrl,
    'username': username,
    'password': password,
    'syncScanned': syncScanned,
    'syncGenerated': syncGenerated,
    'autoSync': autoSync,
  };

  factory SyncSettings.fromJson(Object? json) {
    final object = asWireObject(json);
    return SyncSettings(
      enabled: asWireBool(object['enabled']) ?? false,
      serverUrl: asWireString(object['serverUrl']) ?? '',
      username: asWireString(object['username']),
      password: asWireString(object['password']),
      syncScanned: asWireBool(object['syncScanned']) ?? true,
      syncGenerated: asWireBool(object['syncGenerated']) ?? true,
      autoSync: asWireBool(object['autoSync']) ?? true,
    );
  }

  /// Returns true if sync is properly configured and enabled.
  bool get isConfigured {
    if (!enabled || serverUrl.trim().isEmpty) {
      return false;
    }

    final uri = Uri.tryParse(serverUrl.trim());
    return uri != null &&
        (uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.host.isNotEmpty;
  }

  /// Returns Basic auth header value if credentials are set.
  String? get authHeader {
    if (username != null && username!.isNotEmpty && password != null) {
      final credentials = base64Encode(utf8.encode('$username:$password'));
      return 'Basic $credentials';
    }
    return null;
  }
}

/// Service for persisting sync settings.
class SyncSettingsService {
  static const String _key = 'airqr_sync_settings';
  static const String _securePasswordKey = 'airqr_sync_password';
  static const FlutterSecureStorage _secureStorage = FlutterSecureStorage();

  static Future<SyncSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    final jsonStr = prefs.getString(_key);
    WireObject json = <String, Object?>{};
    try {
      if (jsonStr != null) {
        json = asWireObject(parseJsonText(jsonStr));
      }
    } catch (_) {
      json = <String, Object?>{};
    }

    String? securePassword;
    try {
      securePassword = await _secureStorage.read(key: _securePasswordKey);
    } catch (_) {
      securePassword = null;
    }

    if (securePassword != null && securePassword.isNotEmpty) {
      json['password'] = securePassword;
    }

    final settings = SyncSettings.fromJson(json);

    // One-time migration: remove plaintext password from SharedPreferences.
    final plainPassword = json['password'];
    if ((securePassword == null || securePassword.isEmpty) &&
        plainPassword is String &&
        plainPassword.isNotEmpty) {
      try {
        await _secureStorage.write(
          key: _securePasswordKey,
          value: plainPassword,
        );
        final migrated = WireObject.from(settings.toJson())
          ..['password'] = null;
        await prefs.setString(_key, jsonEncode(migrated));
      } catch (_) {}
    }

    return settings;
  }

  static Future<void> save(SyncSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    final payload = WireObject.from(settings.toJson());
    final password = asWireString(payload['password']);
    payload['password'] = null;
    await prefs.setString(_key, jsonEncode(payload));

    try {
      if (password != null && password.isNotEmpty) {
        await _secureStorage.write(key: _securePasswordKey, value: password);
      } else {
        await _secureStorage.delete(key: _securePasswordKey);
      }
    } catch (_) {}
  }
}
