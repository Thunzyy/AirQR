import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' show FontFeature, PointerDeviceKind, SemanticsAction, Tristate;

import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_icon_aliases.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_page_widgets.dart';
import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

Color _compositeOver(Color foreground, Color background) {
  final foregroundArgb = foreground.toARGB32();
  final backgroundArgb = background.toARGB32();
  final foregroundAlpha = ((foregroundArgb >> 24) & 0xff) / 255;
  final backgroundAlpha = ((backgroundArgb >> 24) & 0xff) / 255;
  final resultAlpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha);

  int compositeChannel(int shift) {
    final foregroundChannel = (foregroundArgb >> shift) & 0xff;
    final backgroundChannel = (backgroundArgb >> shift) & 0xff;
    return ((foregroundChannel * foregroundAlpha +
                backgroundChannel * backgroundAlpha * (1 - foregroundAlpha)) /
            resultAlpha)
        .round();
  }

  return Color.fromARGB(
    (resultAlpha * 255).round(),
    compositeChannel(16),
    compositeChannel(8),
    compositeChannel(0),
  );
}

double _relativeLuminance(Color color) {
  final argb = color.toARGB32();
  double linearizedChannel(int shift) {
    final channel = ((argb >> shift) & 0xff) / 255;
    return channel <= 0.03928
        ? channel / 12.92
        : math.pow((channel + 0.055) / 1.055, 2.4).toDouble();
  }

  return 0.2126 * linearizedChannel(16) +
      0.7152 * linearizedChannel(8) +
      0.0722 * linearizedChannel(0);
}

