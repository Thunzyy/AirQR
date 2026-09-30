import 'parse/wire.dart';

class HistoryItem {
  final String path;
  final int timestamp;
  final int size;
  final String origin;
  final String? mimeType;
  final int? totalFrames;
  final int? minFrames;
  final List<int>? chunkMinFrames;
  final bool isSynced;
  final String? serverId;
  final bool isLocalOnly;

  HistoryItem({
    required this.path,
    required this.timestamp,
    required this.size,
    this.origin = 'scanned',
    this.mimeType,
    this.totalFrames,
    this.minFrames,
    this.chunkMinFrames,
    this.isSynced = false,
    this.serverId,
    this.isLocalOnly = false,
  });

  WireObject toJson() => {
    'path': path,
    'timestamp': timestamp,
    'size': size,
    'origin': origin,
    'mimeType': mimeType,
    'totalFrames': totalFrames,
    'minFrames': minFrames,
    'chunkMinFrames': chunkMinFrames,
    'isSynced': isSynced,
    'serverId': serverId,
    'isLocalOnly': isLocalOnly,
  };

  factory HistoryItem.fromJson(Object? json) {
    final object = asWireObject(json);
    final path = asWireString(object['path']);
    final timestamp = asWireInt(object['timestamp']);
    final size = asWireInt(object['size']);
    if (path == null || timestamp == null || size == null) {
      throw const FormatException('Invalid history item');
    }
    return HistoryItem(
      path: path,
      timestamp: timestamp,
      size: size,
      origin: asWireString(object['origin']) ?? 'scanned',
      mimeType: asWireString(object['mimeType']),
      totalFrames: asWireInt(object['totalFrames']),
      minFrames: asWireInt(object['minFrames']),
      chunkMinFrames: asIntList(object['chunkMinFrames']),
      isSynced: asWireBool(object['isSynced']) ?? false,
      serverId: asWireString(object['serverId']),
      isLocalOnly: asWireBool(object['isLocalOnly']) ?? false,
    );
  }

  HistoryItem copyWith({bool? isSynced, String? serverId, bool? isLocalOnly}) {
    return HistoryItem(
      path: path,
      timestamp: timestamp,
      size: size,
      origin: origin,
      mimeType: mimeType,
      totalFrames: totalFrames,
      minFrames: minFrames,
      chunkMinFrames: chunkMinFrames,
      isSynced: isSynced ?? this.isSynced,
      serverId: serverId ?? this.serverId,
      isLocalOnly: isLocalOnly ?? this.isLocalOnly,
    );
  }

  bool get isNote => mimeType == 'text/plain';

  String get _extension {
    final cleanPath = path.split(RegExp(r'[?#]')).first.trim();
    final basename = cleanPath.split(RegExp(r'[\\/]')).last;
    final lastDot = basename.lastIndexOf('.');
    if (lastDot <= 0 || lastDot == basename.length - 1) return '';
    return basename.substring(lastDot + 1).toLowerCase();
  }

  bool get isTextPreviewable {
    final mime = (mimeType ?? '').toLowerCase();
    const textExtensions = {
      'css',
      'csv',
      'html',
      'htm',
      'js',
      'json',
      'log',
      'md',
      'py',
      'rs',
      'sh',
      'sql',
      'ts',
      'txt',
      'xml',
      'yaml',
      'yml',
    };
    const textMimeTypes = {
      'application/javascript',
      'application/json',
      'application/xml',
      'application/yaml',
      'application/x-yaml',
      'text/markdown',
      'text/typescript',
    };

    return isNote ||
        mime.startsWith('text/') ||
        textMimeTypes.contains(mime) ||
        textExtensions.contains(_extension);
  }

  bool get isPreviewable {
    final mime = (mimeType ?? '').toLowerCase();
    final extension = _extension;

    return isTextPreviewable ||
        mime == 'application/zip' ||
        extension == 'zip' ||
        mime == 'image/gif' ||
        extension == 'gif' ||
        mime.startsWith('image/') ||
        mime.startsWith('video/') ||
        mime == 'application/pdf' ||
        extension == 'pdf';
  }

  String get category {
    final now = DateTime.now();
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));

    if (date.isAfter(today)) return 'today';
    if (date.isAfter(yesterday)) return 'yesterday';
    return 'older';
  }
}
