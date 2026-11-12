import 'history_item.dart';

enum HistorySortOption {
  dateDesc,
  dateAsc,
  sizeDesc,
  sizeAsc,
  nameAsc,
  nameDesc,
}

List<HistoryItem> filterHistoryItems(
  List<HistoryItem> items, {
  required String originFilter,
  required String searchQuery,
  required HistorySortOption sortBy,
}) {
  final query = searchQuery.toLowerCase();
  final filtered = items
      .where((item) => _historyItemMatches(item, originFilter, query))
      .toList();
  return sortHistoryItems(filtered, sortBy: sortBy);
}

/// Number of items [filterHistoryItems] would return, without sorting.
int countHistoryItems(
  List<HistoryItem> items, {
  required String originFilter,
  required String searchQuery,
}) {
  final query = searchQuery.toLowerCase();
  var count = 0;
  for (final item in items) {
    if (_historyItemMatches(item, originFilter, query)) count++;
  }
  return count;
}

bool _historyItemMatches(
  HistoryItem item,
  String originFilter,
  String lowerQuery,
) {
  if (originFilter != 'all' && item.origin != originFilter) return false;
  if (lowerQuery.isEmpty) return true;
  return _historyFileName(item.path).toLowerCase().contains(lowerQuery);
}

Map<String, List<HistoryItem>> groupHistoryItems(List<HistoryItem> items) {
  final groups = <String, List<HistoryItem>>{};
  for (final item in items) {
    final category = item.category;
    final key = category == 'older' ? historyItemDateKey(item) : category;
    groups.putIfAbsent(key, () => <HistoryItem>[]);
    groups[key]!.add(item);
  }
  return groups;
}

List<String> historySectionKeys(
  Map<String, List<HistoryItem>> grouped, {
  required HistorySortOption sortBy,
}) {
  final olderDateKeys =
      grouped.keys.where((key) => key != 'today' && key != 'yesterday').toList()
        ..sort();

  final sortedDateKeys = sortBy == HistorySortOption.dateAsc
      ? olderDateKeys
      : olderDateKeys.reversed.toList();

  if (sortBy == HistorySortOption.dateAsc) {
    return [
      ...sortedDateKeys,
      if (grouped.containsKey('yesterday')) 'yesterday',
      if (grouped.containsKey('today')) 'today',
    ];
  }

  return [
    if (grouped.containsKey('today')) 'today',
    if (grouped.containsKey('yesterday')) 'yesterday',
    ...sortedDateKeys,
  ];
}

String historyItemDateKey(HistoryItem item) {
  final date = DateTime.fromMillisecondsSinceEpoch(item.timestamp);
  final year = date.year.toString().padLeft(4, '0');
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  return '$year-$month-$day';
}

List<HistoryItem> sortHistoryItems(
  List<HistoryItem> items, {
  required HistorySortOption sortBy,
}) {
  final sorted = [...items];
  sorted.sort((a, b) {
    final aName = _historyFileName(a.path).toLowerCase();
    final bName = _historyFileName(b.path).toLowerCase();
    switch (sortBy) {
      case HistorySortOption.dateDesc:
        return b.timestamp.compareTo(a.timestamp);
      case HistorySortOption.dateAsc:
        return a.timestamp.compareTo(b.timestamp);
      case HistorySortOption.sizeDesc:
        return b.size.compareTo(a.size);
      case HistorySortOption.sizeAsc:
        return a.size.compareTo(b.size);
      case HistorySortOption.nameAsc:
        return aName.compareTo(bName);
      case HistorySortOption.nameDesc:
        return bName.compareTo(aName);
    }
  });
  return sorted;
}

HistorySortOption historySortOptionFromStoredValue(String? value) {
  switch (value) {
    case 'date-asc':
      return HistorySortOption.dateAsc;
    case 'size-desc':
      return HistorySortOption.sizeDesc;
    case 'size-asc':
      return HistorySortOption.sizeAsc;
    case 'name-asc':
      return HistorySortOption.nameAsc;
    case 'name-desc':
      return HistorySortOption.nameDesc;
    case 'date-desc':
    default:
      return HistorySortOption.dateDesc;
  }
}

String historySortOptionToStoredValue(HistorySortOption option) {
  switch (option) {
    case HistorySortOption.dateDesc:
      return 'date-desc';
    case HistorySortOption.dateAsc:
      return 'date-asc';
    case HistorySortOption.sizeDesc:
      return 'size-desc';
    case HistorySortOption.sizeAsc:
      return 'size-asc';
    case HistorySortOption.nameAsc:
      return 'name-asc';
    case HistorySortOption.nameDesc:
      return 'name-desc';
  }
}

String _historyFileName(String path) {
  final normalized = path.replaceAll('\\', '/');
  final parts = normalized.split('/');
  return parts.isEmpty ? path : parts.last;
}
