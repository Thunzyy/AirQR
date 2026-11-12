import 'package:airqr_mobile/scanner_analysis_metrics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel(
    'dev.steenbakker.mobile_scanner/scanner/method',
  );
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test(
    'uses the measured camera analysis rate, including repeated QR frames',
    () async {
      messenger.setMockMethodCallHandler(channel, (call) async {
        expect(call.method, 'airqrAnalysisFps');
        return 58.6;
      });
      expect(await ScannerAnalysisMetrics.readFps(), 59);
    },
  );

  test('unavailable metrics retain the existing fallback', () async {
    messenger.setMockMethodCallHandler(
      channel,
      (call) async => throw MissingPluginException(),
    );
    expect(await ScannerAnalysisMetrics.readFps(), isNull);
  });
}
