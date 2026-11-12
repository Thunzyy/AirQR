import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:flutter/material.dart';
import 'dart:convert';

import 'parse/wire.dart';

enum ScannerPreset { turbo, fast, balanced, reliable, custom, silent }

enum CameraResolutionPreset { low, medium, high, veryHigh, ultraHigh }

class ScannerSettings {
  final DetectionSpeed detectionSpeed;
  final int detectionTimeoutMs;
  final CameraResolutionPreset resolutionPreset;
  final List<BarcodeFormat> formats;
  final bool torchEnabled;

  const ScannerSettings({
    required this.detectionSpeed,
    required this.detectionTimeoutMs,
    required this.resolutionPreset,
    required this.formats,
    this.torchEnabled = false,
  });

  factory ScannerSettings.turbo() => const ScannerSettings(
    detectionSpeed: DetectionSpeed.unrestricted,
    detectionTimeoutMs: 100,
    resolutionPreset: CameraResolutionPreset.medium,
    formats: [BarcodeFormat.qrCode],
  );

  factory ScannerSettings.fast() => const ScannerSettings(
    detectionSpeed: DetectionSpeed.noDuplicates,
    detectionTimeoutMs: 200,
    resolutionPreset: CameraResolutionPreset.medium,
    formats: [BarcodeFormat.qrCode],
  );

  factory ScannerSettings.balanced() => const ScannerSettings(
    detectionSpeed: DetectionSpeed.noDuplicates,
    detectionTimeoutMs: 250,
    resolutionPreset: CameraResolutionPreset.medium,
    formats: [BarcodeFormat.qrCode],
  );

  factory ScannerSettings.reliable() => const ScannerSettings(
    detectionSpeed: DetectionSpeed.normal,
    detectionTimeoutMs: 500,
    resolutionPreset: CameraResolutionPreset.veryHigh,
    formats: [BarcodeFormat.qrCode],
  );

  factory ScannerSettings.silent() => const ScannerSettings(
    detectionSpeed: DetectionSpeed.noDuplicates,
    detectionTimeoutMs: 250,
    resolutionPreset: CameraResolutionPreset.medium,
    formats: [BarcodeFormat.qrCode],
  );

  factory ScannerSettings.fromPreset(ScannerPreset preset) {
    switch (preset) {
      case ScannerPreset.turbo:
        return ScannerSettings.turbo();
      case ScannerPreset.fast:
        return ScannerSettings.fast();
      case ScannerPreset.balanced:
        return ScannerSettings.balanced();
      case ScannerPreset.reliable:
        return ScannerSettings.reliable();
      case ScannerPreset.custom:
        return ScannerSettings.fast();
      case ScannerPreset.silent:
        return ScannerSettings.silent();
    }
  }

  Size get resolutionSize {
    switch (resolutionPreset) {
      case CameraResolutionPreset.low:
        return const Size(640, 480); // 480p
      case CameraResolutionPreset.medium:
        return const Size(1280, 720); // 720p
      case CameraResolutionPreset.high:
        return const Size(1920, 1080); // 1080p
      case CameraResolutionPreset.veryHigh:
        return const Size(2560, 1440); // 2K
      case CameraResolutionPreset.ultraHigh:
        return const Size(3840, 2160); // 4K
    }
  }

  WireObject toJson() => {
    'detectionSpeed': detectionSpeed.index,
    'detectionTimeoutMs': detectionTimeoutMs,
    'resolutionPreset': resolutionPreset.index,
    'formats': formats.map((f) => f.index).toList(),
    'torchEnabled': torchEnabled,
  };

