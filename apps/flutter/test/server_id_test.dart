import 'package:airqr_mobile/server_id.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ServerId', () {
    test('accepts the exact sync-server identifier grammar', () {
      final id = ServerId.tryParse('mobile_scan-123');

      expect(id?.value, 'mobile_scan-123');
      expect(id?.encodedPathSegment, 'mobile_scan-123');
    });

    for (final invalid in <Object?>[
      null,
      7,
      '',
      ' padded ',
      '../x',
      'a/b',
      'a?b',
      'a#b',
      List<String>.filled(129, 'a').join(),
    ]) {
      test('rejects $invalid', () {
        expect(ServerId.tryParse(invalid), isNull);
      });
    }

    test('alias parsing requires exact agreement', () {
      expect(
        ServerId.tryParseAliases(<String, dynamic>{
          'id': 'same',
          'sessionId': 'same',
          'historyId': 'same',
        })?.value,
        'same',
      );
      expect(
        ServerId.tryParseAliases(<String, dynamic>{
          'id': 'one',
          'sessionId': 'two',
        }),
        isNull,
      );
    });
  });
}
