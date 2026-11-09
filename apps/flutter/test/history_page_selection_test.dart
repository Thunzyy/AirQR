import 'dart:io';

import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_page.dart';
import 'package:airqr_mobile/history_page_actions.dart';
import 'package:airqr_mobile/history_page_refresh.dart';
import 'package:airqr_mobile/history_page_widgets.dart';
import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:archive/archive.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  group('tab counters', () {
    testWidgets('count what each tab shows and follow the search query', (
      tester,
    ) async {
      final controller = _MutableRefreshController(
        items: <HistoryItem>[
          _item('alpha.bin', origin: 'scanned', timestamp: 3),
          _item('bravo.bin', origin: 'scanned', timestamp: 2),
          _item('zeta.gif', origin: 'generated', timestamp: 1),
        ],
        scans: <IncompleteScan>[_scan('partial-scan', filename: 'Partial')],
      );
      await tester.pumpWidget(_app(controller));
      await tester.pumpAndSettle();

      expect(_tabCounts(tester), <String?>['4', '3', '1']);

      await tester.tap(find.byTooltip('Search files...'));
      await tester.pump();
      await tester.enterText(find.byType(TextField), 'alpha');
      await tester.pump();
      expect(_tabCounts(tester), <String?>['1', '1', '0']);

      await tester.enterText(find.byType(TextField), 'partial');
      await tester.pump();
      expect(_tabCounts(tester), <String?>['1', '1', '0']);
    });
  });

  group('selection mode', () {
    testWidgets('long press enters selection and taps toggle items', (
      tester,
    ) async {
      final controller = _threeItemsAndScan();
      await tester.pumpWidget(_app(controller));
      await tester.pumpAndSettle();

      await tester.longPress(find.text('alpha.bin'));
      await tester.pumpAndSettle();
      expect(find.byType(HistorySelectionBar), findsOneWidget);
      expect(find.byType(HistorySearchToolbar), findsNothing);
      expect(find.text('1 selected'), findsOneWidget);
      expect(find.byType(HistorySelectionCheckbox), findsNWidgets(4));
      expect(find.byType(Dismissible), findsNothing);

      await tester.tap(find.text('bravo.bin'));
      await tester.pump();
      expect(find.text('2 selected'), findsOneWidget);

      await tester.tap(find.text('alpha.bin'));
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);

      await tester.tap(find.text('Select all'));
      await tester.pump();
      expect(find.text('4 selected'), findsOneWidget);
      expect(find.text('Deselect all'), findsOneWidget);

      await tester.tap(find.text('Deselect all'));
      await tester.pump();
      expect(find.text('0 selected'), findsOneWidget);

      await tester.tap(find.byTooltip('Exit selection'));
      await tester.pump();
      expect(find.byType(HistorySelectionBar), findsNothing);
      expect(find.byType(HistorySearchToolbar), findsOneWidget);
      expect(find.byType(HistorySelectionCheckbox), findsNothing);
    });

    testWidgets('tapping an incomplete scan in selection mode never resumes', (
      tester,
    ) async {
      final resumed = <String>[];
      await tester.pumpWidget(
        _app(_threeItemsAndScan(), onResumeRequested: resumed.add),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Select'));
      await tester.pump();
      expect(find.text('0 selected'), findsOneWidget);
      await tester.tap(find.text('Partial'));
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);
      expect(resumed, isEmpty);
    });

    testWidgets('select all only covers the current filter and search', (
      tester,
    ) async {
      await tester.pumpWidget(_app(_threeItemsAndScan()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Generated'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Select'));
      await tester.pump();
      await tester.tap(find.text('Select all'));
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);
    });

    testWidgets('changing filter tab exits selection and clears it', (
      tester,
    ) async {
      await tester.pumpWidget(_app(_threeItemsAndScan()));
      await tester.pumpAndSettle();

      await tester.longPress(find.text('alpha.bin'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Scanned'));
      await tester.pumpAndSettle();
      expect(find.byType(HistorySelectionBar), findsNothing);

      await tester.tap(find.byTooltip('Select'));
      await tester.pump();
      expect(find.text('0 selected'), findsOneWidget);
    });

    testWidgets('selection is pruned when items disappear after refresh', (
      tester,
    ) async {
      final controller = _threeItemsAndScan();
      await tester.pumpWidget(
        _app(controller, refreshInterval: const Duration(milliseconds: 100)),
      );
      await tester.pump();
      await tester.pump();

      await tester.longPress(find.text('alpha.bin'));
      await tester.pump(const Duration(milliseconds: 10));
      await tester.tap(find.text('bravo.bin'));
      await tester.pump();
      await tester.tap(find.text('Partial'));
      await tester.pump();
      expect(find.text('3 selected'), findsOneWidget);

      controller.items = <HistoryItem>[
        _item('bravo.bin', origin: 'scanned', timestamp: 2),
      ];
      controller.scans = const <IncompleteScan>[];
      await tester.pump(const Duration(milliseconds: 120));
      await tester.pump();
      expect(find.text('1 selected'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  });

  group('bulk actions', () {
    testWidgets('delete confirms once and deletes every selected entry', (
      tester,
    ) async {
      final actions = _FakeActions(serverDeleteFails: true);
      await tester.pumpWidget(_app(_threeItemsAndScan(), actions: actions));
      await tester.pumpAndSettle();

      await tester.longPress(find.text('alpha.bin'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('zeta.gif'));
      await tester.tap(find.text('Partial'));
      await tester.pump();

      await tester.tap(find.byTooltip('Delete'));
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(find.text('Delete 3 items?'), findsOneWidget);
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text('Delete'),
        ),
      );
      await tester.pumpAndSettle();

      expect(actions.deletedPaths, <String>['alpha.bin', 'zeta.gif']);
      expect(actions.deletedScanIds, <String>['partial-scan']);
      expect(find.text('alpha.bin'), findsNothing);
      expect(find.text('zeta.gif'), findsNothing);
      expect(find.text('Partial'), findsNothing);
      expect(find.text('bravo.bin'), findsOneWidget);
      expect(find.byType(HistorySelectionBar), findsNothing);
      expect(find.text('3 items deleted'), findsOneWidget);

      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('Failed to delete on server.'), findsOneWidget);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('Failed to delete on server.'), findsNothing);
    });

    testWidgets('cancelling the bulk delete keeps everything selected', (
      tester,
    ) async {
      final actions = _FakeActions();
      await tester.pumpWidget(_app(_threeItemsAndScan(), actions: actions));
      await tester.pumpAndSettle();

      await tester.longPress(find.text('alpha.bin'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Delete'));
      await tester.pumpAndSettle();
      expect(find.text('Delete 1 item?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(actions.deletedPaths, isEmpty);
      expect(find.text('1 selected'), findsOneWidget);
    });

    testWidgets('delete and download are disabled with nothing selected', (
      tester,
    ) async {
      await tester.pumpWidget(_app(_threeItemsAndScan()));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Select'));
      await tester.pump();

      for (final tooltip in <String>['Delete', 'Download']) {
        final button = tester.widget<IconButton>(
          find.ancestor(
            of: find.byTooltip(tooltip),
            matching: find.byType(IconButton),
          ),
        );
        expect(button.onPressed, isNull, reason: tooltip);
      }
    });

    testWidgets('only incomplete scans selected hides file actions', (
      tester,
    ) async {
      await tester.pumpWidget(_app(_threeItemsAndScan()));
      await tester.pumpAndSettle();
      await tester.longPress(find.text('Partial'));
      await tester.pumpAndSettle();

      expect(find.text('1 selected'), findsOneWidget);
      expect(find.byTooltip('Delete'), findsOneWidget);
      expect(find.byTooltip('Download'), findsNothing);
      expect(find.byTooltip('Sync local history to server'), findsNothing);
      expect(find.byTooltip('Keep local'), findsNothing);
    });

    testWidgets('sync shows for local-only items and syncs only those', (
      tester,
    ) async {
      final actions = _FakeActions();
      await tester.pumpWidget(_app(_threeItemsAndScan(), actions: actions));
      await tester.pumpAndSettle();

      await tester.longPress(find.text('zeta.gif'));
      await tester.pumpAndSettle();
      expect(find.byTooltip('Sync local history to server'), findsNothing);
      expect(find.byTooltip('Keep local'), findsOneWidget);

      await tester.tap(find.text('bravo.bin'));
      await tester.pump();
      expect(find.byTooltip('Sync local history to server'), findsOneWidget);

      await tester.tap(find.byTooltip('Sync local history to server'));
      await tester.pumpAndSettle();
      expect(actions.syncedPaths, <String>['bravo.bin']);
      expect(find.byType(HistorySelectionBar), findsNothing);
      expect(find.text('1 item queued for sync'), findsOneWidget);
    });

    testWidgets('keep local runs only for synced items', (tester) async {
      final actions = _FakeActions();
      await tester.pumpWidget(_app(_threeItemsAndScan(), actions: actions));
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Select'));
      await tester.pump();
      await tester.tap(find.text('Select all'));
      await tester.pump();
      await tester.tap(find.byTooltip('Keep local'));
      await tester.pumpAndSettle();

      expect(actions.keptLocalPaths, <String>['zeta.gif']);
      expect(find.text('1 item now stored locally only'), findsOneWidget);
    });

    testWidgets('download of one item uses the single-file save path', (
      tester,
    ) async {
      final saved = <String>[];
      await tester.pumpWidget(
        _app(
          _threeItemsAndScan(),
          fileSaver: (path) async {
            saved.add(path);
          },
        ),
      );
      await tester.pumpAndSettle();

      await tester.longPress(find.text('alpha.bin'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Partial'));
      await tester.pump();
      await tester.tap(find.byTooltip('Download'));
      await tester.pumpAndSettle();

      expect(saved, <String>['alpha.bin']);
    });

    testWidgets('download of several items saves one zip archive', (
      tester,
    ) async {
      final dir = Directory(
        '${Directory.systemTemp.path}/airqr-bulk-${DateTime.now().microsecondsSinceEpoch}',
      )..createSync();
      addTearDown(() => dir.deleteSync(recursive: true));
      final a = Directory(p.join(dir.path, 'a'))..createSync();
      final b = Directory(p.join(dir.path, 'b'))..createSync();
      final first = File(p.join(a.path, 'same.txt'))..writeAsStringSync('A');
      final second = File(p.join(b.path, 'same.txt'))..writeAsStringSync('B');
      final controller = _MutableRefreshController(
        items: <HistoryItem>[
          _item(first.path, origin: 'scanned', timestamp: 2),
          _item(second.path, origin: 'scanned', timestamp: 1),
        ],
        scans: <IncompleteScan>[_scan('partial-scan', filename: 'Partial')],
      );
      String? savedName;
      List<String>? entryNames;
      await tester.pumpWidget(
        _app(
          controller,
          fileSaver: (path) async {
            savedName = p.basename(path);
            final archive = ZipDecoder().decodeBytes(
              File(path).readAsBytesSync(),
            );
            entryNames = archive.files.map((file) => file.name).toList();
          },
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byTooltip('Select'));
      await tester.pump();
      await tester.tap(find.text('Select all'));
      await tester.pump();
      await tester.tap(find.byTooltip('Download'));
      for (var i = 0; i < 50 && savedName == null; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump();
      }

      expect(savedName, matches(RegExp(r'^airqr-history-\d{8}-\d{4}\.zip$')));
      expect(entryNames, unorderedEquals(<String>['same.txt', 'same (2).txt']));
    });
  });
}

Widget _app(
  HistoryPageRefreshController controller, {
  HistoryPageActions? actions,
  Future<void> Function(String path)? fileSaver,
  void Function(String scanId)? onResumeRequested,
  Duration refreshInterval = const Duration(hours: 1),
}) => MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: HistoryPage(
    isActive: true,
    refreshController: controller,
    refreshInterval: refreshInterval,
    actions: actions,
    fileSaver: fileSaver,
    onResumeRequested: onResumeRequested,
  ),
);

List<String?> _tabCounts(WidgetTester tester) => <String?>[
  for (final filter in <String>['all', 'scanned', 'generated'])
    tester
        .widget<Text>(find.byKey(ValueKey('history_filter_count_$filter')))
        .data,
];

_MutableRefreshController _threeItemsAndScan() => _MutableRefreshController(
  items: <HistoryItem>[
    _item('alpha.bin', origin: 'scanned', timestamp: 3),
    _item('bravo.bin', origin: 'scanned', timestamp: 2, isLocalOnly: true),
    _item('zeta.gif', origin: 'generated', timestamp: 1, isSynced: true),
  ],
  scans: <IncompleteScan>[_scan('partial-scan', filename: 'Partial')],
);

HistoryItem _item(
  String path, {
  required String origin,
  required int timestamp,
  bool isSynced = false,
  bool isLocalOnly = false,
}) => HistoryItem(
  path: path,
  timestamp: timestamp,
  size: 1,
  origin: origin,
  isSynced: isSynced,
  isLocalOnly: isLocalOnly,
);

IncompleteScan _scan(String id, {String? filename}) => IncompleteScan(
  id: id,
  startTimestamp: 1,
  lastUpdateTimestamp: 2,
  progress: 0.25,
  receivedPackets: 1,
  expectedPackets: 4,
  filename: filename,
);

class _MutableRefreshController extends HistoryPageRefreshController {
  List<HistoryItem> items;
  List<IncompleteScan> scans;

  _MutableRefreshController({required this.items, required this.scans});

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async =>
      HistoryPageSnapshot(
        items: List<HistoryItem>.of(items),
        incompleteScans: List<IncompleteScan>.of(scans),
        syncEnabled: false,
      );
}

class _FakeActions extends HistoryPageActions {
  final bool serverDeleteFails;
  final deletedPaths = <String>[];
  final deletedScanIds = <String>[];
  final syncedPaths = <String>[];
  final keptLocalPaths = <String>[];

  _FakeActions({this.serverDeleteFails = false});

  @override
  Future<HistoryDeleteResult> deleteHistoryItem(HistoryItem? item) async {
    if (item != null) deletedPaths.add(item.path);
    return HistoryDeleteResult(
      shouldShowServerDeleteFailure: serverDeleteFails,
    );
  }

  @override
  Future<HistoryDeleteResult> deleteIncompleteScan(
    IncompleteScan? scan, {
    required bool syncEnabled,
  }) async {
    if (scan != null) deletedScanIds.add(scan.id);
    return HistoryDeleteResult(
      shouldShowServerDeleteFailure: serverDeleteFails,
    );
  }

  @override
  Future<HistorySyncItemResult> syncItem(HistoryItem item) async {
    syncedPaths.add(item.path);
    return HistorySyncItemResult.queued(p.basename(item.path));
  }

  @override
  Future<HistoryKeepLocalResult> keepLocal(String path) async {
    keptLocalPaths.add(path);
    return HistoryKeepLocalResult(fileName: p.basename(path));
  }
}