  factory ScannerSettings.fromJson(Object? json) {
    final object = asWireObject(json);
    final detectionSpeed = _enumAt(DetectionSpeed.values, object['detectionSpeed']);
    final detectionTimeoutMs = asWireInt(object['detectionTimeoutMs']);
    final resolutionPreset = _enumAt(
      CameraResolutionPreset.values,
      object['resolutionPreset'],
    );
    final formats = asWireList(object['formats'])
        .map((index) => _enumAt(BarcodeFormat.values, index))
        .whereType<BarcodeFormat>()
        .toList();
    if (detectionSpeed == null ||
        detectionTimeoutMs == null ||
        resolutionPreset == null) {
      throw const FormatException('Invalid scanner settings');
    }
    return ScannerSettings(
      detectionSpeed: detectionSpeed,
      detectionTimeoutMs: detectionTimeoutMs,
      resolutionPreset: resolutionPreset,
      formats: formats.isEmpty ? const [BarcodeFormat.qrCode] : formats,
      torchEnabled: asWireBool(object['torchEnabled']) ?? false,
    );
  }

  String toJsonString() => jsonEncode(toJson());

  factory ScannerSettings.fromJsonString(String jsonString) {
    return ScannerSettings.fromJson(parseJsonText(jsonString));
  }

  MobileScannerController createController({
    CameraFacing facing = CameraFacing.back,
  }) {
    // Animated fountain QR streams can legitimately repeat symbols.
    // MobileScanner's noDuplicates mode suppresses repeated detections at source,
    // which can stall progress (e.g. 2/86) on phase-locked capture loops.
    // Always use an event mode compatible with animated scanning.
    final effectiveDetectionSpeed =
        detectionSpeed == DetectionSpeed.noDuplicates
        ? DetectionSpeed.unrestricted
        : detectionSpeed;
    final effectiveDetectionTimeoutMs =
        effectiveDetectionSpeed == DetectionSpeed.unrestricted
        ? detectionTimeoutMs.clamp(0, 80)
        : detectionTimeoutMs;

    return MobileScannerController(
      detectionSpeed: effectiveDetectionSpeed,
      detectionTimeoutMs: effectiveDetectionTimeoutMs,
      cameraResolution: resolutionSize,
      formats: formats,
      returnImage: false,
      torchEnabled: torchEnabled,
      facing: facing,
      autoStart: true,
    );
  }

  String getPresetName(ScannerPreset preset) {
    switch (preset) {
      case ScannerPreset.turbo:
        return 'Turbo';
      case ScannerPreset.fast:
        return 'Fast';
      case ScannerPreset.balanced:
        return 'Balanced';
      case ScannerPreset.reliable:
        return 'Reliable';
      case ScannerPreset.custom:
        return 'Custom';
      case ScannerPreset.silent:
        return 'Silent';
    }
  }

  String getPresetDescription(ScannerPreset preset) {
    switch (preset) {
      case ScannerPreset.turbo:
        return 'Max speed - 30-60 scans/sec\nBest for: close distance, good light';
      case ScannerPreset.fast:
        return 'Balanced speed - 20-30 scans/sec\nRecommended for most cases';
      case ScannerPreset.balanced:
        return 'Battery saving - 15-20 scans/sec\nBest for: older devices, battery life';
      case ScannerPreset.reliable:
        return 'Max reliability - 10-15 scans/sec\nBest for: distance, poor light, movement';
      case ScannerPreset.custom:
        return 'Custom configuration';
      case ScannerPreset.silent:
        return 'No sounds or vibrations';
    }
  }

  String getPresetEmoji(ScannerPreset preset) {
    switch (preset) {
      case ScannerPreset.turbo:
        return '🚀';
      case ScannerPreset.fast:
        return '⚡';
      case ScannerPreset.balanced:
        return '⚖️';
      case ScannerPreset.reliable:
        return '🎯';
      case ScannerPreset.custom:
        return '⚙️';
      case ScannerPreset.silent:
        return '🔇';
    }
  }
}

T? _enumAt<T>(List<T> values, Object? index) {
  final parsed = asWireInt(index);
  if (parsed == null || parsed < 0 || parsed >= values.length) {
    return null;
  }
  return values[parsed];
}
