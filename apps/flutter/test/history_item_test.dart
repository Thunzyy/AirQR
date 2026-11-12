import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/server_history_item.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('HistoryItem', () {
    test('copyWith updates sync fields without touching file metadata', () {
      final item = HistoryItem(
        path: '/tmp/file.bin',
        timestamp: DateTime.now().millisecondsSinceEpoch,
        size: 42,
        origin: 'generated',
      );

      final updated = item.copyWith(
        isSynced: true,
        serverId: 'srv-1',
        isLocalOnly: true,
      );

      expect(updated.path, item.path);
      expect(updated.timestamp, item.timestamp);
      expect(updated.size, item.size);
      expect(updated.origin, item.origin);
      expect(updated.isSynced, isTrue);
      expect(updated.serverId, 'srv-1');
      expect(updated.isLocalOnly, isTrue);
    });

    test('categorizes recent items into today yesterday and older', () {
      final now = DateTime.now();
      final todayItem = HistoryItem(
        path: 'today',
        timestamp: now.millisecondsSinceEpoch,
        size: 1,
      );
      final yesterdayItem = HistoryItem(
        path: 'yesterday',
        timestamp: now.subtract(const Duration(days: 1)).millisecondsSinceEpoch,
        size: 1,
      );
      final olderItem = HistoryItem(
        path: 'older',
        timestamp: now.subtract(const Duration(days: 3)).millisecondsSinceEpoch,
        size: 1,
      );

      expect(todayItem.category, 'today');
      expect(yesterdayItem.category, 'yesterday');
      expect(olderItem.category, 'older');
    });

    test('marks text/plain history items as notes', () {
      final noteItem = HistoryItem(
        path: '/tmp/note.md',
        timestamp: DateTime.now().millisecondsSinceEpoch,
        size: 12,
        mimeType: 'text/plain',
      );
      final binaryItem = HistoryItem(
        path: '/tmp/archive.zip',
        timestamp: DateTime.now().millisecondsSinceEpoch,
        size: 12,
        mimeType: 'application/zip',
      );

      expect(noteItem.isNote, isTrue);
      expect(binaryItem.isNote, isFalse);
    });

    test('marks web-aligned file types as previewable', () {
      final timestamp = DateTime.now().millisecondsSinceEpoch;

      HistoryItem item(String path, [String? mimeType]) => HistoryItem(
        path: path,
        timestamp: timestamp,
        size: 1,
        mimeType: mimeType,
      );

      expect(item('/tmp/photo.png', 'image/png').isPreviewable, isTrue);
      expect(item('/tmp/movie.mp4', 'video/mp4').isPreviewable, isTrue);
      expect(item('/tmp/manual.pdf').isPreviewable, isTrue);
      expect(item('/tmp/archive.zip').isPreviewable, isTrue);
      expect(item('/tmp/readme.md').isTextPreviewable, isTrue);
      expect(item('/tmp/readme.md').isPreviewable, isTrue);
      expect(item('/tmp/payload.bin').isPreviewable, isFalse);
    });

    test('preserves per-chunk minimum frames through JSON and copyWith', () {
      final item = HistoryItem(
        path: '/tmp/chunks.zip',
        timestamp: 1,
        size: 10,
        origin: 'generated',
        minFrames: 8,
        chunkMinFrames: const <int>[8, 3],
      );

      final restored = HistoryItem.fromJson(item.toJson());
      expect(restored.chunkMinFrames, const <int>[8, 3]);
      expect(restored.copyWith(isSynced: true).chunkMinFrames, <int>[8, 3]);
    });
  });

  test('server history parses per-chunk minimum frames', () {
    final item = ServerHistoryItem.tryParse(<String, dynamic>{
      'id': 'generated_item-1',
      'origin': 'generated',
      'completed': true,
      'size': 10,
      'totalFrames': 20,
      'minFrames': 8,
      'chunkMinFrames': <int>[8, 3],
    });

    expect(item, isNotNull);
    expect(item!.chunkMinFrames, const <int>[8, 3]);
  });
}
