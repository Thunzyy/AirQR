import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'l10n/app_localizations.dart';
import 'scanner_session_progress.dart';

const double _scannerTelemetryMaxWidth = 390;
const double _scannerTopHorizontalPadding = 16;
const double _scannerTopVerticalPadding = 8;
const double _scannerTopActionExtent = 48;
const double _scannerTopActionGap = 0;
const double _scannerTopLayerGap = 12;
const double _scannerInfoChipHorizontalPadding = 12;
const double _scannerInfoChipVerticalPadding = 4;

bool scannerStatusUsesLiveRegion(String status) {
  final normalized = status.trim().toLowerCase();
  final isDiscreteOutcome = RegExp(
    r'^(error|erreur|completed|complete|terminé|termine|failed|échec|echec|saved|enregistré|scanning|scan en cours|ready|prêt|pret)',
  ).hasMatch(normalized);
  if (isDiscreteOutcome) return true;

  final containsHighFrequencyProgress = RegExp(
    r'\d+(?:[.,]\d+)?\s*%|\b\d+\s*/\s*\d+\b',
  ).hasMatch(status);
  return !containsHighFrequencyProgress;
}

class ScannerDesktopPlaceholder extends StatelessWidget {
  final String title;
  final String? tip;

  const ScannerDesktopPlaceholder({
    super.key,
    required this.title,
    required this.tip,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AirQrTheme.background(context),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AirQrIcon(
                  'phone_iphone',
                  size: 72,
                  color: AirQrTheme.accentBlue.withValues(alpha: 0.7),
                ),
                const SizedBox(height: 16),
                Text(
                  title,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: AirQrTheme.textPrimary(context),
                  ),
                ),
                if (tip != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    tip!,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: AirQrTheme.textSecondary(context),
                      height: 1.4,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class ScannerChromeOverlay extends StatefulWidget {
  final int fps;
  final String? syncSourceName;
  final bool showMobileCamera;
  final bool showDesktopCamera;
  final bool isTorchOn;
  final int? currentChunkNumber;
  final int? currentChunkTotal;
  final int displayReceivedPackets;
  final int displayExpectedPackets;
  final int? displayTotalPackets;
  final int localChunkFramesScanned;
  final int? displayMissingPackets;
  final List<ScannerChunkProgressInfo> displayChunks;
  final double displayProgress;
  final bool isComplete;
  final String status;
  final Color primaryColor;
  final Color successColor;
  final VoidCallback? onToggleTorch;
  final VoidCallback? onOpenMobileCameraSelector;
  final VoidCallback? onOpenDesktopCameraSelector;
  final VoidCallback onOpenHelp;
  final VoidCallback onReset;

  const ScannerChromeOverlay({
    super.key,
    required this.fps,
    required this.syncSourceName,
    required this.showMobileCamera,
    required this.showDesktopCamera,
    required this.isTorchOn,
    this.currentChunkNumber,
    this.currentChunkTotal,
    required this.displayReceivedPackets,
    required this.displayExpectedPackets,
    this.displayTotalPackets,
    this.localChunkFramesScanned = 0,
    this.displayMissingPackets,
    this.displayChunks = const <ScannerChunkProgressInfo>[],
    required this.displayProgress,
    required this.isComplete,
    required this.status,
    required this.primaryColor,
    required this.successColor,
    required this.onToggleTorch,
    required this.onOpenMobileCameraSelector,
    required this.onOpenDesktopCameraSelector,
    required this.onOpenHelp,
    required this.onReset,
  });

  @override
  State<ScannerChromeOverlay> createState() => _ScannerChromeOverlayState();
}

class _ScannerChromeOverlayState extends State<ScannerChromeOverlay> {
  bool _showChunkDetails = false;
  int? _selectedChunkId;

  @override
  void didUpdateWidget(covariant ScannerChromeOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.displayMissingPackets == null || widget.displayChunks.isEmpty) {
      _showChunkDetails = false;
      _selectedChunkId = null;
      return;
    }
    final selectedId = _selectedChunkId;
    if (selectedId != null &&
        !widget.displayChunks.any((chunk) => chunk.chunkId == selectedId)) {
      _selectedChunkId = null;
    }
  }

  ScannerChunkProgressInfo? _selectedChunk() {
    final chunks = widget.displayChunks;
    if (chunks.isEmpty) return null;
    final selectedId = _selectedChunkId;
    if (selectedId != null) {
      for (final chunk in chunks) {
        if (chunk.chunkId == selectedId) return chunk;
      }
    }
    final currentChunkId = widget.currentChunkNumber != null
        ? widget.currentChunkNumber! - 1
        : null;
    if (currentChunkId != null) {
      for (final chunk in chunks) {
        if (chunk.chunkId == currentChunkId) return chunk;
      }
    }
    for (final chunk in chunks) {
      if (!_isScannerChunkVisuallyComplete(chunk)) return chunk;
    }
    return chunks.first;
  }

  void _selectChunk(int chunkId) {
    setState(() => _selectedChunkId = chunkId);
  }

  @override
  Widget build(BuildContext context) {
    final fps = widget.fps;
    final syncSourceName = widget.syncSourceName;
    final showMobileCamera = widget.showMobileCamera;
    final showDesktopCamera = widget.showDesktopCamera;
    final isTorchOn = widget.isTorchOn;
    final currentChunkNumber = widget.currentChunkNumber;
    final currentChunkTotal = widget.currentChunkTotal;
    final displayReceivedPackets = widget.displayReceivedPackets;
    final displayExpectedPackets = widget.displayExpectedPackets;
    final displayTotalPackets = widget.displayTotalPackets;
    final localChunkFramesScanned = widget.localChunkFramesScanned;
    final displayMissingPackets = widget.displayMissingPackets;
    final displayProgress = widget.displayProgress;
    final isComplete = widget.isComplete;
    final status = widget.status;
    final primaryColor = widget.primaryColor;
    final successColor = widget.successColor;
    final onToggleTorch = widget.onToggleTorch;
    final onOpenMobileCameraSelector = widget.onOpenMobileCameraSelector;
    final onOpenDesktopCameraSelector = widget.onOpenDesktopCameraSelector;
    final onOpenHelp = widget.onOpenHelp;
    final onReset = widget.onReset;
    final displayChunks = widget.displayChunks;
    final showTorchAction = showMobileCamera || showDesktopCamera;
    final l10n = AppLocalizations.of(context);
    final scannedLabel = l10n?.scanner_scanned ?? 'Scanned';
    final minLabel = l10n?.scanner_min ?? 'Min';
    final maxLabel = l10n?.scanner_max ?? 'Max';
    final maxValue = displayTotalPackets != null && displayTotalPackets > 0
        ? '$displayTotalPackets'
        : '-';
    final showSessionProgress = displayExpectedPackets > 0;
    final missingPackets = displayMissingPackets ?? 0;
    final showMissingPackets = displayMissingPackets != null;
    final isMissingComplete = showMissingPackets && missingPackets == 0;
    final missingColor = isMissingComplete
        ? AirQrTheme.successText(context)
        : AirQrTheme.warningText(context);
    final compactNumericStyle = AirQrTypography.of(
      context,
    ).numeric.copyWith(fontSize: 11, height: 1.35);
    final compactTelemetryStyle = AirQrTypography.of(
      context,
    ).compactStatus.copyWith(fontSize: 11, height: 1.35);
    final fpsNumberStyle = AirQrTypography.of(context).numeric.copyWith(
      color: AirQrTheme.successText(context),
      fontSize: 12,
      height: 1.35,
      fontWeight: FontWeight.w700,
    );
    final fpsLabelStyle = AirQrTypography.of(context).compactStatus.copyWith(
      color: AirQrTheme.textSecondary(context),
      fontSize: 12,
      letterSpacing: 0.6,
      fontWeight: FontWeight.w700,
    );
    final fpsText = TextSpan(
      children: [
        TextSpan(text: '$fps', style: fpsNumberStyle),
        TextSpan(text: ' FPS', style: fpsLabelStyle),
      ],
    );
    final textScaler = MediaQuery.textScalerOf(context);
    final fpsPainter = TextPainter(
      text: fpsText,
      textScaler: textScaler,
      textDirection: Directionality.of(context),
      maxLines: 1,
    )..layout();
    final fpsChipWidth =
        fpsPainter.width + 2 * _scannerInfoChipHorizontalPadding;
    fpsPainter.dispose();
    final topActionCount =
        (showMobileCamera ? 1 : 0) +
        (showDesktopCamera ? 1 : 0) +
        (showTorchAction ? 1 : 0) +
        2;
    final topActionsWidth =
        topActionCount * _scannerTopActionExtent +
        math.max(0, topActionCount - 1) * _scannerTopActionGap;
    final availableTopWidth = math.max(
      0.0,
      MediaQuery.sizeOf(context).width - 2 * _scannerTopHorizontalPadding,
    );
    final stackTopActions =
        fpsChipWidth + _scannerTopLayerGap + topActionsWidth >
        availableTopWidth;
    final topActionsTop = stackTopActions ? _scannerTopActionExtent + 4 : 0.0;
    final telemetryDetailsTop = topActionsTop + _scannerTopActionExtent + 4;
    final selectedChunk = _selectedChunk();
    final canShowChunkDetails = showMissingPackets && displayChunks.isNotEmpty;
    final showChunkDetails = _showChunkDetails && selectedChunk != null;
    final bottomNavigationClearance =
        84.0 + math.max(14.0, MediaQuery.paddingOf(context).bottom) + 24.0;
    return Stack(
      children: [
        Positioned(
          top: 0,
          left: 0,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: _scannerTopHorizontalPadding,
                vertical: _scannerTopVerticalPadding,
              ),
              child: SizedBox(
                height: _scannerTopActionExtent,
                child: Center(
                  child: _ScannerInfoChip(
                    key: const Key('scanner_fps_chip'),
                    verticalPadding: 6,
                    child: RichText(
                      key: const Key('scanner_fps_text'),
                      textScaler: textScaler,
                      text: fpsText,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
        Positioned(
          top: telemetryDetailsTop,
          left: 0,
          right: 0,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: LayoutBuilder(
                builder: (context, constraints) => Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.start,
                  children: [
                    SizedBox(
                      width: math.min(
                        _scannerTelemetryMaxWidth,
                        constraints.maxWidth,
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (syncSourceName != null &&
                              syncSourceName.trim().isNotEmpty) ...[
                            _ScannerInfoChip(
                              key: const Key('scanner_sync_chip'),
                              borderColor: AirQrTheme.accentBlue.withValues(
                                alpha: 0.25,
                              ),
                              borderRadius: 999,
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(
                                  maxWidth: 280,
                                ),
                                child: Text(
                                  l10n?.scanner_syncSource(
                                        syncSourceName.trim(),
                                      ) ??
                                      'Sync: ${syncSourceName.trim()}',
                                  key: const Key('scanner_sync_source'),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: compactTelemetryStyle.copyWith(
                                    color: AirQrTheme.textPrimary(context),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                          ],
                          if (showSessionProgress) ...[
                            const SizedBox(height: 6),
                            _ScannerInfoChip(
                              key: const Key('scanner_session_chip'),
                              borderColor: AirQrTheme.successText(
                                context,
                              ).withValues(alpha: 0.24),
                              borderRadius: 999,
                              child: Text(
                                l10n?.scanner_sessionProgress(
                                      displayReceivedPackets,
                                      displayExpectedPackets,
                                    ) ??
                                    'Session: $displayReceivedPackets/$displayExpectedPackets',
                                key: const Key('scanner_session_progress'),
                                style: compactNumericStyle.copyWith(
                                  color: AirQrTheme.successText(context),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                          if (showMissingPackets) ...[
                            const SizedBox(height: 6),
                            Semantics(
                              key: const Key('scanner_session_missing'),
                              button: canShowChunkDetails,
                              enabled: canShowChunkDetails,
                              label:
                                  l10n?.scanner_missingPackets(
                                    missingPackets,
                                  ) ??
                                  '$missingPackets missing',
                              onTap: canShowChunkDetails
                                  ? () => setState(
                                      () => _showChunkDetails =
                                          !_showChunkDetails,
                                    )
                                  : null,
                              excludeSemantics: true,
                              child: MouseRegion(
                                cursor: canShowChunkDetails
                                    ? SystemMouseCursors.click
                                    : MouseCursor.defer,
                                child: GestureDetector(
                                  behavior: HitTestBehavior.opaque,
                                  onTap: canShowChunkDetails
                                      ? () => setState(
                                          () => _showChunkDetails =
                                              !_showChunkDetails,
                                        )
                                      : null,
                                  child: SizedBox(
                                    height: 48,
                                    child: Align(
                                      alignment: Alignment.topLeft,
                                      child: _ScannerInfoChip(
                                        surfaceKey: const Key(
                                          'scanner_missing_chip',
                                        ),
                                        borderColor: missingColor.withValues(
                                          alpha: 0.24,
                                        ),
                                        borderRadius: 999,
                                        child: Text(
                                          l10n?.scanner_missingPackets(
                                                missingPackets,
                                              ) ??
                                              '$missingPackets missing',
                                          style: compactNumericStyle.copyWith(
                                            color: missingColor,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            if (showChunkDetails) ...[
                              Transform.translate(
                                key: const Key(
                                  'scanner_chunk_details_position',
                                ),
                                offset: const Offset(0, -22),
                                child: _ScannerChunkDetailsPanel(
                                  chunks: displayChunks,
                                  selectedChunk: selectedChunk,
                                  onSelectChunk: _selectChunk,
                                ),
                              ),
                            ],
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        Positioned(
          top: topActionsTop,
          right: 0,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                key: const Key('scanner_top_actions'),
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (showMobileCamera) ...[
                    _ScannerTopButton(
                      key: const Key('scanner_camera_button'),
                      iconName: 'videocam',
                      tooltip: l10n?.scanner_camera ?? 'Camera',
                      onPressed: onOpenMobileCameraSelector,
                    ),
                    const SizedBox(width: _scannerTopActionGap),
                  ],
                  if (showDesktopCamera) ...[
                    _ScannerTopButton(
                      key: const Key('scanner_camera_button'),
                      iconName: 'videocam',
                      tooltip: l10n?.scanner_camera ?? 'Camera',
                      onPressed: onOpenDesktopCameraSelector,
                    ),
                    const SizedBox(width: _scannerTopActionGap),
                  ],
                  if (showTorchAction) ...[
                    _ScannerTopButton(
                      key: const Key('scanner_torch_button'),
                      iconName: isTorchOn ? 'flashlight_on' : 'flashlight_off',
                      tooltip: isTorchOn
                          ? l10n?.scanner_torchOff ?? 'Turn off flashlight'
                          : l10n?.scanner_torchOn ?? 'Turn on flashlight',
                      onPressed: onToggleTorch,
                      backgroundColor: isTorchOn
                          ? AirQrTheme.progressOrange
                          : null,
                      iconColor: isTorchOn ? AirQrTheme.lightTextPrimary : null,
                    ),
                    const SizedBox(width: _scannerTopActionGap),
                  ],
                  _ScannerTopButton(
                    key: const Key('scanner_reset_button'),
                    iconName: 'restart_alt',
                    tooltip: l10n?.scanner_resetScanner ?? 'Reset Scanner',
                    onPressed: onReset,
                    iconColor: AirQrTheme.dangerText(context),
                  ),
                  const SizedBox(width: _scannerTopActionGap),
                  _ScannerTopButton(
                    key: const Key('scanner_help_button'),
                    iconName: 'help',
                    tooltip: l10n?.scanner_help ?? 'Help',
                    onPressed: onOpenHelp,
                  ),
                ],
              ),
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: IgnorePointer(
            child: Container(
              key: const Key('scanner_bottom_chrome'),
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                bottom: bottomNavigationClearance,
                top: 20,
              ),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.4),
                    Colors.black.withValues(alpha: 0.9),
                  ],
                ),
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 380),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(
                        key: const Key('scanner_stats_panel'),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: AirQrTheme.navSurface(context),
                          borderRadius: BorderRadius.circular(18),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.2),
                              blurRadius: 16,
                              offset: const Offset(0, 6),
                            ),
                          ],
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: _ScannerStatCard(
                                    label: scannedLabel,
                                    value: '$displayReceivedPackets',
                                    valueColor: primaryColor,
                                    valueKey: const Key(
                                      'scanner_stat_scanned_value',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: _ScannerStatCard(
                                    label: minLabel,
                                    value: '$displayExpectedPackets',
                                    valueColor: AirQrTheme.warningText(context),
                                    valueKey: const Key(
                                      'scanner_stat_min_value',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: _ScannerStatCard(
                                    label: maxLabel,
                                    value: maxValue,
                                    valueColor: AirQrTheme.successText(context),
                                    valueKey: const Key(
                                      'scanner_stat_max_value',
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            if (showSessionProgress && displayProgress > 0) ...[
                              const SizedBox(height: 12),
                              _ScannerLocalChunkSummary(
                                sourceName:
                                    syncSourceName?.trim().isNotEmpty == true
                                    ? syncSourceName!.trim()
                                    : 'This device',
                                framesScanned: localChunkFramesScanned,
                                currentChunkNumber: currentChunkNumber,
                                currentChunkTotal: currentChunkTotal,
                                chunkLabel: _scannerChunkLabel(l10n),
                              ),
                              const SizedBox(height: 8),
                              ClipRRect(
                                borderRadius: BorderRadius.circular(999),
                                child: SizedBox(
                                  height: 8,
                                  child: LinearProgressIndicator(
                                    value: displayProgress.clamp(0.0, 1.0),
                                    backgroundColor: AirQrTheme.controlSurface(
                                      context,
                                    ),
                                    valueColor: AlwaysStoppedAnimation<Color>(
                                      isComplete
                                          ? successColor
                                          : AirQrTheme.loadingIndicator(
                                              context,
                                            ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                            const SizedBox(height: 12),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 12,
                              ),
                              decoration: BoxDecoration(
                                color: isComplete
                                    ? successColor.withValues(alpha: 0.72)
                                    : AirQrTheme.controlSurface(context),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: isComplete
                                      ? successColor.withValues(alpha: 0.4)
                                      : AirQrTheme.controlBorder(context),
                                ),
                              ),
                              child: Semantics(
                                key: const Key('scanner_status_text'),
                                liveRegion: scannerStatusUsesLiveRegion(status),
                                label: status,
                                excludeSemantics: true,
                                child: Text(
                                  status,
                                  textAlign: TextAlign.center,
                                  softWrap: true,
                                  style: AirQrTypography.of(context)
                                      .compactStatus
                                      .copyWith(
                                        color: AirQrTheme.textPrimary(context),
                                        height: 1.25,
                                      ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

String _scannerChunkLabel(AppLocalizations? l10n) {
  final numberedLabel = l10n?.scanner_chunkLabel(0) ?? 'Chunk 0';
  return numberedLabel.replaceFirst(RegExp(r'\s*0$'), '');
}

class _ScannerLocalChunkSummary extends StatelessWidget {
  final String sourceName;
  final int framesScanned;
  final int? currentChunkNumber;
  final int? currentChunkTotal;
  final String chunkLabel;

  const _ScannerLocalChunkSummary({
    required this.sourceName,
    required this.framesScanned,
    required this.currentChunkNumber,
    required this.currentChunkTotal,
    required this.chunkLabel,
  });

  @override
  Widget build(BuildContext context) {
    final typography = AirQrTypography.of(context);
    final baseStyle = typography.compactStatus.copyWith(
      color: AirQrTheme.textSecondary(context),
      fontSize: 10,
      height: 1.2,
      fontWeight: FontWeight.w600,
    );
    final numericStyle = typography.numeric.copyWith(
      color: AirQrTheme.textPrimary(context),
      fontSize: 10,
      height: 1.2,
      fontWeight: FontWeight.w600,
    );
    final currentChunkLabel = currentChunkNumber != null
        ? '$currentChunkNumber'
        : '-';
    final chunkTotalLabel = currentChunkTotal != null && currentChunkTotal! > 0
        ? '$currentChunkTotal'
        : '-';
    final chunk = Text(
      chunkLabel,
      key: const Key('scanner_local_chunk_label'),
      maxLines: 1,
      style: baseStyle,
    );
    final chunkRatio = Text(
      '$currentChunkLabel/$chunkTotalLabel',
      key: const Key('scanner_local_chunk_ratio'),
      maxLines: 1,
      style: numericStyle,
    );
    final source = Text(
      sourceName,
      key: const Key('scanner_local_chunk_source'),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: baseStyle.copyWith(
        color: Theme.of(context).brightness == Brightness.dark
            ? Colors.white
            : AirQrTheme.accentBlue,
      ),
    );
    final received = Text(
      '$framesScanned',
      key: const Key('scanner_local_chunk_received'),
      style: numericStyle,
    );
    final useStackedLayout = MediaQuery.textScalerOf(context).scale(10) > 15;

    return Container(
      key: const Key('scanner_local_chunk_summary'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(12),
      ),
      child: useStackedLayout
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(child: source),
                    const SizedBox(width: 8),
                    received,
                  ],
                ),
                const SizedBox(height: 4),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '•',
                        key: const Key('scanner_local_chunk_separator'),
                        style: baseStyle.copyWith(
                          color: AirQrTheme.textMuted(context),
                        ),
                      ),
                      const SizedBox(width: 8),
                      chunk,
                      const SizedBox(width: 8),
                      chunkRatio,
                    ],
                  ),
                ),
              ],
            )
          : Row(
              children: [
                Expanded(child: source),
                const SizedBox(width: 8),
                received,
                const SizedBox(width: 8),
                Text(
                  '•',
                  key: const Key('scanner_local_chunk_separator'),
                  style: baseStyle.copyWith(
                    color: AirQrTheme.textMuted(context),
                  ),
                ),
                const SizedBox(width: 8),
                chunk,
                const SizedBox(width: 8),
                chunkRatio,
              ],
            ),
    );
  }
}

int _scannerChunkDisplayedMissingCount(ScannerChunkProgressInfo chunk) {
  return math.max(0, chunk.missingCount ?? 0);
}

bool _isScannerChunkVisuallyComplete(ScannerChunkProgressInfo chunk) {
  return _scannerChunkDisplayedMissingCount(chunk) == 0;
}

class _ScannerChunkDetailsPanel extends StatefulWidget {
  final List<ScannerChunkProgressInfo> chunks;
  final ScannerChunkProgressInfo selectedChunk;
  final ValueChanged<int> onSelectChunk;

  const _ScannerChunkDetailsPanel({
    required this.chunks,
    required this.selectedChunk,
    required this.onSelectChunk,
  });

  @override
  State<_ScannerChunkDetailsPanel> createState() =>
      _ScannerChunkDetailsPanelState();
}

class _ScannerChunkDetailsPanelState extends State<_ScannerChunkDetailsPanel> {
  late final ScrollController _chunkScrollController;

  @override
  void initState() {
    super.initState();
    _chunkScrollController = ScrollController();
  }

  @override
  void dispose() {
    _chunkScrollController.dispose();
    super.dispose();
  }

  void _jumpScrollBy(double delta) {
    final controller = _chunkScrollController;
    if (!controller.hasClients || delta == 0) return;

    final target = (controller.offset + delta)
        .clamp(
          controller.position.minScrollExtent,
          controller.position.maxScrollExtent,
        )
        .toDouble();
    controller.jumpTo(target);
  }

  void _handlePointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;

    final horizontalDelta = event.scrollDelta.dx;
    final verticalDelta = event.scrollDelta.dy;
    final delta = horizontalDelta.abs() > verticalDelta.abs()
        ? horizontalDelta
        : verticalDelta;
    _jumpScrollBy(delta);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final warning = AirQrTheme.warningText(context);
    final chunks = widget.chunks;
    final selectedChunk = widget.selectedChunk;
    final threshold = selectedChunk.decodeThreshold;
    final progressLabel = threshold != null
        ? l10n?.scanner_toThreshold(selectedChunk.receivedUnique, threshold) ??
              '${selectedChunk.receivedUnique}/$threshold to threshold'
        : l10n?.scanner_receivedCount(selectedChunk.receivedUnique) ??
              '${selectedChunk.receivedUnique} received';
    final missingCount = _scannerChunkDisplayedMissingCount(selectedChunk);
    final targetFrameCount =
        selectedChunk.targetFrameCount ?? selectedChunk.missingCount ?? 0;
    final unseenFrameCount = selectedChunk.unseenFrameCount ?? 0;
    final candidatesComplete =
        targetFrameCount == 0 &&
        missingCount == 0 &&
        selectedChunk.state == ScannerChunkProgressState.complete;
    final summaryCard = Container(
      key: const Key('scanner_chunk_summary_card'),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n?.scanner_chunkLabel(selectedChunk.chunkId + 1) ??
                      'Chunk ${selectedChunk.chunkId + 1}',
                  style: AirQrTypography.of(context).compactStatus.copyWith(
                    color: AirQrTheme.textPrimary(context),
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              _ScannerChunkStatusPill(chunk: selectedChunk),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 4,
            runSpacing: 4,
            children: [
              _ScannerChunkInlineStat(
                label: progressLabel,
                color: AirQrTheme.accentText(context),
              ),
              _ScannerChunkInlineStat(
                label:
                    l10n?.scanner_moreUniqueQr(missingCount) ??
                    '$missingCount more unique QR',
                color: AirQrTheme.accentText(context),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: _ScannerChunkMetricTile(
                  key: const Key('scanner_chunk_candidates_metric'),
                  label: l10n?.scanner_candidates ?? 'Candidates',
                  value: '$targetFrameCount',
                  isCandidates: true,
                  isComplete: candidatesComplete,
                ),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: _ScannerChunkMetricTile(
                  key: const Key('scanner_chunk_unseen_metric'),
                  label: l10n?.scanner_unseen ?? 'Unseen',
                  value: '$unseenFrameCount',
                  isCandidates: false,
                  isComplete: false,
                ),
              ),
            ],
          ),
        ],
      ),
    );
    final showChunkSelector = chunks.length > 1;

    return Container(
      key: const Key('scanner_chunk_details_panel'),
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.65),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: warning.withValues(alpha: 0.20)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showChunkSelector) ...[
            Text(
              l10n?.scanner_selectChunk ?? 'Select chunk',
              style: AirQrTypography.of(context).compactStatus.copyWith(
                color: AirQrTheme.textSecondary(context),
                fontWeight: FontWeight.w700,
                letterSpacing: 0.7,
              ),
            ),
            const SizedBox(height: 8),
            Column(
              children: [
                Listener(
                  onPointerSignal: _handlePointerSignal,
                  child: ScrollConfiguration(
                    behavior: const _ScannerChunkScrollBehavior(),
                    child: SingleChildScrollView(
                      key: const Key('scanner_chunk_scroll_view'),
                      controller: _chunkScrollController,
                      scrollDirection: Axis.horizontal,
                      primary: false,
                      physics: const ClampingScrollPhysics(),
                      child: Row(
                        children: [
                          for (final chunk in chunks) ...[
                            _ScannerChunkOption(
                              key: Key('scanner_chunk_option_${chunk.chunkId}'),
                              chunk: chunk,
                              isSelected:
                                  chunk.chunkId == selectedChunk.chunkId,
                              onTap: () => widget.onSelectChunk(chunk.chunkId),
                            ),
                            const SizedBox(width: 6),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                _ScannerChunkScrollTrack(
                  key: const Key('scanner_chunk_scroll_track'),
                  controller: _chunkScrollController,
                ),
              ],
            ),
            const SizedBox(height: 2),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                '${selectedChunk.chunkId + 1}/${chunks.length}',
                style: AirQrTypography.of(context).numeric.copyWith(
                  color: AirQrTheme.textSecondary(context),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 8),
          ],
          summaryCard,
        ],
      ),
    );
  }
}

class _ScannerChunkScrollBehavior extends MaterialScrollBehavior {
  const _ScannerChunkScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => const {
    PointerDeviceKind.touch,
    PointerDeviceKind.mouse,
    PointerDeviceKind.stylus,
    PointerDeviceKind.invertedStylus,
    PointerDeviceKind.trackpad,
  };

  @override
  Widget buildScrollbar(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) {
    return child;
  }
}

class _ScannerChunkScrollTrack extends StatelessWidget {
  final ScrollController controller;

  const _ScannerChunkScrollTrack({super.key, required this.controller});

  void _jumpFromLocalDx(BoxConstraints constraints, double localDx) {
    if (!controller.hasClients) return;

    final position = controller.position;
    final maxScrollExtent = position.maxScrollExtent;
    if (maxScrollExtent <= 0) return;

    final trackWidth = constraints.maxWidth;
    final viewport = position.viewportDimension;
    final thumbWidth = math
        .max(44.0, trackWidth * (viewport / (viewport + maxScrollExtent)))
        .clamp(44.0, trackWidth)
        .toDouble();
    final travel = math.max(1.0, trackWidth - thumbWidth);
    final thumbLeft = (localDx - thumbWidth / 2).clamp(0.0, travel).toDouble();
    controller.jumpTo(maxScrollExtent * (thumbLeft / travel));
  }

  void _adjustByViewport(double direction) {
    if (!controller.hasClients) return;

    final position = controller.position;
    final target = (controller.offset + position.viewportDimension * direction)
        .clamp(position.minScrollExtent, position.maxScrollExtent)
        .toDouble();
    controller.jumpTo(target);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        return AnimatedBuilder(
          animation: controller,
          builder: (context, child) {
            final maxScrollExtent = controller.hasClients
                ? controller.position.maxScrollExtent
                : 0.0;
            final currentOffset = controller.hasClients
                ? controller.offset
                : 0.0;
            final percent = maxScrollExtent > 0
                ? ((currentOffset / maxScrollExtent) * 100).round()
                : 0;
            final pageDelta = controller.hasClients
                ? controller.position.viewportDimension * 0.8
                : 0.0;
            int percentFor(double offset) => maxScrollExtent > 0
                ? ((offset.clamp(0.0, maxScrollExtent) / maxScrollExtent) * 100)
                      .round()
                : 0;
            final increasedPercent = percentFor(currentOffset + pageDelta);
            final decreasedPercent = percentFor(currentOffset - pageDelta);
            return Semantics(
              label: l10n?.scanner_chunkScrollTrack ?? 'Scroll through chunks',
              value: l10n?.scanner_chunkScrollValue(percent) ?? '$percent%',
              increasedValue:
                  l10n?.scanner_chunkScrollValue(increasedPercent) ??
                  '$increasedPercent%',
              decreasedValue:
                  l10n?.scanner_chunkScrollValue(decreasedPercent) ??
                  '$decreasedPercent%',
              slider: true,
              enabled: maxScrollExtent > 0,
              onIncrease: maxScrollExtent > 0
                  ? () => _adjustByViewport(0.8)
                  : null,
              onDecrease: maxScrollExtent > 0
                  ? () => _adjustByViewport(-0.8)
                  : null,
              excludeSemantics: true,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapDown: (details) =>
                    _jumpFromLocalDx(constraints, details.localPosition.dx),
                onHorizontalDragUpdate: (details) =>
                    _jumpFromLocalDx(constraints, details.localPosition.dx),
                child: SizedBox(
                  height: 48,
                  child: Center(
                    child: SizedBox(
                      height: 12,
                      child: Builder(
                        builder: (context) {
                          final trackColor = AirQrTheme.textMuted(
                            context,
                          ).withValues(alpha: 0.18);
                          final thumbColor = AirQrTheme.textMuted(
                            context,
                          ).withValues(alpha: 0.62);
                          final trackWidth = constraints.maxWidth;
                          var thumbWidth = trackWidth;
                          var thumbLeft = 0.0;

                          if (controller.hasClients) {
                            final position = controller.position;
                            final maxScrollExtent = position.maxScrollExtent;
                            if (maxScrollExtent > 0) {
                              final viewport = position.viewportDimension;
                              thumbWidth = math
                                  .max(
                                    44.0,
                                    trackWidth *
                                        (viewport /
                                            (viewport + maxScrollExtent)),
                                  )
                                  .clamp(44.0, trackWidth)
                                  .toDouble();
                              final travel = math.max(
                                1.0,
                                trackWidth - thumbWidth,
                              );
                              thumbLeft =
                                  travel *
                                  (controller.offset / maxScrollExtent);
                            }
                          }

                          return Stack(
                            alignment: Alignment.centerLeft,
                            children: [
                              Container(
                                height: 6,
                                decoration: BoxDecoration(
                                  color: trackColor,
                                  borderRadius: BorderRadius.circular(999),
                                ),
                              ),
                              Positioned(
                                left: thumbLeft,
                                child: Container(
                                  width: thumbWidth,
                                  height: 6,
                                  decoration: BoxDecoration(
                                    color: thumbColor,
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _ScannerChunkOption extends StatelessWidget {
  final ScannerChunkProgressInfo chunk;
  final bool isSelected;
  final VoidCallback onTap;

  const _ScannerChunkOption({
    super.key,
    required this.chunk,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final missing = _scannerChunkDisplayedMissingCount(chunk);
    final isComplete = _isScannerChunkVisuallyComplete(chunk);
    final backgroundColor = isComplete
        ? AirQrTheme.successSurface(context)
        : isSelected
        ? AirQrTheme.warningSurface(context)
        : AirQrTheme.navActive(context);
    final borderColor = isComplete
        ? AirQrTheme.successText(
            context,
          ).withValues(alpha: isSelected ? 0.72 : 0.34)
        : isSelected
        ? AirQrTheme.progressOrange.withValues(alpha: 0.7)
        : Colors.transparent;
    final missingTextColor = isComplete
        ? AirQrTheme.successText(context)
        : AirQrTheme.textSecondary(context);
    final chunkLabel =
        l10n?.scanner_chunkLabel(chunk.chunkId + 1) ??
        'Chunk ${chunk.chunkId + 1}';
    final missingLabel =
        l10n?.scanner_missingPackets(missing) ?? '$missing missing';
    return Semantics(
      button: true,
      selected: isSelected,
      enabled: true,
      label: '$chunkLabel, $missingLabel',
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: backgroundColor,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: borderColor),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          overlayColor: AirQrTheme.interactionOverlay(context),
          child: SizedBox(
            width: 88,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      chunkLabel,
                      style: AirQrTypography.of(context).compactStatus.copyWith(
                        color: AirQrTheme.textPrimary(context),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      missingLabel,
                      softWrap: true,
                      style: AirQrTypography.of(context).compactStatus.copyWith(
                        color: missingTextColor,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ScannerChunkStatusPill extends StatelessWidget {
  final ScannerChunkProgressInfo chunk;

  const _ScannerChunkStatusPill({required this.chunk});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isComplete = _isScannerChunkVisuallyComplete(chunk);
    final label = isComplete
        ? l10n?.scanner_chunkComplete ?? 'Complete'
        : switch (chunk.state) {
            ScannerChunkProgressState.thresholdReached =>
              l10n?.scanner_chunkReady ?? 'Ready',
            ScannerChunkProgressState.scanning =>
              l10n?.scanner_chunkScanning ?? 'Scanning',
            ScannerChunkProgressState.complete ||
            ScannerChunkProgressState.missing =>
              l10n?.scanner_chunkMissing ?? 'Missing',
          };
    final isScanningOrReady =
        chunk.state == ScannerChunkProgressState.scanning ||
        chunk.state == ScannerChunkProgressState.thresholdReached;
    final color = isComplete
        ? AirQrTheme.successText(context)
        : isScanningOrReady
        ? AirQrTheme.accentText(context)
        : AirQrTheme.warningText(context);
    final surface = isComplete
        ? AirQrTheme.successSurface(context)
        : isScanningOrReady
        ? AirQrTheme.accentBlue.withValues(alpha: 0.16)
        : AirQrTheme.warningSurface(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.36)),
      ),
      child: Text(
        label,
        style: AirQrTypography.of(context).compactStatus.copyWith(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _ScannerChunkInlineStat extends StatelessWidget {
  final String label;
  final Color color;

  const _ScannerChunkInlineStat({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: AirQrTypography.of(context).compactStatus.copyWith(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _ScannerChunkMetricTile extends StatelessWidget {
  final String label;
  final String value;
  final bool isCandidates;
  final bool isComplete;

  const _ScannerChunkMetricTile({
    super.key,
    required this.label,
    required this.value,
    required this.isCandidates,
    required this.isComplete,
  });

  @override
  Widget build(BuildContext context) {
    final textColor = isCandidates
        ? isComplete
              ? AirQrTheme.successText(context)
              : AirQrTheme.warningText(context)
        : AirQrTheme.textSecondary(context);
    final surfaceColor = isCandidates
        ? isComplete
              ? AirQrTheme.successSurface(context)
              : AirQrTheme.warningSurface(context)
        : AirQrTheme.navActive(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: surfaceColor,
        borderRadius: BorderRadius.circular(isCandidates ? 8 : 14),
        border: Border.all(
          color: isCandidates
              ? textColor.withValues(alpha: 0.18)
              : AirQrTheme.controlBorder(context),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: AirQrTypography.of(context).compactStatus.copyWith(
              color: AirQrTheme.textSecondary(context),
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: AirQrTypography.of(context).numeric.copyWith(
              color: textColor,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

Future<void> showScannerCameraSelectorSheet(
  BuildContext context, {
  required VoidCallback onSelectBackCamera,
  required VoidCallback onSelectFrontCamera,
}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: AirQrTheme.card(context),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (context) {
      final l10n = AppLocalizations.of(context);
      return Container(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n?.scanner_selectCamera ?? 'Select Camera',
              style: AirQrTypography.of(context).compactStatus.copyWith(
                color: AirQrTheme.textSecondary(context),
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 12),
            ListTile(
              leading: AirQrIcon(
                'photo_camera_back',
                color: AirQrTheme.textPrimary(context),
              ),
              title: Text(
                l10n?.scanner_backCamera ?? 'Back Camera',
                style: TextStyle(color: AirQrTheme.textPrimary(context)),
              ),
              onTap: () {
                Navigator.pop(context);
                onSelectBackCamera();
              },
            ),
            ListTile(
              leading: AirQrIcon(
                'photo_camera_front',
                color: AirQrTheme.textPrimary(context),
              ),
              title: Text(
                l10n?.scanner_frontCamera ?? 'Front Camera',
                style: TextStyle(color: AirQrTheme.textPrimary(context)),
              ),
              onTap: () {
                Navigator.pop(context);
                onSelectFrontCamera();
              },
            ),
          ],
        ),
      );
    },
  );
}

Future<void> showScannerHelpDialog(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (context) {
      final l10n = AppLocalizations.of(context);
      return AlertDialog(
        backgroundColor: AirQrTheme.card(context),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text(
          l10n?.scanner_helpTitle ?? 'Scanning Tips',
          style: TextStyle(
            color: AirQrTheme.textPrimary(context),
            fontWeight: FontWeight.bold,
          ),
        ),
        content: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.55,
          ),
          child: SingleChildScrollView(
            key: const Key('scanner_help_scroll'),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _ScannerHelpTip(
                  iconName: 'qr_code_scanner',
                  title: l10n?.scanner_helpTip_positioning ?? 'Positioning',
                  description:
                      l10n?.scanner_helpTip_positioningDesc ??
                      'Keep the QR code centered and fully visible in the frame',
                ),
                SizedBox(height: 12),
                _ScannerHelpTip(
                  iconName: 'light_mode',
                  title: l10n?.scanner_helpTip_lighting ?? 'Lighting',
                  description:
                      l10n?.scanner_helpTip_lightingDesc ??
                      'Ensure good lighting for best results',
                ),
                SizedBox(height: 12),
                _ScannerHelpTip(
                  iconName: 'flashlight_on',
                  title: l10n?.scanner_helpTip_torch ?? 'Torch',
                  description:
                      l10n?.scanner_helpTip_torchDesc ??
                      'Use the torch in low-light conditions',
                ),
                SizedBox(height: 12),
                _ScannerHelpTip(
                  iconName: 'speed',
                  title: l10n?.scanner_helpTip_speed ?? 'Speed',
                  description:
                      l10n?.scanner_helpTip_speedDesc ??
                      'Hold steady while scanning animated QR codes',
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: Navigator.of(context).pop,
            child: Text(l10n?.scanner_helpConfirm ?? 'Got it'),
          ),
        ],
      );
    },
  );
}

class _ScannerHelpTip extends StatelessWidget {
  final String iconName;
  final String title;
  final String description;

  const _ScannerHelpTip({
    required this.iconName,
    required this.title,
    required this.description,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: AirQrTheme.accentBlue.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(12),
          ),
          child: AirQrIcon(
            iconName,
            color: AirQrTheme.accentText(context),
            size: 20,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: AirQrTheme.textPrimary(context),
                ),
              ),
              const SizedBox(height: 2),
              Text(
                description,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: AirQrTheme.textSecondary(context),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ScannerTopButton extends StatelessWidget {
  final String iconName;
  final String? tooltip;
  final VoidCallback? onPressed;
  final Color? backgroundColor;
  final Color? iconColor;

  const _ScannerTopButton({
    super.key,
    required this.iconName,
    this.tooltip,
    required this.onPressed,
    this.backgroundColor,
    this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    final isEnabled = onPressed != null;
    final effectiveBackgroundColor =
        backgroundColor ?? AirQrTheme.navActive(context);
    final button = Semantics(
      button: true,
      label: tooltip,
      enabled: isEnabled,
      onTap: onPressed,
      excludeSemantics: true,
      child: Material(
        color: Colors.transparent,
        shape: const CircleBorder(),
        child: InkWell(
          onTap: onPressed,
          customBorder: const CircleBorder(),
          overlayColor: const WidgetStatePropertyAll(Colors.transparent),
          child: SizedBox(
            width: _scannerTopActionExtent,
            height: _scannerTopActionExtent,
            child: Center(
              child: DecoratedBox(
                decoration: ShapeDecoration(
                  color: isEnabled
                      ? effectiveBackgroundColor
                      : effectiveBackgroundColor.withValues(alpha: 0.52),
                  shape: const CircleBorder(),
                ),
                child: SizedBox(
                  width: 40,
                  height: 40,
                  child: Center(
                    child: AirQrIcon(
                      iconName,
                      color:
                          iconColor ??
                          (isEnabled
                              ? AirQrTheme.textPrimary(context)
                              : AirQrTheme.textMuted(context)),
                      size: iconName == 'help' ? 24 : 20,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    if (tooltip == null || tooltip!.isEmpty) {
      return button;
    }
    return Tooltip(
      message: tooltip!,
      excludeFromSemantics: true,
      child: button,
    );
  }
}

class _ScannerInfoChip extends StatelessWidget {
  final Widget child;
  final Key? surfaceKey;
  final Color? borderColor;
  final double borderRadius;
  final double verticalPadding;

  const _ScannerInfoChip({
    super.key,
    required this.child,
    this.surfaceKey,
    this.borderColor,
    this.borderRadius = 12,
    this.verticalPadding = _scannerInfoChipVerticalPadding,
  });

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      widthFactor: 1,
      heightFactor: 1,
      child: Container(
        key: surfaceKey,
        padding: EdgeInsets.symmetric(
          horizontal: _scannerInfoChipHorizontalPadding,
          vertical: verticalPadding,
        ),
        decoration: BoxDecoration(
          color: AirQrTheme.navSurface(context),
          borderRadius: BorderRadius.circular(borderRadius),
          border: Border.all(
            color: borderColor ?? AirQrTheme.controlBorder(context),
          ),
        ),
        child: child,
      ),
    );
  }
}

class _ScannerStatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color valueColor;
  final Key? valueKey;

  const _ScannerStatCard({
    required this.label,
    required this.value,
    required this.valueColor,
    this.valueKey,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: BoxDecoration(
        color: AirQrTheme.navActive(context),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: AirQrTypography.of(context).compactStatus.copyWith(
              color: AirQrTheme.textSecondary(context),
              fontWeight: FontWeight.w700,
              letterSpacing: 0.6,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            key: valueKey,
            style: AirQrTypography.of(
              context,
            ).numeric.copyWith(color: valueColor),
          ),
        ],
      ),
    );
  }
}
