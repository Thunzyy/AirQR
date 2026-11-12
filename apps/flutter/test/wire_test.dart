import 'package:airqr_mobile/parse/wire.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('wire parsers', () {
    test('parseJsonText walks maps and lists into WireObject trees', () {
      final decoded = parseJsonText(
        '{"name":"scan","count":3,"ok":true,"nested":{"id":"a"},"tags":["x",1]}',
      );
      final object = tryWireObject(decoded);
      expect(object, isNotNull);
      expect(asWireString(object!['name']), 'scan');
      expect(asWireInt(object['count']), 3);
      expect(asWireBool(object['ok']), isTrue);
      expect(asWireString(asWireObject(object['nested'])['id']), 'a');
      expect(asWireList(object['tags']), <Object?>['x', 1]);
    });

    test('rejects non-objects and non-lists at try helpers', () {
      expect(tryWireObject('nope'), isNull);
      expect(tryWireList('nope'), isNull);
      expect(asWireObject('nope'), isEmpty);
      expect(asWireList('nope'), isEmpty);
    });

    test('coerces finite numbers and numeric strings', () {
      expect(asWireInt(4.2), 4);
      expect(asWireInt(' 12 '), 12);
      expect(asWireDouble('3.5'), 3.5);
      expect(asWireString(9), '9');
      expect(firstWireInt(<Object?>[null, 'x', 8]), 8);
    });

    test('loose bool accepts common wire encodings', () {
      expect(asWireLooseBool(true), isTrue);
      expect(asWireLooseBool(1), isTrue);
      expect(asWireLooseBool('YES'), isTrue);
      expect(asWireLooseBool('no'), isFalse);
      expect(asWireBool('true'), isNull);
    });
  });
}
