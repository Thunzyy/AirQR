import 'dart:ui' show PointerDeviceKind, SemanticsAction, Tristate;

import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/app/app_shell.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/settings_page.dart';
import 'package:airqr_mobile/history_page.dart';
import 'package:airqr_mobile/widgets/airqr_press_feedback.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const navItems = [
    AirQrNavItem(iconName: 'qr_code_2', label: 'Encodeur'),
    AirQrNavItem(iconName: 'qr_code_scanner', label: 'Décodeur'),
    AirQrNavItem(iconName: 'center_focus_weak', label: 'Scanner'),
    AirQrNavItem(iconName: 'history', label: 'Historique'),
    AirQrNavItem(iconName: 'settings', label: 'Paramètres'),
  ];

  testWidgets('Light theme uses gray for neutral icons', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAirQrLightTheme(),
        home: Builder(
          builder: (context) {
            expect(
              Theme.of(context).iconTheme.color,
              AirQrTheme.lightIconPrimary,
            );
            expect(
              AirQrTheme.resolveIconColor(context, AirQrTheme.lightTextPrimary),
              AirQrTheme.lightIconPrimary,
            );
            expect(
              AirQrTheme.resolveIconColor(context, AirQrTheme.lightDangerText),
              AirQrTheme.lightDangerText,
            );
            return const AirQrIcon('settings');
          },
        ),
      ),
    );

    expect(find.byType(AirQrIcon), findsOneWidget);
  });

  testWidgets('Dark theme keeps neutral icons white', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAirQrDarkTheme(),
        home: Builder(
          builder: (context) {
            expect(
              Theme.of(context).iconTheme.color,
              AirQrTheme.darkIconPrimary,
            );
            expect(
              AirQrTheme.resolveIconColor(context, AirQrTheme.darkTextPrimary),
              AirQrTheme.darkIconPrimary,
            );
            return const AirQrIcon('settings');
          },
        ),
      ),
    );

    expect(find.byType(AirQrIcon), findsOneWidget);
  });

  Future<void> pumpBottomNav(WidgetTester tester) {
    return tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          bottomNavigationBar: AirQrBottomNav(
            currentIndex: 1,
            onTap: (_) {},
            items: navItems,
          ),
        ),
      ),
    );
  }

  for (final activeIndex in [0, 4]) {
    testWidgets(
      'Bottom nav active indicator is centered at edge tab $activeIndex',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              bottomNavigationBar: AirQrBottomNav(
                currentIndex: activeIndex,
                onTap: (_) {},
                items: const [
                  AirQrNavItem(iconName: 'qr_code_2', label: 'Encodeur'),
                  AirQrNavItem(iconName: 'qr_code_scanner', label: 'Décodeur'),
                  AirQrNavItem(iconName: 'center_focus_weak', label: 'Scanner'),
                  AirQrNavItem(iconName: 'history', label: 'Historique'),
                  AirQrNavItem(iconName: 'settings', label: 'Paramètres'),
                ],
              ),
            ),
          ),
        );

        final navRect = tester.getRect(
          find.byKey(const Key('airqr-bottom-nav')),
        );
        final indicatorRect = tester.getRect(
          find.byKey(const Key('airqr-bottom-nav-active-indicator')),
        );
        final itemRect = tester.getRect(
          find.byKey(Key('airqr-bottom-nav-item-$activeIndex')),
        );
        final itemWidth = (navRect.width - 16) / 5;
        final activeCenter =
            navRect.left + 8 + (itemWidth * activeIndex) + (itemWidth / 2);
        final safeLeft = navRect.left - 1;
        final safeRight = navRect.right + 1;

        expect(indicatorRect.width, closeTo(itemWidth + 17, 1));
        expect(indicatorRect.height, greaterThanOrEqualTo(68));
        expect(indicatorRect.center.dx, closeTo(activeCenter, 1));
        expect(itemRect.center.dx, closeTo(indicatorRect.center.dx, 1));
        expect(indicatorRect.left, greaterThanOrEqualTo(safeLeft));
        expect(indicatorRect.right, lessThanOrEqualTo(safeRight));
      },
    );
  }

  testWidgets('Bottom nav keeps a borderless clipped-free shell', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          bottomNavigationBar: AirQrBottomNav(
            currentIndex: 0,
            onTap: (_) {},
            items: const [
              AirQrNavItem(iconName: 'qr_code_2', label: 'Encodeur'),
              AirQrNavItem(iconName: 'qr_code_scanner', label: 'Décodeur'),
              AirQrNavItem(iconName: 'center_focus_weak', label: 'Scanner'),
              AirQrNavItem(iconName: 'history', label: 'Historique'),
              AirQrNavItem(iconName: 'settings', label: 'Paramètres'),
            ],
          ),
        ),
      ),
    );

    final nav = tester.widget<Container>(
      find.byKey(const Key('airqr-bottom-nav')),
    );

    expect(nav.clipBehavior, Clip.none);
  });

  testWidgets('Bottom nav uses the shared web navigation surface', (
    tester,
  ) async {
    await pumpBottomNav(tester);

    final nav = tester.widget<Container>(
      find.byKey(const Key('airqr-bottom-nav')),
    );
    final decoration = nav.decoration! as BoxDecoration;

    expect(
      decoration.color,
      AirQrTheme.navSurface(
        tester.element(find.byKey(const Key('airqr-bottom-nav'))),
      ).withValues(alpha: 1),
    );
    expect(decoration.color?.a, 1);
    expect(decoration.boxShadow, isNull);
  });

  testWidgets('Bottom nav pointer overlays stay transparent', (tester) async {
    await pumpBottomNav(tester);

    expect(find.byType(AirQrPressFeedback), findsNWidgets(5));

    final inkWellFinder = find.descendant(
      of: find.byKey(const Key('airqr-bottom-nav-item-0')),
      matching: find.byType(InkWell),
    );
    final inkWell = tester.widget<InkWell>(inkWellFinder);

    final mouse = await tester.createGesture(kind: PointerDeviceKind.mouse);
    await mouse.addPointer(location: Offset.zero);
    await mouse.moveTo(tester.getCenter(inkWellFinder));
    await tester.pump();

    expect(
      inkWell.overlayColor?.resolve({WidgetState.hovered}),
      Colors.transparent,
    );

    final touch = await tester.startGesture(tester.getCenter(inkWellFinder));
    await tester.pump();
    expect(
      inkWell.overlayColor?.resolve({WidgetState.pressed}),
      Colors.transparent,
    );
    final pressedScale = tester.widget<AnimatedScale>(
      find
          .descendant(
            of: find.byKey(const Key('airqr-bottom-nav-item-0')),
            matching: find.byType(AnimatedScale),
          )
          .first,
    );
    expect(pressedScale.scale, 0.96);
    await touch.up();
    await mouse.removePointer();
  });

  testWidgets('Bottom nav active indicator uses pill geometry', (tester) async {
    await pumpBottomNav(tester);

    final indicator = tester.widget<DecoratedBox>(
      find.byKey(const Key('airqr-bottom-nav-active-indicator')),
    );
    final decoration = indicator.decoration as ShapeDecoration;

    expect(decoration.shape, isA<StadiumBorder>());
  });

  testWidgets('Bottom nav active indicator contains selected icon and label', (
    tester,
  ) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(390, 800));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          bottomNavigationBar: AirQrBottomNav(
            currentIndex: 4,
            onTap: (_) {},
            items: navItems,
          ),
        ),
      ),
    );

    final indicatorRect = tester.getRect(
      find.byKey(const Key('airqr-bottom-nav-active-indicator')),
    );
    final selectedItem = find.byKey(const Key('airqr-bottom-nav-item-4'));
    final iconRect = tester.getRect(
      find.descendant(of: selectedItem, matching: find.byType(AirQrIcon)),
    );
    final labelBox = tester.renderObject<RenderBox>(
      find.descendant(of: selectedItem, matching: find.text('Paramètres')),
    );
    final labelRect = Rect.fromPoints(
      labelBox.localToGlobal(Offset.zero),
      labelBox.localToGlobal(labelBox.size.bottomRight(Offset.zero)),
    );

    expect(iconRect.left, greaterThanOrEqualTo(indicatorRect.left));
    expect(iconRect.top, greaterThanOrEqualTo(indicatorRect.top));
    expect(iconRect.right, lessThanOrEqualTo(indicatorRect.right));
    expect(iconRect.bottom, lessThanOrEqualTo(indicatorRect.bottom));
    expect(labelRect.left, greaterThanOrEqualTo(indicatorRect.left));
    expect(labelRect.top, greaterThanOrEqualTo(indicatorRect.top));
    expect(labelRect.right, lessThanOrEqualTo(indicatorRect.right));
    expect(labelRect.bottom, lessThanOrEqualTo(indicatorRect.bottom));
    expect(labelRect.left - indicatorRect.left, greaterThanOrEqualTo(8));
    expect(indicatorRect.right - labelRect.right, greaterThanOrEqualTo(8));
    expect(iconRect.top - indicatorRect.top, greaterThanOrEqualTo(12));
    expect(indicatorRect.bottom - labelRect.bottom, greaterThanOrEqualTo(13));
  });

  testWidgets('Bottom nav keeps every normal-scale label fully readable', (
    tester,
  ) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(390, 800));

    for (var index = 0; index < navItems.length; index++) {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            bottomNavigationBar: AirQrBottomNav(
              currentIndex: index,
              onTap: (_) {},
              items: navItems,
            ),
          ),
        ),
      );

      final selectedItem = find.byKey(Key('airqr-bottom-nav-item-$index'));
      final labelFinder = find.descendant(
        of: selectedItem,
        matching: find.text(navItems[index].label),
      );
      final label = tester.widget<Text>(labelFinder);
      final paragraph = tester.renderObject<RenderParagraph>(labelFinder);

      expect(label.maxLines, 1);
      expect(label.overflow, isNot(TextOverflow.ellipsis));
      expect(paragraph.didExceedMaxLines, isFalse);
    }
  });

  testWidgets('Bottom nav gives every destination a 48dp target', (
    tester,
  ) async {
    await pumpBottomNav(tester);

    for (var index = 0; index < navItems.length; index++) {
      final size = tester.getSize(
        find.byKey(Key('airqr-bottom-nav-item-$index')),
      );
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
    }
  });

  testWidgets(
    'MainPage keeps bottom navigation at compact and desktop widths',
    (tester) async {
      addTearDown(() => tester.binding.setSurfaceSize(null));

      Future<void> pumpAt(double width) async {
        await tester.binding.setSurfaceSize(Size(width, 900));
        await tester.pumpWidget(
          MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: MainPage(
              buildScannerPage:
                  ({required settingsChangedNotifier, required isActive}) =>
                      const SizedBox.shrink(),
            ),
          ),
        );
        await tester.pump();
      }

      for (final width in [390.0, 1600.0]) {
        await pumpAt(width);
        expect(find.byType(AirQrBottomNav), findsOneWidget);
        expect(find.byType(NavigationRail), findsNothing);
        for (var index = 0; index < 5; index++) {
          expect(
            find.byKey(Key('airqr-bottom-nav-item-$index')),
            findsOneWidget,
          );
        }
      }

      final navRect = tester.getRect(find.byKey(const Key('airqr-bottom-nav')));
      expect(navRect.width, lessThanOrEqualTo(560));
      expect(navRect.center.dx, closeTo(800, 1));

      await tester.tap(find.byKey(const Key('airqr-bottom-nav-item-4')));
      await tester.pump();
      expect(
        tester
            .widget<SettingsPage>(
              find.byType(SettingsPage, skipOffstage: false),
            )
            .isActive,
        isTrue,
      );

      await tester.tap(find.byKey(const Key('airqr-bottom-nav-item-3')));
      await tester.pump();
      expect(
        tester
            .widget<HistoryPage>(find.byType(HistoryPage, skipOffstage: false))
            .isActive,
        isTrue,
      );
    },
  );

  testWidgets('MainPage content extends behind the floating bottom nav', (
    tester,
  ) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(390, 844));
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: MainPage(
          buildScannerPage:
              ({required settingsChangedNotifier, required isActive}) =>
                  Builder(
                    builder: (context) => Text(
                      '${MediaQuery.paddingOf(context).bottom}',
                      key: const Key('scanner-bottom-padding'),
                    ),
                  ),
        ),
      ),
    );

    final pageStackRect = tester.getRect(
      find.byKey(const Key('airqr-page-stack')),
    );
    final navRect = tester.getRect(find.byKey(const Key('airqr-bottom-nav')));
    expect(pageStackRect.bottom, 844);
    expect(pageStackRect.bottom, greaterThan(navRect.top));
    expect(find.text('0.0'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('compact destinations expose one selected button semantic', (
    tester,
  ) async {
    var selectedIndex = -1;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          bottomNavigationBar: AirQrBottomNav(
            currentIndex: 2,
            onTap: (index) => selectedIndex = index,
            items: navItems,
          ),
        ),
      ),
    );

    final node = tester.getSemantics(
      find.byKey(const Key('airqr-bottom-nav-item-2')),
    );
    expect(node.label, 'Scanner');
    expect(node.flagsCollection.isButton, isTrue);
    expect(node.flagsCollection.isSelected, Tristate.isTrue);
    expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);

    node.owner!.performAction(node.id, SemanticsAction.tap);
    await tester.pump();
    expect(selectedIndex, 2);

    selectedIndex = -1;
    for (var index = 0; index < 3; index++) {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    }
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(selectedIndex, 2);
  });

  testWidgets('compact navigation honors reduced motion', (tester) async {
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(disableAnimations: true),
        child: MaterialApp(
          home: Scaffold(
            bottomNavigationBar: AirQrBottomNav(
              currentIndex: 0,
              onTap: (_) {},
              items: navItems,
            ),
          ),
        ),
      ),
    );

    final indicator = tester.widget<AnimatedPositioned>(
      find.ancestor(
        of: find.byKey(const Key('airqr-bottom-nav-active-indicator')),
        matching: find.byType(AnimatedPositioned),
      ),
    );
    expect(indicator.duration, Duration.zero);
  });

  testWidgets('compact navigation tolerates large text without overflow', (
    tester,
  ) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(390, 800));
    await tester.pumpWidget(
      MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(2)),
        child: MaterialApp(
          home: Scaffold(
            bottomNavigationBar: AirQrBottomNav(
              currentIndex: 0,
              onTap: (_) {},
              items: navItems,
            ),
          ),
        ),
      ),
    );

    final selectedItem = find.byKey(const Key('airqr-bottom-nav-item-0'));
    final labelFinder = find.descendant(
      of: selectedItem,
      matching: find.text('Encodeur'),
    );
    final indicatorRect = tester.getRect(
      find.byKey(const Key('airqr-bottom-nav-active-indicator')),
    );
    final labelRect = tester.getRect(labelFinder);
    final iconRect = tester.getRect(
      find.descendant(of: selectedItem, matching: find.byType(AirQrIcon)),
    );
    expect(labelRect.top, greaterThanOrEqualTo(indicatorRect.top));
    expect(labelRect.bottom, lessThanOrEqualTo(indicatorRect.bottom));
    expect(indicatorRect.contains(iconRect.topLeft), isTrue);
    expect(indicatorRect.contains(iconRect.bottomRight), isTrue);
    expect(tester.takeException(), isNull);
  });

  testWidgets('MyApp starts without a legacy native error surface', (
    tester,
  ) async {
    await tester.pumpWidget(
      MyApp(
        buildScannerPage:
            ({required settingsChangedNotifier, required isActive}) {
              return const SizedBox.shrink();
            },
      ),
    );

    expect(find.text('Native Library Init Failed'), findsNothing);
  });

  test('AirQR themes use the same Manrope display font as the web app', () {
    expect(buildAirQrLightTheme().textTheme.bodyMedium?.fontFamily, 'Manrope');
    expect(buildAirQrDarkTheme().textTheme.bodyMedium?.fontFamily, 'Manrope');
  });
}
