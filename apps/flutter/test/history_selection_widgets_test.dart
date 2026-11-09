import 'dart:ui' show CheckedState, SemanticsAction;

import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_page_widgets.dart';
import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('HistoryFilterToggle counts', () {
    testWidgets('shows a count badge after each tab label', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: HistoryFilterToggle(
              selectedFilter: 'all',
              cardColor: Colors.black,
              selectedColor: Colors.grey,
              allLabel: 'All',
              scannedLabel: 'Scanned',
              generatedLabel: 'Generated',
              counts: <String, int>{'all': 42, 'scanned': 40, 'generated': 2},
              onChanged: _noopFilter,
            ),
          ),
        ),
      );

      expect(find.text('All'), findsOneWidget);
      expect(find.text('42'), findsOneWidget);
      expect(find.text('40'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('42')).dx,
        greaterThan(tester.getTopRight(find.text('All')).dx),
      );
      final countText = tester.widget<Text>(find.text('42'));
      expect(
        countText.style?.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
      final allSemantics = tester.getSemantics(find.text('All'));
      expect(allSemantics.label, 'All');
      expect(allSemantics.value, '42');
    });

    testWidgets('counts are plain baseline-aligned numerals, not pills', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: HistoryFilterToggle(
              selectedFilter: 'all',
              cardColor: Colors.black,
              selectedColor: Colors.grey,
              allLabel: 'All',
              scannedLabel: 'Scanned',
              generatedLabel: 'Generated',
              counts: <String, int>{'all': 42, 'scanned': 40, 'generated': 2},
              onChanged: _noopFilter,
            ),
          ),
        ),
      );
      final context = tester.element(find.byType(HistoryFilterToggle));

      // No pill: the count has exactly the same decorated ancestors as its
      // label (i.e. only the track), and sits 6dp after it on one baseline.
      int decoratedAncestors(Finder finder) => tester
          .widgetList(
            find.ancestor(
              of: finder,
              matching: find.byWidgetPredicate(
                (widget) =>
                    widget is DecoratedBox ||
                    (widget is Container && widget.decoration != null),
              ),
            ),
          )
          .length;
      expect(
        decoratedAncestors(find.text('42')),
        decoratedAncestors(find.text('All')),
      );
      expect(
        tester.getTopLeft(find.text('42')).dx -
            tester.getTopRight(find.text('All')).dx,
        closeTo(6, 0.01),
      );
      final row = tester.widget<Row>(
        find.ancestor(of: find.text('42'), matching: find.byType(Row)).first,
      );
      expect(row.crossAxisAlignment, CrossAxisAlignment.baseline);
      expect(row.textBaseline, TextBaseline.alphabetic);

      final activeCount = tester.widget<Text>(find.text('42')).style!;
      expect(activeCount.fontSize, 13);
      expect(activeCount.fontWeight, FontWeight.w500);
      expect(
        activeCount.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
      expect(activeCount.color, AirQrTheme.textSecondary(context));
      final inactiveCount = tester.widget<Text>(find.text('40')).style!;
      expect(inactiveCount.color, AirQrTheme.textMuted(context));

      final activeLabel = tester.widget<Text>(find.text('All')).style!;
      expect(activeLabel.fontSize, 15);
      expect(activeLabel.fontWeight, FontWeight.w600);
      expect(activeLabel.letterSpacing, closeTo(-0.15, 0.001));
      expect(activeLabel.color, AirQrTheme.textPrimary(context));
      final inactiveLabel = tester.widget<Text>(find.text('Scanned')).style!;
      expect(inactiveLabel.color, AirQrTheme.textMuted(context));
    });

    testWidgets('track and thumb follow the flat segmented spec', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: HistoryFilterToggle(
              selectedFilter: 'scanned',
              cardColor: Colors.black,
              selectedColor: Colors.grey,
              allLabel: 'All',
              scannedLabel: 'Scanned',
              generatedLabel: 'Generated',
              counts: <String, int>{'all': 3, 'scanned': 2, 'generated': 1},
              onChanged: _noopFilter,
            ),
          ),
        ),
      );
      final context = tester.element(find.byType(HistoryFilterToggle));

      final track = tester.widget<Container>(
        find
            .descendant(
              of: find.byType(HistoryFilterToggle),
              matching: find.byWidgetPredicate(
                (widget) =>
                    widget is Container &&
                    widget.decoration is BoxDecoration &&
                    (widget.decoration! as BoxDecoration).color == Colors.black,
              ),
            )
            .first,
      );
      final trackDecoration = track.decoration! as BoxDecoration;
      expect(trackDecoration.borderRadius, BorderRadius.circular(16));
      expect(
        trackDecoration.border,
        Border.all(color: AirQrTheme.controlBorder(context)),
      );
      expect(trackDecoration.boxShadow, anyOf(isNull, isEmpty));
      expect(track.padding, const EdgeInsets.all(4));
      expect(
        find.descendant(
          of: find.byType(HistoryFilterToggle),
          matching: find.byType(BackdropFilter),
        ),
        findsNothing,
      );
      expect(
        tester
            .getSize(
              find
                  .descendant(
                    of: find.byType(HistoryFilterToggle),
                    matching: find.byType(SizedBox),
                  )
                  .first,
            )
            .height,
        48,
      );

      final indicator = tester.widget<AnimatedPositioned>(
        find.byType(AnimatedPositioned),
      );
      expect(indicator.height, 38);
      final thumb =
          (tester
                  .widget<DecoratedBox>(
                    find.descendant(
                      of: find.byType(AnimatedPositioned),
                      matching: find.byType(DecoratedBox),
                    ),
                  )
                  .decoration
              as BoxDecoration);
      expect(thumb.color, Colors.grey);
      expect(thumb.borderRadius, BorderRadius.circular(12));
      expect(thumb.boxShadow, hasLength(1));
      final shadow = thumb.boxShadow!.single;
      expect(shadow.offset, const Offset(0, 1));
      expect(shadow.blurRadius, 2);
      expect(shadow.color.a, closeTo(0.14, 0.01));
    });

    for (final textScale in <double>[1, 2]) {
      testWidgets(
        'badges never overflow at 320dp with large counts (x$textScale text)',
        (tester) async {
          addTearDown(() => tester.binding.setSurfaceSize(null));
          await tester.binding.setSurfaceSize(const Size(320, 640));
          await tester.pumpWidget(
            MaterialApp(
              home: MediaQuery(
                data: MediaQueryData(
                  size: const Size(320, 640),
                  textScaler: TextScaler.linear(textScale),
                ),
                child: const Scaffold(
                  body: HistoryFilterToggle(
                    selectedFilter: 'generated',
                    cardColor: Colors.black,
                    selectedColor: Colors.grey,
                    allLabel: 'Everything here',
                    scannedLabel: 'Scanned',
                    generatedLabel: 'Generated',
                    counts: <String, int>{
                      'all': 12345,
                      'scanned': 999,
                      'generated': 1000,
                    },
                    onChanged: _noopFilter,
                  ),
                ),
              ),
            ),
          );

          expect(tester.takeException(), isNull);
          expect(find.text('999'), findsOneWidget);
          expect(find.text('999+'), findsNWidgets(2));
          for (final count in <String>['999', '999+']) {
            for (final element in find.text(count).evaluate()) {
              final paragraph = element.renderObject! as RenderParagraph;
              expect(
                paragraph.size.width,
                greaterThanOrEqualTo(
                  paragraph.getMaxIntrinsicWidth(double.infinity) - 0.01,
                ),
                reason: 'count "$count" must never truncate',
              );
              expect(paragraph.didExceedMaxLines, isFalse);
            }
          }
        },
      );
    }

    testWidgets('keeps the sliding indicator layout when counts are set', (
      tester,
    ) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: HistoryFilterToggle(
              selectedFilter: 'scanned',
              cardColor: Colors.black,
              selectedColor: Colors.grey,
              allLabel: 'All',
              scannedLabel: 'Scanned',
              generatedLabel: 'Generated',
              counts: <String, int>{'all': 3, 'scanned': 2, 'generated': 1},
              onChanged: _noopFilter,
            ),
          ),
        ),
      );
      final indicator = tester.widget<AnimatedPositioned>(
        find.byType(AnimatedPositioned),
      );
      expect(indicator.height, 38);
    });
  });

  group('CompletedHistoryCard selection', () {
    testWidgets('selection mode shows a checkbox and hides actions', (
      tester,
    ) async {
      var toggles = 0;
      var saves = 0;
      await tester.pumpWidget(
        _host(
          CompletedHistoryCard(
            item: _item('missing-selection.txt'),
            cardColor: AirQrTheme.darkCard,
            successColor: Colors.green,
            subtitle: 'Today',
            selectionMode: true,
            selected: true,
            onToggleSelected: () => toggles++,
            onView: () {},
            onKeepLocal: () {},
            onSync: () {},
            onSave: () => saves++,
            onDelete: () {},
            onDismissed: () {},
          ),
        ),
      );

      final checkbox = tester.widget<HistorySelectionCheckbox>(
        find.byType(HistorySelectionCheckbox),
      );
      expect(checkbox.selected, isTrue);
      expect(find.byType(Checkbox), findsNothing);
      expect(
        tester.getTopLeft(find.byType(HistorySelectionCheckbox)).dx,
        lessThan(tester.getTopLeft(find.text('missing-selection.txt')).dx),
      );
      expect(find.byType(HistoryActionButton), findsNothing);
      expect(find.byType(Dismissible), findsNothing);

      await tester.tap(find.text('missing-selection.txt'));
      await tester.pump();
      expect(toggles, 1);

      await tester.tap(find.byType(HistorySelectionCheckbox));
      await tester.pump();
      expect(toggles, 2);
      expect(saves, 0);
    });

    testWidgets('long press outside selection mode requests selection', (
      tester,
    ) async {
      var longPresses = 0;
      await tester.pumpWidget(
        _host(
          CompletedHistoryCard(
            item: _item('missing-long-press.txt'),
            cardColor: AirQrTheme.darkCard,
            successColor: Colors.green,
            subtitle: 'Today',
            onLongPress: () => longPresses++,
            onView: null,
            onKeepLocal: null,
            onSync: null,
            onSave: () {},
            onDelete: () {},
            onDismissed: () {},
          ),
        ),
      );

      expect(find.byType(HistorySelectionCheckbox), findsNothing);
      expect(find.byType(Dismissible), findsOneWidget);
      await tester.longPress(find.text('missing-long-press.txt'));
      await tester.pump();
      expect(longPresses, 1);
    });
  });

  group('IncompleteHistoryCard selection', () {
    testWidgets('selection mode taps toggle instead of resuming', (
      tester,
    ) async {
      var toggles = 0;
      var resumes = 0;
      await tester.pumpWidget(
        _host(
          IncompleteHistoryCard(
            scan: _scan('scan-sel'),
            cardColor: AirQrTheme.darkCard,
            warningColor: AirQrTheme.progressOrange,
            displayName: 'Partial scan',
            packetsSummary: '1/4 packets',
            formattedDate: 'Today',
            selectionMode: true,
            selected: false,
            onToggleSelected: () => toggles++,
            onResume: () => resumes++,
            onDelete: () {},
          ),
        ),
      );

      expect(
        tester
            .widget<HistorySelectionCheckbox>(
              find.byType(HistorySelectionCheckbox),
            )
            .selected,
        isFalse,
      );
      expect(find.byType(HistoryActionButton), findsNothing);
      expect(find.byType(Dismissible), findsNothing);

      await tester.tap(find.text('Partial scan'));
      await tester.pump();
      expect(toggles, 1);
      expect(resumes, 0);
    });

    testWidgets('long press outside selection mode requests selection', (
      tester,
    ) async {
      var longPresses = 0;
      var resumes = 0;
      await tester.pumpWidget(
        _host(
          IncompleteHistoryCard(
            scan: _scan('scan-long'),
            cardColor: AirQrTheme.darkCard,
            warningColor: AirQrTheme.progressOrange,
            displayName: 'Partial scan',
            packetsSummary: '1/4 packets',
            formattedDate: 'Today',
            onLongPress: () => longPresses++,
            onResume: () => resumes++,
            onDelete: () {},
          ),
        ),
      );

      await tester.longPress(find.text('Partial scan'));
      await tester.pump();
      expect(longPresses, 1);
      expect(resumes, 0);
    });
  });

  group('HistorySelectionCheckbox', () {
    Future<void> pumpCheckbox(
      WidgetTester tester, {
      required bool selected,
      VoidCallback? onChanged,
      bool disableAnimations = false,
      Brightness brightness = Brightness.light,
    }) {
      return tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(brightness: brightness),
          home: MediaQuery(
            data: MediaQueryData(disableAnimations: disableAnimations),
            child: Scaffold(
              body: Center(
                child: HistorySelectionCheckbox(
                  selected: selected,
                  semanticLabel: 'note.txt',
                  onChanged: onChanged ?? () {},
                ),
              ),
            ),
          ),
        ),
      );
    }

    BoxDecoration circleDecoration(WidgetTester tester) =>
        tester
                .widget<AnimatedContainer>(
                  find.descendant(
                    of: find.byType(HistorySelectionCheckbox),
                    matching: find.byType(AnimatedContainer),
                  ),
                )
                .decoration!
            as BoxDecoration;

    testWidgets('unchecked is a 24dp hollow circle with a 44dp target', (
      tester,
    ) async {
      await pumpCheckbox(tester, selected: false);
      final context = tester.element(find.byType(HistorySelectionCheckbox));

      expect(find.byType(Checkbox), findsNothing);
      final target = tester.getSize(find.byType(HistorySelectionCheckbox));
      expect(target.width, greaterThanOrEqualTo(44));
      expect(target.height, greaterThanOrEqualTo(44));
      expect(
        tester.getSize(
          find.descendant(
            of: find.byType(HistorySelectionCheckbox),
            matching: find.byType(AnimatedContainer),
          ),
        ),
        const Size.square(24),
      );
      final decoration = circleDecoration(tester);
      expect(decoration.shape, BoxShape.circle);
      expect(decoration.color, Colors.transparent);
      expect(
        decoration.border,
        Border.all(color: AirQrTheme.textMuted(context), width: 2),
      );
      expect(
        tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity)).opacity,
        0,
      );
      expect(
        tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale,
        0.5,
      );
    });

    for (final brightness in Brightness.values) {
      testWidgets('checked fills with accent text and a card-colored check '
          '(${brightness.name})', (tester) async {
        await pumpCheckbox(tester, selected: true, brightness: brightness);
        final context = tester.element(find.byType(HistorySelectionCheckbox));
        final accent = AirQrTheme.accentText(context);
        expect(
          accent,
          brightness == Brightness.dark
              ? const Color(0xFF9BA8FF)
              : const Color(0xFF334CFF),
        );

        final decoration = circleDecoration(tester);
        expect(decoration.color, accent);
        expect(decoration.border, Border.all(color: accent, width: 2));
        final check = tester.widget<AirQrIcon>(
          find.descendant(
            of: find.byType(HistorySelectionCheckbox),
            matching: find.byType(AirQrIcon),
          ),
        );
        expect(check.name, 'check');
        expect(check.size, 14);
        expect(check.color, AirQrTheme.card(context));
        expect(
          tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity)).opacity,
          1,
        );
        expect(
          tester.widget<AnimatedScale>(find.byType(AnimatedScale)).scale,
          1,
        );
      });
    }

    testWidgets('check animates over 150ms and honors reduced motion', (
      tester,
    ) async {
      await pumpCheckbox(tester, selected: true);
      expect(
        tester.widget<AnimatedScale>(find.byType(AnimatedScale)).duration,
        const Duration(milliseconds: 150),
      );
      expect(
        tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity)).duration,
        const Duration(milliseconds: 150),
      );

      await pumpCheckbox(tester, selected: true, disableAnimations: true);
      expect(
        tester.widget<AnimatedScale>(find.byType(AnimatedScale)).duration,
        Duration.zero,
      );
      expect(
        tester.widget<AnimatedOpacity>(find.byType(AnimatedOpacity)).duration,
        Duration.zero,
      );
    });

    testWidgets('exposes checked state, file name and tap to semantics', (
      tester,
    ) async {
      var taps = 0;
      await pumpCheckbox(tester, selected: true, onChanged: () => taps++);
      final node = tester.getSemantics(find.bySemanticsLabel('note.txt'));
      expect(node.flagsCollection.isChecked, CheckedState.isTrue);
      expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);

      await tester.tap(find.byType(HistorySelectionCheckbox));
      await tester.pump();
      expect(taps, 1);
    });
  });

  group('selected outline', () {
    testWidgets('incomplete card outline paints above content, unclipped', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          IncompleteHistoryCard(
            scan: _scan('scan-outline'),
            cardColor: AirQrTheme.darkCard,
            warningColor: AirQrTheme.progressOrange,
            displayName: 'Partial scan',
            packetsSummary: '1/4 packets',
            formattedDate: 'Today',
            selectionMode: true,
            selected: true,
            onToggleSelected: () {},
            onResume: () {},
            onDelete: () {},
          ),
        ),
      );
      final cardFinder = find.byKey(
        const ValueKey('history_incomplete_card_scan-outline'),
      );
      _expectOutlineOnTop(tester, cardFinder);
      // The progress bar is inside the card, below the outline layer.
      expect(
        find.descendant(
          of: cardFinder,
          matching: find.byType(LinearProgressIndicator),
        ),
        findsOneWidget,
      );
    });

    testWidgets('completed card outline paints above content, unclipped', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          CompletedHistoryCard(
            item: _item('missing-outline.txt'),
            cardColor: AirQrTheme.darkCard,
            successColor: Colors.green,
            subtitle: 'Today',
            selectionMode: true,
            selected: true,
            onToggleSelected: () {},
            onView: null,
            onKeepLocal: null,
            onSync: null,
            onSave: () {},
            onDelete: () {},
            onDismissed: () {},
          ),
        ),
      );
      _expectOutlineOnTop(
        tester,
        find
            .ancestor(
              of: find.text('missing-outline.txt'),
              matching: find.byWidgetPredicate(
                (widget) =>
                    widget is Container && widget.foregroundDecoration != null,
              ),
            )
            .first,
      );
    });
  });

  group('HistorySelectionBar', () {
    testWidgets('shows count, select all and enabled actions', (tester) async {
      var closed = 0;
      var toggledAll = 0;
      var deleted = 0;
      var downloaded = 0;
      var synced = 0;
      var keptLocal = 0;
      await tester.pumpWidget(
        _host(
          HistorySelectionBar(
            selectedLabel: '2 selected',
            allSelected: false,
            selectAllLabel: 'Select all',
            deselectAllLabel: 'Deselect all',
            closeTooltip: 'Exit selection',
            onClose: () => closed++,
            onToggleSelectAll: () => toggledAll++,
            deleteTooltip: 'Delete',
            onDelete: () => deleted++,
            showDownload: true,
            downloadTooltip: 'Download',
            onDownload: () => downloaded++,
            syncTooltip: 'Sync',
            onSync: () => synced++,
            keepLocalTooltip: 'Keep local',
            onKeepLocal: () => keptLocal++,
          ),
        ),
      );

      expect(find.text('2 selected'), findsOneWidget);
      expect(find.text('Select all'), findsOneWidget);
      await tester.tap(find.byTooltip('Exit selection'));
      await tester.tap(find.text('Select all'));
      await tester.tap(find.byTooltip('Delete'));
      await tester.tap(find.byTooltip('Download'));
      await tester.tap(find.byTooltip('Sync'));
      await tester.tap(find.byTooltip('Keep local'));
      await tester.pump();
      expect(
        <int>[closed, toggledAll, deleted, downloaded, synced, keptLocal],
        <int>[1, 1, 1, 1, 1, 1],
      );
    });

    testWidgets('hides optional actions and disables empty selection', (
      tester,
    ) async {
      await tester.pumpWidget(
        _host(
          HistorySelectionBar(
            selectedLabel: '0 selected',
            allSelected: true,
            selectAllLabel: 'Select all',
            deselectAllLabel: 'Deselect all',
            closeTooltip: 'Exit selection',
            onClose: () {},
            onToggleSelectAll: () {},
            deleteTooltip: 'Delete',
            onDelete: null,
            showDownload: false,
            downloadTooltip: 'Download',
            onDownload: null,
            syncTooltip: 'Sync',
            keepLocalTooltip: 'Keep local',
          ),
        ),
      );

      expect(find.text('Deselect all'), findsOneWidget);
      expect(find.byTooltip('Download'), findsNothing);
      expect(find.byTooltip('Sync'), findsNothing);
      expect(find.byTooltip('Keep local'), findsNothing);
      final delete = tester.widget<IconButton>(
        find.ancestor(
          of: find.byTooltip('Delete'),
          matching: find.byType(IconButton),
        ),
      );
      expect(delete.onPressed, isNull);
    });

    for (final textScale in <double>[1, 2]) {
      testWidgets('fits at 320dp with every action (x$textScale text)', (
        tester,
      ) async {
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.binding.setSurfaceSize(const Size(320, 640));
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(
                size: const Size(320, 640),
                textScaler: TextScaler.linear(textScale),
              ),
              child: Scaffold(
                body: HistorySelectionBar(
                  selectedLabel: '1234 selected',
                  allSelected: false,
                  selectAllLabel: 'Select all',
                  deselectAllLabel: 'Deselect all',
                  closeTooltip: 'Exit selection',
                  onClose: () {},
                  onToggleSelectAll: () {},
                  deleteTooltip: 'Delete',
                  onDelete: () {},
                  showDownload: true,
                  downloadTooltip: 'Download',
                  onDownload: () {},
                  syncTooltip: 'Sync',
                  onSync: () {},
                  keepLocalTooltip: 'Keep local',
                  onKeepLocal: () {},
                ),
              ),
            ),
          ),
        );
        expect(tester.takeException(), isNull);
        for (final tooltip in <String>[
          'Exit selection',
          'Delete',
          'Download',
          'Sync',
          'Keep local',
        ]) {
          final rect = tester.getRect(find.byTooltip(tooltip));
          expect(rect.left, greaterThanOrEqualTo(0));
          expect(rect.right, lessThanOrEqualTo(320));
        }
      });
    }
  });

  group('HistorySearchToolbar select action', () {
    for (final width in <double>[320, 340, 360]) {
      testWidgets('select action fits at ${width.toInt()}dp while connected', (
        tester,
      ) async {
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.binding.setSurfaceSize(Size(width, 640));
        var selects = 0;
        await tester.pumpWidget(
          _host(_toolbar(onEnterSelection: () => selects++)),
        );

        expect(tester.takeException(), isNull);
        final rect = tester.getRect(find.byTooltip('Select'));
        expect(rect.right, lessThanOrEqualTo(width));
        expect(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'check_circle',
          ),
          findsOneWidget,
        );
        await tester.tap(find.byTooltip('Select'));
        await tester.pump();
        expect(selects, 1);
      });
    }

    testWidgets('select action is hidden without a callback', (tester) async {
      await tester.pumpWidget(_host(_toolbar()));
      expect(find.byTooltip('Select'), findsNothing);
    });
  });
}

