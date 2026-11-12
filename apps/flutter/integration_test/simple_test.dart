import 'package:flutter_test/flutter_test.dart';
import 'package:airqr_mobile/main.dart';
import 'package:airqr_mobile/src/rust/frb_generated.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    await RustLib.init();
  });

  testWidgets('App boots and shows bottom navigation', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MyApp(
        buildScannerPage: ({
          required settingsChangedNotifier,
          required isActive,
        }) {
          return ScannerPage(
            settingsChangedNotifier: settingsChangedNotifier,
            isActive: isActive,
          );
        },
      ),
    );

    // Avoid pumpAndSettle() here: the app runs timers/streams (scanner + sync).
    await tester.pump(const Duration(seconds: 1));

    final navFinder = find.byType(BottomNavigationBar);
    expect(navFinder, findsOneWidget);

    final nav = tester.widget<BottomNavigationBar>(navFinder);
    expect(nav.items, hasLength(5));
  });
}
