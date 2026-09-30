import 'package:airqr_mobile/encoder_page.dart';
import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('encoder progress uses the selected control color', (
    tester,
  ) async {
    for (final brightness in [Brightness.light, Brightness.dark]) {
      await tester.pumpWidget(
        MaterialApp(
          key: ValueKey(brightness),
          theme: ThemeData(brightness: brightness),
          home: const Scaffold(body: EncoderProgressIndicator()),
        ),
      );

      final indicator = tester.widget<CircularProgressIndicator>(
        find.byType(CircularProgressIndicator),
      );
      expect(
        indicator.color,
        brightness == Brightness.dark
            ? AirQrTheme.darkSwitchSelectedTrack
            : AirQrTheme.lightSwitchSelectedTrack,
      );
    }
  });

  testWidgets('fresh encoder page uses the shared encoder defaults', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'airqr_encoder_network_notice_hidden': true,
    });

    await tester.pumpWidget(
      const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: EncoderPage(),
      ),
    );
    await tester.pumpAndSettle();

    final pageScroll = tester.widget<SingleChildScrollView>(
      find.byKey(const Key('encoder-page-scroll-view')),
    );
    expect(pageScroll.padding, const EdgeInsets.fromLTRB(16, 16, 16, 128));

    await tester.tap(find.byKey(const Key('encoder-mode-note-option')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(EditableText).first, 'AirQR defaults');
    await tester.pump();
    final generateIcon = tester.widget<AirQrIcon>(
      find.byKey(const Key('encoder-generate-qr-icon')),
    );
    expect(generateIcon.name, 'qr_code_2');
    expect(generateIcon.size, 20);
    await tester.ensureVisible(find.text('Advanced Settings'));
    await tester.tap(find.text('Advanced Settings'));
    await tester.pumpAndSettle();

    expect(find.text('10 fps'), findsOneWidget);
    expect(find.text('1500 bytes'), findsOneWidget);
    expect(find.text('LOW (7%)'), findsOneWidget);
    expect(find.text('177px'), findsOneWidget);
    expect(find.text('1.3x'), findsOneWidget);
    expect(find.text('Redundancy'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);
  });
}
