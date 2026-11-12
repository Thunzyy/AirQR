import 'package:flutter/services.dart';

/// Analysis attempts from the native camera pipeline, before QR deduplication.
/// Older/unpatched plugins do not expose this metric.
class ScannerAnalysisMetrics {
  static const _channel = MethodChannel(
    'dev.steenbakker.mobile_scanner/scanner/method',
  );

  static Future<int?> readFps() async {
    try {
      final value = await _channel.invokeMethod<num>('airqrAnalysisFps');
      if (value == null || !value.isFinite || value < 0) return null;
      return value.round();
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }
}
