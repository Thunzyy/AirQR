import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'airqr_icon_aliases.dart';
import 'airqr_theme.dart';

class AirQrIcon extends StatelessWidget {
  final String name;
  final double? size;
  final Color? color;
  final bool exactColor;
  final String? semanticLabel;

  const AirQrIcon(
    this.name, {
    super.key,
    this.size,
    this.color,
    this.exactColor = false,
    this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    final iconTheme = IconTheme.of(context);
    final resolvedSize = size ?? iconTheme.size ?? 24;
    final requestedColor = color ?? iconTheme.color;
    final resolvedColor = exactColor && requestedColor != null
        ? requestedColor
        : AirQrTheme.resolveIconColor(context, requestedColor);
    final lucideName = airQrLucideIconAliases[name] ?? 'circle-help';

    return SvgPicture.asset(
      'assets/icons/lucide/$lucideName.svg',
      width: resolvedSize,
      height: resolvedSize,
      colorFilter: ColorFilter.mode(resolvedColor, BlendMode.srcIn),
      semanticsLabel: semanticLabel,
    );
  }
}
