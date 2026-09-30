import 'package:flutter/material.dart';

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'camera_preferences.dart';
import 'l10n/app_localizations.dart';
import 'scanner_config.dart';
import 'settings_page_widgets.dart';
import 'settings_sync_controller.dart';
import 'settings_export_config_controller.dart';
import 'sync_settings.dart';

Duration settingsAnimationDuration(BuildContext context, Duration duration) =>
    MediaQuery.disableAnimationsOf(context) ? Duration.zero : duration;

class SettingsSectionPalette {
  final bool isDarkMode;
  final Color primaryColor;
  final Color cardBackgroundColor;
  final Color fieldBackgroundColor;
  final Color primaryTextColor;
  final Color secondaryTextColor;
  final Color subtleBorderColor;
  final Color segmentedBackgroundColor;
  final Color clearButtonBackgroundColor;
  final Color clearButtonForegroundColor;

  const SettingsSectionPalette({
    required this.isDarkMode,
    required this.primaryColor,
    required this.cardBackgroundColor,
    required this.fieldBackgroundColor,
    required this.primaryTextColor,
    required this.secondaryTextColor,
    required this.subtleBorderColor,
    required this.segmentedBackgroundColor,
    required this.clearButtonBackgroundColor,
    required this.clearButtonForegroundColor,
  });

  Color get sliderInactiveTrackColor => subtleBorderColor;

  Color get focusedBorderColor => AirQrTheme.accentBlue;

  Color get languageBorderColor =>
      AirQrTheme.accentBlue.withValues(alpha: 0.55);
}

class SettingsEncoderSection extends StatelessWidget {
  final SettingsSectionPalette palette;
  final int fps;
  final String ecc;
  final int packetSize;
  final double raptorqOverhead;
  final int targetSize;
  final bool compressionEnabled;
  final bool forceChunkMode;
  final int customChunkSize;
  final ValueChanged<double> onFpsChanged;
  final VoidCallback onPersist;
  final ValueChanged<String> onEccChanged;
  final ValueChanged<double> onPacketSizeChanged;
  final ValueChanged<double> onRaptorqOverheadChanged;
  final ValueChanged<double> onTargetSizeChanged;
  final ValueChanged<bool> onCompressionChanged;
  final ValueChanged<bool> onForceChunkModeChanged;
  final ValueChanged<double> onCustomChunkSizeChanged;

