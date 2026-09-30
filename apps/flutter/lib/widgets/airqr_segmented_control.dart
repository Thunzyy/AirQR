import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../airqr_theme.dart';
import 'airqr_press_feedback.dart';

class AirQrSegmentedControl extends StatelessWidget {
  AirQrSegmentedControl({
    required this.options,
    required this.value,
    required this.onChanged,
    this.selectedColor,
    this.backgroundColor,
    this.unselectedTextColor,
    this.indicatorKey,
    this.optionKeys,
    super.key,
  }) : assert(options.isNotEmpty),
       assert(options.toSet().length == options.length),
       assert(options.contains(value)),
       assert(optionKeys == null || optionKeys.length == options.length);

  final List<String> options;
  final String value;
  final ValueChanged<String> onChanged;
  final Color? selectedColor;
  final Color? backgroundColor;
  final Color? unselectedTextColor;
  final Key? indicatorKey;
  final List<Key>? optionKeys;

  @override
  Widget build(BuildContext context) {
    final selectedIndex = options.indexOf(value);
    final duration = MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 300);
    final textScaler = MediaQuery.textScalerOf(context);
    final labelStyle =
        (Theme.of(context).textTheme.titleMedium ?? const TextStyle()).copyWith(
          height: 1.2,
          fontWeight: FontWeight.w800,
        );

    return LayoutBuilder(
      builder: (context, outerConstraints) {
        final innerWidth = math.max(0.0, outerConstraints.maxWidth - 8);
        final optionWidth = innerWidth / options.length;
        var maximumLabelHeight = 0.0;
        for (final option in options) {
          final painter = TextPainter(
            text: TextSpan(text: option, style: labelStyle),
            textDirection: Directionality.of(context),
            textAlign: TextAlign.center,
            textScaler: textScaler,
          )..layout(maxWidth: optionWidth);
          maximumLabelHeight = math.max(maximumLabelHeight, painter.height);
          painter.dispose();
        }
        final controlHeight = 8.0 + math.max(48.0, maximumLabelHeight + 8.0);

        return Container(
          height: controlHeight,
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: backgroundColor ?? AirQrTheme.navSurface(context),
            borderRadius: AirQrRadii.panel,
          ),
          clipBehavior: Clip.antiAlias,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final optionWidth = constraints.maxWidth / options.length;
              return Stack(
                children: [
                  AnimatedPositioned(
                    key: indicatorKey,
                    duration: duration,
                    curve: const Cubic(0.2, 0.8, 0.2, 1),
                    left: optionWidth * selectedIndex,
                    top: 0,
                    width: optionWidth,
                    height: constraints.maxHeight,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: selectedColor ?? AirQrTheme.navActive(context),
                        borderRadius: AirQrRadii.control,
                      ),
                    ),
                  ),
                  Row(
                    children: [
                      for (var index = 0; index < options.length; index++)
                        Expanded(
                          child: _AirQrSegmentOption(
                            key: optionKeys?[index],
                            label: options[index],
                            selected: index == selectedIndex,
                            unselectedTextColor:
                                unselectedTextColor ??
                                AirQrTheme.textSecondary(context),
                            labelStyle: labelStyle,
                            onTap: () => onChanged(options[index]),
                          ),
                        ),
                    ],
                  ),
                ],
              );
            },
          ),
        );
      },
    );
  }
}

class _AirQrSegmentOption extends StatelessWidget {
  const _AirQrSegmentOption({
    required this.label,
    required this.selected,
    required this.unselectedTextColor,
    required this.labelStyle,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool selected;
  final Color unselectedTextColor;
  final TextStyle labelStyle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onTap,
      child: ExcludeSemantics(
        child: AirQrPressFeedback(
          builder: (context, statesController, child) => Material(
            color: Colors.transparent,
            borderRadius: AirQrRadii.control,
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              statesController: statesController,
              onTap: onTap,
              borderRadius: AirQrRadii.control,
              overlayColor: AirQrTheme.interactionOverlay(context),
              child: child,
            ),
          ),
          child: Center(
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: labelStyle.copyWith(
                color: selected
                    ? AirQrTheme.textPrimary(context)
                    : unselectedTextColor,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