double _contrastRatio(Color foreground, Color background) {
  final foregroundLuminance = _relativeLuminance(foreground);
  final backgroundLuminance = _relativeLuminance(background);
  final lighter = math.max(foregroundLuminance, backgroundLuminance);
  final darker = math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

void main() {
  testWidgets('HistoryFilterToggle exposes all scanned generated tabs', (
    tester,
  ) async {
    var selected = 'all';

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, setState) {
              return HistoryFilterToggle(
                selectedFilter: selected,
                cardColor: const Color(0xFF101113),
                selectedColor: const Color(0xFF343434),
                allLabel: 'All',
                scannedLabel: 'Scanned',
                generatedLabel: 'Generated',
                onChanged: (value) => setState(() => selected = value),
              );
            },
          ),
        ),
      ),
    );

    expect(find.text('All'), findsOneWidget);
    expect(find.text('Scanned'), findsOneWidget);
    expect(find.text('Generated'), findsOneWidget);

    await tester.tap(find.text('Generated'));
    await tester.pumpAndSettle();
    expect(selected, 'generated');
  });

  testWidgets('history filters are exclusive buttons with selected semantics', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HistoryFilterToggle(
            selectedFilter: 'scanned',
            cardColor: Colors.black,
            selectedColor: Colors.grey,
            allLabel: 'All',
            scannedLabel: 'Scanned',
            generatedLabel: 'Generated',
            onChanged: (_) {},
          ),
        ),
      ),
    );

    final nodes = tester.getSemantics(find.byType(HistoryFilterToggle));
    expect(nodes, isNotNull);
    final scanned = tester.getSemantics(find.text('Scanned'));
    expect(scanned.label, 'Scanned');
    expect(scanned.flagsCollection.isButton, isTrue);
    expect(scanned.flagsCollection.isSelected, Tristate.isTrue);
    final targetSize = tester.getSize(find.bySemanticsLabel('Scanned'));
    expect(targetSize.width, greaterThanOrEqualTo(48));
    expect(targetSize.height, greaterThanOrEqualTo(36));
  });

  testWidgets('history filter indicator honors reduced motion', (tester) async {
    await tester.pumpWidget(
      const MediaQuery(
        data: MediaQueryData(disableAnimations: true),
        child: MaterialApp(
          home: Scaffold(
            body: HistoryFilterToggle(
              selectedFilter: 'all',
              cardColor: Colors.black,
              selectedColor: Colors.grey,
              allLabel: 'All',
              scannedLabel: 'Scanned',
              generatedLabel: 'Generated',
              onChanged: _noopFilter,
            ),
          ),
        ),
      ),
    );
    expect(
      tester
          .widget<AnimatedPositioned>(find.byType(AnimatedPositioned))
          .duration,
      Duration.zero,
    );
  });

  testWidgets('history filter matches the compact web control geometry', (
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
            onChanged: _noopFilter,
          ),
        ),
      ),
    );

    final indicator = tester.widget<AnimatedPositioned>(
      find.byType(AnimatedPositioned),
    );
    expect(indicator.height, 36);
    expect(
      tester
          .widgetList<SizedBox>(
            find.descendant(
              of: find.byType(HistoryFilterToggle),
              matching: find.byType(SizedBox),
            ),
          )
          .any((box) => box.height == 44),
      isTrue,
    );
  });

  testWidgets('history action controls have at least 48dp targets', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HistoryActionButton(
            iconName: 'delete',
            semanticLabel: 'Delete file',
            autofocus: true,
            onPressed: () {},
          ),
        ),
      ),
    );
    final size = tester.getSize(find.byType(HistoryActionButton));
    expect(size.width, greaterThanOrEqualTo(48));
    expect(size.height, greaterThanOrEqualTo(48));
  });

  testWidgets(
    'history action exposes one semantic tap and keyboard activation',
    (tester) async {
      var calls = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: HistoryActionButton(
              iconName: 'delete',
              semanticLabel: 'Delete file',
              autofocus: true,
              onPressed: () => calls++,
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.bySemanticsLabel('Delete file'), findsOneWidget);
      final semantics = tester.getSemantics(
        find.bySemanticsLabel('Delete file'),
      );
      expect(semantics.flagsCollection.isButton, isTrue);
      expect(
        semantics.getSemanticsData().hasAction(SemanticsAction.tap),
        isTrue,
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(calls, 1);
    },
  );

  for (final width in <double>[320, 360, 390]) {
    testWidgets(
      'completed history actions stay readable at ${width.toInt()}dp',
      (tester) async {
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.binding.setSurfaceSize(Size(width, 640));
        final file = File(
          '${Directory.systemTemp.path}/airqr-responsive-$width.png',
        );
        file.writeAsBytesSync(<int>[1, 2, 3]);
        addTearDown(() {
          if (file.existsSync()) file.deleteSync();
        });
        var deleted = false;

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ListView(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: CompletedHistoryCard(
                      item: HistoryItem(
                        path: file.path,
                        timestamp: 1,
                        size: 3,
                        mimeType: 'image/png',
                        isSynced: true,
                      ),
                      cardColor: const Color(0xFF101922),
                      successColor: Colors.green,
                      subtitle: 'Today - 3 B',
                      viewLabel: 'Open',
                      keepLocalLabel: 'Keep local',
                      syncLabel: 'Sync to server',
                      saveLabel: 'Download',
                      deleteLabel: 'Delete',
                      onView: () {},
                      onKeepLocal: () {},
                      onSync: () {},
                      onSave: () {},
                      onDelete: () => deleted = true,
                      onDismissed: () {},
                    ),
                  ),
                ],
              ),
            ),
          ),
        );

        expect(tester.takeException(), isNull);
        final cardRect = tester.getRect(find.byType(Dismissible));
        final actionRects = find
            .byType(HistoryActionButton)
            .evaluate()
            .map((element) => tester.getRect(find.byWidget(element.widget)))
            .toList();
        expect(actionRects, hasLength(4));
        for (final rect in actionRects) {
          expect(rect.width, greaterThanOrEqualTo(34));
          expect(rect.height, greaterThanOrEqualTo(34));
          expect(rect.left, greaterThanOrEqualTo(cardRect.left));
          expect(rect.right, lessThanOrEqualTo(cardRect.right));
        }
        for (var index = 1; index < actionRects.length; index++) {
          expect(
            actionRects[index].left,
            closeTo(actionRects[index - 1].right, 0.01),
            reason: 'compact action targets should have no extra gap',
          );
        }
        final identityIconRect = tester.getRect(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'description',
          ),
        );
        expect(
          (actionRects.first.center.dy - identityIconRect.center.dy).abs(),
          lessThan(10),
        );
        expect(cardRect.height, lessThanOrEqualTo(80));

        final visualCircles = find
            .descendant(
              of: find.byType(HistoryActionButton),
              matching: find.byType(Container),
            )
            .evaluate()
            .map((element) => tester.getSize(find.byWidget(element.widget)))
            .where((size) => size.width > 0 && size.height > 0)
            .toList();
        expect(
          visualCircles.where((size) => size == const Size.square(30)),
          hasLength(4),
        );

        await tester.tap(find.bySemanticsLabel('Delete'));
        await tester.pump();
        expect(deleted, isTrue);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('history section labels match compact web metadata', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: HistorySectionHeader(title: 'July 2')),
      ),
    );

    final label = tester.widget<Text>(find.text('JULY 2'));
    expect(label.style?.fontSize, 11);
    expect(label.style?.fontWeight, FontWeight.w800);
    expect(label.style?.letterSpacing, closeTo(1.98, 0.01));
  });

  for (final brightness in Brightness.values) {
    testWidgets(
      'history 11sp muted text has WCAG contrast in ${brightness.name} mode',
      (tester) async {
        final isDark = brightness == Brightness.dark;
        final pageSurface = isDark
            ? AirQrTheme.darkBackground
            : AirQrTheme.lightBackground;
        final cardSurface = isDark ? AirQrTheme.darkCard : AirQrTheme.lightCard;
        final effectiveCardSurface = _compositeOver(cardSurface, pageSurface);

        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData(brightness: brightness),
            home: Scaffold(
              backgroundColor: pageSurface,
              body: Column(
                children: [
                  const HistorySectionHeader(title: 'July 2'),
                  CompletedHistoryCard(
                    item: HistoryItem(
                      path: 'airqr-remote://contrast/note.txt',
                      timestamp: 1,
                      size: 4,
                      origin: 'generated',
                      mimeType: 'text/plain',
                      isSynced: true,
                      serverId: 'contrast',
                    ),
                    cardColor: cardSurface,
                    successColor: Colors.green,
                    subtitle: 'Metadata',
                    onView: () {},
                    onKeepLocal: () {},
                    onSync: null,
                    onSave: () {},
                    onDelete: () {},
                    onDismissed: () {},
                  ),
                ],
              ),
            ),
          ),
        );

        final sectionText = tester.widget<Text>(find.text('JULY 2'));
        final subtitleText = tester.widget<Text>(find.text('Metadata'));
        final sectionColor = sectionText.style!.color!;
        final subtitleColor = subtitleText.style!.color!;
        final sectionContrast = _contrastRatio(
          _compositeOver(sectionColor, pageSurface),
          pageSurface,
        );
        final subtitleContrast = _contrastRatio(
          _compositeOver(subtitleColor, effectiveCardSurface),
          effectiveCardSurface,
        );

        expect(
          sectionContrast,
          greaterThanOrEqualTo(4.5),
          reason: 'section contrast was $sectionContrast',
        );
        expect(
          subtitleContrast,
          greaterThanOrEqualTo(4.5),
          reason: 'subtitle contrast was $subtitleContrast',
        );
      },
    );
  }

  for (final textScale in <double>[1, 2]) {
    testWidgets(
      'completed history card fits 320dp at ${textScale}x text scale',
      (tester) async {
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.binding.setSurfaceSize(const Size(320, 640));

        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
              child: Scaffold(
                body: ListView(
                  children: [
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: CompletedHistoryCard(
                        item: HistoryItem(
                          path: 'airqr-remote://responsive/note.txt',
                          timestamp: 1,
                          size: 4,
                          origin: 'generated',
                          mimeType: 'text/plain',
                          isSynced: true,
                          serverId: 'responsive',
                        ),
                        cardColor: AirQrTheme.darkCard,
                        successColor: Colors.green,
                        subtitle: 'Today - 4 B',
                        onView: () {},
                        onKeepLocal: () {},
                        onSync: null,
                        onSave: () {},
                        onDelete: () {},
                        onDismissed: () {},
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );

        expect(tester.takeException(), isNull);
        final cardRect = tester.getRect(find.byType(Dismissible));
        final actionRects = find
            .byType(HistoryActionButton)
            .evaluate()
            .map((element) => tester.getRect(find.byWidget(element.widget)));
        expect(actionRects, hasLength(4));
        for (final rect in actionRects) {
          expect(rect.width, greaterThanOrEqualTo(34));
          expect(rect.height, greaterThanOrEqualTo(34));
          expect(rect.left, greaterThanOrEqualTo(cardRect.left));
          expect(rect.right, lessThanOrEqualTo(cardRect.right));
        }
      },
    );
  }

  for (final width in <double>[360, 375, 390]) {
    testWidgets(
      'history toolbar stays on one row at ${width.toInt()}dp with normal text',
      (tester) async {
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.binding.setSurfaceSize(Size(width, 640));
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: HistorySearchToolbar(
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
                cardColor: AirQrTheme.darkCard,
                primaryColor: AirQrTheme.accentBlue,
              ),
            ),
          ),
        );

        final badgeRect = tester.getRect(find.text('CONNECTED'));
        final actionRects = <String>[
          'Search',
          'Sort',
          'Refresh',
          'Sync',
          'Clear history',
        ].map((tooltip) => tester.getRect(find.byTooltip(tooltip))).toList();
        for (final rect in actionRects) {
          expect(rect.width, greaterThanOrEqualTo(36));
          expect(rect.right, lessThanOrEqualTo(width));
          expect((rect.center.dy - badgeRect.center.dy).abs(), lessThan(2));
        }
      },
    );
  }

  testWidgets('completed history filenames use Manrope metadata type', (
    tester,
  ) async {
    final file = File('${Directory.systemTemp.path}/holiday-2026.png');
    file.writeAsBytesSync(<int>[1, 2, 3]);
    addTearDown(() {
      if (file.existsSync()) file.deleteSync();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CompletedHistoryCard(
            item: HistoryItem(
              path: file.path,
              timestamp: 1,
              size: 3,
              mimeType: 'image/png',
            ),
            cardColor: Colors.black,
            successColor: Colors.green,
            subtitle: 'Today - 3 B',
            viewLabel: 'Open',
            keepLocalLabel: 'Keep local',
            syncLabel: 'Sync',
            saveLabel: 'Save',
            deleteLabel: 'Delete',
            onView: () {},
            onKeepLocal: () {},
            onSync: () {},
            onSave: () {},
            onDelete: () {},
            onDismissed: () {},
          ),
        ),
      ),
    );

    final filename = tester.widget<Text>(find.text('holiday-2026.png'));
    final subtitle = tester.widget<Text>(find.text('Today - 3 B'));
    expect(filename.style?.fontFamily, 'Manrope');
    expect(filename.style?.fontFeatures, isNull);
    expect(filename.style?.fontSize, greaterThan(subtitle.style!.fontSize!));
    expect(
      filename.style?.fontWeight?.index,
      greaterThan(subtitle.style!.fontWeight!.index),
    );
  });

  testWidgets('HistorySearchToolbar uses AirQR theme tokens for controls', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(),
        home: Scaffold(
          body: HistorySearchToolbar(
            searchController: TextEditingController(),
            searchOpen: false,
            searchQuery: '',
            searchHint: 'Search files...',
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
            cardColor: AirQrTheme.lightCard,
            primaryColor: AirQrTheme.accentBlue,
          ),
        ),
      ),
    );

    expect(find.byType(TextField), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is AirQrIcon &&
            widget.name == 'search' &&
            widget.color == AirQrTheme.lightTextSecondary,
      ),
      findsOneWidget,
    );
    expect(find.text('CONNECTED'), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'delete',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is AirQrIcon &&
            widget.name == 'cloud_upload' &&
            widget.color == AirQrTheme.lightTextSecondary,
      ),
      findsOneWidget,
    );
  });

  testWidgets('history sort overlay retains elevation and 48dp hit areas', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(),
        home: Scaffold(
          body: HistorySearchToolbar(
            searchController: TextEditingController(),
            searchOpen: false,
            searchQuery: '',
            searchHint: 'Search files',
            connected: false,
            connectedLabel: 'CONNECTED',
            refreshTooltip: 'Refresh history',
            clearSearchTooltip: 'Clear search',
            onToggleSearch: () {},
            onClearSearch: () {},
            onSearchChanged: (_) {},
            sortTooltip: 'Sort history',
            sortItems: const <HistorySortMenuValue>[
              HistorySortMenuValue(
                label: 'Newest first',
                iconName: 'schedule',
                selected: true,
                value: 'newest',
              ),
              HistorySortMenuValue(
                label: 'Oldest first',
                iconName: 'history',
                selected: false,
                value: 'oldest',
              ),
              HistorySortMenuValue(
                label: 'Largest first',
                iconName: 'storage',
                selected: false,
                value: 'largest',
              ),
            ],
            onSortSelected: (_) {},
            onRefresh: () {},
            canClearHistory: false,
            clearHistoryTooltip: 'Clear history',
            onClearHistory: null,
            syncEnabled: false,
            isSyncingNow: false,
            syncTooltip: 'Sync history',
            onSyncNow: () {},
            cardColor: AirQrTheme.lightCard,
            primaryColor: AirQrTheme.accentBlue,
          ),
        ),
      ),
    );

    await tester.tap(find.byTooltip('Sort history'));
    await tester.pumpAndSettle();

    final menuAnchor = tester.widget<MenuAnchor>(find.byType(MenuAnchor));
    final menuElevation = menuAnchor.style?.elevation?.resolve(
      const <WidgetState>{},
    );
    expect(menuElevation, 18);
    expect(menuElevation, greaterThan(0));

    for (final label in const [
      'Newest first',
      'Oldest first',
      'Largest first',
    ]) {
      final row = find.ancestor(
        of: find.text(label),
        matching: find.byType(InkWell),
      );
      expect(row, findsOneWidget);
      expect(tester.getSize(row).height, greaterThanOrEqualTo(48));
    }
  });

  testWidgets(
    'history toolbar uses the same stable surface for hover and focus',
    (tester) async {
      var searchActivations = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.light(),
          home: Scaffold(
            body: HistorySearchToolbar(
              searchController: TextEditingController(),
              searchOpen: false,
              searchQuery: '',
              searchHint: 'Search files',
              connected: false,
              connectedLabel: 'CONNECTED',
              refreshTooltip: 'Refresh history',
              clearSearchTooltip: 'Clear search',
              onToggleSearch: () => searchActivations++,
              onClearSearch: () {},
              onSearchChanged: (_) {},
              sortTooltip: 'Sort history',
              sortItems: const <HistorySortMenuValue>[],
              onSortSelected: (_) {},
              onRefresh: () {},
              canClearHistory: false,
              clearHistoryTooltip: 'Clear history',
              onClearHistory: null,
              syncEnabled: false,
              isSyncingNow: false,
              syncTooltip: 'Sync history',
              onSyncNow: () {},
              cardColor: AirQrTheme.lightCard,
              primaryColor: AirQrTheme.accentBlue,
            ),
          ),
        ),
      );

      final action = find.byTooltip('Search files');
      final containerFinder = find
          .ancestor(of: action, matching: find.byType(AnimatedContainer))
          .first;
      final restingSize = tester.getSize(containerFinder);

      final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
      addTearDown(mouse.removePointer);
      await mouse.addPointer(location: Offset.zero);
      await mouse.moveTo(tester.getCenter(action));
      await tester.pumpAndSettle();
      final hoverDecoration =
          tester.widget<AnimatedContainer>(containerFinder).decoration
              as BoxDecoration;
      expect(hoverDecoration.color, AirQrTheme.lightActionHover);
      expect(tester.getSize(containerFinder), restingSize);

      await mouse.moveTo(Offset.zero);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pumpAndSettle();
      final focusDecoration =
          tester.widget<AnimatedContainer>(containerFinder).decoration
              as BoxDecoration;
      expect(focusDecoration.color, hoverDecoration.color);
      expect(tester.getSize(containerFinder), restingSize);
      expect(
        tester
            .getSemantics(action)
            .getSemanticsData()
            .hasAction(SemanticsAction.tap),
        isTrue,
      );

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(searchActivations, 1);
      expect(tester.getSize(containerFinder), restingSize);

      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pumpAndSettle();
      expect(searchActivations, 2);
      expect(tester.getSize(containerFinder), restingSize);
      final activatedFocusDecoration =
          tester.widget<AnimatedContainer>(containerFinder).decoration
              as BoxDecoration;
      expect(activatedFocusDecoration.color, focusDecoration.color);
    },
  );

  for (final width in <double>[320, 360]) {
    testWidgets(
      'HistorySearchToolbar keeps all actions usable at ${width.toInt()}dp and 200 percent text',
      (tester) async {
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.binding.setSurfaceSize(Size(width, 640));
        var searchTaps = 0;
        var refreshTaps = 0;
        var syncTaps = 0;
        var clearTaps = 0;

        await tester.pumpWidget(
          MaterialApp(
            theme: ThemeData.light(),
            home: MediaQuery(
              data: MediaQueryData(
                size: Size(width, 640),
                textScaler: const TextScaler.linear(2),
              ),
              child: Scaffold(
                body: HistorySearchToolbar(
                  searchController: TextEditingController(),
                  searchOpen: false,
                  searchQuery: '',
                  searchHint: 'Search files',
                  connected: true,
                  connectedLabel: 'CONNECTED',
                  refreshTooltip: 'Refresh history',
                  clearSearchTooltip: 'Clear search',
                  onToggleSearch: () => searchTaps++,
                  onClearSearch: () {},
                  onSearchChanged: (_) {},
                  sortTooltip: 'Sort history',
                  sortItems: const <HistorySortMenuValue>[
                    HistorySortMenuValue(
                      label: 'Newest first',
                      iconName: 'schedule',
                      selected: true,
                      value: 'newest',
                    ),
                  ],
                  onSortSelected: (_) {},
                  onRefresh: () => refreshTaps++,
                  canClearHistory: true,
                  clearHistoryTooltip: 'Clear history',
                  onClearHistory: () => clearTaps++,
                  syncEnabled: true,
                  isSyncingNow: false,
                  syncTooltip: 'Sync history',
                  onSyncNow: () => syncTaps++,
                  cardColor: AirQrTheme.lightCard,
                  primaryColor: AirQrTheme.accentBlue,
                ),
              ),
            ),
          ),
        );
        await tester.pump();

        expect(tester.takeException(), isNull);
        final badge = tester.renderObject<RenderParagraph>(
          find.text('CONNECTED'),
        );
        expect(badge.didExceedMaxLines, isFalse);

        for (final tooltip in <String>[
          'Search files',
          'Sort history',
          'Refresh history',
          'Sync history',
          'Clear history',
        ]) {
          final action = find.byTooltip(tooltip);
          expect(action, findsOneWidget);
          expect(action.hitTestable(), findsOneWidget);
          final rect = tester.getRect(action);
          expect(rect.width, greaterThanOrEqualTo(36));
          expect(rect.height, greaterThanOrEqualTo(36));
          expect(rect.left, greaterThanOrEqualTo(0));
          expect(rect.right, lessThanOrEqualTo(width));
        }

        await tester.tap(find.byTooltip('Search files'));
        await tester.tap(find.byTooltip('Refresh history'));
        await tester.tap(find.byTooltip('Sync history'));
        await tester.tap(find.byTooltip('Clear history'));
        expect(searchTaps, 1);
        expect(refreshTaps, 1);
        expect(syncTaps, 1);
        expect(clearTaps, 1);
      },
    );
  }

  testWidgets('HistorySearchToolbar reveals search field only when open', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(),
        home: Scaffold(
          body: HistorySearchToolbar(
            searchController: TextEditingController(text: 'note'),
            searchOpen: true,
            searchQuery: 'note',
            searchHint: 'Search files...',
            connected: false,
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
            canClearHistory: false,
            clearHistoryTooltip: 'Clear history',
            onClearHistory: () {},
            syncEnabled: false,
            isSyncingNow: false,
            syncTooltip: 'Sync',
            onSyncNow: () {},
            cardColor: AirQrTheme.lightCard,
            primaryColor: AirQrTheme.accentBlue,
          ),
        ),
      ),
    );

    final textField = tester.widget<TextField>(find.byType(TextField));
    expect(textField.style?.color, AirQrTheme.lightTextPrimary);
    expect(find.text('note'), findsOneWidget);
  });

  testWidgets(
    'IncompleteHistoryCard shows decimal capped progress and server sync',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncompleteHistoryCard(
              scan: IncompleteScan(
                id: 'scan-1',
                startTimestamp: 1,
                lastUpdateTimestamp: 2,
                progress: 1.0,
                receivedPackets: 200,
                expectedPackets: 200,
                serverReceivedPackets: 120,
                serverExpectedPackets: 200,
              ),
              cardColor: const Color(0xFF101922),
              warningColor: const Color(0xFFf59e0b),
              displayName: 'Scan 1',
              packetsSummary: '200/200 packets',
              serverSyncSummary: 'Server sync: 120/200 packets',
              formattedDate: 'Today',
              onResume: () {},
              onDelete: () {},
            ),
          ),
        ),
      );

      expect(find.text('99.9%'), findsOneWidget);
      expect(find.textContaining('200/200 packets'), findsOneWidget);
      expect(
        find.textContaining('Server sync: 120/200 packets'),
        findsOneWidget,
      );
      expect(find.text('100%'), findsNothing);
      final percent = tester.widget<Text>(find.text('99.9%'));
      expect(percent.style?.fontFamily, 'Manrope');
      expect(
        percent.style?.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
      final packets = tester.widget<Text>(
        find.textContaining('200/200 packets').first,
      );
      expect(packets.style?.fontFamily, 'monospace');
      expect(
        packets.style?.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'play_arrow',
        ),
        findsOneWidget,
      );
      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'delete_outline',
        ),
        findsNothing,
      );
      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'delete',
        ),
        findsOneWidget,
      );
    },
  );

  for (final width in <double>[320, 360, 390]) {
    testWidgets(
      'incomplete history actions stay compact at ${width.toInt()}dp',
      (tester) async {
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.binding.setSurfaceSize(Size(width, 640));

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: IncompleteHistoryCard(
                  scan: IncompleteScan(
                    id: 'scan-$width',
                    startTimestamp: 1,
                    lastUpdateTimestamp: 2,
                    progress: 0.3,
                    receivedPackets: 30,
                    expectedPackets: 100,
                  ),
                  cardColor: const Color(0xFF101922),
                  warningColor: const Color(0xFFF59E0B),
                  displayName: 'Scan local',
                  packetsSummary: '30/100 packets',
                  formattedDate: 'Today',
                  onSync: () {},
                  onResume: () {},
                  onDelete: () {},
                ),
              ),
            ),
          ),
        );

        expect(tester.takeException(), isNull);
        final cardRect = tester.getRect(find.byType(Dismissible));
        final actionRects = find
            .byType(HistoryActionButton)
            .evaluate()
            .map((element) => tester.getRect(find.byWidget(element.widget)))
            .toList();
        expect(actionRects, hasLength(3));
        for (final rect in actionRects) {
          expect(rect.size, const Size.square(34));
          expect(rect.left, greaterThanOrEqualTo(cardRect.left));
          expect(rect.right, lessThanOrEqualTo(cardRect.right));
        }
        for (var index = 1; index < actionRects.length; index++) {
          expect(
            actionRects[index].left,
            closeTo(actionRects[index - 1].right, 0.01),
          );
        }
        final visualCircles = find
            .descendant(
              of: find.byType(HistoryActionButton),
              matching: find.byType(Container),
            )
            .evaluate()
            .map((element) => tester.getSize(find.byWidget(element.widget)))
            .where((size) => size == const Size.square(30));
        expect(visualCircles, hasLength(3));
      },
    );
  }

  testWidgets('IncompleteHistoryCard action buttons invoke callbacks', (
    tester,
  ) async {
    var syncCalled = false;
    var resumeCalled = false;
    var deleteCalled = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: IncompleteHistoryCard(
            scan: IncompleteScan(
              id: 'scan-local',
              startTimestamp: 1,
              lastUpdateTimestamp: 2,
              progress: 0.3,
              receivedPackets: 30,
              expectedPackets: 100,
            ),
            cardColor: const Color(0xFF101922),
            warningColor: const Color(0xFFf59e0b),
            displayName: 'Scan local',
            packetsSummary: '30/100 packets',
            formattedDate: 'Today',
            onSync: () => syncCalled = true,
            onResume: () => resumeCalled = true,
            onDelete: () => deleteCalled = true,
          ),
        ),
      ),
    );

    expect(
      tester
          .widgetList<HistoryActionButton>(find.byType(HistoryActionButton))
          .every((button) => button.dimension >= 34),
      isTrue,
    );
    final actionRects = find
        .byType(HistoryActionButton)
        .evaluate()
        .map((element) => tester.getRect(find.byWidget(element.widget)))
        .toList();
    for (var index = 1; index < actionRects.length; index++) {
      expect(
        actionRects[index].left,
        closeTo(actionRects[index - 1].right, 0.01),
        reason: 'compact incomplete action targets should have no extra gap',
      );
    }
    final visualCircles = find
        .descendant(
          of: find.byType(HistoryActionButton),
          matching: find.byType(Container),
        )
        .evaluate()
        .map((element) => tester.getSize(find.byWidget(element.widget)))
        .where((size) => size.width > 0 && size.height > 0);
    expect(
      visualCircles.where((size) => size == const Size.square(30)),
      hasLength(3),
    );
    expect(find.bySemanticsLabel('Sync to server'), findsOneWidget);
    expect(find.bySemanticsLabel('Resume scan'), findsOneWidget);
    expect(find.bySemanticsLabel('Delete incomplete scan'), findsOneWidget);
    for (final label in <String>[
      'Sync to server',
      'Resume scan',
      'Delete incomplete scan',
    ]) {
      expect(
        tester
            .getSemantics(find.bySemanticsLabel(label))
            .getSemanticsData()
            .hasAction(SemanticsAction.tap),
        isTrue,
      );
    }

    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is AirQrIcon &&
            widget.name == 'cloud_upload' &&
            widget.color == Colors.white,
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'cloud_off',
      ),
      findsNothing,
    );

    final syncLeft = tester
        .getTopLeft(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'cloud_upload',
          ),
        )
        .dx;
    final playLeft = tester
        .getTopLeft(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'play_arrow',
          ),
        )
        .dx;
    final deleteLeft = tester
        .getTopLeft(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'delete',
          ),
        )
        .dx;

    expect(syncLeft, lessThan(playLeft));
    expect(playLeft, lessThan(deleteLeft));

    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'cloud_upload',
      ),
    );
    await tester.pump();
    expect(syncCalled, isTrue);
    expect(resumeCalled, isFalse);
    expect(deleteCalled, isFalse);

    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'play_arrow',
      ),
    );
    await tester.pump();
    expect(resumeCalled, isTrue);

    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'delete',
      ),
    );
    await tester.pump();
    expect(deleteCalled, isTrue);
  });

  testWidgets(
    'IncompleteHistoryCard shows keep-local action for remote scans',
    (tester) async {
      var keepLocalCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: IncompleteHistoryCard(
              scan: IncompleteScan(
                id: 'scan-remote',
                startTimestamp: 1,
                lastUpdateTimestamp: 2,
                progress: 0.3,
                receivedPackets: 30,
                expectedPackets: 100,
                isRemote: true,
              ),
              cardColor: const Color(0xFF101922),
              warningColor: const Color(0xFFf59e0b),
              displayName: 'Scan remote',
              packetsSummary: '30/100 packets',
              formattedDate: 'Today',
              onKeepLocal: () => keepLocalCalled = true,
              onResume: () {},
              onDelete: () {},
            ),
          ),
        ),
      );

      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'cloud_off',
        ),
        findsOneWidget,
      );
      expect(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'cloud_upload',
        ),
        findsNothing,
      );

      await tester.tap(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'cloud_off',
        ),
      );
      await tester.pump();
      expect(keepLocalCalled, isTrue);
    },
  );

  testWidgets('CompletedHistoryCard mirrors web history action icons', (
    tester,
  ) async {
    final file = File('${Directory.systemTemp.path}/airqr-history-icon.png');
    file.writeAsBytesSync([0, 1, 2]);
    addTearDown(() {
      if (file.existsSync()) file.deleteSync();
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CompletedHistoryCard(
            item: HistoryItem(
              path: file.path,
              timestamp: 1,
              size: 3,
              mimeType: 'image/png',
              isSynced: true,
            ),
            cardColor: const Color(0xFF101922),
            successColor: Colors.green,
            subtitle: 'Today - 3 B',
            onView: () {},
            onKeepLocal: () {},
            onSync: () {},
            onSave: () {},
            onDelete: () {},
            onDismissed: () {},
          ),
        ),
      ),
    );

    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'description',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'download',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'visibility',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'cloud_off',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'cloud_upload',
      ),
      findsNothing,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'delete',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'insert_drive_file',
      ),
      findsNothing,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'delete_outline',
      ),
      findsNothing,
    );
    expect(
      find.byWidgetPredicate(
        (widget) =>
            widget is AirQrIcon &&
            widget.name == 'download' &&
            widget.size == 14,
      ),
      findsOneWidget,
    );
    final visibilityLeft = tester
        .getTopLeft(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'visibility',
          ),
        )
        .dx;
    final cloudOffLeft = tester
        .getTopLeft(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'cloud_off',
          ),
        )
        .dx;
    final downloadLeft = tester
        .getTopLeft(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'download',
          ),
        )
        .dx;
    final deleteLeft = tester
        .getTopLeft(
          find.byWidgetPredicate(
            (widget) => widget is AirQrIcon && widget.name == 'delete',
          ),
        )
        .dx;

    expect(visibilityLeft, lessThan(cloudOffLeft));
    expect(cloudOffLeft, lessThan(downloadLeft));
    expect(downloadLeft, lessThan(deleteLeft));
  });

  testWidgets('CompletedHistoryCard renders remote metadata sentinel safely', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CompletedHistoryCard(
            item: HistoryItem(
              path: 'airqr-remote://remote-id/note.txt',
              timestamp: 1,
              size: 4,
              mimeType: 'text/plain',
              isSynced: true,
              serverId: 'remote-id',
            ),
            cardColor: const Color(0xFF101922),
            successColor: Colors.green,
            subtitle: 'Today - 4 B',
            onView: () {},
            onKeepLocal: () {},
            onSync: null,
            onSave: () {},
            onDelete: () {},
            onDismissed: () {},
          ),
        ),
      ),
    );

    expect(find.text('note.txt'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('CompletedHistoryCard action buttons invoke callbacks', (
    tester,
  ) async {
    final file = File('${Directory.systemTemp.path}/airqr-history-actions.png');
    file.writeAsBytesSync([0, 1, 2]);
    addTearDown(() {
      if (file.existsSync()) file.deleteSync();
    });

    var viewCalled = false;
    var keepLocalCalled = false;
    var downloadCalled = false;
    var deleteCalled = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: CompletedHistoryCard(
            item: HistoryItem(
              path: file.path,
              timestamp: 1,
              size: 3,
              mimeType: 'image/png',
              isSynced: true,
            ),
            cardColor: const Color(0xFF101922),
            successColor: Colors.green,
            subtitle: 'Today - 3 B',
            onView: () => viewCalled = true,
            onKeepLocal: () => keepLocalCalled = true,
            onSync: () {},
            onSave: () => downloadCalled = true,
            onDelete: () => deleteCalled = true,
            onDismissed: () {},
          ),
        ),
      ),
    );

    expect(
      tester
          .widgetList<HistoryActionButton>(find.byType(HistoryActionButton))
          .every((button) => button.dimension >= 34),
      isTrue,
    );
    expect(find.bySemanticsLabel('Open'), findsOneWidget);
    expect(find.bySemanticsLabel('Keep local'), findsOneWidget);
    expect(find.bySemanticsLabel('Download'), findsOneWidget);
    expect(find.bySemanticsLabel('Delete'), findsOneWidget);
    for (final label in <String>['Open', 'Keep local', 'Download', 'Delete']) {
      expect(
        tester
            .getSemantics(find.bySemanticsLabel(label))
            .getSemanticsData()
            .hasAction(SemanticsAction.tap),
        isTrue,
      );
    }

    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'visibility',
      ),
    );
    await tester.pump();
    expect(viewCalled, isTrue);

    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'cloud_off',
      ),
    );
    await tester.pump();
    expect(keepLocalCalled, isTrue);

    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'download',
      ),
    );
    await tester.pump();
    expect(downloadCalled, isTrue);

    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'delete',
      ),
    );
    await tester.pump();
    expect(deleteCalled, isTrue);
  });

  test(
    'history action aliases use native Lucide glyphs like toolbar actions',
    () {
      expect(airQrLucideIconAliases['visibility'], 'eye');
      expect(airQrLucideIconAliases['cloud_off'], 'cloud-off');
      expect(airQrLucideIconAliases['cloud_upload'], 'cloud-upload');
      expect(airQrLucideIconAliases['download'], 'download');
      expect(airQrLucideIconAliases['delete'], 'trash-2');
    },
  );
}

void _noopFilter(String _) {}