  const SettingsEncoderSection({
    super.key,
    required this.palette,
    required this.fps,
    required this.ecc,
    required this.packetSize,
    required this.raptorqOverhead,
    required this.targetSize,
    required this.compressionEnabled,
    required this.forceChunkMode,
    required this.customChunkSize,
    required this.onFpsChanged,
    required this.onPersist,
    required this.onEccChanged,
    required this.onPacketSizeChanged,
    required this.onRaptorqOverheadChanged,
    required this.onTargetSizeChanged,
    required this.onCompressionChanged,
    required this.onForceChunkModeChanged,
    required this.onCustomChunkSizeChanged,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SettingsCard(
          backgroundColor: palette.cardBackgroundColor,
          borderColor: palette.subtleBorderColor,
          children: [
            SettingsSliderTile(
              label: l10n.settings_frameRate,
              value: fps.toDouble(),
              min: 1,
              max: 60,
              onChanged: onFpsChanged,
              onChangeEnd: onPersist,
              primaryTextColor: palette.primaryTextColor,
              accentColor: palette.primaryColor,
              inactiveTrackColor: palette.sliderInactiveTrackColor,
              suffix: ' fps',
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsSliderTile(
              label: l10n.settings_packetSize,
              value: packetSize.toDouble(),
              min: 100,
              max: 2800,
              onChanged: onPacketSizeChanged,
              onChangeEnd: onPersist,
              primaryTextColor: palette.primaryTextColor,
              accentColor: palette.primaryColor,
              inactiveTrackColor: palette.sliderInactiveTrackColor,
              suffix: ' bytes',
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsDropdownTile(
              label: l10n.encoder_errorCorrection,
              value: ecc,
              options: const ['LOW', 'MEDIUM', 'QUARTILE', 'HIGH'],
              onChanged: onEccChanged,
              primaryTextColor: palette.primaryTextColor,
              accentColor: palette.primaryColor,
              fieldBackgroundColor: AirQrTheme.controlSurface(context),
              borderColor: palette.subtleBorderColor,
              dropdownColor: AirQrTheme.controlSurface(context),
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsSliderTile(
              label: l10n.encoder_targetQrSize,
              value: targetSize.toDouble(),
              min: 100,
              max: 400,
              onChanged: onTargetSizeChanged,
              onChangeEnd: onPersist,
              primaryTextColor: palette.primaryTextColor,
              accentColor: palette.primaryColor,
              inactiveTrackColor: palette.sliderInactiveTrackColor,
              suffix: 'px',
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsSliderTile(
              label: l10n.encoder_raptorqOverhead,
              value: raptorqOverhead,
              min: 1.0,
              max: 3.0,
              onChanged: onRaptorqOverheadChanged,
              onChangeEnd: onPersist,
              primaryTextColor: palette.primaryTextColor,
              accentColor: palette.primaryColor,
              inactiveTrackColor: palette.sliderInactiveTrackColor,
              suffix: 'x',
              decimals: 1,
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsSwitchTile(
              label: l10n.encoder_compression,
              subtitle: l10n.encoder_compressionDesc,
              value: compressionEnabled,
              onChanged: onCompressionChanged,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsSwitchTile(
              label: l10n.encoder_forceChunkMode,
              subtitle: l10n.encoder_forceChunkModeDesc,
              value: forceChunkMode,
              onChanged: onForceChunkModeChanged,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
            ),
            if (forceChunkMode) ...[
              SettingsCardDivider(color: palette.subtleBorderColor),
              SettingsSliderTile(
                label: l10n.encoder_chunkSize,
                value: customChunkSize.toDouble(),
                min: 1,
                max: 50,
                onChanged: onCustomChunkSizeChanged,
                onChangeEnd: onPersist,
                primaryTextColor: palette.primaryTextColor,
                accentColor: palette.primaryColor,
                inactiveTrackColor: palette.sliderInactiveTrackColor,
                suffix: ' MB',
              ),
            ],
          ],
        ),
      ],
    );
  }
}

class SettingsScannerPresetSection extends StatelessWidget {
  final SettingsSectionPalette palette;
  final ScannerPreset selectedPreset;
  final ValueChanged<ScannerPreset> onPresetChanged;

  const SettingsScannerPresetSection({
    super.key,
    required this.palette,
    required this.selectedPreset,
    required this.onPresetChanged,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 12),
          child: Text(
            l10n.settings_preset,
            style: TextStyle(
              color: palette.primaryTextColor.withValues(alpha: 0.82),
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        SettingsCard(
          backgroundColor: palette.cardBackgroundColor,
          borderColor: palette.subtleBorderColor,
          children: [
            SettingsPresetOption(
              emoji: '🚀',
              name: l10n.settings_preset_turbo,
              description: l10n.settings_preset_turboDesc,
              selected: selectedPreset == ScannerPreset.turbo,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
              selectedColor: palette.primaryColor,
              onTap: () => onPresetChanged(ScannerPreset.turbo),
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsPresetOption(
              emoji: '⚡',
              name: l10n.settings_preset_fast,
              description: l10n.settings_preset_fastDesc,
              selected: selectedPreset == ScannerPreset.fast,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
              selectedColor: palette.primaryColor,
              onTap: () => onPresetChanged(ScannerPreset.fast),
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsPresetOption(
              emoji: '⚖️',
              name: l10n.settings_preset_balanced,
              description: l10n.settings_preset_balancedDesc,
              selected: selectedPreset == ScannerPreset.balanced,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
              selectedColor: palette.primaryColor,
              onTap: () => onPresetChanged(ScannerPreset.balanced),
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsPresetOption(
              emoji: '🎯',
              name: l10n.settings_preset_reliable,
              description: l10n.settings_preset_reliableDesc,
              selected: selectedPreset == ScannerPreset.reliable,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
              selectedColor: palette.primaryColor,
              onTap: () => onPresetChanged(ScannerPreset.reliable),
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsPresetOption(
              emoji: '🔇',
              name: l10n.settings_preset_silent,
              description: l10n.settings_preset_silentDesc,
              selected: selectedPreset == ScannerPreset.silent,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
              selectedColor: palette.primaryColor,
              onTap: () => onPresetChanged(ScannerPreset.silent),
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsPresetOption(
              emoji: '🔧',
              name: l10n.settings_preset_custom,
              description: l10n.settings_preset_customDesc,
              selected: selectedPreset == ScannerPreset.custom,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
              selectedColor: palette.primaryColor,
              onTap: () => onPresetChanged(ScannerPreset.custom),
            ),
          ],
        ),
      ],
    );
  }
}

class SettingsScannerAdvancedSection extends StatelessWidget {
  final SettingsSectionPalette palette;
  final String resolutionValue;
  final ValueChanged<String> onResolutionChanged;
  final String detectionSpeedValue;
  final List<String> detectionSpeedOptions;
  final ValueChanged<String> onDetectionSpeedChanged;
  final int detectionTimeoutMs;
  final ValueChanged<double> onDetectionTimeoutChanged;
  final VoidCallback onDetectionTimeoutPersist;
  final bool torchEnabled;
  final ValueChanged<bool> onTorchChanged;
  final bool supportsDesktopCameraSelection;
  final bool supportsMobileCameraSelection;
  final List<String> desktopCameraDevices;
  final String? selectedDesktopCameraName;
  final MobileCameraFacingPreference mobileCameraFacing;
  final Future<void> Function(String?) onSaveDesktopCameraPreference;
  final Future<void> Function() onRefreshDesktopCameraDevices;
  final Future<void> Function(MobileCameraFacingPreference)
  onSaveMobileCameraPreference;

  const SettingsScannerAdvancedSection({
    super.key,
    required this.palette,
    required this.resolutionValue,
    required this.onResolutionChanged,
    required this.detectionSpeedValue,
    required this.detectionSpeedOptions,
    required this.onDetectionSpeedChanged,
    required this.detectionTimeoutMs,
    required this.onDetectionTimeoutChanged,
    required this.onDetectionTimeoutPersist,
    required this.torchEnabled,
    required this.onTorchChanged,
    required this.supportsDesktopCameraSelection,
    required this.supportsMobileCameraSelection,
    required this.desktopCameraDevices,
    required this.selectedDesktopCameraName,
    required this.mobileCameraFacing,
    required this.onSaveDesktopCameraPreference,
    required this.onRefreshDesktopCameraDevices,
    required this.onSaveMobileCameraPreference,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SettingsCard(
          backgroundColor: palette.cardBackgroundColor,
          borderColor: palette.subtleBorderColor,
          children: [
            if (supportsDesktopCameraSelection ||
                supportsMobileCameraSelection) ...[
              SettingsDefaultCameraTile(
                palette: palette,
                supportsDesktopCameraSelection: supportsDesktopCameraSelection,
                desktopCameraDevices: desktopCameraDevices,
                selectedDesktopCameraName: selectedDesktopCameraName,
                mobileCameraFacing: mobileCameraFacing,
                onSaveDesktopCameraPreference: onSaveDesktopCameraPreference,
                onRefreshDesktopCameraDevices: onRefreshDesktopCameraDevices,
                onSaveMobileCameraPreference: onSaveMobileCameraPreference,
              ),
              SettingsCardDivider(color: palette.subtleBorderColor),
            ],
            SettingsSliderTile(
              label: l10n.settings_scanInterval,
              value: detectionTimeoutMs.toDouble(),
              min: 0,
              max: 500,
              onChanged: onDetectionTimeoutChanged,
              onChangeEnd: onDetectionTimeoutPersist,
              primaryTextColor: palette.primaryTextColor,
              accentColor: palette.primaryColor,
              inactiveTrackColor: palette.sliderInactiveTrackColor,
              suffix: 'ms',
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            _SettingsSegmentedChoiceTile(
              label: l10n.settings_resolution,
              value: resolutionValue,
              options: const ['720p', '1080p', '1440p'],
              palette: palette,
              onChanged: onResolutionChanged,
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            _SettingsSegmentedChoiceTile(
              label: l10n.settings_detectionSpeed,
              value: detectionSpeedValue,
              options: detectionSpeedOptions,
              palette: palette,
              onChanged: onDetectionSpeedChanged,
              footer: l10n.settings_accurateModeHint,
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            SettingsSwitchTile(
              label: l10n.settings_torchFlash,
              subtitle: l10n.settings_torchFlashDesc,
              value: torchEnabled,
              onChanged: onTorchChanged,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
            ),
          ],
        ),
      ],
    );
  }
}

class _SettingsSegmentedChoiceTile extends StatelessWidget {
  final String label;
  final String value;
  final List<String> options;
  final SettingsSectionPalette palette;
  final ValueChanged<String> onChanged;
  final String? footer;

  const _SettingsSegmentedChoiceTile({
    required this.label,
    required this.value,
    required this.options,
    required this.palette,
    required this.onChanged,
    this.footer,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(
              color: palette.primaryTextColor,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 10),
          SettingsSegmentedControl(
            options: options,
            value: value,
            selectedColor: AirQrTheme.navActive(context),
            backgroundColor: AirQrTheme.controlSurface(context),
            unselectedTextColor: palette.secondaryTextColor,
            onChanged: onChanged,
          ),
          if (footer != null) ...[
            const SizedBox(height: 10),
            Text(
              footer!,
              style: TextStyle(color: palette.secondaryTextColor, height: 1.35),
            ),
          ],
        ],
      ),
    );
  }
}

class SettingsDefaultCameraTile extends StatelessWidget {
  final SettingsSectionPalette palette;
  final bool supportsDesktopCameraSelection;
  final List<String> desktopCameraDevices;
  final String? selectedDesktopCameraName;
  final MobileCameraFacingPreference mobileCameraFacing;
  final Future<void> Function(String?) onSaveDesktopCameraPreference;
  final Future<void> Function() onRefreshDesktopCameraDevices;
  final Future<void> Function(MobileCameraFacingPreference)
  onSaveMobileCameraPreference;

  const SettingsDefaultCameraTile({
    super.key,
    required this.palette,
    this.supportsDesktopCameraSelection = true,
    required this.desktopCameraDevices,
    required this.selectedDesktopCameraName,
    this.mobileCameraFacing = MobileCameraFacingPreference.back,
    required this.onSaveDesktopCameraPreference,
    required this.onRefreshDesktopCameraDevices,
    this.onSaveMobileCameraPreference = _ignoreMobileCameraPreference,
  });

  static Future<void> _ignoreMobileCameraPreference(
    MobileCameraFacingPreference _,
  ) async {}

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.settings_defaultCamera,
            style: TextStyle(
              color: palette.primaryTextColor,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 10),
          LayoutBuilder(
            builder: (context, constraints) {
              final stacked = settingsControlUsesStackedLayout(
                context,
                constraints,
              );
              final selector = !supportsDesktopCameraSelection
                  ? DropdownButtonHideUnderline(
                      child: DropdownButton<MobileCameraFacingPreference>(
                        key: const Key('settings-mobile-default-camera'),
                        value: mobileCameraFacing,
                        isExpanded: true,
                        dropdownColor: palette.cardBackgroundColor,
                        icon: AirQrIcon(
                          'expand_more',
                          color: palette.secondaryTextColor,
                        ),
                        style: TextStyle(
                          color: palette.primaryTextColor,
                          fontWeight: FontWeight.w600,
                        ),
                        items: [
                          DropdownMenuItem<MobileCameraFacingPreference>(
                            value: MobileCameraFacingPreference.back,
                            child: Text(l10n.scanner_backCamera),
                          ),
                          DropdownMenuItem<MobileCameraFacingPreference>(
                            value: MobileCameraFacingPreference.front,
                            child: Text(l10n.scanner_frontCamera),
                          ),
                        ],
                        onChanged: (value) {
                          if (value == null) return;
                          onSaveMobileCameraPreference(value);
                        },
                      ),
                    )
                  : desktopCameraDevices.isEmpty
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Text(
                        l10n.settings_noCameraDetected,
                        style: TextStyle(
                          color: palette.secondaryTextColor,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    )
                  : DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: selectedDesktopCameraName,
                        isExpanded: true,
                        itemHeight: null,
                        dropdownColor: palette.cardBackgroundColor,
                        icon: AirQrIcon(
                          'expand_more',
                          color: palette.secondaryTextColor,
                        ),
                        style: TextStyle(
                          color: palette.primaryTextColor,
                          fontWeight: FontWeight.w600,
                        ),
                        items: desktopCameraDevices
                            .map(
                              (device) => DropdownMenuItem<String>(
                                value: device,
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    vertical: 8,
                                  ),
                                  child: Text(device),
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (value) {
                          if (value == null) return;
                          onSaveDesktopCameraPreference(value);
                        },
                      ),
                    );
              final refresh = supportsDesktopCameraSelection
                  ? IconButton(
                      tooltip: l10n.common_reset,
                      constraints: const BoxConstraints(
                        minWidth: 48,
                        minHeight: 48,
                      ),
                      onPressed: onRefreshDesktopCameraDevices,
                      icon: AirQrIcon(
                        'refresh',
                        color: palette.secondaryTextColor,
                      ),
                    )
                  : null;
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: AirQrTheme.controlSurface(context),
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: palette.subtleBorderColor),
                ),
                child: stacked
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          selector,
                          if (refresh != null)
                            Align(
                              alignment: Alignment.centerRight,
                              child: refresh,
                            ),
                        ],
                      )
                    : Row(
                        children: [
                          Expanded(child: selector),
                          if (refresh != null) ...[
                            const SizedBox(width: 8),
                            refresh,
                          ],
                        ],
                      ),
              );
            },
          ),
          const SizedBox(height: 8),
          Text(
            l10n.settings_defaultCameraDesc,
            style: TextStyle(color: palette.secondaryTextColor, height: 1.4),
          ),
        ],
      ),
    );
  }
}

class _LocalServerLaunchTile extends StatelessWidget {
  final SettingsSectionPalette palette;
  final bool canLaunch;
  final bool isStarting;
  final bool isRunning;
  final String? serverUrl;
  final String? feedback;
  final VoidCallback onLaunch;
  final VoidCallback onStop;

