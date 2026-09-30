import 'dart:ui' show SemanticsAction;

import 'package:airqr_mobile/widgets/airqr_press_feedback.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('uses exact press and release motion', (tester) async {
    await tester.pumpWidget(_PressFeedbackHarness());

    expect(_animatedScale(tester).scale, 1.0);

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(FilledButton)),
    );
    await tester.pump();

    expect(_animatedScale(tester).scale, 0.96);
    expect(_animatedScale(tester).duration, const Duration(milliseconds: 110));
    expect(_animatedScale(tester).curve, Curves.easeOutCubic);

    await gesture.up();
    await tester.pump();

    expect(_animatedScale(tester).scale, 1.0);
    expect(_animatedScale(tester).duration, const Duration(milliseconds: 160));
    expect(_animatedScale(tester).curve, Curves.easeOutCubic);
  });

  testWidgets('disables press and release animation for reduced motion', (
    tester,
  ) async {
    await tester.pumpWidget(_PressFeedbackHarness(disableAnimations: true));

    final gesture = await tester.startGesture(
      tester.getCenter(find.byType(FilledButton)),
    );
    await tester.pump();

    expect(_animatedScale(tester).scale, 0.96);
    expect(_animatedScale(tester).duration, Duration.zero);

    await gesture.up();
    await tester.pump();

    expect(_animatedScale(tester).scale, 1.0);
    expect(_animatedScale(tester).duration, Duration.zero);
  });

  testWidgets('preserves the wrapped button tap semantics', (tester) async {
    var taps = 0;
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(_PressFeedbackHarness(onPressed: () => taps += 1));

    final node = tester.getSemantics(find.byType(FilledButton));
    expect(node.getSemanticsData().flagsCollection.isButton, isTrue);
    expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);

    await tester.tap(find.byType(FilledButton));
    expect(taps, 1);
    semantics.dispose();
  });
}

AnimatedScale _animatedScale(WidgetTester tester) =>
    tester.widget<AnimatedScale>(find.byType(AnimatedScale));

class _PressFeedbackHarness extends StatelessWidget {
  const _PressFeedbackHarness({this.disableAnimations = false, this.onPressed});

  final bool disableAnimations;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: MediaQuery(
        data: MediaQueryData(disableAnimations: disableAnimations),
        child: Scaffold(
          body: Center(
            child: AirQrPressFeedback(
              builder: (context, statesController, child) => FilledButton(
                statesController: statesController,
                onPressed: onPressed ?? () {},
                child: child,
              ),
              child: const Text('Send'),
            ),
          ),
        ),
      ),
    );
  }
}
