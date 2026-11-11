import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/foundation.dart';

abstract final class EncoderDefaults {
  static const int fps = 10;
  static const int maxGifFps = 60;

  static int get maxPlaybackFps {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.iOS) return maxGifFps;
    final refreshRate =
        PlatformDispatcher.instance.implicitView?.display.refreshRate;
    return refreshRate != null && refreshRate.isFinite && refreshRate >= 1
        ? refreshRate.round()
        : maxGifFps;
  }

  static Duration playbackInterval(int fps) =>
      Duration(microseconds: (Duration.microsecondsPerSecond / fps).ceil());

  static const int packetSize = 1500;
  static const String errorCorrection = 'LOW';
  static const int targetQrSize = 177;
  static const double raptorqOverhead = 1.3;
  static const bool compressionEnabled = true;
}
