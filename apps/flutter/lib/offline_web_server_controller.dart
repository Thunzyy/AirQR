import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

class OfflineWebServerLaunchResult {
  final bool success;
  final String? serverUrl;
  final String? error;

  const OfflineWebServerLaunchResult._({
    required this.success,
    this.serverUrl,
    this.error,
  });

  factory OfflineWebServerLaunchResult.ok(String serverUrl) {
    return OfflineWebServerLaunchResult._(success: true, serverUrl: serverUrl);
  }

  factory OfflineWebServerLaunchResult.failed(String error) {
    return OfflineWebServerLaunchResult._(success: false, error: error);
  }
}

typedef OfflineWebHtmlLoader = Future<String> Function();
typedef OfflineWebAddressResolver = Future<List<InternetAddress>> Function();

class OfflineWebServerController {
  static const defaultPreferredPort = 8090;
  static const defaultMaxPort = 8100;
  static const assetPath = 'assets/web/airqr-portable.html';

  final int preferredPort;
  final int maxPort;
  final OfflineWebHtmlLoader _htmlLoader;
  final OfflineWebAddressResolver _addressResolver;

  HttpServer? _server;
  String? _html;
  String? _serverUrl;
  List<String> _networkUrls = const [];

  OfflineWebServerController({
    this.preferredPort = defaultPreferredPort,
    this.maxPort = defaultMaxPort,
    OfflineWebHtmlLoader? htmlLoader,
    OfflineWebAddressResolver? addressResolver,
  }) : _htmlLoader = htmlLoader ?? _loadPortableHtml,
       _addressResolver = addressResolver ?? _resolveLanAddresses;

  bool get isRunning => _server != null;

  String? get serverUrl => _serverUrl;

  int? get port => _server?.port;

  List<String> get networkUrls => List.unmodifiable(_networkUrls);

  Future<OfflineWebServerLaunchResult> start() async {
    if (_server != null) {
      return OfflineWebServerLaunchResult.ok(_serverUrl!);
    }

    try {
      _html = await _htmlLoader();
      if (_html == null || _html!.trim().isEmpty) {
        return OfflineWebServerLaunchResult.failed(
          'Bundled web app asset is empty.',
        );
      }

      final server = await _bindAvailablePort();
      _server = server;
      unawaited(_serveRequests(server));

      final urls = await _buildNetworkUrls(server.port);
      _networkUrls = urls;
      _serverUrl = urls.first;
      return OfflineWebServerLaunchResult.ok(_serverUrl!);
    } catch (error) {
      await stop();
      return OfflineWebServerLaunchResult.failed(error.toString());
    }
  }

  Future<void> stop() async {
    final server = _server;
    _server = null;
    _serverUrl = null;
    _networkUrls = const [];
    _html = null;
    if (server != null) {
      await server.close(force: true);
    }
  }

  Future<HttpServer> _bindAvailablePort() async {
    final ports = preferredPort == 0
        ? const [0]
        : [for (var port = preferredPort; port <= maxPort; port++) port];

    Object? lastError;
    for (final candidate in ports) {
      try {
        return await HttpServer.bind(InternetAddress.anyIPv4, candidate);
      } catch (error) {
        lastError = error;
      }
    }
    throw StateError(
      'Could not bind offline web server on ports $preferredPort-$maxPort: $lastError',
    );
  }

  Future<void> _serveRequests(HttpServer server) async {
    await for (final request in server) {
      unawaited(_handleRequest(request));
    }
  }

  Future<void> _handleRequest(HttpRequest request) async {
    try {
      _setCommonHeaders(request.response);

      if (request.method != 'GET' && request.method != 'HEAD') {
        request.response.statusCode = HttpStatus.methodNotAllowed;
        await request.response.close();
        return;
      }

      if (!_shouldServePortableHtml(request.uri)) {
        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
        return;
      }

      request.response.statusCode = HttpStatus.ok;
      request.response.headers.set(
        HttpHeaders.contentTypeHeader,
        'text/html; charset=utf-8',
      );
      if (request.method == 'GET') {
        request.response.write(_html);
      }
      await request.response.close();
    } catch (_) {
      try {
        request.response.statusCode = HttpStatus.internalServerError;
      } catch (_) {
        // The response may already be committed; closing remains best-effort.
      }
      await request.response.close();
    }
  }

  static void _setCommonHeaders(HttpResponse response) {
    response.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    response.headers.set('X-Content-Type-Options', 'nosniff');
  }

  static bool _shouldServePortableHtml(Uri uri) {
    final path = uri.path;
    if (path.isEmpty ||
        path == '/' ||
        path == '/portable' ||
        path == '/airqr-portable' ||
        path == '/airqr-portable.html') {
      return true;
    }

    final lastSegment = uri.pathSegments.isEmpty ? '' : uri.pathSegments.last;
    return !lastSegment.contains('.');
  }

  Future<List<String>> _buildNetworkUrls(int boundPort) async {
    final addresses = await _addressResolver();
    final sorted = _sortDisplayAddresses(addresses);
    final usable = sorted.isEmpty ? [InternetAddress.loopbackIPv4] : sorted;
    return [
      for (final address in usable) 'http://${address.address}:$boundPort',
    ];
  }

  static List<InternetAddress> _sortDisplayAddresses(
    List<InternetAddress> addresses,
  ) {
    final unique = <String, InternetAddress>{};
    for (final address in addresses) {
      if (address.type != InternetAddressType.IPv4) continue;
      unique[address.address] = address;
    }

    final sorted = unique.values.toList();
    sorted.sort((a, b) {
      final scoreCompare = _addressScore(a).compareTo(_addressScore(b));
      if (scoreCompare != 0) return scoreCompare;
      return a.address.compareTo(b.address);
    });
    return sorted;
  }

  static int _addressScore(InternetAddress address) {
    final value = address.address;
    if (_isLinkLocalIpv4(value)) return 90;
    if (address.isLoopback) return 80;
    if (_isPrivateIpv4(value)) return _privateIpv4Score(value);
    return 70;
  }

  static bool _isPrivateIpv4(String address) {
    final parts = address.split('.').map(int.tryParse).toList();
    if (parts.length != 4 || parts.any((part) => part == null)) {
      return false;
    }
    final first = parts[0]!;
    final second = parts[1]!;
    return first == 10 ||
        (first == 172 && second >= 16 && second <= 31) ||
        (first == 192 && second == 168);
  }

  static int _privateIpv4Score(String address) {
    final parts = address.split('.').map(int.tryParse).toList();
    if (parts.length != 4 || parts.any((part) => part == null)) return 60;

    final first = parts[0]!;
    final second = parts[1]!;
    final third = parts[2]!;
    if (first == 192 && second == 168 && third == 1) return 0;
    if (first == 192 && second == 168) return 5;
    if (first == 172 && second >= 16 && second <= 31) return 10;
    if (first == 10) return 20;
    return 60;
  }

  static bool _isLinkLocalIpv4(String address) {
    final parts = address.split('.').map(int.tryParse).toList();
    if (parts.length != 4 || parts.any((part) => part == null)) return false;
    return parts[0] == 169 && parts[1] == 254;
  }

  static Future<String> _loadPortableHtml() {
    return rootBundle.loadString(assetPath);
  }

  static Future<List<InternetAddress>> _resolveLanAddresses() async {
    final interfaces = await NetworkInterface.list(
      includeLoopback: false,
      type: InternetAddressType.IPv4,
    );
    return [
      for (final interface in interfaces)
        for (final address in interface.addresses) address,
    ];
  }
}
