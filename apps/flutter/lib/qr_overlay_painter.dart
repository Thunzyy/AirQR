import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class QROverlayPainter extends CustomPainter {
  final List<Offset> corners;
  final Size imageSize;
  final Size widgetSize;
  final Color color;

  QROverlayPainter({
    required List<Offset> corners,
    required this.imageSize,
    required this.widgetSize,
    required this.color,
  }) : corners = List<Offset>.unmodifiable(corners);

  @override
  void paint(Canvas canvas, Size size) {
    if (corners.isEmpty || imageSize.width == 0 || imageSize.height == 0) {
      return;
    }

    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.0
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    // Handle potential rotation (Android landscape sensor vs portrait screen)
    // If aspect ratios are inverse, we likely need to rotate coordinates.
    bool rotate90 = false;
    double sourceWidth = imageSize.width;
    double sourceHeight = imageSize.height;

    if (widgetSize.width < widgetSize.height &&
        imageSize.width > imageSize.height) {
      rotate90 = true;
      // Swap dimensions for the fitted box calculation
      sourceWidth = imageSize.height;
      sourceHeight = imageSize.width;
    }

    final FittedSizes fittedSizes = applyBoxFit(
      BoxFit.cover,
      Size(sourceWidth, sourceHeight),
      widgetSize,
    );

    final Rect destRect = Alignment.center.inscribe(
      fittedSizes.destination,
      Rect.fromLTWH(0, 0, widgetSize.width, widgetSize.height),
    );

    final path = Path();

    Offset transform(Offset p) {
      double x, y;
      if (rotate90) {
        // Rotate 90 degrees clockwise: (x, y) -> (height - y, x)
        // Note: This depends on the specific device/camera rotation.
        // 90 deg CW is common for back cameras in portrait.
        x = (imageSize.height - p.dy);
        y = p.dx;
      } else {
        x = p.dx;
        y = p.dy;
      }

      // Map point from sourceSize to destRect
      double screenX = (x / sourceWidth) * destRect.width + destRect.left;
      double screenY = (y / sourceHeight) * destRect.height + destRect.top;
      return Offset(screenX, screenY);
    }

    if (corners.isNotEmpty) {
      final start = transform(corners[0]);
      path.moveTo(start.dx, start.dy);
      for (int i = 1; i < corners.length; i++) {
        final p = transform(corners[i]);
        path.lineTo(p.dx, p.dy);
      }
      path.close();
    }

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant QROverlayPainter oldDelegate) {
    return !listEquals(oldDelegate.corners, corners) ||
        oldDelegate.imageSize != imageSize ||
        oldDelegate.color != color ||
        oldDelegate.widgetSize != widgetSize;
  }
}
