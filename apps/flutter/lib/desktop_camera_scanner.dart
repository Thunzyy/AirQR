import 'dart:async';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_lite_camera/flutter_lite_camera.dart';
import 'package:zxing2/qrcode.dart';

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'camera_preferences.dart';
import 'l10n/app_localizations.dart';

typedef DesktopQrDetectCallback =
    void Function(Uint8List bytes, List<Offset> corners, Size imageSize);

/// Simple Windows desktop camera preview + QR decoder.
///
/// Why this exists:
/// - `mobile_scanner` has no Windows/Linux implementation.
/// - Flutter's official `camera` plugin still lacks a reliable image stream on
///   Windows, which makes real-time QR decoding hard.
///
/// `flutter_lite_camera` provides RGB frames on Windows/Linux/macOS; we decode
/// them with `zxing2` (pure Dart) so we can recover raw QR bytes (not only text).
class DesktopCameraScanner extends StatefulWidget {
  final bool enabled;
  final int decodeThrottleMs;
  final Size? preferredResolution;
  final String? preferredDeviceName;
  final DesktopQrDetectCallback onDetect;

  const DesktopCameraScanner({
    super.key,
    required this.enabled,
    required this.decodeThrottleMs,
    required this.onDetect,
    this.preferredResolution,
    this.preferredDeviceName,
  });

  @override
  State<DesktopCameraScanner> createState() => DesktopCameraScannerState();
}

class DesktopCameraScannerState extends State<DesktopCameraScanner> {
  static const _channel = MethodChannel('flutter_lite_camera');
  final FlutterLiteCamera _camera = FlutterLiteCamera();

  List<String> _devices = const [];
  int _selectedDeviceIndex = 0;
  bool _isOpen = false;
  int? _openedDeviceIndex;
  String? _storedPreferredDeviceName;

  Timer? _tickTimer;
  bool _captureInFlight = false;
  bool _decodeInFlight = false;
  DateTime _lastDecodeAttempt = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime? _warmupUntil;
  int _consecutiveCaptureErrors = 0;

  ui.Image? _previewImage;
  DateTime _lastPreviewUpdate = DateTime.fromMillisecondsSinceEpoch(0);

  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  @override
  void didUpdateWidget(covariant DesktopCameraScanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.enabled != widget.enabled) {
      if (widget.enabled) {
        unawaited(_activate());
      } else {
        unawaited(_deactivate());
      }
    }

    if (oldWidget.preferredResolution != widget.preferredResolution &&
        widget.enabled) {
      _applyPreferredResolution(widget.preferredResolution);
    }

