import 'dart:io';

/// Classifies GIF/ZIP decode failures for user-facing copy.
///
/// Microsoft Store testers pick a regular photo GIF, then treat the raw
/// Rust "Incomplete: … 0 QR" string as a broken primary feature (policy
/// 10.1.2.10). Map those expected failures to guidance instead of debug text.
enum DecoderFailureKind { notAirQr, invalidFile, incomplete, unreadable, unknown }

final _zeroQrPattern = RegExp(r'\b0\s*qr\b');

DecoderFailureKind classifyDecoderFailure({
  required String? errorMsg,
  required int qrDetected,
  Object? caughtError,
}) {
  if (caughtError is FileSystemException) {
    return DecoderFailureKind.unreadable;
  }

  final raw = (errorMsg ?? caughtError?.toString() ?? '')
      .replaceFirst(RegExp(r'^exception:\s*', caseSensitive: false), '');
  final lower = raw.toLowerCase();
  if (lower.contains('unsupportedformat') ||
      lower.contains('gif decode error') ||
      lower.contains('failed to decode gif') ||
      lower.contains('frame extract') ||
      lower.contains('failed to extract frames') ||
      lower.contains('failed to open zip')) {
    return DecoderFailureKind.invalidFile;
  }
  final zeroQr = qrDetected <= 0 || _zeroQrPattern.hasMatch(lower);
  if (zeroQr ||
      (lower.startsWith('incomplete:') && !lower.contains('chunks'))) {
    if (qrDetected > 0) {
      return DecoderFailureKind.incomplete;
    }
    return DecoderFailureKind.notAirQr;
  }
  if (lower.contains('incomplete') || lower.contains('not all chunks')) {
    return DecoderFailureKind.incomplete;
  }
  if (raw.trim().isEmpty) {
    return DecoderFailureKind.unknown;
  }
  return DecoderFailureKind.incomplete;
}

bool decoderFailureShowsError(DecoderFailureKind kind) =>
    kind != DecoderFailureKind.notAirQr;
