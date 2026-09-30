// ignore: unnecessary_import, required for explicit typography feature tokens.
import 'dart:ui' show FontFeature;

import 'package:flutter/material.dart';

abstract final class AirQrRadii {
  static const BorderRadius control = BorderRadius.all(Radius.circular(18));
  static const BorderRadius panel = BorderRadius.all(Radius.circular(22));
  static const BorderRadius card = BorderRadius.all(Radius.circular(30));
}

@immutable
class AirQrTypography extends ThemeExtension<AirQrTypography> {
  final TextStyle numeric;
  final TextStyle liveNumeric;
  final TextStyle primaryAction;
  final TextStyle compactStatus;

  const AirQrTypography({
    required this.numeric,
    required this.liveNumeric,
    required this.primaryAction,
    required this.compactStatus,
  });

  static const standard = AirQrTypography(
    numeric: TextStyle(
      fontFamily: 'monospace',
      fontSize: 15,
      height: 1.35,
      fontWeight: FontWeight.w700,
      fontFeatures: [FontFeature.tabularFigures()],
    ),
    liveNumeric: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 15,
      height: 1.35,
      fontWeight: FontWeight.w700,
      fontFeatures: [FontFeature.tabularFigures()],
    ),
    primaryAction: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 16,
      height: 1.25,
      fontWeight: FontWeight.w700,
    ),
    compactStatus: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 12,
      height: 1.35,
      fontWeight: FontWeight.w600,
    ),
  );

  static AirQrTypography of(BuildContext context) =>
      Theme.of(context).extension<AirQrTypography>() ?? standard;

  @override
  AirQrTypography copyWith({
    TextStyle? numeric,
    TextStyle? liveNumeric,
    TextStyle? primaryAction,
    TextStyle? compactStatus,
  }) => AirQrTypography(
    numeric: numeric ?? this.numeric,
    liveNumeric: liveNumeric ?? this.liveNumeric,
    primaryAction: primaryAction ?? this.primaryAction,
    compactStatus: compactStatus ?? this.compactStatus,
  );

  @override
  AirQrTypography lerp(covariant AirQrTypography? other, double t) {
    if (other == null) return this;
    return AirQrTypography(
      numeric: TextStyle.lerp(numeric, other.numeric, t)!,
      liveNumeric: TextStyle.lerp(liveNumeric, other.liveNumeric, t)!,
      primaryAction: TextStyle.lerp(primaryAction, other.primaryAction, t)!,
      compactStatus: TextStyle.lerp(compactStatus, other.compactStatus, t)!,
    );
  }
}