  const _LocalServerLaunchTile({
    required this.palette,
    required this.canLaunch,
    required this.isStarting,
    required this.isRunning,
    required this.serverUrl,
    required this.feedback,
    required this.onLaunch,
    required this.onStop,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final subtitle = isRunning && serverUrl != null
        ? serverUrl!
        : feedback ??
              (canLaunch
                  ? l10n.settings_localServerDesc
                  : l10n.settings_localServerDesktopOnly);
    final isError = feedback != null && !isRunning;
    final actionForeground = isRunning
        ? AirQrTheme.dangerText(context)
        : AirQrTheme.primaryButtonForeground(context);
    final actionBackground = isRunning
        ? AirQrTheme.dangerSurface(context)
        : AirQrTheme.primaryButtonSurface(context);

    Widget buildServerDetails() {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: palette.fieldBackgroundColor,
              shape: BoxShape.circle,
            ),
            child: AirQrIcon(
              isRunning ? 'check_circle' : 'play_circle',
              size: 22,
              color: isRunning
                  ? AirQrTheme.successText(context)
                  : palette.primaryTextColor,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.settings_localServerTitle,
                  style: TextStyle(
                    color: palette.primaryTextColor,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: isError
                        ? AirQrTheme.destructive
                        : palette.secondaryTextColor,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      );
    }

    Widget buildActionButton() {
      final label = isRunning
          ? l10n.settings_stopLocalServer
          : isStarting
          ? l10n.settings_localServerStarting
          : l10n.settings_launchLocalServer;

      return FilledButton(
        key: const Key('local-server-action-button'),
        onPressed: canLaunch
            ? (isRunning ? onStop : (!isStarting ? onLaunch : null))
            : null,
        style: FilledButton.styleFrom(
          backgroundColor: actionBackground,
          foregroundColor: actionForeground,
          disabledBackgroundColor: palette.fieldBackgroundColor,
          disabledForegroundColor: palette.secondaryTextColor,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          shape: const StadiumBorder(),
          side: isRunning
              ? BorderSide(
                  color: AirQrTheme.destructive.withValues(alpha: 0.36),
                )
              : BorderSide.none,
          elevation: 0,
          shadowColor: Colors.transparent,
        ),
        child: isStarting
            ? Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: actionForeground,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(label),
                ],
              )
            : Text(label, textAlign: TextAlign.center),
      );
    }

