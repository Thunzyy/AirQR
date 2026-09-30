import 'package:flutter/foundation.dart';

import 'parse/wire.dart';

@immutable
final class ServerId {
  static final RegExp _pattern = RegExp(r'^[A-Za-z0-9_-]{1,128}$');

  final String value;

  const ServerId._(this.value);

  static ServerId? tryParse(Object? raw) {
    if (raw is! String || !_pattern.hasMatch(raw)) return null;
    return ServerId._(raw);
  }

  static ServerId? tryFromPositiveInt(int? raw) {
    if (raw == null || raw <= 0) return null;
    return tryParse('$raw');
  }

  static ServerId? tryParseAliases(
    Object? item, {
    Iterable<String> keys = const <String>['id', 'sessionId', 'historyId'],
  }) {
    final object = asWireObject(item);
    ServerId? canonical;
    var found = false;
    for (final key in keys) {
      if (!object.containsKey(key)) continue;
      found = true;
      final parsed = tryParse(object[key]);
      if (parsed == null || (canonical != null && canonical != parsed)) {
        return null;
      }
      canonical = parsed;
    }
    return found ? canonical : null;
  }

  String get encodedPathSegment => Uri.encodeComponent(value);

  @override
  bool operator ==(Object other) => other is ServerId && other.value == value;

  @override
  int get hashCode => value.hashCode;

  @override
  String toString() => value;
}
