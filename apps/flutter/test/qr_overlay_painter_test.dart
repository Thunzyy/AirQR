import 'package:airqr_mobile/qr_overlay_painter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  QROverlayPainter painter({
    List<Offset> corners = const <Offset>[Offset(1, 2), Offset(3, 4)],
    Size imageSize = const Size(640, 480),
    Size widgetSize = const Size(320, 240),
    Color color = Colors.green,
  }) {
    return QROverlayPainter(
      corners: corners,
      imageSize: imageSize,
      widgetSize: widgetSize,
      color: color,
    );
  }

  test('does not repaint for identical values', () {
    final previous = painter(
      corners: <Offset>[const Offset(1, 2), const Offset(3, 4)],
    );

    expect(
      painter(
        corners: <Offset>[const Offset(1, 2), const Offset(3, 4)],
      ).shouldRepaint(previous),
      isFalse,
    );
  });

  test('repaints when corners change', () {
    final previous = painter();

    expect(
      painter(corners: const <Offset>[Offset(5, 6)]).shouldRepaint(previous),
      isTrue,
    );
  });

  test('snapshots mutable corners before comparing repaint delegates', () {
    final source = <Offset>[const Offset(1, 2), const Offset(3, 4)];
    final previous = painter(corners: source);

    source.add(const Offset(5, 6));
    final current = painter(corners: source);

    expect(previous.corners, const <Offset>[Offset(1, 2), Offset(3, 4)]);
    expect(current.shouldRepaint(previous), isTrue);
    expect(
      () => previous.corners.add(const Offset(7, 8)),
      throwsUnsupportedError,
    );
  });

  test('repaints when image size changes', () {
    final previous = painter();

    expect(
      painter(imageSize: const Size(1280, 720)).shouldRepaint(previous),
      isTrue,
    );
  });

  test('repaints when widget size changes', () {
    final previous = painter();

    expect(
      painter(widgetSize: const Size(360, 640)).shouldRepaint(previous),
      isTrue,
    );
  });

  test('repaints when color changes', () {
    final previous = painter();

    expect(painter(color: Colors.red).shouldRepaint(previous), isTrue);
  });
}
