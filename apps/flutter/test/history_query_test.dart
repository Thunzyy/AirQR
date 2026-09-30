import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_query.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime.now();
  final items = <HistoryItem>[
    HistoryItem(
      path: '/tmp/zeta.gif',
      timestamp: now.subtract(const Duration(days: 3)).millisecondsSinceEpoch,
      size: 30,
      origin: 'generated',
    ),
    HistoryItem(
      path: '/tmp/alpha.bin',
      timestamp: now.millisecondsSinceEpoch,
      size: 10,
      origin: 'scanned',
    ),
    HistoryItem(
      path: '/tmp/bravo.bin',
      timestamp: now.subtract(const Duration(days: 1)).millisecondsSinceEpoch,
      size: 20,
      origin: 'scanned',
    ),
  ];

  group('filterHistoryItems', () {
    test('all origin filter includes scanned and generated items', () {
      final result = filterHistoryItems(
        items,
        originFilter: 'all',
        searchQuery: '',
        sortBy: HistorySortOption.nameAsc,
      );

      expect(result.map((item) => item.path).toList(), [
        '/tmp/alpha.bin',
        '/tmp/bravo.bin',
        '/tmp/zeta.gif',
      ]);
    });

    test('filters by origin search query and sort option', () {
      final result = filterHistoryItems(
        items,
        originFilter: 'scanned',
        searchQuery: 'br',
        sortBy: HistorySortOption.nameAsc,
      );

      expect(result.map((item) => item.path).toList(), ['/tmp/bravo.bin']);
    });

    test('sorts by descending date by default option value', () {
      final result = filterHistoryItems(
        items,
        originFilter: 'scanned',
        searchQuery: '',
        sortBy: HistorySortOption.dateDesc,
      );

      expect(result.map((item) => item.path).toList(), [
        '/tmp/alpha.bin',
        '/tmp/bravo.bin',
      ]);
    });
  });

  group('groupHistoryItems', () {
    test('groups filtered items by category and older date keys', () {
      final grouped = groupHistoryItems(items);
      final olderKey = historyItemDateKey(items.first);

      expect(grouped['today']!.map((item) => item.path), ['/tmp/alpha.bin']);
      expect(grouped['yesterday']!.map((item) => item.path), [
        '/tmp/bravo.bin',
      ]);
      expect(grouped[olderKey]!.map((item) => item.path), ['/tmp/zeta.gif']);
      expect(grouped.containsKey('older'), isFalse);
    });

    test('orders section keys like the web history view', () {
      final grouped = groupHistoryItems(items);
      final olderKey = historyItemDateKey(items.first);

      expect(historySectionKeys(grouped, sortBy: HistorySortOption.dateDesc), [
        'today',
        'yesterday',
        olderKey,
      ]);
      expect(historySectionKeys(grouped, sortBy: HistorySortOption.dateAsc), [
        olderKey,
        'yesterday',
        'today',
      ]);
    });
  });

  group('sort option storage mapping', () {
    test('round trips stored values', () {
      expect(
        historySortOptionFromStoredValue('name-desc'),
        HistorySortOption.nameDesc,
      );
      expect(
        historySortOptionToStoredValue(HistorySortOption.sizeAsc),
        'size-asc',
      );
    });
  });
}