class AirQrTheme {
  static WidgetStateProperty<Color?> interactionOverlay(BuildContext context) {
    final color = textPrimary(context);
    return WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.pressed)) {
        return color.withValues(alpha: 0.16);
      }
      if (states.contains(WidgetState.focused)) {
        return color.withValues(alpha: 0.12);
      }
      if (states.contains(WidgetState.hovered)) {
        return color.withValues(alpha: 0.08);
      }
      return null;
    });
  }

  static SliderThemeData viewerTimelineTheme(BuildContext context) =>
      SliderTheme.of(context).copyWith(
        activeTrackColor: textSecondary(context),
        inactiveTrackColor: controlBorder(context),
        thumbColor: textPrimary(context),
        overlayColor: textPrimary(context).withValues(alpha: 0.10),
        trackHeight: 4,
      );

  static const TextTheme textTheme = TextTheme(
    displayLarge: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 28,
      height: 1.15,
      fontWeight: FontWeight.w800,
    ),
    titleLarge: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 20,
      height: 1.25,
      fontWeight: FontWeight.w700,
    ),
    titleMedium: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 16,
      height: 1.35,
      fontWeight: FontWeight.w700,
    ),
    bodyLarge: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 16,
      height: 1.5,
      fontWeight: FontWeight.w400,
    ),
    bodyMedium: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 16,
      height: 1.45,
      fontWeight: FontWeight.w400,
    ),
    labelLarge: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 16,
      height: 1.25,
      fontWeight: FontWeight.w700,
    ),
    labelMedium: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 12,
      height: 1.35,
      fontWeight: FontWeight.w600,
    ),
    labelSmall: TextStyle(
      fontFamily: 'Manrope',
      fontSize: 12,
      height: 1.35,
      fontWeight: FontWeight.w500,
    ),
  );

  static const Color lightBackground = Color(0xFFF4F7FA);
  static const Color darkBackground = Color(0xFF0B141F);

  static const Color lightTextPrimary = Color(0xFF111820);
  static const Color darkTextPrimary = Color(0xFFFFFFFF);

  static const Color lightTextSecondary = Color(0xAD111820);
  static const Color darkTextSecondary = Color(0xA8FFFFFF);
  static const Color lightIconPrimary = lightTextSecondary;
  static const Color darkIconPrimary = darkTextPrimary;

  static const Color lightTextMuted = Color(0xFF59616A);
  static const Color darkTextMuted = Color(0xFFA9B2BC);

  static const Color lightCard = Color(0xBDFFFFFF);
  static const Color darkCard = Color(0xFF2A3744);
  static const Color lightCardHover = Color(0xEAF5F8FB);
  static const Color darkCardHover = Color(0xFF37424F);
  static const Color lightSubcardSurface = Color(0xD1E8EEF4);
  static const Color darkSubcardSurface = Color(0xFF37424F);

  static const Color lightIconSurface = Color(0xD6DEE6EE);
  static const Color darkIconSurface = Color(0x1AFFFFFF);
  static const Color lightControlSurface = Color(0xD1E0E8EF);
  static const Color darkControlSurface = Color(0xFF37424F);

  static const Color lightNavSurface = Color(0xDBE8EEF4);
  static const Color darkNavSurface = Color(0x94101113);

  static const Color lightNavActive = Color(0xEAC6D1DC);
  static const Color darkNavActive = Color(0xFF35393D);
  static const Color lightSwitchSelectedTrack = Color(0xFF5F7F99);
  static const Color darkSwitchSelectedTrack = Color(0xFF7595AE);

  static const Color lightActionSurface = Color(0xEAD1DCE6);
  static const Color darkActionSurface = Color(0xFF212324);
  static const Color lightProgressText = lightTextPrimary;
  static const Color darkProgressText = darkTextPrimary;
  static const Color lightActionHover = Color(0xF5BECCD9);
  static const Color darkActionHover = Color(0xFF35393D);
  static const Color lightPrimaryButtonSurface = Color(0xEA8BABC5);
  static const Color darkPrimaryButtonSurface = Color(0xFFFFFFFF);
  static const Color lightPrimaryButtonHover = Color(0xF57799B5);
  static const Color darkPrimaryButtonHover = Color(0xE6FFFFFF);
  static const Color lightPreviewSurface = Color(0xBDE7EDF3);
  static const Color darkPreviewSurface = Color(0x94101113);
  static const Color lightControlPanelSurface = Color(0xC7D5E0EA);
  static const Color darkControlPanelSurface = Color(0xB8101113);
  static const Color lightBackSurface = Color(0xEAD5E0EA);
  static const Color darkBackSurface = Color(0xC7101113);
  static const Color lightBackHover = Color(0xF5C2CFDC);
  static const Color darkBackHover = Color(0xE0202020);

  static const Color lightControlBorder = Color(0x1C111820);
  static const Color darkControlBorder = Color(0x12FFFFFF);
  static const Color lightDivider = Color(0x14111820);
  static const Color darkDivider = Color(0x0FFFFFFF);

  static const Color accentBlue = Color(0xFF334CFF);
  static const Color progressOrange = Color(0xFFFFC46B);
  static const Color destructive = Color(0xFFEF4444);
  static const Color success = Color(0xFF16A34A);

  static const Color lightAccentText = Color(0xFF334CFF);
  static const Color darkAccentText = Color(0xFF9BA8FF);
  static const Color lightLinkText = lightAccentText;
  static const Color darkLinkText = darkAccentText;
  static const Color lightSuccessText = Color(0xFF0F7A37);
  static const Color darkSuccessText = Color(0xFFBBF7D0);
  static const Color lightWarningText = Color(0xFFB45309);
  static const Color darkWarningText = Color(0xFFFED7AA);
  static const Color lightDangerText = Color(0xFFB91C1C);
  static const Color darkDangerText = Color(0xFFFCA5A5);

  static bool isDark(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark;

  static Color background(BuildContext context) =>
      isDark(context) ? darkBackground : lightBackground;

  static Color textPrimary(BuildContext context) =>
      isDark(context) ? darkTextPrimary : lightTextPrimary;

  static Color textSecondary(BuildContext context) =>
      isDark(context) ? darkTextSecondary : lightTextSecondary;

  static Color iconPrimary(BuildContext context) =>
      isDark(context) ? darkIconPrimary : lightIconPrimary;

  static Color resolveIconColor(BuildContext context, Color? requestedColor) {
    final fallbackColor =
        Theme.of(context).iconTheme.color ?? iconPrimary(context);
    final resolvedColor = requestedColor ?? fallbackColor;

    return resolvedColor == textPrimary(context)
        ? iconPrimary(context)
        : resolvedColor;
  }

  static Color textMuted(BuildContext context) =>
      isDark(context) ? darkTextMuted : lightTextMuted;

  static Color card(BuildContext context) =>
      isDark(context) ? darkCard : lightCard;

  static Color cardHover(BuildContext context) =>
      isDark(context) ? darkCardHover : lightCardHover;

  static Color subcardSurface(BuildContext context) =>
      isDark(context) ? darkSubcardSurface : lightSubcardSurface;

  static Color iconSurface(BuildContext context) =>
      isDark(context) ? darkIconSurface : lightIconSurface;

  static Color controlSurface(BuildContext context) =>
      isDark(context) ? darkControlSurface : lightControlSurface;

  static Color navSurface(BuildContext context) =>
      isDark(context) ? darkNavSurface : lightNavSurface;

  static Color navActive(BuildContext context) =>
      isDark(context) ? darkNavActive : lightNavActive;

  static Color switchSelectedTrack(BuildContext context) =>
      isDark(context) ? darkSwitchSelectedTrack : lightSwitchSelectedTrack;

  static Color loadingIndicator(BuildContext context) =>
      switchSelectedTrack(context);

  static Color actionSurface(BuildContext context) =>
      isDark(context) ? darkActionSurface : lightActionSurface;

  static Color progressText(BuildContext context) =>
      isDark(context) ? darkProgressText : lightProgressText;

  static Color actionHover(BuildContext context) =>
      isDark(context) ? darkActionHover : lightActionHover;

  static Color primaryButtonSurface(BuildContext context) =>
      isDark(context) ? darkPrimaryButtonSurface : lightPrimaryButtonSurface;

  static Color primaryButtonForeground(BuildContext context) =>
      isDark(context) ? darkBackground : lightTextPrimary;

  static Color primaryButtonHover(BuildContext context) =>
      isDark(context) ? darkPrimaryButtonHover : lightPrimaryButtonHover;

  static Color previewSurface(BuildContext context) =>
      isDark(context) ? darkPreviewSurface : lightPreviewSurface;

  static Color controlPanelSurface(BuildContext context) =>
      isDark(context) ? darkControlPanelSurface : lightControlPanelSurface;

  static Color backSurface(BuildContext context) =>
      isDark(context) ? darkBackSurface : lightBackSurface;

  static Color backHover(BuildContext context) =>
      isDark(context) ? darkBackHover : lightBackHover;

  static Color controlBorder(BuildContext context) =>
      isDark(context) ? darkControlBorder : lightControlBorder;

  static Color divider(BuildContext context) =>
      isDark(context) ? darkDivider : lightDivider;

  static Color accentText(BuildContext context) =>
      isDark(context) ? darkAccentText : lightAccentText;

  static Color linkText(BuildContext context) =>
      isDark(context) ? darkLinkText : lightLinkText;

  static Color successText(BuildContext context) =>
      isDark(context) ? darkSuccessText : lightSuccessText;

  static Color warningText(BuildContext context) =>
      isDark(context) ? darkWarningText : lightWarningText;

  static Color dangerText(BuildContext context) =>
      isDark(context) ? darkDangerText : lightDangerText;

  static Color successSurface(BuildContext context) =>
      success.withValues(alpha: isDark(context) ? 0.14 : 0.12);

  static Color warningSurface(BuildContext context) =>
      progressOrange.withValues(alpha: isDark(context) ? 0.18 : 0.15);

  static Color dangerSurface(BuildContext context) =>
      destructive.withValues(alpha: isDark(context) ? 0.16 : 0.13);

  static Color disabledSurface(BuildContext context) =>
      isDark(context) ? const Color(0x0DFFFFFF) : const Color(0x0F111820);

  static Color disabledText(BuildContext context) =>
      isDark(context) ? const Color(0x4DFFFFFF) : const Color(0x4D111820);
}
