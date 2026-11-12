import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class QROverlayPainter extends CustomPainter {
  final List<Offset> corners;
  final Size imageSize;
  final Color color;

  QROverlayPainter({
    required List<Offset> corners,
    required this.imageSize,
    required this.color,
  }) : corners = List<Offset>.unmodifiable(corners);

  @override
  void paint(Canvas canvas, Size size) {
    if (corners.length < 4 || imageSize.isEmpty || size.isEmpty) {
      return;
    }

    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.0
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final fitted = applyBoxFit(BoxFit.cover, imageSize, size);
    final visibleImage = Alignment.center.inscribe(
      fitted.source,
      Offset.zero & imageSize,
    );
    final scale = size.width / visibleImage.width;
    final path = Path()
      ..addPolygon([
        for (final point in corners) (point - visibleImage.topLeft) * scale,
      ], true);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant QROverlayPainter oldDelegate) {
    return !listEquals(oldDelegate.corners, corners) ||
        oldDelegate.imageSize != imageSize ||
        oldDelegate.color != color;
  }
}