    return Padding(
      padding: const EdgeInsets.all(16),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final useStackedLayout =
              constraints.maxWidth < 560 ||
              MediaQuery.textScalerOf(context).scale(16) > 20;

          if (useStackedLayout) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                buildServerDetails(),
                const SizedBox(height: 12),
                buildActionButton(),
              ],
            );
          }

          return Row(
            children: [
              Expanded(child: buildServerDetails()),
              const SizedBox(width: 12),
              buildActionButton(),
            ],
          );
        },
      ),
    );
  }
}

class _ServerConnectivityBadge extends StatelessWidget {
  final bool connected;

  const _ServerConnectivityBadge({required this.connected});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final foreground = connected
        ? AirQrTheme.successText(context)
        : AirQrTheme.dangerText(context);
    final background = connected
        ? AirQrTheme.successSurface(context)
        : AirQrTheme.dangerSurface(context);

    return AnimatedContainer(
      duration: settingsAnimationDuration(
        context,
        const Duration(milliseconds: 180),
      ),
      curve: Curves.easeOutCubic,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: foreground.withValues(alpha: 0.28)),
      ),
      child: Text(
        connected
            ? l10n.settings_serverConnected
            : l10n.settings_serverUnavailable,
        style: TextStyle(
          color: foreground,
          fontSize: 10,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.2,
        ),
      ),
    );
  }
}

class SettingsSyncSection extends StatelessWidget {
  final SettingsSectionPalette palette;
  final SyncSettings syncSettings;
  final TextEditingController serverUrlController;
  final TextEditingController usernameController;
  final TextEditingController passwordController;
  final bool isSyncTesting;
  final SettingsSyncFeedback? syncFeedback;
  final bool isServerConnected;
  final bool isSyncing;
  final bool canLaunchLocalServer;
  final bool isStartingLocalServer;
  final bool isLocalServerRunning;
  final String? localServerUrl;
  final String? localServerFeedback;
  final SettingsExportConfig exportConfig;
  final TextEditingController exportDirController;
  final bool isExportConfigLoading;
  final String? exportConfigError;
  final bool exportConfigSaved;
  final ValueChanged<bool> onSyncEnabledChanged;
  final Future<void> Function() onSaveSyncDraft;
  final ValueChanged<bool> onSyncScannedChanged;
  final ValueChanged<bool> onSyncGeneratedChanged;
  final ValueChanged<bool> onAutoSyncChanged;
  final VoidCallback onTestConnection;
  final VoidCallback onPerformSync;
  final VoidCallback onLaunchLocalServer;
  final VoidCallback onStopLocalServer;
  final ValueChanged<bool> onExportEnabledChanged;
  final ValueChanged<bool> onExportScannedChanged;
  final ValueChanged<bool> onExportGeneratedChanged;
  final VoidCallback onSaveExportDirectory;

