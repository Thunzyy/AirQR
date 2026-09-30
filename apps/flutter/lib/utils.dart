// Shared utility functions for the AirQR Flutter app.
//
// Format byte count to a human-readable string.
//
// Returns sizes in B, KB, or MB with appropriate precision.
String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(2)} KB';
  return '${(bytes / 1024 / 1024).toStringAsFixed(2)} MB';
}

/// Sanitize a string to be a valid session/history ID (alphanumeric, underscore, dash only).
String sanitizeId(String input) {
  return input.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
}

/// Check whether [host] is a local/private network address.
bool isLocalDevHost(String host) {
  final normalized = host.toLowerCase();
  if (normalized == 'localhost' ||
      normalized == '127.0.0.1' ||
      normalized == '::1') {
    return true;
  }
  if (normalized.startsWith('10.') || normalized.startsWith('192.168.')) {
    return true;
  }
  final match = RegExp(r'^172\.(\d{1,2})\.').firstMatch(normalized);
  if (match != null) {
    final secondOctet = int.tryParse(match.group(1)!);
    if (secondOctet != null && secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }
  return false;
}
