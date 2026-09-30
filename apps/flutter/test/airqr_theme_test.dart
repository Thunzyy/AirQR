import 'dart:math' as math;
// ignore: unnecessary_import, keeps FontFeature assertions explicit.
import 'dart:ui' show FontFeature;

import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/app/app_shell.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/settings_page_sections.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('semantic radii expose the exact control panel and card geometry', () {
    expect(AirQrRadii.control, BorderRadius.circular(18));
    expect(AirQrRadii.panel, BorderRadius.circular(22));
    expect(AirQrRadii.card, BorderRadius.circular(30));
  });

  test('numeric roles use tabular figures and their specified typefaces', () {
    const tabularFigures = FontFeature.tabularFigures();
    final typography = AirQrTypography.standard;

    expect(typography.liveNumeric.fontFamily, 'Manrope');
    expect(typography.liveNumeric.fontSize, 15);
    expect(typography.liveNumeric.fontWeight, FontWeight.w700);
    expect(typography.liveNumeric.fontFeatures, contains(tabularFigures));

    expect(typography.numeric.fontFamily, 'monospace');
    expect(typography.numeric.fontWeight, FontWeight.w700);
    expect(typography.numeric.fontFeatures, contains(tabularFigures));
  });

  test('live numeric typography is preserved by copyWith and lerp', () {
    const replacement = TextStyle(fontSize: 19);
    final copied = AirQrTypography.standard.copyWith(liveNumeric: replacement);
    final lerped = AirQrTypography.standard.lerp(copied, 1);

    expect(copied.liveNumeric, replacement);
    expect(lerped.liveNumeric.fontSize, replacement.fontSize);
  });

  testWidgets('low-priority text roles meet normal-text contrast minimums', (
    tester,
  ) async {
    for (final theme in [buildAirQrLightTheme(), buildAirQrDarkTheme()]) {
      late Color progressText;
      late Color actionSurface;
      late Color textMuted;
      late Color background;

      await tester.pumpWidget(
        MaterialApp(
          theme: theme,
          home: Builder(
            builder: (context) {
              progressText = AirQrTheme.progressText(context);
              actionSurface = AirQrTheme.actionSurface(context);
              textMuted = AirQrTheme.textMuted(context);
              background = AirQrTheme.background(context);
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      expect(
        _contrastRatio(progressText, actionSurface, background),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        _contrastRatio(textMuted, background, background),
        greaterThanOrEqualTo(4.5),
      );
    }
  });

  testWidgets('about links use readable semantic colors in both themes', (
    tester,
  ) async {
    for (final theme in [buildAirQrLightTheme(), buildAirQrDarkTheme()]) {
      late Color semanticLinkColor;
      late Color primaryButtonForeground;
      await tester.pumpWidget(
        MaterialApp(
          theme: theme,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) {
              semanticLinkColor = AirQrTheme.linkText(context);
              primaryButtonForeground = AirQrTheme.primaryButtonForeground(
                context,
              );
              return Scaffold(
                body: SettingsAboutSection(
                  palette: SettingsSectionPalette(
                    isDarkMode: theme.brightness == Brightness.dark,
                    primaryColor: AirQrTheme.accentText(context),
                    primaryTextColor: AirQrTheme.textPrimary(context),
                    secondaryTextColor: AirQrTheme.textSecondary(context),
                    cardBackgroundColor: AirQrTheme.card(context),
                    fieldBackgroundColor: AirQrTheme.controlSurface(context),
                    subtleBorderColor: AirQrTheme.controlBorder(context),
                    segmentedBackgroundColor: AirQrTheme.navSurface(context),
                    clearButtonBackgroundColor: AirQrTheme.dangerSurface(
                      context,
                    ),
                    clearButtonForegroundColor: AirQrTheme.dangerText(context),
                  ),
                  version: '1.0.0',
                  author: 'AirQR author',
                  onOpenAuthorUrl: () {},
                  onOpenRepoUrl: () {},
                ),
              );
            },
          ),
        ),
      );

      final author = tester.widget<Text>(find.text('AirQR author'));
      expect(author.style?.color, semanticLinkColor);
      final authorControl = find.ancestor(
        of: find.text('AirQR author'),
        matching: find.byType(InkWell),
      );
      expect(tester.getSize(authorControl).height, greaterThanOrEqualTo(48));
      expect(
        (tester.getCenter(find.text('Made with ❤️ by')).dy -
                tester.getCenter(find.text('AirQR author')).dy)
            .abs(),
        lessThan(1),
      );

      final githubLabel = tester.widget<Text>(find.text('Star on GitHub'));
      expect(githubLabel.style?.color, primaryButtonForeground);
    }
  });

  test('light and dark themes share the semantic AirQR type system', () {
    final light = buildAirQrLightTheme();
    final dark = buildAirQrDarkTheme();

    for (final theme in [light, dark]) {
      expect(theme.textTheme.displayLarge?.fontFamily, 'Manrope');
      expect(theme.textTheme.displayLarge?.fontSize, 28);
      expect(theme.textTheme.titleLarge?.fontSize, 20);
      expect(theme.textTheme.bodyLarge?.fontSize, 16);
      expect(theme.textTheme.labelMedium?.fontSize, 12);

      final typography = theme.extension<AirQrTypography>();
      expect(typography, isNotNull);
      expect(typography!.numeric.fontSize, 15);
      expect(typography.numeric.fontFamily, 'monospace');
      expect(typography.primaryAction.fontSize, 16);
      expect(typography.primaryAction.fontWeight, FontWeight.w700);
      expect(typography.compactStatus.fontSize, 12);
    }

    for (final role in <TextStyle? Function(TextTheme)>[
      (theme) => theme.displayLarge,
      (theme) => theme.titleLarge,
      (theme) => theme.bodyLarge,
      (theme) => theme.labelMedium,
    ]) {
      final lightRole = role(light.textTheme)!;
      final darkRole = role(dark.textTheme)!;
      expect(lightRole.fontFamily, darkRole.fontFamily);
      expect(lightRole.fontSize, darkRole.fontSize);
      expect(lightRole.fontWeight, darkRole.fontWeight);
      expect(lightRole.height, darkRole.height);
    }
    expect(
      light.extension<AirQrTypography>(),
      dark.extension<AirQrTypography>(),
    );
  });

  test('switch themes use calm selected tracks in light and dark mode', () {
    final light = buildAirQrLightTheme();
    final dark = buildAirQrDarkTheme();
    const selected = <WidgetState>{WidgetState.selected};

    expect(
      light.switchTheme.trackColor?.resolve(selected),
      AirQrTheme.lightSwitchSelectedTrack,
    );
    expect(
      dark.switchTheme.trackColor?.resolve(selected),
      AirQrTheme.darkSwitchSelectedTrack,
    );
    expect(light.switchTheme.thumbColor?.resolve(selected), Colors.white);
    expect(dark.switchTheme.thumbColor?.resolve(selected), Colors.white);
    expect(
      light.progressIndicatorTheme.color,
      AirQrTheme.lightSwitchSelectedTrack,
    );
    expect(
      dark.progressIndicatorTheme.color,
      AirQrTheme.darkSwitchSelectedTrack,
    );

    for (final colors in [
      (
        track: AirQrTheme.lightSwitchSelectedTrack,
        surface: AirQrTheme.lightControlSurface,
        background: AirQrTheme.lightBackground,
      ),
      (
        track: AirQrTheme.darkSwitchSelectedTrack,
        surface: AirQrTheme.darkControlSurface,
        background: AirQrTheme.darkBackground,
      ),
    ]) {
      expect(
        _contrastRatio(colors.track, Colors.white, colors.background),
        greaterThanOrEqualTo(3),
      );
      expect(
        _contrastRatio(colors.track, colors.surface, colors.background),
        greaterThanOrEqualTo(3),
      );
    }
  });

  test('AirQrTheme mirrors the web CSS token colors', () {
    expect(AirQrTheme.lightBackground, const Color(0xFFF4F7FA));
    expect(AirQrTheme.darkBackground, const Color(0xFF0B141F));

    expect(AirQrTheme.lightCard, const Color(0xBDFFFFFF));
    expect(AirQrTheme.darkCard, const Color(0xFF2A3744));
    expect(AirQrTheme.lightCardHover, const Color(0xEAF5F8FB));
    expect(AirQrTheme.darkCardHover, const Color(0xFF37424F));
    expect(AirQrTheme.lightSubcardSurface, const Color(0xD1E8EEF4));
    expect(AirQrTheme.darkSubcardSurface, const Color(0xFF37424F));

    expect(AirQrTheme.lightIconSurface, const Color(0xD6DEE6EE));
    expect(AirQrTheme.darkIconSurface, const Color(0x1AFFFFFF));
    expect(AirQrTheme.lightControlSurface, const Color(0xD1E0E8EF));
    expect(AirQrTheme.darkControlSurface, const Color(0xFF37424F));
    expect(AirQrTheme.lightControlBorder, const Color(0x1C111820));
    expect(AirQrTheme.darkControlBorder, const Color(0x12FFFFFF));
    expect(AirQrTheme.lightDivider, const Color(0x14111820));
    expect(AirQrTheme.darkDivider, const Color(0x0FFFFFFF));

    expect(AirQrTheme.lightNavSurface, const Color(0xDBE8EEF4));
    expect(AirQrTheme.darkNavSurface, const Color(0x94101113));
    expect(AirQrTheme.lightNavActive, const Color(0xEAC6D1DC));
    expect(AirQrTheme.darkNavActive, const Color(0xFF35393D));
    expect(AirQrTheme.lightSwitchSelectedTrack, const Color(0xFF5F7F99));
    expect(AirQrTheme.darkSwitchSelectedTrack, const Color(0xFF7595AE));
    expect(AirQrTheme.lightActionSurface, const Color(0xEAD1DCE6));
    expect(AirQrTheme.darkActionSurface, const Color(0xFF212324));
    expect(AirQrTheme.lightActionHover, const Color(0xF5BECCD9));
    expect(AirQrTheme.darkActionHover, const Color(0xFF35393D));
    expect(AirQrTheme.lightPrimaryButtonSurface, const Color(0xEA8BABC5));
    expect(AirQrTheme.darkPrimaryButtonSurface, const Color(0xFFFFFFFF));
    expect(AirQrTheme.lightPrimaryButtonHover, const Color(0xF57799B5));
    expect(AirQrTheme.darkPrimaryButtonHover, const Color(0xE6FFFFFF));
    expect(AirQrTheme.lightPreviewSurface, const Color(0xBDE7EDF3));
    expect(AirQrTheme.darkPreviewSurface, const Color(0x94101113));
    expect(AirQrTheme.lightControlPanelSurface, const Color(0xC7D5E0EA));
    expect(AirQrTheme.darkControlPanelSurface, const Color(0xB8101113));
    expect(AirQrTheme.lightBackSurface, const Color(0xEAD5E0EA));
    expect(AirQrTheme.darkBackSurface, const Color(0xC7101113));
    expect(AirQrTheme.lightBackHover, const Color(0xF5C2CFDC));
    expect(AirQrTheme.darkBackHover, const Color(0xE0202020));
  });

  test(
    'Material secondary color resolves through the semantic success role',
    () {
      expect(buildAirQrLightTheme().colorScheme.secondary, AirQrTheme.success);
      expect(buildAirQrDarkTheme().colorScheme.secondary, AirQrTheme.success);
    },
  );
}

double _contrastRatio(Color foreground, Color surface, Color background) {
  final opaqueSurface = _composite(surface, background);
  final opaqueForeground = _composite(foreground, opaqueSurface);
  final lighter = math.max(
    opaqueForeground.computeLuminance(),
    opaqueSurface.computeLuminance(),
  );
  final darker = math.min(
    opaqueForeground.computeLuminance(),
    opaqueSurface.computeLuminance(),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

Color _composite(Color foreground, Color background) =>
    Color.alphaBlend(foreground, background);
