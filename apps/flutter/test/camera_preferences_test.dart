import 'package:airqr_mobile/camera_preferences.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  group('mobile camera facing preference', () {
    test('defaults invalid and missing values to the back camera', () {
      expect(
        parseMobileCameraFacingPreference(null),
        MobileCameraFacingPreference.back,
      );
      expect(
        parseMobileCameraFacingPreference('external'),
        MobileCameraFacingPreference.back,
      );
    });

    test('persists the selected facing', () async {
      await savePreferredMobileCameraFacing(MobileCameraFacingPreference.front);

      expect(
        await loadPreferredMobileCameraFacing(),
        MobileCameraFacingPreference.front,
      );
    });
  });

  group('normalizeDesktopCameraName', () {
    test('returns null for blank values', () {
      expect(normalizeDesktopCameraName(null), isNull);
      expect(normalizeDesktopCameraName(''), isNull);
      expect(normalizeDesktopCameraName('   '), isNull);
    });

    test('trims non-empty values', () {
      expect(normalizeDesktopCameraName('  USB Camera  '), 'USB Camera');
    });
  });

  group('resolvePreferredDesktopCameraIndex', () {
    test('uses preferred device when present', () {
      final devices = ['Front', 'USB Camera', 'Virtual'];

      final index = resolvePreferredDesktopCameraIndex(devices, 'USB Camera');

      expect(index, 1);
    });

    test('clamps fallback index when preferred device is absent', () {
      final devices = ['Front', 'USB Camera'];

      expect(
        resolvePreferredDesktopCameraIndex(
          devices,
          'Missing',
          fallbackIndex: 9,
        ),
        1,
      );
      expect(
        resolvePreferredDesktopCameraIndex(
          devices,
          'Missing',
          fallbackIndex: -1,
        ),
        0,
      );
    });
  });
}
