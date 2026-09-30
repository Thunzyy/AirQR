import 'package:airqr_mobile/resume_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ResumeService', () {
    setUp(() {
      final service = ResumeService();
      while (service.hasPendingResume) {
        service.consumePendingResume();
      }
    });

    test('stores and consumes a pending resume id once', () {
      final service = ResumeService();

      service.requestResume('scan-123');

      expect(service.hasPendingResume, isTrue);
      expect(service.consumePendingResume(), 'scan-123');
      expect(service.hasPendingResume, isFalse);
      expect(service.consumePendingResume(), isNull);
    });
  });
}