    if (oldWidget.preferredDeviceName != widget.preferredDeviceName) {
      unawaited(_applyPreferredDevice());
    }
  }

  @override
  void dispose() {
    unawaited(_deactivate());
    _previewImage?.dispose();
    // Best-effort: free the device on app exit.
    unawaited(() async {
      try {
        await _camera.release();
      } catch (_) {}
    }());
    super.dispose();
  }

  Future<void> showCameraSelector(BuildContext context) async {
    await _refreshDevices();
    if (!context.mounted) return;

    // We keep UI strings minimal here; the parent already provides a translated
    // "Select camera" title elsewhere.
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AirQrTheme.card(context),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return SafeArea(
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: _devices.length,
            itemBuilder: (context, index) {
              final name = _devices[index];
              final selected = index == _selectedDeviceIndex;
              return ListTile(
                leading: AirQrIcon(
                  selected ? 'radio_button_checked' : 'radio_button_off',
                  color: selected
                      ? AirQrTheme.accentText(context)
                      : AirQrTheme.textSecondary(context),
                ),
                title: Text(
                  name,
                  style: TextStyle(color: AirQrTheme.textPrimary(context)),
                ),
                onTap: () async {
                  Navigator.pop(context);
                  await _selectDevice(index);
                },
              );
            },
          ),
        );
      },
    );
  }

  Future<void> _init() async {
    _storedPreferredDeviceName = await loadPreferredDesktopCameraName();
    await _refreshDevices();
    if (!mounted) return;

    if (_devices.isEmpty) {
      setState(
        () => _error = AppLocalizations.of(context)!.settings_noCameraDetected,
      );
      return;
    }

    if (widget.enabled) {
      await _activate();
    }
  }

  Future<void> _activate() async {
    if (_isOpen) {
      _start();
      return;
    }

    await _refreshDevices();
    if (!mounted) return;
    if (_devices.isEmpty) {
      setState(
        () => _error = AppLocalizations.of(context)!.settings_noCameraDetected,
      );
      return;
    }

    await _openSelectedDevice();
    if (!mounted) return;
    if (_error != null) return;
    _isOpen = true;
    _start();
  }

  Future<void> _deactivate() async {
    _stop();
    // Intentionally keep the camera opened while the app runs, and only stop
    // frame capture. Some desktop camera backends can be flaky when repeatedly
    // opened/closed; keeping it open makes resume instant and more reliable.
  }

  Future<void> _refreshDevices() async {
    try {
      final devices = await loadDesktopCameraDevices();
      if (!mounted) return;
      final nextIndex = resolvePreferredDesktopCameraIndex(
        devices,
        _effectivePreferredDeviceName,
        fallbackIndex: _selectedDeviceIndex,
      );
      setState(() {
        _devices = devices;
        _selectedDeviceIndex = nextIndex;
      });
    } catch (e) {
      if (!mounted) return;
      setState(
        () => _error = AppLocalizations.of(
          context,
        )!.scanner_cameraListFailed(e.toString()),
      );
    }
  }

  String? get _effectivePreferredDeviceName =>
      normalizeDesktopCameraName(widget.preferredDeviceName) ??
      _storedPreferredDeviceName;

  Future<void> _applyPreferredDevice() async {
    await _refreshDevices();
    if (!mounted || _devices.isEmpty) return;
    final preferredName = _effectivePreferredDeviceName;
    if (preferredName == null) return;
    final preferredIndex = _devices.indexOf(preferredName);
    if (preferredIndex == -1) {
      return;
    }
    if (!_isOpen) {
      if (_selectedDeviceIndex != preferredIndex) {
        setState(() {
          _selectedDeviceIndex = preferredIndex;
        });
      }
      return;
    }
    if (_openedDeviceIndex == preferredIndex) {
      return;
    }
    await _selectDevice(preferredIndex, persistSelection: false);
  }

  Future<void> _selectDevice(int index, {bool persistSelection = true}) async {
    if (index < 0 || index >= _devices.length) return;
    final deviceName = _devices[index];
    setState(() {
      _selectedDeviceIndex = index;
      _error = null;
    });

    _storedPreferredDeviceName = deviceName;
    if (persistSelection) {
      await savePreferredDesktopCameraName(deviceName);
    }

    await _stopAndClose();
    _isOpen = false;
    if (!mounted) return;

    if (widget.enabled) {
      unawaited(_activate());
    }
  }

  Future<void> _openSelectedDevice() async {
    try {
      final ok = await _camera.open(_selectedDeviceIndex);
      if (!ok) {
        if (!mounted) return;
        setState(
          () => _error = AppLocalizations.of(
            context,
          )!.scanner_cameraOpenUnavailable,
        );
        return;
      }
      await _applyPreferredResolution(widget.preferredResolution);
      // Some drivers return a few failing samples right after open; give it a
      // short warmup to avoid surfacing a sticky error state.
      _warmupUntil = DateTime.now().add(const Duration(milliseconds: 350));
      _consecutiveCaptureErrors = 0;
      _openedDeviceIndex = _selectedDeviceIndex;
      setState(() => _error = null);
    } catch (e) {
      if (!mounted) return;
      setState(
        () => _error = AppLocalizations.of(
          context,
        )!.scanner_cameraOpenFailed(e.toString()),
      );
    }
  }

  Future<void> _applyPreferredResolution(Size? size) async {
    if (size == null) return;
    try {
      final ok = await _channel.invokeMethod<bool>('setResolution', <int>[
        size.width.round(),
        size.height.round(),
      ]);
      if (ok != true) return;
    } catch (_) {
      // Not supported on this platform/device, ignore.
    }
  }

  void _start() {
    // Poll at ~60 fps. `_captureInFlight` prevents overlapping frame
    // captures, so effective cadence is bounded by camera/backend speed.
    _tickTimer ??= Timer.periodic(const Duration(milliseconds: 16), (_) {
      unawaited(_tick());
    });
  }

  void _stop() {
    _tickTimer?.cancel();
    _tickTimer = null;
  }

  Future<void> _stopAndClose() async {
    _stop();
    _isOpen = false;
    _openedDeviceIndex = null;
    try {
      await _camera.release();
    } catch (_) {}
  }

  Future<void> _tick() async {
    if (!widget.enabled) return;
    if (_captureInFlight) return;
    final warmupUntil = _warmupUntil;
    if (warmupUntil != null && DateTime.now().isBefore(warmupUntil)) {
      return;
    }
    _captureInFlight = true;

    try {
      final frame = await _camera.captureFrame();
      final data = frame['data'];
      final width = frame['width'];
      final height = frame['height'];

      if (data is! Uint8List || width is! int || height is! int) {
        return;
      }

      // Clear previous capture errors as soon as we get a valid frame.
      _consecutiveCaptureErrors = 0;
      if (_error != null && mounted) {
        setState(() => _error = null);
      }

      _maybeUpdatePreview(data, width, height);
      _maybeDecode(data, width, height);
    } catch (e) {
      _consecutiveCaptureErrors++;
      if (!mounted) return;
      // Don't show an error for single transient failures.
      if (_consecutiveCaptureErrors >= 10) {
        setState(
          () => _error = AppLocalizations.of(
            context,
          )!.scanner_cameraCaptureFailed(e.toString()),
        );
      }
    } finally {
      _captureInFlight = false;
    }
  }

  void _maybeUpdatePreview(Uint8List rgb, int width, int height) {
    final now = DateTime.now();
    // Keep preview refresh lower than capture rate to reduce CPU.
    if (now.difference(_lastPreviewUpdate).inMilliseconds < 66) return;
    _lastPreviewUpdate = now;

    // Convert RGB888 to RGBA8888 for display.
    final rgba = Uint8List(width * height * 4);
    for (int si = 0, di = 0; si + 2 < rgb.length && di + 3 < rgba.length;) {
      rgba[di++] = rgb[si++]; // R
      rgba[di++] = rgb[si++]; // G
      rgba[di++] = rgb[si++]; // B
      rgba[di++] = 0xFF; // A
    }

    ui.decodeImageFromPixels(rgba, width, height, ui.PixelFormat.rgba8888, (
      img,
    ) {
      if (!mounted) {
        img.dispose();
        return;
      }
      setState(() {
        _previewImage?.dispose();
        _previewImage = img;
      });
    });
  }

  void _maybeDecode(Uint8List rgb, int width, int height) {
    if (_decodeInFlight) return;

    final throttleMs = max(0, widget.decodeThrottleMs);
    final now = DateTime.now();
    if (throttleMs > 0 &&
        now.difference(_lastDecodeAttempt).inMilliseconds < throttleMs) {
      return;
    }
    _lastDecodeAttempt = now;

    _decodeInFlight = true;

    final ttd = TransferableTypedData.fromList([rgb]);
    Isolate.run(() => _decodeQr(ttd, width, height))
        .then((result) {
          if (!mounted) return;
          if (result == null) return;

          final bytes = result['bytes'];
          final points = result['points'];

          if (bytes is Uint8List) {
            final pts = <Offset>[];
            if (points is List && points.length >= 4) {
              for (int i = 0; i + 1 < points.length; i += 2) {
                final x = (points[i] as num).toDouble();
                final y = (points[i + 1] as num).toDouble();
                pts.add(Offset(x, y));
              }
            }

            // Convert result points to a 4-corner bounding box for the overlay.
            final corners = pts.isEmpty
                ? const <Offset>[]
                : () {
                    final minX = pts.map((p) => p.dx).reduce(min);
                    final minY = pts.map((p) => p.dy).reduce(min);
                    final maxX = pts.map((p) => p.dx).reduce(max);
                    final maxY = pts.map((p) => p.dy).reduce(max);
                    return <Offset>[
                      Offset(minX, minY),
                      Offset(maxX, minY),
                      Offset(maxX, maxY),
                      Offset(minX, maxY),
                    ];
                  }();

            widget.onDetect(
              bytes,
              corners,
              Size(width.toDouble(), height.toDouble()),
            );
          }
        })
        .catchError((_) {})
        .whenComplete(() {
          _decodeInFlight = false;
        });
  }

  static Map<String, Object>? _decodeQr(
    TransferableTypedData rgbTtd,
    int width,
    int height,
  ) {
    try {
      final rgb = rgbTtd.materialize().asUint8List();

      // Convert RGB888 to Int32List pixels (0xAARRGGBB).
      final pixelCount = width * height;
      if (rgb.length < pixelCount * 3) return null;
      final pixels = Int32List(pixelCount);
      for (int i = 0, si = 0; i < pixelCount; i++) {
        final r = rgb[si++];
        final g = rgb[si++];
        final b = rgb[si++];
        pixels[i] = (0xFF << 24) | (r << 16) | (g << 8) | b;
      }

      final source = RGBLuminanceSource(width, height, pixels);
      final bitmap = BinaryBitmap(HybridBinarizer(source));
      final reader = QRCodeReader();
      final result = reader.decode(bitmap);

      final raw = result.rawBytes;
      if (raw == null || raw.isEmpty) return null;

      final bytes = Uint8List.fromList(
        raw.buffer.asUint8List(raw.offsetInBytes, raw.lengthInBytes),
      );

      final points = <double>[];
      for (final p in result.resultPoints) {
        points
          ..add(p.x)
          ..add(p.y);
      }

      return <String, Object>{'bytes': bytes, 'points': points};
    } on NotFoundException {
      return null;
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final cameraErrorTitle = l10n?.scanner_cameraError ?? 'Camera error';
    final initCameraTitle =
        l10n?.scanner_initCamera ?? 'Initializing camera...';
    final noCameraDetected =
        l10n?.settings_noCameraDetected ?? 'No camera detected';

    if (_error != null) {
      return _buildCenteredMessage(
        iconName: 'videocam_off',
        title: cameraErrorTitle,
        message: _error!,
      );
    }

    if (_devices.isEmpty) {
      return _buildCenteredMessage(
        iconName: 'videocam_off',
        title: cameraErrorTitle,
        message: noCameraDetected,
      );
    }

    final img = _previewImage;
    if (img == null) {
      return _buildCenteredMessage(
        iconName: 'videocam',
        title: initCameraTitle,
        message: initCameraTitle,
      );
    }

    // Make sure the preview always consumes the full available area
    // (desktop windows are often much wider than the camera aspect ratio).
    return SizedBox.expand(
      child: ClipRect(
        child: FittedBox(
          fit: BoxFit.cover,
          child: SizedBox(
            width: img.width.toDouble(),
            height: img.height.toDouble(),
            child: RawImage(image: img),
          ),
        ),
      ),
    );
  }

  Widget _buildCenteredMessage({
    required String iconName,
    required String title,
    required String message,
  }) {
    return Container(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AirQrIcon(
                  iconName,
                  size: 64,
                  color: AirQrTheme.accentText(context),
                ),
                const SizedBox(height: 16),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AirQrTheme.textPrimary(context),
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: AirQrTheme.textSecondary(context),
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