Widget _host(Widget child) => MaterialApp(
  home: Scaffold(body: ListView(children: [child])),
);

HistorySearchToolbar _toolbar({VoidCallback? onEnterSelection}) =>
    HistorySearchToolbar(
      searchController: TextEditingController(),
      searchOpen: false,
      searchQuery: '',
      searchHint: 'Search',
      connected: true,
      connectedLabel: 'CONNECTED',
      refreshTooltip: 'Refresh',
      clearSearchTooltip: 'Clear search',
      onToggleSearch: () {},
      onClearSearch: () {},
      onSearchChanged: (_) {},
      sortTooltip: 'Sort',
      sortItems: const <HistorySortMenuValue>[],
      onSortSelected: (_) {},
      onRefresh: () {},
      canClearHistory: true,
      clearHistoryTooltip: 'Clear history',
      onClearHistory: () {},
      syncEnabled: true,
      isSyncingNow: false,
      syncTooltip: 'Sync',
      onSyncNow: () {},
      selectTooltip: 'Select',
      onEnterSelection: onEnterSelection,
      cardColor: AirQrTheme.darkCard,
      primaryColor: AirQrTheme.accentBlue,
    );

void _expectOutlineOnTop(WidgetTester tester, Finder cardFinder) {
  final card = tester.widget<Container>(cardFinder);
  // foregroundDecoration paints after (above) every child of the card,
  // including the progress bar.
  final outline = card.foregroundDecoration! as BoxDecoration;
  expect(outline.border, Border.all(color: AirQrTheme.accentBlue, width: 2));
  expect(outline.borderRadius, BorderRadius.circular(28));
  expect(
    (card.decoration! as BoxDecoration).borderRadius,
    outline.borderRadius,
  );
  // Nothing inside the card widget wraps (and so clips) the outlined box.
  final cardWidget = find.byWidgetPredicate(
    (widget) =>
        widget is IncompleteHistoryCard || widget is CompletedHistoryCard,
  );
  expect(
    find.ancestor(
      of: cardFinder,
      matching: find.descendant(
        of: cardWidget,
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is ClipRRect || widget is ClipRect || widget is ClipPath,
        ),
      ),
    ),
    findsNothing,
  );
}

HistoryItem _item(String path) =>
    HistoryItem(path: path, timestamp: 1, size: 1, origin: 'scanned');

IncompleteScan _scan(String id) => IncompleteScan(
  id: id,
  startTimestamp: 1,
  lastUpdateTimestamp: 2,
  progress: 0.25,
  receivedPackets: 1,
  expectedPackets: 4,
);

void _noopFilter(String _) {}