  const SettingsSyncSection({
    super.key,
    required this.palette,
    required this.syncSettings,
    required this.serverUrlController,
    required this.usernameController,
    required this.passwordController,
    required this.isSyncTesting,
    required this.syncFeedback,
    required this.isServerConnected,
    required this.isSyncing,
    required this.canLaunchLocalServer,
    required this.isStartingLocalServer,
    required this.isLocalServerRunning,
    required this.localServerUrl,
    required this.localServerFeedback,
    required this.exportConfig,
    required this.exportDirController,
    required this.isExportConfigLoading,
    required this.exportConfigError,
    required this.exportConfigSaved,
    required this.onSyncEnabledChanged,
    required this.onSaveSyncDraft,
    required this.onSyncScannedChanged,
    required this.onSyncGeneratedChanged,
    required this.onAutoSyncChanged,
    required this.onTestConnection,
    required this.onPerformSync,
    required this.onLaunchLocalServer,
    required this.onStopLocalServer,
    required this.onExportEnabledChanged,
    required this.onExportScannedChanged,
    required this.onExportGeneratedChanged,
    required this.onSaveExportDirectory,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    Widget actionContent({required Widget icon, required String label}) {
      return Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(width: 18, height: 18, child: Center(child: icon)),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              softWrap: false,
              textAlign: TextAlign.center,
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SettingsCard(
          backgroundColor: palette.cardBackgroundColor,
          borderColor: palette.subtleBorderColor,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
              child: Align(
                alignment: Alignment.centerRight,
                child: _ServerConnectivityBadge(connected: isServerConnected),
              ),
            ),
            SettingsSwitchTile(
              label: l10n.settings_enableSync,
              subtitle: l10n.settings_enableSyncDesc,
              value: syncSettings.enabled,
              onChanged: onSyncEnabledChanged,
              primaryTextColor: palette.primaryTextColor,
              secondaryTextColor: palette.secondaryTextColor,
            ),
            SettingsCardDivider(color: palette.subtleBorderColor),
            _LocalServerLaunchTile(
              palette: palette,
              canLaunch: canLaunchLocalServer,
              isStarting: isStartingLocalServer,
              isRunning: isLocalServerRunning,
              serverUrl: localServerUrl,
              feedback: localServerFeedback,
              onLaunch: onLaunchLocalServer,
              onStop: onStopLocalServer,
            ),
            if (syncSettings.enabled) ...[
              SettingsCardDivider(color: palette.subtleBorderColor),
              SettingsTextFieldTile(
                label: l10n.settings_serverUrl,
                controller: serverUrlController,
                hint: 'https://airqr.example.com',
                onChanged: (_) {
                  onSaveSyncDraft();
                },
                primaryTextColor: palette.primaryTextColor,
                secondaryTextColor: palette.secondaryTextColor,
                fieldBackgroundColor: AirQrTheme.controlSurface(context),
                borderColor: palette.subtleBorderColor,
                focusedBorderColor: palette.focusedBorderColor,
              ),
              SettingsCardDivider(color: palette.subtleBorderColor),
              SettingsTextFieldTile(
                label: l10n.settings_username,
                controller: usernameController,
                hint: 'admin',
                onChanged: (_) {
                  onSaveSyncDraft();
                },
                primaryTextColor: palette.primaryTextColor,
                secondaryTextColor: palette.secondaryTextColor,
                fieldBackgroundColor: AirQrTheme.controlSurface(context),
                borderColor: palette.subtleBorderColor,
                focusedBorderColor: palette.focusedBorderColor,
              ),
              SettingsCardDivider(color: palette.subtleBorderColor),
              SettingsTextFieldTile(
                label: l10n.settings_password,
                controller: passwordController,
                hint: '••••••',
                obscure: true,
                onChanged: (_) {
                  onSaveSyncDraft();
                },
                primaryTextColor: palette.primaryTextColor,
                secondaryTextColor: palette.secondaryTextColor,
                fieldBackgroundColor: AirQrTheme.controlSurface(context),
                borderColor: palette.subtleBorderColor,
                focusedBorderColor: palette.focusedBorderColor,
              ),
              SettingsCardDivider(color: palette.subtleBorderColor),
              SettingsSwitchTile(
                label: l10n.settings_syncScannedFiles,
                subtitle: l10n.settings_syncScannedFilesDesc,
                value: syncSettings.syncScanned,
                onChanged: onSyncScannedChanged,
                primaryTextColor: palette.primaryTextColor,
                secondaryTextColor: palette.secondaryTextColor,
              ),
              SettingsCardDivider(color: palette.subtleBorderColor),
              SettingsSwitchTile(
                label: l10n.settings_syncGeneratedFiles,
                subtitle: l10n.settings_syncGeneratedFilesDesc,
                value: syncSettings.syncGenerated,
                onChanged: onSyncGeneratedChanged,
                primaryTextColor: palette.primaryTextColor,
                secondaryTextColor: palette.secondaryTextColor,
              ),
              SettingsCardDivider(color: palette.subtleBorderColor),
              SettingsSwitchTile(
                label: l10n.settings_autoSyncShort,
                subtitle: l10n.settings_autoSyncShortDesc,
                value: syncSettings.autoSync,
                onChanged: onAutoSyncChanged,
                primaryTextColor: palette.primaryTextColor,
                secondaryTextColor: palette.secondaryTextColor,
              ),
              SettingsCardDivider(color: palette.subtleBorderColor),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: ElevatedButton(
                            key: const Key('settings-connection-button'),
                            onPressed: isSyncTesting ? null : onTestConnection,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AirQrTheme.primaryButtonSurface(
                                context,
                              ),
                              foregroundColor:
                                  AirQrTheme.primaryButtonForeground(context),
                              disabledBackgroundColor:
                                  AirQrTheme.disabledSurface(context),
                              disabledForegroundColor: AirQrTheme.disabledText(
                                context,
                              ),
                              elevation: 0,
                              shadowColor: Colors.transparent,
                              minimumSize: const Size(0, 48),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                              ),
                              textStyle: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                              shape: const StadiumBorder(),
                            ),
                            child: actionContent(
                              icon: isSyncTesting
                                  ? CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: AirQrTheme.primaryButtonForeground(
                                        context,
                                      ),
                                    )
                                  : AirQrIcon(
                                      'wifi_tethering',
                                      size: 18,
                                      color: AirQrTheme.primaryButtonForeground(
                                        context,
                                      ),
                                      exactColor: true,
                                    ),
                              label: isSyncTesting
                                  ? l10n.settings_testingConnection
                                  : l10n.settings_testConnection,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton(
                            key: const Key('settings-sync-button'),
                            onPressed: isSyncing ? null : onPerformSync,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AirQrTheme.actionSurface(
                                context,
                              ),
                              foregroundColor: AirQrTheme.textPrimary(context),
                              disabledBackgroundColor:
                                  AirQrTheme.disabledSurface(context),
                              disabledForegroundColor: AirQrTheme.disabledText(
                                context,
                              ),
                              elevation: 0,
                              shadowColor: Colors.transparent,
                              minimumSize: const Size(0, 48),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                              ),
                              textStyle: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                              shape: const StadiumBorder(),
                            ),
                            child: actionContent(
                              icon: isSyncing
                                  ? CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: AirQrTheme.textPrimary(context),
                                    )
                                  : AirQrIcon(
                                      'sync',
                                      size: 18,
                                      color: AirQrTheme.textPrimary(context),
                                      exactColor: true,
                                    ),
                              label: isSyncing
                                  ? l10n.settings_syncing
                                  : l10n.settings_syncNow,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (syncFeedback != null) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: syncFeedback!.isSuccess
                              ? AirQrTheme.successSurface(context)
                              : AirQrTheme.dangerSurface(context),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Row(
                          children: [
                            AirQrIcon(
                              syncFeedback!.isSuccess
                                  ? 'check_circle'
                                  : 'error',
                              color: syncFeedback!.isSuccess
                                  ? AirQrTheme.successText(context)
                                  : AirQrTheme.dangerText(context),
                              size: 20,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                syncFeedback!.message,
                                style: TextStyle(
                                  color: syncFeedback!.isSuccess
                                      ? AirQrTheme.successText(context)
                                      : AirQrTheme.dangerText(context),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
        ),
        if (syncSettings.enabled &&
            serverUrlController.text.trim().isNotEmpty) ...[
          const SizedBox(height: 16),
          SettingsFileExportSection(
            palette: palette,
            exportConfig: exportConfig,
            exportDirController: exportDirController,
            isLoading: isExportConfigLoading,
            error: exportConfigError,
            saved: exportConfigSaved,
            onExportEnabledChanged: onExportEnabledChanged,
            onExportScannedChanged: onExportScannedChanged,
            onExportGeneratedChanged: onExportGeneratedChanged,
            onSaveExportDirectory: onSaveExportDirectory,
          ),
        ],
      ],
    );
  }
}

class SettingsFileExportSection extends StatelessWidget {
  final SettingsSectionPalette palette;
  final SettingsExportConfig exportConfig;
  final TextEditingController exportDirController;
  final bool isLoading;
  final String? error;
  final bool saved;
  final ValueChanged<bool> onExportEnabledChanged;
  final ValueChanged<bool> onExportScannedChanged;
  final ValueChanged<bool> onExportGeneratedChanged;
  final VoidCallback onSaveExportDirectory;

  const SettingsFileExportSection({
    super.key,
    required this.palette,
    required this.exportConfig,
    required this.exportDirController,
    required this.isLoading,
    required this.error,
    required this.saved,
    required this.onExportEnabledChanged,
    required this.onExportScannedChanged,
    required this.onExportGeneratedChanged,
    required this.onSaveExportDirectory,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final fieldEnabled = exportConfig.enabled && !isLoading;

    return SettingsCard(
      backgroundColor: palette.cardBackgroundColor,
      borderColor: palette.subtleBorderColor,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: SizedBox(
            width: double.infinity,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SettingsSectionHeader(
                  title: l10n.settings_fileExportSection,
                  color: palette.secondaryTextColor,
                ),
                const SizedBox(height: 14),
                Text(
                  l10n.settings_fileExportDesc,
                  textAlign: TextAlign.start,
                  style: TextStyle(
                    color: palette.secondaryTextColor,
                    height: 1.35,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
        SettingsSwitchTile(
          label: l10n.settings_enableExport,
          subtitle: l10n.settings_enableExportDesc,
          value: exportConfig.enabled,
          onChanged: isLoading ? (_) {} : onExportEnabledChanged,
          primaryTextColor: palette.primaryTextColor,
          secondaryTextColor: palette.secondaryTextColor,
        ),
        SettingsCardDivider(color: palette.subtleBorderColor),
        SettingsSwitchTile(
          label: l10n.settings_exportScanned,
          subtitle: l10n.settings_exportScannedDesc,
          value: exportConfig.exportScanned,
          onChanged: fieldEnabled ? onExportScannedChanged : (_) {},
          primaryTextColor: palette.primaryTextColor,
          secondaryTextColor: palette.secondaryTextColor,
        ),
        SettingsCardDivider(color: palette.subtleBorderColor),
        SettingsSwitchTile(
          label: l10n.settings_exportGenerated,
          subtitle: l10n.settings_exportGeneratedDesc,
          value: exportConfig.exportGenerated,
          onChanged: fieldEnabled ? onExportGeneratedChanged : (_) {},
          primaryTextColor: palette.primaryTextColor,
          secondaryTextColor: palette.secondaryTextColor,
        ),
        SettingsCardDivider(color: palette.subtleBorderColor),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.settings_exportDirectory,
                style: TextStyle(
                  color: palette.primaryTextColor,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: exportDirController,
                      enabled: fieldEnabled,
                      style: TextStyle(color: palette.primaryTextColor),
                      decoration: InputDecoration(
                        hintText: l10n.settings_exportDirectoryPlaceholder,
                        hintStyle: TextStyle(color: palette.secondaryTextColor),
                        filled: true,
                        fillColor: AirQrTheme.controlSurface(context),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(999),
                          borderSide: BorderSide(
                            color: palette.subtleBorderColor,
                          ),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(999),
                          borderSide: BorderSide(
                            color: palette.subtleBorderColor,
                          ),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(999),
                          borderSide: BorderSide(
                            color: palette.focusedBorderColor,
                            width: 1.2,
                          ),
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 13,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  FilledButton(
                    onPressed: fieldEnabled ? onSaveExportDirectory : null,
                    style: FilledButton.styleFrom(
                      backgroundColor: AirQrTheme.primaryButtonSurface(context),
                      foregroundColor: AirQrTheme.primaryButtonForeground(
                        context,
                      ),
                      disabledBackgroundColor: palette.fieldBackgroundColor,
                      disabledForegroundColor: palette.secondaryTextColor,
                      minimumSize: const Size(104, 48),
                      padding: const EdgeInsets.symmetric(horizontal: 18),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(999),
                      ),
                      elevation: 0,
                      shadowColor: Colors.transparent,
                    ),
                    child: isLoading
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AirQrTheme.primaryButtonForeground(
                                context,
                              ),
                            ),
                          )
                        : Text(
                            l10n.common_save,
                            style: const TextStyle(fontWeight: FontWeight.w800),
                          ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                l10n.settings_exportDirectoryHint,
                style: TextStyle(
                  color: palette.secondaryTextColor,
                  height: 1.35,
                ),
              ),
              if (saved) ...[
                const SizedBox(height: 10),
                _SettingsExportStatus(
                  message: l10n.settings_configSaved,
                  color: AirQrTheme.successText(context),
                ),
              ],
              if (error != null) ...[
                const SizedBox(height: 10),
                _SettingsExportStatus(
                  message: error!,
                  color: AirQrTheme.dangerText(context),
                ),
              ] else if (exportConfig.exportDirError != null) ...[
                const SizedBox(height: 10),
                _SettingsExportStatus(
                  message:
                      '${l10n.settings_pathWarning} ${exportConfig.exportDirError}',
                  color: AirQrTheme.warningText(context),
                ),
              ] else if (exportConfig.effectiveDir != null) ...[
                const SizedBox(height: 10),
                _SettingsExportStatus(
                  message:
                      '${l10n.settings_pathReady} ${exportConfig.effectiveDir}',
                  color: AirQrTheme.successText(context),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SettingsExportStatus extends StatelessWidget {
  final String message;
  final Color color;

  const _SettingsExportStatus({required this.message, required this.color});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        AirQrIcon('info', size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            message,
            style: TextStyle(color: color, fontWeight: FontWeight.w700),
          ),
        ),
      ],
    );
  }
}

class SettingsOfflineWebServerSection extends StatelessWidget {
  final SettingsSectionPalette palette;
  final bool isStarting;
  final bool isRunning;
  final String? serverUrl;
  final List<String> networkUrls;
  final String? feedback;
  final VoidCallback onStart;
  final VoidCallback onStop;
  final ValueChanged<String> onCopyUrl;
  final ValueChanged<String> onOpenUrl;

  const SettingsOfflineWebServerSection({
    super.key,
    required this.palette,
    required this.isStarting,
    required this.isRunning,
    required this.serverUrl,
    required this.networkUrls,
    required this.feedback,
    required this.onStart,
    required this.onStop,
    required this.onCopyUrl,
    required this.onOpenUrl,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final hasUrl = serverUrl != null && serverUrl!.isNotEmpty;
    final alternativeUrls = hasUrl
        ? networkUrls.where((url) => url != serverUrl).toList()
        : const <String>[];
    final statusColor = isRunning
        ? AirQrTheme.successText(context)
        : palette.secondaryTextColor;
    final statusSurface = isRunning
        ? AirQrTheme.successSurface(context)
        : AirQrTheme.actionSurface(context);
    final actionLabel = isRunning
        ? l10n.settings_stopOfflineWeb
        : isStarting
        ? l10n.settings_offlineWebStarting
        : l10n.settings_startOfflineWeb;

    return SettingsCard(
      backgroundColor: palette.cardBackgroundColor,
      borderColor: palette.subtleBorderColor,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: palette.fieldBackgroundColor,
                      shape: BoxShape.circle,
                    ),
                    child: AirQrIcon(
                      isRunning ? 'check_circle' : 'wifi_tethering',
                      color: isRunning
                          ? AirQrTheme.successText(context)
                          : palette.primaryTextColor,
                      size: 21,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.settings_offlineWebTitle,
                          style: TextStyle(
                            color: palette.primaryTextColor,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          l10n.settings_offlineWebDesc,
                          style: TextStyle(
                            color: palette.secondaryTextColor,
                            height: 1.35,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  AnimatedContainer(
                    duration: settingsAnimationDuration(
                      context,
                      const Duration(milliseconds: 180),
                    ),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: statusSurface,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      isRunning
                          ? l10n.settings_offlineWebRunning
                          : l10n.settings_offlineWebStoppedStatus,
                      style: TextStyle(
                        color: statusColor,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.25,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 13,
                ),
                decoration: BoxDecoration(
                  color: AirQrTheme.controlSurface(context),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        hasUrl ? serverUrl! : l10n.settings_offlineWebNoUrl,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: hasUrl
                              ? palette.primaryTextColor
                              : palette.secondaryTextColor,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (hasUrl) ...[
                      const SizedBox(width: 8),
                      IconButton(
                        key: const Key('offline-web-server-copy-button'),
                        tooltip: l10n.common_copy,
                        onPressed: () => onCopyUrl(serverUrl!),
                        icon: AirQrIcon(
                          'content_copy',
                          size: 18,
                          color: palette.primaryTextColor,
                        ),
                      ),
                      IconButton(
                        key: const Key('offline-web-server-open-button'),
                        tooltip: l10n.common_open,
                        onPressed: () => onOpenUrl(serverUrl!),
                        icon: AirQrIcon(
                          'open_in_new',
                          size: 18,
                          color: palette.primaryTextColor,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (alternativeUrls.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  l10n.settings_offlineWebMoreUrls(alternativeUrls.length),
                  style: TextStyle(
                    color: palette.secondaryTextColor,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 8),
                ...List.generate(alternativeUrls.length, (index) {
                  final url = alternativeUrls[index];
                  return Padding(
                    padding: EdgeInsets.only(top: index == 0 ? 0 : 8),
                    child: Container(
                      key: Key('offline-web-network-url-${index + 1}'),
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: AirQrTheme.controlSurface(context),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              url,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: palette.primaryTextColor,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton(
                            tooltip: l10n.common_copy,
                            onPressed: () => onCopyUrl(url),
                            icon: AirQrIcon(
                              'content_copy',
                              size: 17,
                              color: palette.primaryTextColor,
                            ),
                          ),
                          IconButton(
                            tooltip: l10n.common_open,
                            onPressed: () => onOpenUrl(url),
                            icon: AirQrIcon(
                              'open_in_new',
                              size: 17,
                              color: palette.primaryTextColor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              ],
              if (feedback != null) ...[
                const SizedBox(height: 12),
                Text(
                  feedback!,
                  style: TextStyle(
                    color: isRunning
                        ? AirQrTheme.successText(context)
                        : palette.secondaryTextColor,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  key: const Key('offline-web-server-action-button'),
                  onPressed: isRunning
                      ? onStop
                      : isStarting
                      ? null
                      : onStart,
                  style: FilledButton.styleFrom(
                    backgroundColor: isRunning
                        ? AirQrTheme.dangerSurface(context)
                        : AirQrTheme.primaryButtonSurface(context),
                    foregroundColor: isRunning
                        ? AirQrTheme.dangerText(context)
                        : AirQrTheme.primaryButtonForeground(context),
                    disabledBackgroundColor: AirQrTheme.disabledSurface(
                      context,
                    ),
                    disabledForegroundColor: AirQrTheme.disabledText(context),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: const StadiumBorder(),
                    elevation: 0,
                    shadowColor: Colors.transparent,
                  ),
                  icon: isStarting
                      ? SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AirQrTheme.primaryButtonForeground(context),
                          ),
                        )
                      : AirQrIcon(
                          isRunning ? 'close' : 'play_circle',
                          size: 18,
                        ),
                  label: Text(
                    actionLabel,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class SettingsAppearanceSection extends StatelessWidget {
  final SettingsSectionPalette palette;
  final String languageValue;
  final ValueChanged<String?> onLanguageChanged;
  final String themeValue;
  final ValueChanged<String> onThemeChanged;
  final VoidCallback onClearAllAppData;

  const SettingsAppearanceSection({
    super.key,
    required this.palette,
    required this.languageValue,
    required this.onLanguageChanged,
    required this.themeValue,
    required this.onThemeChanged,
    required this.onClearAllAppData,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: palette.cardBackgroundColor,
            borderRadius: BorderRadius.circular(30),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.settings_language,
                style: TextStyle(
                  color: palette.primaryTextColor,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: AirQrTheme.controlSurface(context),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: palette.languageBorderColor,
                    width: 1.2,
                  ),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: languageValue,
                    isExpanded: true,
                    dropdownColor: palette.cardBackgroundColor,
                    icon: AirQrIcon(
                      'expand_more',
                      color: palette.secondaryTextColor,
                    ),
                    style: TextStyle(
                      color: palette.primaryTextColor,
                      fontWeight: FontWeight.w600,
                    ),
                    items: [
                      DropdownMenuItem(
                        value: 'system',
                        child: Text('🌐 ${l10n.settings_languageSystem}'),
                      ),
                      DropdownMenuItem(
                        value: 'en',
                        child: Text(
                          '🇺🇸 ${l10n.settings_languageEnglish} (US)',
                        ),
                      ),
                      DropdownMenuItem(
                        value: 'fr',
                        child: Text('🇫🇷 ${l10n.settings_languageFrench}'),
                      ),
                    ],
                    onChanged: onLanguageChanged,
                  ),
                ),
              ),
              const SizedBox(height: 22),
              Text(
                l10n.settings_theme,
                style: TextStyle(
                  color: palette.primaryTextColor,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 10),
              SettingsSegmentedControl(
                key: const Key('settings-theme-segmented-control'),
                indicatorKey: const Key('settings-theme-active-indicator'),
                options: [
                  l10n.settings_themeLight,
                  l10n.settings_themeDark,
                  l10n.settings_themeSystem,
                ],
                value: switch (themeValue) {
                  'light' => l10n.settings_themeLight,
                  'dark' => l10n.settings_themeDark,
                  _ => l10n.settings_themeSystem,
                },
                selectedColor: AirQrTheme.navActive(context),
                backgroundColor: AirQrTheme.controlSurface(context),
                unselectedTextColor: palette.isDarkMode
                    ? Colors.white.withValues(alpha: 0.55)
                    : palette.secondaryTextColor,
                onChanged: (label) {
                  if (label == l10n.settings_themeLight) {
                    onThemeChanged('light');
                  } else if (label == l10n.settings_themeDark) {
                    onThemeChanged('dark');
                  } else {
                    onThemeChanged('system');
                  }
                },
              ),
              const SizedBox(height: 22),
              Divider(height: 1, color: palette.subtleBorderColor),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: onClearAllAppData,
                  style: FilledButton.styleFrom(
                    backgroundColor: palette.clearButtonBackgroundColor,
                    foregroundColor: palette.clearButtonForegroundColor,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(
                    l10n.settings_clearData,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class SettingsAboutSection extends StatelessWidget {
  final SettingsSectionPalette palette;
  final String version;
  final String author;
  final VoidCallback onOpenAuthorUrl;
  final VoidCallback onOpenRepoUrl;

  const SettingsAboutSection({
    super.key,
    required this.palette,
    required this.version,
    required this.author,
    required this.onOpenAuthorUrl,
    required this.onOpenRepoUrl,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SettingsCard(
          backgroundColor: palette.cardBackgroundColor,
          borderColor: palette.subtleBorderColor,
          children: [
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      SizedBox(
                        width: 40,
                        height: 40,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: Image.asset(
                            'assets/logo.png',
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              l10n.settings_appName,
                              style: Theme.of(context).textTheme.titleLarge
                                  ?.copyWith(color: palette.primaryTextColor),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              version,
                              style: AirQrTypography.of(context).compactStatus
                                  .copyWith(color: palette.secondaryTextColor),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Text(
                    l10n.settings_appDescription,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: palette.secondaryTextColor,
                    ),
                  ),
                  const SizedBox(height: 18),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        l10n.settings_madeWith,
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          color: palette.secondaryTextColor,
                        ),
                      ),
                      Semantics(
                        button: true,
                        label: author,
                        onTap: onOpenAuthorUrl,
                        child: ExcludeSemantics(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(minHeight: 48),
                            child: InkWell(
                              excludeFromSemantics: true,
                              onTap: onOpenAuthorUrl,
                              child: Align(
                                alignment: Alignment.centerLeft,
                                widthFactor: 1,
                                child: Text(
                                  author,
                                  style: Theme.of(context).textTheme.labelLarge
                                      ?.copyWith(
                                        color: AirQrTheme.linkText(context),
                                        fontWeight: FontWeight.w700,
                                      ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextButton.icon(
                    onPressed: onOpenRepoUrl,
                    style: TextButton.styleFrom(
                      backgroundColor: AirQrTheme.primaryButtonSurface(context),
                      foregroundColor: AirQrTheme.primaryButtonForeground(
                        context,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                    icon: const AirQrIcon('star', size: 18),
                    label: Text(
                      l10n.settings_starOnGithub,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: AirQrTheme.primaryButtonForeground(context),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
