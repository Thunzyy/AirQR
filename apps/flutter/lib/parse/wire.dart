import 'dart:convert';

/// Parsed JSON object. Values are JSON trees or `null`.
typedef WireObject = Map<String, Object?>;

/// Parses JSON text at a trust boundary.
Object? parseJsonText(String text) {
  // SAFETY: dart:convert jsonDecode is untyped. This is the JSON trust boundary.
  return jsonDecode(text) as Object?;
}

bool isJsonMap(Object? value) => value is Map;

bool isJsonList(Object? value) => value is List;

WireObject? tryWireObject(Object? value) {
  if (value is! Map) return null;
  return asWireObject(value);
}

List<Object?>? tryWireList(Object? value) {
  if (value is! List) return null;
  return asWireList(value);
}

WireObject asWireObject(Object? value) {
  if (value is! Map) {
    return const <String, Object?>{};
  }
  final object = <String, Object?>{};
  for (final entry in value.entries) {
    // SAFETY: JSON object keys from dart:convert are untyped until checked.
    final key = entry.key as Object?;
    if (key is! String) {
      continue;
    }
    // SAFETY: JSON object values from dart:convert are untyped until cloned.
    object[key] = cloneWireValue(entry.value as Object?);
  }
  return object;
}

List<Object?> asWireList(Object? value) {
  if (value is! List) {
    return const <Object?>[];
  }
  return <Object?>[
    for (final entry in value)
      // SAFETY: JSON array elements from dart:convert are untyped until cloned.
      cloneWireValue(entry as Object?),
  ];
}

Object? cloneWireValue(Object? value) {
  if (value == null || value is String || value is bool || value is num) {
    return value;
  }
  if (value is Map) {
    return asWireObject(value);
  }
  if (value is List) {
    return asWireList(value);
  }
  return null;
}

String? asWireString(Object? value) {
  if (value is String) return value;
  if (value is num && value.isFinite) return value.toString();
  return null;
}

int? asWireInt(Object? value) {
  if (value is int) return value;
  if (value is num && value.isFinite) return value.toInt();
  if (value is String) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return null;
    return int.tryParse(trimmed) ?? double.tryParse(trimmed)?.toInt();
  }
  return null;
}

double? asWireDouble(Object? value) {
  if (value is double && value.isFinite) return value;
  if (value is num && value.isFinite) return value.toDouble();
  if (value is String) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return null;
    final parsed = double.tryParse(trimmed);
    if (parsed != null && parsed.isFinite) return parsed;
  }
  return null;
}

bool? asWireBool(Object? value) {
  return value is bool ? value : null;
}

bool asWireLooseBool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  final normalized = asWireString(value)?.trim().toLowerCase();
  return normalized == 'true' || normalized == '1' || normalized == 'yes';
}

List<int>? asIntList(Object? value) {
  if (value is! List) return null;
  final numbers = <int>[];
  for (final entry in value) {
    // SAFETY: JSON array elements from dart:convert are untyped until parsed.
    final parsed = asWireInt(entry as Object?);
    if (parsed != null) {
      numbers.add(parsed);
    }
  }
  return numbers.isEmpty ? null : numbers;
}

int? firstWireInt(Iterable<Object?> values) {
  for (final value in values) {
    final parsed = asWireInt(value);
    if (parsed != null) return parsed;
  }
  return null;
}

double? firstWireDouble(Iterable<Object?> values) {
  for (final value in values) {
    final parsed = asWireDouble(value);
    if (parsed != null) return parsed;
  }
  return null;
}

DateTime? asWireDateTime(Object? value) {
  final text = asWireString(value);
  if (text == null || text.trim().isEmpty) return null;
  return DateTime.tryParse(text);
}

String caughtMessage(Object error) {
  if (error is FormatException && error.message.isNotEmpty) {
    return error.message;
  }
  return error.toString();
}
