import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/note_view.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'history note viewer reserves navbar clearance and keeps icon-only actions',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: NoteViewerScaffold(
            filename: 'note.txt',
            content: 'first line\nsecond line',
            onBack: () {},
            bottomClearance: 124,
            toolbarActions: [
              NoteToolbarIconButton(
                iconName: 'content_copy',
                tooltip: 'Copy',
                onPressed: () {},
              ),
              NoteToolbarIconButton(
                iconName: 'download',
                tooltip: 'Download',
                onPressed: () {},
              ),
            ],
          ),
        ),
      );

      expect(find.byTooltip('Copy'), findsOneWidget);
      expect(find.byTooltip('Download'), findsOneWidget);
      expect(find.text('Copy'), findsNothing);
      expect(find.text('Download'), findsNothing);
      final backButton = tester.widget<IconButton>(
        find.byKey(const Key('note_view_back')),
      );
      expect(
        tester.getSize(find.byKey(const Key('note_view_back'))),
        const Size.square(36),
      );
      expect(backButton.style?.shape?.resolve({}), isA<CircleBorder>());
      expect(
        backButton.style?.backgroundColor?.resolve({}),
        AirQrTheme.lightBackSurface,
      );
      expect(
        backButton.style?.side?.resolve({})?.color,
        AirQrTheme.lightControlBorder,
      );
      expect(
        tester.getTopLeft(find.byKey(const Key('note_view_file_icon'))).dx -
            tester.getTopRight(find.byKey(const Key('note_view_back'))).dx,
        6,
      );
      final firstLineNumber = tester.widget<Text>(
        find.byKey(const Key('note_view_line_number_0')),
      );
      final firstLineNumberTransform = tester.widget<Transform>(
        find
            .ancestor(
              of: find.byKey(const Key('note_view_line_number_0')),
              matching: find.byType(Transform),
            )
            .first,
      );
      final noteContent = tester.widget<SelectableText>(
        find.byKey(const Key('note_view_content')),
      );
      expect(firstLineNumber.textAlign, TextAlign.center);
      expect(firstLineNumber.style?.fontSize, 10);
      expect(firstLineNumber.style?.height, 2.4);
      expect(firstLineNumberTransform.transform.getTranslation().y, 2);
      expect(noteContent.style?.fontFamily, 'monospace');
      expect(noteContent.style?.fontSize, 14);
      expect(noteContent.style?.height, closeTo(24 / 14, 0.001));
      expect(
        tester.getTopLeft(find.byKey(const Key('note_view_content'))).dx -
            tester
                .getTopRight(find.byKey(const Key('note_view_line_gutter')))
                .dx,
        4,
      );
      expect(
        tester.getCenter(find.byKey(const Key('note_view_line_number_0'))).dx,
        closeTo(20, 0.01),
      );
      final gutter = tester.widget<DecoratedBox>(
        find.byKey(const Key('note_view_line_gutter')),
      );
      final gutterDecoration = gutter.decoration as BoxDecoration;
      expect(
        tester.getSize(find.byKey(const Key('note_view_line_gutter'))).width,
        40,
      );
      expect(
        tester.getSize(find.byKey(const Key('note_view_line_gutter'))).height,
        greaterThan(400),
      );
      expect(gutterDecoration.color, AirQrTheme.lightControlSurface);
      expect(
        (gutterDecoration.border! as Border).right.color,
        AirQrTheme.lightDivider,
      );
      expect(
        tester.getBottomLeft(find.byKey(const Key('note_view_line_count'))).dy,
        lessThanOrEqualTo(676),
      );
    },
  );

  testWidgets('history note viewer numbers every visually wrapped row', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(220, 500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: NoteViewerScaffold(
          filename: 'note.txt',
          content:
              'This single logical line is deliberately long enough to wrap '
              'onto several visual rows.',
          onBack: () {},
        ),
      ),
    );

    expect(find.byKey(const Key('note_view_line_number_0')), findsOneWidget);
    expect(find.byKey(const Key('note_view_line_number_1')), findsOneWidget);
    expect(find.byKey(const Key('note_view_line_number_2')), findsOneWidget);
    expect(find.text('1 line'), findsOneWidget);
  });
}
