import 'dart:ui' show Tristate;

import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/widgets/airqr_press_feedback.dart';
import 'package:airqr_mobile/widgets/airqr_segmented_control.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Widget buildControl({
    String value = 'File',
    ValueChanged<String>? onChanged,
    bool disableAnimations = false,
    TextScaler textScaler = TextScaler.noScaling,
  }) {
    return MediaQuery(
      data: MediaQueryData(
        disableAnimations: disableAnimations,
        textScaler: textScaler,
      ),
      child: MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: 320,
              child: AirQrSegmentedControl(
                key: const Key('control'),
                indicatorKey: const Key('indicator'),
                optionKeys: const [Key('file-option'), Key('note-option')],
                options: const ['File', 'Note'],
                value: value,
                onChanged: onChanged ?? (_) {},
              ),
            ),
          ),
        ),
      ),
    );
  }

  test('validates selected value and option key count', () {
    expect(
      () => AirQrSegmentedControl(
        options: const ['File', 'Note'],
        value: 'Missing',
        onChanged: (_) {},
      ),
      throwsAssertionError,
    );
    expect(
      () => AirQrSegmentedControl(
        options: const ['File', 'Note'],
        value: 'File',
        optionKeys: const [Key('file')],
        onChanged: (_) {},
      ),
      throwsAssertionError,
    );
    expect(
      () => AirQrSegmentedControl(
        options: const ['File', 'File'],
        value: 'File',
        onChanged: (_) {},
      ),
      throwsAssertionError,
    );
  });

  testWidgets('uses concentric token radii and a flat indicator', (
    tester,
  ) async {
    await tester.pumpWidget(buildControl());

    final outerFinder = find
        .descendant(
          of: find.byKey(const Key('control')),
          matching: find.byType(Container),
        )
        .first;
    final outer = tester.widget<Container>(outerFinder);
    final outerDecoration = outer.decoration! as BoxDecoration;
    final indicator = tester.widget<DecoratedBox>(
      find.descendant(
        of: find.byKey(const Key('indicator')),
        matching: find.byType(DecoratedBox),
      ),
    );
    final indicatorDecoration = indicator.decoration as BoxDecoration;
    final outerRect = tester.getRect(outerFinder);
    final indicatorRect = tester.getRect(find.byKey(const Key('indicator')));

    expect(outerDecoration.borderRadius, AirQrRadii.panel);
    expect(outer.clipBehavior, Clip.antiAlias);
    expect(indicatorDecoration.borderRadius, AirQrRadii.control);
    expect(indicatorDecoration.boxShadow, isNull);
    expect(indicatorRect.top - outerRect.top, 4);
    expect(outerRect.bottom - indicatorRect.bottom, 4);
  });

  testWidgets('slides the selected indicator with AirQR motion', (
    tester,
  ) async {
    await tester.pumpWidget(const _StatefulControlHarness());

    var indicator = tester.widget<AnimatedPositioned>(
      find.byKey(const Key('indicator')),
    );
    expect(indicator.left, 0);
    expect(indicator.duration, const Duration(milliseconds: 300));
    expect(indicator.curve, const Cubic(0.2, 0.8, 0.2, 1));

    await tester.tap(find.byKey(const Key('note-option')));
    await tester.pump();

    indicator = tester.widget<AnimatedPositioned>(
      find.byKey(const Key('indicator')),
    );
    expect(indicator.left, greaterThan(0));
  });

  testWidgets('retargets an in-flight indicator without a position jump', (
    tester,
  ) async {
    await tester.pumpWidget(const _StatefulControlHarness());

    await tester.tap(find.byKey(const Key('note-option')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 120));
    final positionBeforeRetarget = tester.getRect(
      find.byKey(const Key('indicator')),
    );

    await tester.tap(find.byKey(const Key('file-option')));
    await tester.pump();

    final indicator = tester.widget<AnimatedPositioned>(
      find.byKey(const Key('indicator')),
    );
    final positionAfterRetarget = tester.getRect(
      find.byKey(const Key('indicator')),
    );
    final controlRect = tester.getRect(find.byKey(const Key('control')));
    expect(indicator.left, 0);
    expect(indicator.duration, const Duration(milliseconds: 300));
    expect(positionAfterRetarget.left, closeTo(positionBeforeRetarget.left, 1));
    for (final position in [positionBeforeRetarget, positionAfterRetarget]) {
      expect(position.left, greaterThanOrEqualTo(controlRect.left + 4));
      expect(position.right, lessThanOrEqualTo(controlRect.right - 4));
    }

    await tester.pump(const Duration(milliseconds: 300));
    final settledIndicatorRect = tester.getRect(
      find.byKey(const Key('indicator')),
    );
    expect(settledIndicatorRect.left, closeTo(controlRect.left + 4, 1));
    expect(
      settledIndicatorRect.right,
      lessThanOrEqualTo(controlRect.right - 4),
    );
  });

  testWidgets('reduced motion moves the indicator directly to its edge', (
    tester,
  ) async {
    await tester.pumpWidget(
      const _StatefulControlHarness(disableAnimations: true),
    );

    await tester.tap(find.byKey(const Key('note-option')));
    await tester.pump();

    final indicator = tester.widget<AnimatedPositioned>(
      find.byKey(const Key('indicator')),
    );
    final controlRect = tester.getRect(find.byKey(const Key('control')));
    final indicatorRect = tester.getRect(find.byKey(const Key('indicator')));
    expect(indicator.duration, Duration.zero);
    expect(indicatorRect.right, closeTo(controlRect.right - 4, 1));
    expect(indicatorRect.left, greaterThanOrEqualTo(controlRect.left + 4));
  });

  testWidgets('exposes selection semantics and 48dp option targets', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(buildControl(value: 'Note'));

    final selected = tester.getSemantics(find.byKey(const Key('note-option')));
    final unselected = tester.getSemantics(
      find.byKey(const Key('file-option')),
    );
    expect(selected.flagsCollection.isSelected, Tristate.isTrue);
    expect(unselected.flagsCollection.isSelected, Tristate.isFalse);
    expect(selected.flagsCollection.isButton, isTrue);
    for (final key in const [Key('file-option'), Key('note-option')]) {
      final size = tester.getSize(find.byKey(key));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
    }
    semantics.dispose();
  });

  testWidgets('inherits the exact 0.96 press contract', (tester) async {
    await tester.pumpWidget(buildControl());

    expect(find.byType(AirQrPressFeedback), findsNWidgets(2));
    final gesture = await tester.startGesture(
      tester.getCenter(find.byKey(const Key('file-option'))),
    );
    await tester.pump();

    final scale = tester.widget<AnimatedScale>(
      find.descendant(
        of: find.byKey(const Key('file-option')),
        matching: find.byType(AnimatedScale),
      ),
    );
    expect(scale.scale, 0.96);

    await gesture.up();
  });

  testWidgets('large text and reduced motion remain overflow-free', (
    tester,
  ) async {
    await tester.pumpWidget(
      buildControl(
        disableAnimations: true,
        textScaler: const TextScaler.linear(2),
      ),
    );

    final indicator = tester.widget<AnimatedPositioned>(
      find.byKey(const Key('indicator')),
    );
    expect(indicator.duration, Duration.zero);
    expect(tester.takeException(), isNull);
  });

  testWidgets('narrow large-text segments render every localized label', (
    tester,
  ) async {
    const optionKeys = [
      Key('long-light-option'),
      Key('long-dark-option'),
      Key('long-system-option'),
    ];
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2)),
        child: MaterialApp(
          home: Scaffold(
            body: Center(
              child: SizedBox(
                width: 320,
                child: AirQrSegmentedControl(
                  key: const Key('long-label-control'),
                  options: const [
                    'Thème clair détaillé',
                    'Thème sombre détaillé',
                    'Préférence du système',
                  ],
                  optionKeys: optionKeys,
                  value: 'Préférence du système',
                  onChanged: (_) {},
                ),
              ),
            ),
          ),
        ),
      ),
    );

    final paragraphs = tester.renderObjectList<RenderParagraph>(
      find.descendant(
        of: find.byKey(const Key('long-label-control')),
        matching: find.byType(Text),
      ),
    );
    expect(paragraphs, hasLength(3));
    for (final paragraph in paragraphs) {
      expect(paragraph.didExceedMaxLines, isFalse);
    }
    for (final key in optionKeys) {
      final size = tester.getSize(find.byKey(key));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
    }
    expect(tester.takeException(), isNull);
  });
}

class _StatefulControlHarness extends StatefulWidget {
  const _StatefulControlHarness({this.disableAnimations = false});

  final bool disableAnimations;

  @override
  State<_StatefulControlHarness> createState() =>
      _StatefulControlHarnessState();
}

class _StatefulControlHarnessState extends State<_StatefulControlHarness> {
  var value = 'File';

  @override
  Widget build(BuildContext context) {
    return MediaQuery(
      data: MediaQueryData(disableAnimations: widget.disableAnimations),
      child: MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 320,
            child: AirQrSegmentedControl(
              key: const Key('control'),
              indicatorKey: const Key('indicator'),
              optionKeys: const [Key('file-option'), Key('note-option')],
              options: const ['File', 'Note'],
              value: value,
              onChanged: (next) => setState(() => value = next),
            ),
          ),
        ),
      ),
    );
  }
}
