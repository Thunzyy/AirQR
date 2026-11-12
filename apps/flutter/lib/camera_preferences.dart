import 'dart:io';

import 'package:flutter_lite_camera/flutter_lite_camera.dart';
import 'package:shared_preferences/shared_preferences.dart';

const String kDesktopCameraPreferenceKey = 'desktop_camera_name';
const String kMobileCameraFacingPreferenceKey = 'mobile_camera_facing';

enum MobileCameraFacingPreference { back, front }

bool get supportsDesktopCameraSelection =>
    Platform.isWindows || Platform.isLinux;

String? normalizeDesktopCameraName(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) {
    return null;
  }
  return trimmed;
}

Future<String?> loadPreferredDesktopCameraName() async {
  final prefs = await SharedPreferences.getInstance();
  return normalizeDesktopCameraName(
    prefs.getString(kDesktopCameraPreferenceKey),
  );
}

Future<void> savePreferredDesktopCameraName(String? value) async {
  final prefs = await SharedPreferences.getInstance();
  final normalized = normalizeDesktopCameraName(value);
  if (normalized == null) {
    await prefs.remove(kDesktopCameraPreferenceKey);
    return;
  }
  await prefs.setString(kDesktopCameraPreferenceKey, normalized);
}

MobileCameraFacingPreference parseMobileCameraFacingPreference(String? value) {
  return MobileCameraFacingPreference.values
          .where((facing) => facing.name == value)
          .firstOrNull ??
      MobileCameraFacingPreference.back;
}

Future<MobileCameraFacingPreference> loadPreferredMobileCameraFacing() async {
  final prefs = await SharedPreferences.getInstance();
  return parseMobileCameraFacingPreference(
    prefs.getString(kMobileCameraFacingPreferenceKey),
  );
}

Future<void> savePreferredMobileCameraFacing(
  MobileCameraFacingPreference facing,
) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(kMobileCameraFacingPreferenceKey, facing.name);
}

Future<List<String>> loadDesktopCameraDevices() async {
  if (!supportsDesktopCameraSelection) {
    return const [];
  }

  try {
    final devices = await FlutterLiteCamera().getDeviceList();
    return devices
        .map((device) => device.trim())
        .where((device) => device.isNotEmpty)
        .toList(growable: false);
  } catch (_) {
    return const [];
  }
}

int resolvePreferredDesktopCameraIndex(
  List<String> devices,
  String? preferredDeviceName, {
  int fallbackIndex = 0,
}) {
  if (devices.isEmpty) {
    return 0;
  }

  final normalized = normalizeDesktopCameraName(preferredDeviceName);
  if (normalized != null) {
    final preferredIndex = devices.indexOf(normalized);
    if (preferredIndex != -1) {
      return preferredIndex;
    }
  }

  if (fallbackIndex < 0) {
    return 0;
  }
  if (fallbackIndex >= devices.length) {
    return devices.length - 1;
  }
  return fallbackIndex;
}
