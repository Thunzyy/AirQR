import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_page.dart';
import 'package:airqr_mobile/history_page_refresh.dart';
import 'package:airqr_mobile/history_page_widgets.dart';
import 'package:airqr_mobile/history_service.dart';
import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('HistoryPage renders compact search and refresh controls', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const HistoryPage(),
      ),
    );
    await tester.pump();

    expect(find.byType(TextField), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'search',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'refresh',
      ),
      findsOneWidget,
    );

    await tester.tap(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'search',
      ),
    );
    await tester.pump();

    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets('Refresh reloads metadata while Sync explicitly forces sync', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _RecordingRefreshController();

    await tester.pumpWidget(_historyApp(controller));
    await tester.pumpAndSettle();
    expect(controller.forceSyncCalls, <bool>[false]);

    await tester.tap(find.byTooltip('Refresh'));
    await tester.pumpAndSettle();
    expect(controller.forceSyncCalls, <bool>[false, false]);

    await tester.tap(find.byTooltip('Sync local history to server'));
    await tester.pumpAndSettle();
    expect(controller.forceSyncCalls, <bool>[false, false, true]);
  });

  testWidgets(
    'search filters incomplete scans by filename session id and formatted date',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final timestamp = DateTime.parse(
        '2026-07-02T23:30:00Z',
      ).millisecondsSinceEpoch;
      final controller = _MixedSnapshotRefreshController(
        items: const <HistoryItem>[],
        incompleteScans: <IncompleteScan>[
          IncompleteScan(
            id: 'session-ALPHA-42',
            startTimestamp: timestamp - 1000,
            lastUpdateTimestamp: timestamp,
            progress: 0.25,
            receivedPackets: 25,
            expectedPackets: 100,
            filename: 'Quarterly Report.pdf',
          ),
        ],
      );

      await tester.pumpWidget(_historyApp(controller));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byWidgetPredicate(
          (widget) => widget is AirQrIcon && widget.name == 'search',
        ),
      );
      await tester.pump();

      Future<void> searchFor(String query) async {
        await tester.enterText(find.byType(TextField), query);
        await tester.pump();
      }

      await searchFor('no-match');
      expect(find.byType(IncompleteHistoryCard), findsNothing);
      expect(find.byType(HistoryEmptyState), findsOneWidget);

      for (final query in <String>[
        'QUARTERLY REPORT',
        'alpha-42',
        'JUL 3, 2026',
        '2026-07-02',
      ]) {
        await searchFor(query);
        expect(
          find.byType(IncompleteHistoryCard),
          findsOneWidget,
          reason: 'query "$query" should match the incomplete scan',
        );
      }

      await tester.tap(find.text('Generated'));
      await tester.pump();
      expect(find.byType(IncompleteHistoryCard), findsNothing);
    },
  );

  testWidgets(
    'inactive history does not refresh until activated and stops again',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final controller = _CountingRefreshController();
      var active = false;
      late StateSetter setHostState;

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: StatefulBuilder(
            builder: (context, setState) {
              setHostState = setState;
              return HistoryPage(
                isActive: active,
                refreshController: controller,
                refreshInterval: const Duration(milliseconds: 100),
              );
            },
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 250));
      expect(controller.calls, 0);

      setHostState(() => active = true);
      await tester.pump();
      expect(controller.calls, 1);
      await tester.pump(const Duration(milliseconds: 110));
      expect(controller.calls, 2);

      setHostState(() => active = false);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 250));
      expect(controller.calls, 2);

      setHostState(() => active = true);
      await tester.pump();
      expect(controller.calls, 3);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump(const Duration(milliseconds: 250));
      expect(controller.calls, 3);
    },
  );

  testWidgets('history refreshes never overlap', (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _BlockingRefreshController();

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: HistoryPage(
          isActive: true,
          refreshController: controller,
          refreshInterval: const Duration(milliseconds: 50),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 160));
    expect(controller.calls, 1);

    controller.complete();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 60));
    expect(controller.calls, 2);
  });

  testWidgets(
    'queued forced refresh keeps syncing until forced work completes',
    (tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final controller = _SequencedRefreshController();

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: HistoryPage(
            isActive: true,
            refreshController: controller,
            refreshInterval: const Duration(seconds: 1),
          ),
        ),
      );
      await tester.pump();
      expect(controller.forceSyncCalls, <bool>[false]);

      await tester.pump(const Duration(seconds: 1));
      expect(controller.forceSyncCalls, <bool>[false, false]);
      await tester.tap(find.byTooltip('Sync local history to server'));
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      controller.completeNormal();
      await tester.pump();
      expect(controller.forceSyncCalls, <bool>[false, false, true]);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);

      controller.completeForced();
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsNothing);
    },
  );

  testWidgets('history periodic refresh pauses outside resumed lifecycle', (
    tester,
  ) async {
    addTearDown(
      () => tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      ),
    );
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _CountingRefreshController();
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: HistoryPage(
          isActive: true,
          refreshController: controller,
          refreshInterval: const Duration(milliseconds: 50),
        ),
      ),
    );
    await tester.pump();
    expect(controller.calls, 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump(const Duration(milliseconds: 120));
    expect(controller.calls, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    await tester.pump(const Duration(milliseconds: 120));
    expect(controller.calls, 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(controller.calls, 2);
    await tester.pump(const Duration(milliseconds: 60));
    expect(controller.calls, 3);
  });

  testWidgets('hidden lifecycle rejects an in-flight history snapshot', (
    tester,
  ) async {
    addTearDown(
      () => tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      ),
    );
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _LifecycleBlockingRefreshController();
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: HistoryPage(isActive: true, refreshController: controller),
      ),
    );
    await tester.pump();
    expect(controller.calls, 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    controller.complete(0, 'stale-hidden.txt');
    await tester.pump();

    expect(find.text('stale-hidden.txt'), findsNothing);
    expect(find.byType(Dismissible), findsNothing);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(controller.calls, 2);
    controller.complete(1, 'fresh-after-hidden.txt');
    await tester.pump();
    await tester.pump();
    expect(find.text('stale-hidden.txt'), findsNothing);
    expect(find.text('fresh-after-hidden.txt'), findsOneWidget);
  });

  testWidgets('resumed history applies only the refresh after a stale one', (
    tester,
  ) async {
    addTearDown(
      () => tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      ),
    );
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _LifecycleBlockingRefreshController();
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: HistoryPage(isActive: true, refreshController: controller),
      ),
    );
    await tester.pump();
    expect(controller.calls, 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(controller.calls, 1);

    controller.complete(0, 'stale-before-resume.txt');
    await tester.pump();
    await tester.pump();
    expect(controller.calls, 2);
    expect(find.text('stale-before-resume.txt'), findsNothing);

    controller.complete(1, 'fresh-after-resume.txt');
    await tester.pump();
    await tester.pump();
    expect(find.text('fresh-after-resume.txt'), findsOneWidget);
  });

  testWidgets('long history lazily builds only visible cards', (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final items = List<HistoryItem>.generate(
      200,
      (index) => HistoryItem(
        path: 'missing-$index.bin',
        timestamp: 200 - index,
        size: index,
        origin: 'scanned',
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: HistoryPage(
          isActive: true,
          refreshController: _SnapshotRefreshController(items),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(Dismissible), findsWidgets);
    expect(find.byType(Dismissible).evaluate().length, lessThan(30));
  });

  testWidgets('history card action labels follow the French locale', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('fr'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: HistoryPage(
          isActive: true,
          refreshController: _SnapshotRefreshController(<HistoryItem>[
            HistoryItem(
              path: 'missing-fr.png',
              timestamp: 1,
              size: 1,
              origin: 'scanned',
              mimeType: 'image/png',
              isSynced: true,
            ),
          ]),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.bySemanticsLabel('Ouvrir'), findsOneWidget);
    expect(find.bySemanticsLabel('Conserver en local'), findsOneWidget);
    expect(find.bySemanticsLabel('Télécharger'), findsOneWidget);
    expect(find.bySemanticsLabel('Supprimer'), findsOneWidget);
    await tester.tap(find.byTooltip('Trier'));
    await tester.pumpAndSettle();
    expect(find.text('Plus récent'), findsOneWidget);
    expect(find.byTooltip('Effacer l’historique'), findsOneWidget);
  });

  testWidgets('remote-only open materializes before reading the file', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final directory = Directory(
      '${Directory.systemTemp.path}/airqr-open-${DateTime.now().microsecondsSinceEpoch}',
    )..createSync();
    addTearDown(() => directory.deleteSync(recursive: true));
    final localFile = File('${directory.path}/note.txt');
    localFile.writeAsStringSync('materialized content');
    final controller = _MaterializingRefreshController(
      _remoteItem('open-id'),
      _localItem(localFile.path, 'open-id'),
    );

    await tester.pumpWidget(_historyApp(controller));
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Open'));
    await tester.pumpAndSettle();

    expect(controller.materializeCalls, 1);
  });

  testWidgets('history note preview stays inline with icon-only actions', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final directory = Directory(
      '${Directory.systemTemp.path}/airqr-note-preview-${DateTime.now().microsecondsSinceEpoch}',
    )..createSync();
    addTearDown(() => directory.deleteSync(recursive: true));
    final localFile = File('${directory.path}/note.txt');
    localFile.writeAsStringSync('first line\nsecond line');

    await tester.pumpWidget(
      _historyApp(
        _SnapshotRefreshController(<HistoryItem>[
          HistoryItem(
            path: localFile.path,
            timestamp: 1,
            size: localFile.lengthSync(),
            origin: 'generated',
            mimeType: 'text/plain',
          ),
        ]),
      ),
    );
    await tester.pumpAndSettle();
    final onView = tester
        .widget<CompletedHistoryCard>(find.byType(CompletedHistoryCard))
        .onView!;
    await tester.runAsync(() async {
      onView();
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pump();

    expect(find.byKey(const Key('note_view')), findsOneWidget);
    expect(find.byTooltip('Copy'), findsOneWidget);
    expect(find.byTooltip('Download'), findsOneWidget);
    expect(find.text('Copy'), findsNothing);
    expect(find.text('Download'), findsNothing);
    final expectedFooterDate = DateFormat(
      'yyyy-MM-dd - HH:mm',
    ).format(DateTime.fromMillisecondsSinceEpoch(1));
    final expectedFooterSize = '${localFile.lengthSync()} B';
    expect(find.text(expectedFooterDate), findsOneWidget);
    expect(find.text(expectedFooterSize), findsOneWidget);
    expect(
      tester.getCenter(find.byKey(const Key('note_view_line_count'))).dy,
      closeTo(
        tester.getCenter(find.byKey(const Key('note_view_footer_metadata'))).dy,
        0.01,
      ),
    );
    final footerMetadata = tester.widget<Row>(
      find.byKey(const Key('note_view_footer_metadata')),
    );
    final footerDate = tester.widget<Text>(
      find.byKey(const Key('note_view_footer_date')),
    );
    final footerSize = tester.widget<Text>(
      find.byKey(const Key('note_view_footer_size')),
    );
    expect(footerMetadata.children[0], isA<Flexible>());
    expect(footerMetadata.children[2].key, const Key('note_view_footer_size'));
    expect(footerDate.style?.fontSize, 12);
    expect(footerDate.textAlign, TextAlign.right);
    expect(footerDate.maxLines, 1);
    expect(footerSize.style?.fontSize, 12);
    expect(footerSize.maxLines, 1);
    expect(
      Navigator.of(tester.element(find.byKey(const Key('note_view')))).canPop(),
      isFalse,
    );

    await tester.tap(find.byTooltip('Back'));
    await tester.pump();
    expect(find.byKey(const Key('note_view')), findsNothing);
    expect(find.text('note.txt'), findsOneWidget);
  });

  testWidgets('remote-only download materializes before saving', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    String? savedPath;
    final controller = _MaterializingRefreshController(
      _remoteItem('save-id'),
      _localItem('C:/safe/materialized.txt', 'save-id'),
    );

    await tester.pumpWidget(
      _historyApp(
        controller,
        fileSaver: (path) async {
          savedPath = path;
        },
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Download'));
    await tester.pump();

    expect(controller.materializeCalls, 1);
    expect(savedPath, 'C:/safe/materialized.txt');
  });

  testWidgets('remote-only keep local materializes before marking local', (
    tester,
  ) async {
    final directory = Directory(
      '${Directory.systemTemp.path}/airqr-keep-${DateTime.now().microsecondsSinceEpoch}',
    )..createSync();
    addTearDown(() => directory.deleteSync(recursive: true));
    final localFile = File('${directory.path}/kept.txt');
    localFile.writeAsStringSync('kept');
    final local = _localItem(localFile.path, 'keep-id');
    SharedPreferences.setMockInitialValues(<String, Object>{
      'airqr_history': jsonEncode(<Map<String, dynamic>>[local.toJson()]),
    });
    final controller = _MaterializingRefreshController(
      _remoteItem('keep-id'),
      local,
    );

    await tester.pumpWidget(_historyApp(controller));
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsLabel('Keep local'));
    await tester.pumpAndSettle();

    expect(controller.materializeCalls, 1);
    expect((await HistoryService.getHistory()).single.isLocalOnly, isTrue);
  });

  testWidgets('history sections use compact web-equivalent vertical gaps', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final controller = _MixedSnapshotRefreshController(
      items: <HistoryItem>[
        _remoteItemAt('first-day', DateTime(2026, 7, 3)),
        _remoteItemAt('second-day', DateTime(2026, 7, 2)),
      ],
      incompleteScans: <IncompleteScan>[
        IncompleteScan(
          id: 'incomplete-gap',
          startTimestamp: 1,
          lastUpdateTimestamp: 2,
          progress: 0.25,
          receivedPackets: 25,
          expectedPackets: 100,
        ),
      ],
    );

    await tester.pumpWidget(_historyApp(controller));
    await tester.pumpAndSettle();

    final headers = find.byType(HistorySectionHeader);
    final incompleteCard = find.byType(IncompleteHistoryCard);
    final completedCards = find.byType(CompletedHistoryCard);
    expect(headers, findsNWidgets(3));
    expect(incompleteCard, findsOneWidget);
    expect(completedCards, findsNWidgets(2));

    expect(
      tester.getTopLeft(incompleteCard).dy -
          tester.getBottomLeft(headers.at(0)).dy,
      4,
    );
    expect(
      tester.getTopLeft(headers.at(1)).dy -
          tester.getBottomLeft(incompleteCard).dy,
      12,
    );
    expect(
      tester.getTopLeft(completedCards.at(0)).dy -
          tester.getBottomLeft(headers.at(1)).dy,
      4,
    );
    expect(
      tester.getTopLeft(headers.at(2)).dy -
          tester.getBottomLeft(completedCards.at(0)).dy,
      8,
    );
  });

  testWidgets('disposed page ignores delayed remote materialization', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    var saved = false;
    final controller = _DelayedMaterializingRefreshController(
      _remoteItem('delayed-id'),
    );

    await tester.pumpWidget(
      _historyApp(
        controller,
        fileSaver: (_) async {
          saved = true;
        },
      ),
    );
    await tester.pump();
    await tester.pump();
    await tester.tap(find.bySemanticsLabel('Download'));
    await tester.pump();
    expect(controller.materializeCalls, 1);

    await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
    controller.complete(_localItem('C:/safe/delayed.txt', 'delayed-id'));
    await tester.pump();
    await tester.pump();

    expect(saved, isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('cross-origin remote cards have distinct dismissible keys', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final items = <HistoryItem>[
      HistoryItem(
        path: 'airqr-remote://scanned/same-id/same.txt',
        timestamp: 1,
        size: 1,
        origin: 'scanned',
        serverId: 'same-id',
      ),
      HistoryItem(
        path: 'airqr-remote://generated/same-id/same.txt',
        timestamp: 1,
        size: 1,
        origin: 'generated',
        serverId: 'same-id',
      ),
    ];

    await tester.pumpWidget(_historyApp(_SnapshotRefreshController(items)));
    await tester.pumpAndSettle();

    expect(find.byType(Dismissible), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });
}

Widget _historyApp(
  HistoryPageRefreshController controller, {
  Future<void> Function(String path)? fileSaver,
}) => MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: HistoryPage(
    isActive: true,
    refreshController: controller,
    fileSaver: fileSaver,
  ),
);

HistoryItem _remoteItem(String id) => HistoryItem(
  path: 'airqr-remote://$id/note.txt',
  timestamp: 1,
  size: 4,
  origin: 'generated',
  mimeType: 'text/plain',
  isSynced: true,
  serverId: id,
);

HistoryItem _localItem(String path, String id) => HistoryItem(
  path: path,
  timestamp: 1,
  size: 4,
  origin: 'generated',
  mimeType: 'text/plain',
  isSynced: true,
  serverId: id,
);

HistoryItem _remoteItemAt(String id, DateTime timestamp) => HistoryItem(
  path: 'airqr-remote://$id/note.txt',
  timestamp: timestamp.millisecondsSinceEpoch,
  size: 4,
  origin: 'generated',
  mimeType: 'text/plain',
  isSynced: true,
  serverId: id,
);

const _emptySnapshot = HistoryPageSnapshot(
  items: <HistoryItem>[],
  incompleteScans: <IncompleteScan>[],
  syncEnabled: false,
);

class _MaterializingRefreshController extends HistoryPageRefreshController {
  final HistoryItem remote;
  final HistoryItem local;
  int materializeCalls = 0;

  _MaterializingRefreshController(this.remote, this.local);

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async =>
      HistoryPageSnapshot(
        items: <HistoryItem>[remote],
        incompleteScans: const <IncompleteScan>[],
        syncEnabled: true,
      );

  @override
  Future<HistoryMaterializationResult> materializeRemoteItem(
    HistoryItem item,
  ) async {
    materializeCalls++;
    return HistoryMaterializationResult.materialized(local);
  }
}

class _DelayedMaterializingRefreshController
    extends HistoryPageRefreshController {
  final HistoryItem remote;
  final Completer<HistoryMaterializationResult> _materialization =
      Completer<HistoryMaterializationResult>();
  int materializeCalls = 0;

  _DelayedMaterializingRefreshController(this.remote);

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async =>
      HistoryPageSnapshot(
        items: <HistoryItem>[remote],
        incompleteScans: const <IncompleteScan>[],
        syncEnabled: true,
      );

  @override
  Future<HistoryMaterializationResult> materializeRemoteItem(HistoryItem item) {
    materializeCalls++;
    return _materialization.future;
  }

  void complete(HistoryItem local) {
    _materialization.complete(HistoryMaterializationResult.materialized(local));
  }
}

class _CountingRefreshController extends HistoryPageRefreshController {
  int calls = 0;

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async {
    calls++;
    return _emptySnapshot;
  }
}

class _RecordingRefreshController extends HistoryPageRefreshController {
  final forceSyncCalls = <bool>[];

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async {
    forceSyncCalls.add(forceSync);
    return _syncEnabledSnapshot;
  }
}

class _BlockingRefreshController extends HistoryPageRefreshController {
  int calls = 0;
  Completer<HistoryPageSnapshot> _pending = Completer<HistoryPageSnapshot>();

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) {
    calls++;
    return _pending.future;
  }

  void complete() {
    _pending.complete(_emptySnapshot);
    _pending = Completer<HistoryPageSnapshot>();
  }
}

