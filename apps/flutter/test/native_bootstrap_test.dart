import 'dart:async';

import 'package:airqr_mobile/l10n/app_localizations_en.dart';
import 'package:airqr_mobile/l10n/app_localizations_fr.dart';
import 'package:airqr_mobile/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('generated localizations expose the retry label', () {
    expect(AppLocalizationsEn().common_retry, 'Try again');
    expect(AppLocalizationsFr().common_retry, 'Réessayer');
  });

  testWidgets('shows a Material loading surface while native init is pending', (
    tester,
  ) async {
    final initialization = Completer<void>();
    var builderInvocations = 0;

    await tester.pumpWidget(
      NativeBootstrap(
        initialize: () => initialization.future,
        builder: () {
          builderInvocations += 1;
          return const MaterialApp(home: Text('AirQR ready'));
        },
      ),
    );

    expect(find.byKey(const Key('native-bootstrap-loading')), findsOneWidget);
    expect(find.byType(Material), findsWidgets);
    expect(builderInvocations, 0);

    initialization.complete();
    await tester.pumpAndSettle();

    expect(builderInvocations, 1);
  });

  testWidgets('offers a retry after native init fails', (tester) async {
    var attempts = 0;
    var builderInvocations = 0;

    await tester.pumpWidget(
      NativeBootstrap(
        initialize: () async {
          attempts += 1;
          if (attempts == 1) {
            throw StateError('native init failed');
          }
        },
        builder: () {
          builderInvocations += 1;
          return const MaterialApp(home: Text('AirQR ready'));
        },
      ),
    );
    await tester.pump();

    expect(find.byKey(const Key('native-bootstrap-retry')), findsOneWidget);
    expect(find.text('native init failed'), findsNothing);
    expect(builderInvocations, 0);

    await tester.tap(find.byKey(const Key('native-bootstrap-retry')));
    await tester.pumpAndSettle();

    expect(attempts, 2);
    expect(builderInvocations, 1);
    expect(find.text('AirQR ready'), findsOneWidget);
  });

  testWidgets('starts only one retry when retry is triggered twice', (
    tester,
  ) async {
    var attempts = 0;
    var builderInvocations = 0;
    final retryInitialization = Completer<void>();

    await tester.pumpWidget(
      NativeBootstrap(
        initialize: () {
          attempts += 1;
          if (attempts == 1) {
            return Future<void>.error(StateError('native init failed'));
          }
          return retryInitialization.future;
        },
        builder: () {
          builderInvocations += 1;
          return const MaterialApp(home: Text('AirQR ready'));
        },
      ),
    );
    await tester.pump();

    final retry = find.byKey(const Key('native-bootstrap-retry'));
    await tester.tap(retry);
    await tester.tap(retry);

    expect(attempts, 2);
    expect(builderInvocations, 0);

    retryInitialization.complete();
    await tester.pumpAndSettle();
    expect(attempts, 2);
    expect(builderInvocations, 1);
    expect(find.text('AirQR ready'), findsOneWidget);
  });
}
