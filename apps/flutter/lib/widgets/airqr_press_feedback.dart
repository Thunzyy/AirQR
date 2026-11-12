import 'package:flutter/material.dart';

typedef AirQrPressBuilder =
    Widget Function(
      BuildContext context,
      WidgetStatesController statesController,
      Widget child,
    );

class AirQrPressFeedback extends StatefulWidget {
  const AirQrPressFeedback({
    required this.child,
    required this.builder,
    super.key,
  });

  final Widget child;
  final AirQrPressBuilder builder;

  @override
  State<AirQrPressFeedback> createState() => _AirQrPressFeedbackState();
}

class _AirQrPressFeedbackState extends State<AirQrPressFeedback> {
  late final WidgetStatesController _statesController;
  var _pressed = false;

  @override
  void initState() {
    super.initState();
    _statesController = WidgetStatesController()
      ..addListener(_handleStatesChanged);
  }

  void _handleStatesChanged() {
    final pressed = _statesController.value.contains(WidgetState.pressed);
    if (pressed == _pressed) return;

    setState(() => _pressed = pressed);
  }

  @override
  void dispose() {
    _statesController
      ..removeListener(_handleStatesChanged)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final disableAnimations = MediaQuery.disableAnimationsOf(context);

    return AnimatedScale(
      scale: _pressed ? 0.96 : 1.0,
      duration: disableAnimations
          ? Duration.zero
          : Duration(milliseconds: _pressed ? 110 : 160),
      curve: Curves.easeOutCubic,
      child: widget.builder(context, _statesController, widget.child),
    );
  }
}
