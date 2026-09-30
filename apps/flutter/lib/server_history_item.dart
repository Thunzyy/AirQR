import 'package:flutter/foundation.dart';

import 'parse/wire.dart';
import 'server_id.dart';

enum ServerHistoryOrigin { scanned, generated }

@immutable
final class ServerHistoryItem {
  final ServerId id;
  final ServerHistoryOrigin origin;
  final String? filename;
  final String? mimeType;
  final bool completed;
  final int size;
  final int? totalFrames;
  final int? minFrames;
  final List<int>? chunkMinFrames;
  final DateTime? createdAt;
  final DateTime? completedAt;
  final DateTime? updatedAt;
  final int receivedPackets;
  final int expectedPackets;
  final double progress;
  final String? deviceId;
  final String? deviceName;

  const ServerHistoryItem._({
    required this.id,
    required this.origin,
    required this.filename,
    required this.mimeType,
    required this.completed,
    required this.size,
    required this.totalFrames,
    required this.minFrames,
    required this.chunkMinFrames,
    required this.createdAt,
    required this.completedAt,
    required this.updatedAt,
    required this.receivedPackets,
    required this.expectedPackets,
    required this.progress,
    required this.deviceId,
    required this.deviceName,
  });

  static ServerHistoryItem? tryParse(Object? json) {
    final object = tryWireObject(json);
    if (object == null) return null;
    final id = ServerId.tryParseAliases(object);
    if (id == null) return null;

    final origin = switch (object['origin']) {
      null => ServerHistoryOrigin.scanned,
      'scanned' => ServerHistoryOrigin.scanned,
      'generated' => ServerHistoryOrigin.generated,
      _ => null,
    };
    if (origin == null) return null;
    final filename = _nullableString(object, 'filename');
    final mimeType = _nullableString(object, 'mimeType');
    if (filename == _invalidString || mimeType == _invalidString) return null;
    final completed = object.containsKey('completed')
        ? object['completed']
        : false;
    if (completed is! bool) return null;
    final size = _nonNegativeInt(object, 'size', defaultValue: 0);
    final totalFrames = _nullableNonNegativeInt(object, 'totalFrames');
    final minFrames = _nullableNonNegativeInt(object, 'minFrames');
    final chunkMinFrames = _nullableNonNegativeIntList(object, 'chunkMinFrames');
    if (size == null ||
        totalFrames == _invalidInt ||
        minFrames == _invalidInt ||
        chunkMinFrames == _invalidInt) {
      return null;
    }
    if (totalFrames is int && minFrames is int && minFrames > totalFrames) {
      return null;
    }
    final createdAt = _nullableDateTime(object, 'createdAt');
    final completedAt = _nullableDateTime(object, 'completedAt');
    final updatedAt = _nullableDateTime(object, 'updatedAt');
    if (createdAt == _invalidDate ||
        completedAt == _invalidDate ||
        updatedAt == _invalidDate) {
      return null;
    }
    final scanState = asWireObject(object['scanState']);
    final receivedPackets = _firstNonNegativeInt(<Object?>[
      object['receivedPackets'],
      object['receivedCount'],
      object['packetCount'],
      scanState['receivedUnique'],
    ]);
    final expectedPackets = _firstNonNegativeInt(<Object?>[
      scanState['decodeThreshold'],
      object['decodeThreshold'],
      object['expectedPackets'],
      object['totalPackets'],
    ]);
    final completionPercent = _firstNumber(<Object?>[
      object['completionPercent'],
    ]);
    final explicitProgress = _firstNumber(<Object?>[object['progress']]);
    final rawProgress = completionPercent != null
        ? completionPercent / 100
        : explicitProgress ??
              (expectedPackets > 0 ? receivedPackets / expectedPackets : 0.0);

    return ServerHistoryItem._(
      id: id,
      origin: origin,
      filename: filename is String ? filename : null,
      mimeType: mimeType is String ? mimeType : null,
      completed: completed,
      size: size,
      totalFrames: totalFrames is int ? totalFrames : null,
      minFrames: minFrames is int ? minFrames : null,
      chunkMinFrames: chunkMinFrames is List<int> ? chunkMinFrames : null,
      createdAt: createdAt is DateTime ? createdAt : null,
      completedAt: completedAt is DateTime ? completedAt : null,
      updatedAt: updatedAt is DateTime ? updatedAt : null,
      receivedPackets: receivedPackets,
      expectedPackets: expectedPackets,
      progress: rawProgress.clamp(0.0, 1.0).toDouble(),
      deviceId: asWireString(object['deviceId']),
      deviceName: asWireString(object['deviceName']),
    );
  }

  String get originValue => origin.name;
  DateTime? get effectiveTimestamp => updatedAt ?? completedAt ?? createdAt;
}

const Object _invalidString = Object();
const Object _invalidInt = Object();
const Object _invalidDate = Object();

Object? _nullableNonNegativeIntList(WireObject json, String key) {
  if (!json.containsKey(key) || json[key] == null) return null;
  final value = json[key];
  if (value is! List) return _invalidInt;
  final parsed = <int>[];
  for (final entry in value) {
    if (entry is! num || entry < 0 || entry != entry.roundToDouble()) {
      return _invalidInt;
    }
    parsed.add(entry.toInt());
  }
  return parsed;
}

Object? _nullableString(WireObject json, String key) {
  if (!json.containsKey(key) || json[key] == null) return null;
  return json[key] is String ? json[key] : _invalidString;
}

int? _nonNegativeInt(
  WireObject json,
  String key, {
  required int defaultValue,
}) {
  if (!json.containsKey(key) || json[key] == null) return defaultValue;
  final value = json[key];
  return value is int && value >= 0 ? value : null;
}

Object? _nullableNonNegativeInt(WireObject json, String key) {
  if (!json.containsKey(key) || json[key] == null) return null;
  final value = json[key];
  return value is int && value >= 0 ? value : _invalidInt;
}

Object? _nullableDateTime(WireObject json, String key) {
  if (!json.containsKey(key) || json[key] == null) return null;
  final value = json[key];
  if (value is! String) return _invalidDate;
  return DateTime.tryParse(value) ?? _invalidDate;
}

int _firstNonNegativeInt(List<Object?> values) {
  for (final value in values) {
    if (value is int && value >= 0) return value;
  }
  return 0;
}

double? _firstNumber(List<Object?> values) {
  for (final value in values) {
    if (value is num && value.isFinite && value >= 0) {
      return value.toDouble();
    }
  }
  return null;
}
