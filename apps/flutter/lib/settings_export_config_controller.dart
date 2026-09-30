import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import 'sync_settings.dart';
import 'utils.dart';
import 'parse/wire.dart';

class SettingsExportConfig {
  final bool enabled;
  final String? exportDir;
  final bool exportScanned;
  final bool exportGenerated;
  final String? effectiveDir;
  final bool? exportDirValid;
  final String? exportDirError;

  const SettingsExportConfig({
    this.enabled = true,
    this.exportDir,
    this.exportScanned = true,
    this.exportGenerated = true,
    this.effectiveDir,
    this.exportDirValid,
    this.exportDirError,
  });

  factory SettingsExportConfig.fromJson(Object? json) {
    final object = asWireObject(json);
    return SettingsExportConfig(
      enabled: asWireBool(object['enabled']) ?? true,
      exportDir: asWireString(object['exportDir']),
      exportScanned: asWireBool(object['exportScanned']) ?? true,
      exportGenerated: asWireBool(object['exportGenerated']) ?? true,
      effectiveDir: asWireString(object['effectiveDir']),
      exportDirValid: asWireBool(object['exportDirValid']),
      exportDirError: asWireString(object['exportDirError']),
    );
  }
}

class SettingsExportConfigController {
  static http.Client? _strictClient;
  static http.Client? _insecureClient;

  static http.Client _createTrustingClient() {
    final httpClient = HttpClient()
      ..badCertificateCallback = (certificate, host, port) => true;
    return IOClient(httpClient);
  }

  static bool _shouldAllowInsecureTls(SyncSettings settings) {
    if (!kDebugMode) return false;
    final uri = Uri.tryParse(settings.serverUrl.trim());
    if (uri == null || uri.scheme != 'https') return false;
    return isLocalDevHost(uri.host);
  }

  static http.Client _httpClientFor(SyncSettings settings) {
    if (_shouldAllowInsecureTls(settings)) {
      _insecureClient ??= _createTrustingClient();
      return _insecureClient!;
    }
    _strictClient ??= http.Client();
    return _strictClient!;
  }

  static Map<String, String> _headers(SyncSettings settings) {
    final headers = <String, String>{'Content-Type': 'application/json'};
    final auth = settings.authHeader;
    if (auth != null) {
      headers['Authorization'] = auth;
    }
    return headers;
  }

  static Uri _endpoint(SyncSettings settings) {
    final base = settings.serverUrl.trim().replaceFirst(RegExp(r'/+$'), '');
    return Uri.parse('$base/api/config/export');
  }

  Future<SettingsExportConfig> load(SyncSettings settings) async {
    if (!settings.isConfigured) {
      return const SettingsExportConfig();
    }

    final response = await _httpClientFor(
      settings,
    ).get(_endpoint(settings), headers: _headers(settings));

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Server error: ${response.statusCode}');
    }

    return SettingsExportConfig.fromJson(parseJsonText(response.body));
  }

  Future<SettingsExportConfig> save(
    SyncSettings settings,
    Object? updates,
  ) async {
    if (!settings.isConfigured) {
      return const SettingsExportConfig();
    }

    final response = await _httpClientFor(settings).post(
      _endpoint(settings),
      headers: _headers(settings),
      body: jsonEncode(asWireObject(updates)),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = _tryReadError(response.body);
      throw Exception(error ?? 'Server error: ${response.statusCode}');
    }

    final payload = asWireObject(parseJsonText(response.body));
    final config = payload['config'];
    if (isJsonMap(config)) {
      return SettingsExportConfig.fromJson(config);
    }
    return SettingsExportConfig.fromJson(payload);
  }

  static String? _tryReadError(String body) {
    try {
      final payload = tryWireObject(parseJsonText(body));
      return asWireString(payload?['error']);
    } catch (_) {}
    return null;
  }
}