class _SnapshotRefreshController extends HistoryPageRefreshController {
  final List<HistoryItem> items;

  _SnapshotRefreshController(this.items);

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async =>
      HistoryPageSnapshot(
        items: items,
        incompleteScans: const <IncompleteScan>[],
        syncEnabled: false,
      );
}

class _MixedSnapshotRefreshController extends HistoryPageRefreshController {
  final List<HistoryItem> items;
  final List<IncompleteScan> incompleteScans;

  _MixedSnapshotRefreshController({
    required this.items,
    required this.incompleteScans,
  });

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) async =>
      HistoryPageSnapshot(
        items: items,
        incompleteScans: incompleteScans,
        syncEnabled: false,
      );
}

class _SequencedRefreshController extends HistoryPageRefreshController {
  final forceSyncCalls = <bool>[];
  final _normal = Completer<HistoryPageSnapshot>();
  final _forced = Completer<HistoryPageSnapshot>();

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) {
    forceSyncCalls.add(forceSync);
    if (forceSyncCalls.length == 1) {
      return Future<HistoryPageSnapshot>.value(
        const HistoryPageSnapshot(
          items: <HistoryItem>[],
          incompleteScans: <IncompleteScan>[],
          syncEnabled: true,
        ),
      );
    }
    return forceSync ? _forced.future : _normal.future;
  }

  void completeNormal() => _normal.complete(_syncEnabledSnapshot);

  void completeForced() => _forced.complete(_syncEnabledSnapshot);
}

const _syncEnabledSnapshot = HistoryPageSnapshot(
  items: <HistoryItem>[],
  incompleteScans: <IncompleteScan>[],
  syncEnabled: true,
);

class _LifecycleBlockingRefreshController extends HistoryPageRefreshController {
  final _pending = <Completer<HistoryPageSnapshot>>[];

  int get calls => _pending.length;

  @override
  Future<HistoryPageSnapshot> refresh({bool forceSync = false}) {
    final completer = Completer<HistoryPageSnapshot>();
    _pending.add(completer);
    return completer.future;
  }

  void complete(int index, String path) {
    _pending[index].complete(
      HistoryPageSnapshot(
        items: <HistoryItem>[
          HistoryItem(
            path: path,
            timestamp: index + 1,
            size: 1,
            origin: 'scanned',
          ),
        ],
        incompleteScans: const <IncompleteScan>[],
        syncEnabled: false,
      ),
    );
  }
}
