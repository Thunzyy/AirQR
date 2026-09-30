import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'encoder_inline_preview.dart';
import 'l10n/app_localizations.dart';
import 'note_detection.dart';
import 'widgets/airqr_segmented_control.dart';

Duration _animationDuration(
  BuildContext context, [
  Duration duration = const Duration(milliseconds: 300),
]) => MediaQuery.disableAnimationsOf(context) ? Duration.zero : duration;

class EncoderModeToggle extends StatelessWidget {
  final bool noteMode;
  final VoidCallback onSelectFileMode;
  final VoidCallback onSelectNoteMode;

  const EncoderModeToggle({
    super.key,
    required this.noteMode,
    required this.onSelectFileMode,
    required this.onSelectNoteMode,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final labels = [l10n.encoder_modeFile, l10n.encoder_modeNote];
    return AirQrSegmentedControl(
      key: const Key('encoder-mode-toggle'),
      indicatorKey: const Key('encoder-mode-toggle-active-indicator'),
      optionKeys: const [
        Key('encoder-mode-file-option'),
        Key('encoder-mode-note-option'),
      ],
      options: labels,
      value: labels[noteMode ? 1 : 0],
      onChanged: (value) =>
          value == labels[0] ? onSelectFileMode() : onSelectNoteMode(),
    );
  }
}

class EncoderNetworkAccessNotice extends StatelessWidget {
  final VoidCallback? onOpenOfflineWebSettings;
  final VoidCallback onOpenGithubReleases;
  final VoidCallback onDismiss;

  const EncoderNetworkAccessNotice({
    super.key,
    required this.onOpenOfflineWebSettings,
    required this.onOpenGithubReleases,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final primaryText = AirQrTheme.textPrimary(context);
    final secondaryText = AirQrTheme.textSecondary(context);

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AirQrTheme.card(context),
        borderRadius: BorderRadius.circular(28),
      ),
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 54),
            child: LayoutBuilder(
              key: const Key('encoder-network-notice-content'),
              builder: (context, constraints) {
                final compact = constraints.maxWidth < 560;
                final icon = Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AirQrTheme.controlSurface(context),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: AirQrIcon(
                    'wifi_tethering',
                    size: 22,
                    color: primaryText,
                    semanticLabel: l10n.encoder_networkTitle,
                  ),
                );
                final textAndActionsChild = Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.encoder_networkTitle,
                      style: TextStyle(
                        color: primaryText,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      l10n.encoder_networkBody,
                      style: TextStyle(color: secondaryText, height: 1.35),
                    ),
                    const SizedBox(height: 14),
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: [
                        ElevatedButton.icon(
                          onPressed: onOpenOfflineWebSettings,
                          icon: const AirQrIcon('settings', size: 17),
                          label: Text(l10n.encoder_openOfflineWebSettings),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AirQrTheme.primaryButtonSurface(
                              context,
                            ),
                            foregroundColor: AirQrTheme.primaryButtonForeground(
                              context,
                            ),
                            disabledBackgroundColor: AirQrTheme.controlSurface(
                              context,
                            ),
                            disabledForegroundColor: secondaryText,
                            elevation: 0,
                            minimumSize: const Size(48, 48),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 12,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(999),
                            ),
                          ),
                        ),
                        TextButton.icon(
                          onPressed: onOpenGithubReleases,
                          icon: AirQrIcon(
                            'open_in_new',
                            size: 17,
                            color: primaryText,
                          ),
                          label: Text(l10n.encoder_openGithubReleases),
                          style: TextButton.styleFrom(
                            backgroundColor: AirQrTheme.actionSurface(context),
                            foregroundColor: primaryText,
                            minimumSize: const Size(48, 48),
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 12,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(999),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                );
                final textAndActions = Expanded(child: textAndActionsChild);

                if (compact) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      icon,
                      const SizedBox(height: 12),
                      textAndActionsChild,
                    ],
                  );
                }

                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [icon, const SizedBox(width: 14), textAndActions],
                );
              },
            ),
          ),
          Positioned(
            top: 0,
            right: 0,
            child: Tooltip(
              message: l10n.encoder_hideNetworkNotice,
              child: Semantics(
                button: true,
                label: l10n.encoder_hideNetworkNotice,
                child: Material(
                  color: AirQrTheme.actionSurface(context),
                  borderRadius: BorderRadius.circular(999),
                  child: InkWell(
                    onTap: onDismiss,
                    borderRadius: BorderRadius.circular(999),
                    child: SizedBox(
                      key: const Key('encoder-network-notice-dismiss'),
                      width: 48,
                      height: 48,
                      child: Center(
                        child: AirQrIcon('close', size: 18, color: primaryText),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class EncoderNoteEditor extends StatelessWidget {
  final String noteText;
  final NoteFormat noteFormat;
  final ValueChanged<String> onNoteTextChanged;
  final ValueChanged<NoteFormat> onNoteFormatChanged;
  final VoidCallback onClear;

  const EncoderNoteEditor({
    super.key,
    required this.noteText,
    required this.noteFormat,
    required this.onNoteTextChanged,
    required this.onNoteFormatChanged,
    required this.onClear,
  });

  String _noteFormatLabel(AppLocalizations l10n, NoteFormat format) {
    switch (format) {
      case NoteFormat.plain:
        return l10n.encoder_noteFormat_plain;
      case NoteFormat.markdown:
        return l10n.encoder_noteFormat_markdown;
      case NoteFormat.javascript:
        return l10n.encoder_noteFormat_javascript;
      case NoteFormat.python:
        return l10n.encoder_noteFormat_python;
      case NoteFormat.typescript:
        return l10n.encoder_noteFormat_typescript;
      case NoteFormat.json:
        return l10n.encoder_noteFormat_json;
      case NoteFormat.html:
        return l10n.encoder_noteFormat_html;
      case NoteFormat.css:
        return l10n.encoder_noteFormat_css;
      case NoteFormat.rust:
        return l10n.encoder_noteFormat_rust;
      case NoteFormat.sql:
        return l10n.encoder_noteFormat_sql;
      case NoteFormat.yaml:
        return l10n.encoder_noteFormat_yaml;
      case NoteFormat.shell:
        return l10n.encoder_noteFormat_shell;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final noteBytes = utf8.encode(noteText).length;
    final noteLines = noteText.split('\n');
    final visibleLineCount = noteLines.length < 15 ? 15 : noteLines.length;

    return Container(
      decoration: BoxDecoration(
        color: AirQrTheme.card(context),
        borderRadius: BorderRadius.circular(34),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: AirQrTheme.controlSurface(context),
              border: Border(
                bottom: BorderSide(color: AirQrTheme.divider(context)),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: AirQrTheme.iconSurface(context),
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: AirQrIcon(
                    'article',
                    color: AirQrTheme.textPrimary(context),
                    size: 16,
                  ),
                ),
                const SizedBox(width: 8),
                DropdownButtonHideUnderline(
                  child: DropdownButton<NoteFormat>(
                    key: const Key('encoder_note_format_dropdown'),
                    value: noteFormat,
                    isDense: true,
                    borderRadius: BorderRadius.circular(16),
                    dropdownColor: AirQrTheme.controlSurface(context),
                    icon: AirQrIcon(
                      'expand_more',
                      size: 16,
                      color: AirQrTheme.textPrimary(context),
                    ),
                    iconSize: 16,
                    style: TextStyle(
                      color: AirQrTheme.textPrimary(context),
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                    items: noteFormatOptions.map((option) {
                      return DropdownMenuItem<NoteFormat>(
                        value: option.value,
                        child: Text(_noteFormatLabel(l10n, option.value)),
                      );
                    }).toList(),
                    onChanged: (value) {
                      if (value != null) {
                        onNoteFormatChanged(value);
                      }
                    },
                  ),
                ),
                const Spacer(),
                TextButton.icon(
                  key: const Key('encoder_note_clear_button'),
                  onPressed: noteText.isEmpty ? null : onClear,
                  style: TextButton.styleFrom(
                    foregroundColor: AirQrTheme.textSecondary(context),
                    backgroundColor: AirQrTheme.actionSurface(context),
                    disabledForegroundColor: AirQrTheme.disabledText(context),
                    disabledBackgroundColor: AirQrTheme.disabledSurface(
                      context,
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    minimumSize: const Size(0, 32),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(999),
                      side: BorderSide(
                        color: noteText.isEmpty
                            ? Colors.transparent
                            : AirQrTheme.controlBorder(context),
                      ),
                    ),
                  ),
                  icon: const AirQrIcon('delete_outline', size: 14),
                  label: Text(
                    l10n.encoder_clearNote,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(
            height: 360,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  key: const Key('encoder_note_line_gutter'),
                  width: 46,
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  decoration: BoxDecoration(
                    color: AirQrTheme.controlSurface(context),
                    border: Border(
                      right: BorderSide(color: AirQrTheme.divider(context)),
                    ),
                  ),
                  child: Column(
                    children: List<Widget>.generate(visibleLineCount, (index) {
                      final hasLine = index < noteLines.length;
                      return SizedBox(
                        key: Key('encoder_note_line_number_${index + 1}'),
                        height: 22,
                        width: double.infinity,
                        child: Padding(
                          padding: const EdgeInsets.only(right: 16),
                          child: Align(
                            alignment: Alignment.centerRight,
                            child: Text(
                              '${index + 1}',
                              textAlign: TextAlign.right,
                              style: TextStyle(
                                color: hasLine
                                    ? AirQrTheme.textMuted(context)
                                    : AirQrTheme.disabledText(context),
                                fontSize: 12,
                                height: 22 / 12,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ),
                        ),
                      );
                    }),
                  ),
                ),
                Expanded(
                  child: ColoredBox(
                    color: AirQrTheme.previewSurface(context),
                    child: TextFormField(
                      initialValue: noteText,
                      minLines: 14,
                      maxLines: null,
                      onChanged: onNoteTextChanged,
                      style: TextStyle(
                        color: AirQrTheme.textPrimary(context),
                        fontSize: 14,
                        height: 22 / 14,
                        fontFamily: 'monospace',
                      ),
                      decoration: InputDecoration(
                        hintText: l10n.encoder_notePlaceholder,
                        hintStyle: TextStyle(
                          color: AirQrTheme.textMuted(context),
                        ),
                        filled: true,
                        fillColor: Colors.transparent,
                        contentPadding: const EdgeInsets.all(15),
                        border: InputBorder.none,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Container(
            key: const Key('encoder_note_status_bar'),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: AirQrTheme.controlSurface(context),
              border: Border(
                top: BorderSide(color: AirQrTheme.divider(context)),
              ),
            ),
            child: Row(
              children: [
                Text(
                  l10n.common_lineCount(noteLines.length),
                  style: TextStyle(
                    color: AirQrTheme.textMuted(context),
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text(
                    '|',
                    style: TextStyle(
                      color: AirQrTheme.divider(context),
                      fontSize: 12,
                    ),
                  ),
                ),
                Text(
                  l10n.common_charCount(noteText.length),
                  style: TextStyle(
                    color: AirQrTheme.textMuted(context),
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                Text(
                  l10n.common_byteCount(noteBytes),
                  style: TextStyle(
                    color: AirQrTheme.textMuted(context),
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class EncoderSourceCard extends StatelessWidget {
  final String? fileName;
  final String? fileSizeLabel;
  final bool hasSelection;
  final VoidCallback onSelectFile;
  final VoidCallback onSelectFolder;

  const EncoderSourceCard({
    super.key,
    required this.fileName,
    required this.fileSizeLabel,
    required this.hasSelection,
    required this.onSelectFile,
    required this.onSelectFolder,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final subtitle = hasSelection
        ? fileSizeLabel
        : AppLocalizations.of(context)!.encoder_dropzone;
    final stacksSourceActions = MediaQuery.textScalerOf(context).scale(16) > 22;
    final fileAction = _EncoderSourceAction(
      iconName: 'file_text',
      label: l10n.encoder_selectFiles,
      onTap: onSelectFile,
    );
    final folderAction = _EncoderSourceAction(
      iconName: 'folder_open',
      label: l10n.encoder_selectFolder,
      onTap: onSelectFolder,
    );

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AirQrTheme.card(context),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Column(
        children: [
          if (hasSelection) ...[
            Row(
              children: [
                Container(
                  key: const Key('encoder-selected-file-icon'),
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    color: AirQrTheme.iconSurface(context),
                    shape: BoxShape.circle,
                  ),
                  child: AirQrIcon(
                    'description',
                    size: 20,
                    color: AirQrTheme.textPrimary(context),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        fileName ?? l10n.encoder_fileSelected,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: AirQrTheme.textPrimary(context),
                        ),
                      ),
                      if (subtitle != null)
                        Text(
                          subtitle,
                          style: TextStyle(
                            color: AirQrTheme.textMuted(context),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],
          if (stacksSourceActions)
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [fileAction, const SizedBox(height: 12), folderAction],
            )
          else
            Row(
              children: [
                Expanded(child: fileAction),
                const SizedBox(width: 12),
                Expanded(child: folderAction),
              ],
            ),
          if (!hasSelection) ...[
            const SizedBox(height: 12),
            Text(
              subtitle ?? '',
              textAlign: TextAlign.center,
              style: TextStyle(color: AirQrTheme.textMuted(context)),
            ),
          ],
        ],
      ),
    );
  }
}

class _EncoderSourceAction extends StatelessWidget {
  final String iconName;
  final String label;
  final VoidCallback onTap;

  const _EncoderSourceAction({
    required this.iconName,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AirQrTheme.controlSurface(context),
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        hoverColor: AirQrTheme.cardHover(context),
        focusColor: AirQrTheme.cardHover(context),
        highlightColor: AirQrTheme.cardHover(context),
        splashColor: Colors.transparent,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              AirQrIcon(
                iconName,
                size: 22,
                color: AirQrTheme.textPrimary(context),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label,
                  maxLines: 2,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AirQrTheme.textPrimary(context),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class EncoderSettingsPanel extends StatelessWidget {
  final bool expanded;
  final VoidCallback onToggleExpanded;
  final int fps;
  final String eccLevel;
  final int packetSize;
  final int targetQrSize;
  final int scale;
  final double raptorqOverhead;
  final bool compressionEnabled;
  final bool forceChunkMode;
  final String chunkSizeMbText;
  final ValueChanged<double> onFpsChanged;
  final ValueChanged<String> onEccLevelChanged;
  final ValueChanged<String> onPacketSizeChanged;
  final ValueChanged<String> onTargetQrSizeChanged;
  final ValueChanged<String> onScaleChanged;
  final ValueChanged<double> onRaptorqOverheadChanged;
  final ValueChanged<bool> onCompressionChanged;
  final ValueChanged<bool> onForceChunkModeChanged;
  final ValueChanged<String> onChunkSizeChanged;

  const EncoderSettingsPanel({
    super.key,
    required this.expanded,
    required this.onToggleExpanded,
    required this.fps,
    required this.eccLevel,
    required this.packetSize,
    required this.targetQrSize,
    required this.scale,
    required this.raptorqOverhead,
    required this.compressionEnabled,
    required this.forceChunkMode,
    required this.chunkSizeMbText,
    required this.onFpsChanged,
    required this.onEccLevelChanged,
    required this.onPacketSizeChanged,
    required this.onTargetQrSizeChanged,
    required this.onScaleChanged,
    required this.onRaptorqOverheadChanged,
    required this.onCompressionChanged,
    required this.onForceChunkModeChanged,
    required this.onChunkSizeChanged,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      decoration: BoxDecoration(
        color: AirQrTheme.card(context),
        borderRadius: BorderRadius.circular(34),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(34),
              hoverColor: AirQrTheme.controlSurface(
                context,
              ).withValues(alpha: 0.22),
              splashColor: Colors.transparent,
              onTap: onToggleExpanded,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    AirQrIcon(
                      'settings',
                      color: AirQrTheme.textPrimary(context),
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        l10n.encoder_advancedSettings,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: AirQrTheme.textPrimary(context),
                        ),
                      ),
                    ),
                    AnimatedRotation(
                      turns: expanded ? 0.5 : 0,
                      duration: _animationDuration(
                        context,
                        const Duration(milliseconds: 220),
                      ),
                      curve: Curves.easeOut,
                      child: AirQrIcon(
                        'expand_more',
                        color: AirQrTheme.textSecondary(context),
                        size: 20,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: _animationDuration(
              context,
              const Duration(milliseconds: 220),
            ),
            crossFadeState: expanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            firstChild: const SizedBox.shrink(),
            secondChild: Column(
              children: [
                Divider(height: 1, color: AirQrTheme.divider(context)),
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
                  child: Column(
                    children: [
                      _EncoderSliderRow(
                        label: l10n.encoder_frameRate,
                        valueLabel: '$fps fps',
                        lowLabel: l10n.encoder_slowFps,
                        highLabel: l10n.encoder_fastFps,
                        value: fps.toDouble(),
                        min: 1,
                        max: 60,
                        onChanged: onFpsChanged,
                      ),
                      _EncoderSliderRow(
                        label: l10n.encoder_packetSize,
                        valueLabel: '$packetSize bytes',
                        lowLabel: l10n.encoder_smallPacket,
                        highLabel: l10n.encoder_largePacket,
                        value: packetSize.toDouble(),
                        min: 100,
                        max: 2800,
                        divisions: 27,
                        onChanged: (value) => onPacketSizeChanged(
                          ((value / 100).round() * 100).toString(),
                        ),
                      ),
                      _EncoderStringDropdown(
                        label: l10n.encoder_errorCorrection,
                        value: eccLevel,
                        options: const <String>[
                          'LOW (7%)',
                          'MEDIUM (15%)',
                          'QUARTILE (25%)',
                          'HIGH (30%)',
                        ],
                        onChanged: onEccLevelChanged,
                      ),
                      _EncoderSliderRow(
                        label: l10n.encoder_targetQrSize,
                        valueLabel: '${targetQrSize}px',
                        value: targetQrSize.toDouble(),
                        min: 100,
                        max: 500,
                        divisions: 40,
                        onChanged: (value) => onTargetQrSizeChanged(
                          ((value / 10).round() * 10).toString(),
                        ),
                      ),
                      _EncoderSliderRow(
                        label: l10n.encoder_raptorqOverhead,
                        valueLabel: '${raptorqOverhead.toStringAsFixed(1)}x',
                        value: raptorqOverhead,
                        min: 1.0,
                        max: 3.0,
                        divisions: 20,
                        onChanged: onRaptorqOverheadChanged,
                      ),
                      const SizedBox(height: 8),
                      _EncoderSwitchTile(
                        title: l10n.encoder_enableCompression,
                        subtitle: l10n.encoder_enableCompressionDesc,
                        value: compressionEnabled,
                        onChanged: onCompressionChanged,
                      ),
                      const SizedBox(height: 12),
                      _EncoderSwitchTile(
                        title: l10n.encoder_forceChunkMode,
                        subtitle: l10n.encoder_forceChunkModeDesc,
                        value: forceChunkMode,
                        onChanged: onForceChunkModeChanged,
                      ),
                      if (forceChunkMode) ...[
                        const SizedBox(height: 12),
                        _EncoderSliderRow(
                          label: l10n.encoder_chunkSizeMb,
                          valueLabel: '$chunkSizeMbText MB',
                          value: double.tryParse(chunkSizeMbText) ?? 10.0,
                          min: 0.1,
                          max: 50.0,
                          divisions: 499,
                          onChanged: (value) =>
                              onChunkSizeChanged(value.toStringAsFixed(1)),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class EncoderGifResultCard extends StatefulWidget {
  final Uint8List gifData;
  final int currentFrame;
  final int totalFrames;
  final int minFrames;
  final String sizeLabel;
  final String durationLabel;
  final int originalSizeBytes;
  final int? resultSizeBytes;
  final int playbackFps;
  final bool isPlaying;
  final bool canPlay;
  final String keyPrefix;
  final String? downloadLabel;
  final Widget? controlsAddon;
  final Widget? resultFooter;
  final int? selectedChunkIndex;
  final int? totalChunks;
  final bool autoAdvanceChunks;
  final VoidCallback? onToggleAutoAdvanceChunks;
  final VoidCallback onDownload;
  final VoidCallback onFullscreen;
  final VoidCallback? onTogglePlayback;
  final ValueChanged<int>? onFrameChanged;
  final ValueChanged<int>? onPlaybackFpsChanged;

  const EncoderGifResultCard({
    super.key,
    required this.gifData,
    required this.currentFrame,
    required this.totalFrames,
    required this.minFrames,
    required this.sizeLabel,
    required this.durationLabel,
    this.originalSizeBytes = 0,
    this.resultSizeBytes,
    this.playbackFps = 10,
    this.isPlaying = true,
    this.canPlay = true,
    this.keyPrefix = 'encoder-gif',
    this.downloadLabel,
    this.controlsAddon,
    this.resultFooter,
    this.selectedChunkIndex,
    this.totalChunks,
    this.autoAdvanceChunks = true,
    this.onToggleAutoAdvanceChunks,
    required this.onDownload,
    required this.onFullscreen,
    this.onTogglePlayback,
    this.onFrameChanged,
    this.onPlaybackFpsChanged,
  });

  @override
  State<EncoderGifResultCard> createState() => _EncoderGifResultCardState();
}

class _EncoderGifResultCardState extends State<EncoderGifResultCard> {
  final TransformationController _transformationController =
      TransformationController();
  double _zoom = 1;
  bool _controlsCollapsed = false;

  @override
  void initState() {
    super.initState();
    _transformationController.addListener(_syncZoom);
  }

  @override
  void dispose() {
    _transformationController
      ..removeListener(_syncZoom)
      ..dispose();
    super.dispose();
  }

  void _syncZoom() {
    final next = _transformationController.value.getMaxScaleOnAxis().clamp(
      0.5,
      5.0,
    );
    if (!mounted || (next - _zoom).abs() < 0.01) return;
    setState(() => _zoom = next);
  }

  void _setZoom(double zoom) {
    final next = zoom.clamp(0.5, 5.0);
    _transformationController.value = Matrix4.diagonal3Values(next, next, 1);
  }

  void _recenterZoom() => _setZoom(_zoom);

  Key _key(String suffix) => Key('${widget.keyPrefix}-$suffix');

  String _formatScanDuration(double seconds) => seconds >= 60
      ? '${seconds ~/ 60}:${(seconds % 60).round().toString().padLeft(2, '0')}'
      : '${seconds.toStringAsFixed(seconds >= 10 ? 0 : 1)}s';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final total = widget.totalFrames.clamp(1, 1 << 31);
    final resultSizeBytes = widget.resultSizeBytes ?? widget.gifData.length;
    final expansion = widget.originalSizeBytes > 0
        ? ((resultSizeBytes - widget.originalSizeBytes) /
                  widget.originalSizeBytes) *
              100
        : null;
    final minScanSeconds = widget.minFrames > 0 && widget.playbackFps > 0
        ? widget.minFrames / widget.playbackFps
        : null;
    return Semantics(
      label: '${widget.sizeLabel}, ${widget.durationLabel}',
      child: Container(
        key: _key('result-card'),
        decoration: BoxDecoration(
          color: AirQrTheme.card(context),
          borderRadius: BorderRadius.circular(30),
        ),
        padding: const EdgeInsets.all(12),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final previewHeight = (constraints.maxWidth + 56).clamp(
              340.0,
              620.0,
            );
            return Column(
              children: [
                _buildResultHeader(context, l10n, expansion),
                const SizedBox(height: 10),
                RepaintBoundary(
                  child: Container(
                    key: _key('preview'),
                    width: double.infinity,
                    height: previewHeight,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AirQrTheme.previewSurface(context),
                      borderRadius: AirQrRadii.panel,
                      border: Border.all(
                        color: AirQrTheme.controlBorder(context),
                      ),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      children: [
                        _buildPreviewStatus(context, l10n, minScanSeconds),
                        const SizedBox(height: 12),
                        Expanded(
                          child: InteractiveViewer(
                            transformationController: _transformationController,
                            minScale: 0.5,
                            maxScale: 5,
                            panEnabled: false,
                            boundaryMargin: const EdgeInsets.all(80),
                            onInteractionEnd: (_) => _recenterZoom(),
                            child: EncoderInlineGifPreview(
                              gifData: widget.gifData,
                              frameNumber: widget.currentFrame,
                              isPlaying: widget.isPlaying,
                              fit: BoxFit.contain,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                AnimatedSize(
                  duration: const Duration(milliseconds: 180),
                  curve: Curves.easeOutCubic,
                  child: _controlsCollapsed
                      ? Align(
                          alignment: Alignment.center,
                          child: _InlineViewerIconButton(
                            key: _key('expand-controls'),
                            label: l10n.encoder_showControls,
                            icon: 'expand_less',
                            onPressed: () =>
                                setState(() => _controlsCollapsed = false),
                          ),
                        )
                      : _buildControls(context, l10n, total),
                ),
                if (widget.resultFooter != null) ...[
                  const SizedBox(height: 12),
                  widget.resultFooter!,
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _buildResultHeader(
    BuildContext context,
    AppLocalizations l10n,
    double? expansion,
  ) {
    final baseStyle = AirQrTypography.of(context).compactStatus.copyWith(
      color: AirQrTheme.textSecondary(context),
      fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
    );
    final stats = Text.rich(
      key: _key('result-stats'),
      TextSpan(
        style: baseStyle,
        children: [
          TextSpan(text: '${widget.sizeLabel} - ${widget.durationLabel}'),
          if (expansion != null && expansion > 0)
            TextSpan(
              text:
                  ' (+${expansion.toStringAsFixed(1)}% ${l10n.encoder_expansion})',
              style: baseStyle.copyWith(
                color: AirQrTheme.destructive,
                fontWeight: FontWeight.w700,
              ),
            ),
        ],
      ),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
    );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.encoder_result.toUpperCase(),
                style: AirQrTypography.of(context).compactStatus.copyWith(
                  color: AirQrTheme.textSecondary(context),
                  fontSize: 10,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1.4,
                ),
              ),
              const SizedBox(height: 3),
              stats,
            ],
          ),
        ),
        const SizedBox(width: 12),
        _InlineViewerIconButton(
          key: _key('download-action'),
          label: widget.downloadLabel ?? l10n.encoder_downloadGif,
          icon: 'download',
          onPressed: widget.onDownload,
        ),
      ],
    );
  }

  Widget _buildPreviewStatus(
    BuildContext context,
    AppLocalizations l10n,
    double? minScanSeconds,
  ) {
    final hasChunkNavigation =
        widget.selectedChunkIndex != null &&
        widget.totalChunks != null &&
        widget.totalChunks! > 1 &&
        widget.onToggleAutoAdvanceChunks != null;
    final frameSemanticLabel =
        '${widget.currentFrame} / ${widget.totalFrames} '
        '(${l10n.encoder_minRequired}: ${widget.minFrames})';
    final frameBadge = _InlineViewerBadge(
      key: _key('frame-badge'),
      label: hasChunkNavigation
          ? '${widget.currentFrame}/${widget.totalFrames} • '
                '${l10n.encoder_minShort} ${widget.minFrames}'
          : frameSemanticLabel,
      semanticLabel: frameSemanticLabel,
    );
    final minScanBadge = minScanSeconds == null
        ? null
        : _InlineViewerBadge(
            key: _key('min-scan'),
            label: l10n.encoder_minScanTime(
              _formatScanDuration(minScanSeconds),
            ),
          );
    final chunkBadge = hasChunkNavigation
        ? _InlineViewerBadge(
            key: _key('chunk-badge'),
            label: [
              l10n.encoder_chunk(
                widget.selectedChunkIndex! + 1,
                widget.totalChunks!,
              ),
              if (minScanBadge != null) _formatScanDuration(minScanSeconds!),
            ].join(' • '),
            semanticLabel: [
              l10n.encoder_chunk(
                widget.selectedChunkIndex! + 1,
                widget.totalChunks!,
              ),
              if (minScanBadge != null)
                l10n.encoder_minScanTime(_formatScanDuration(minScanSeconds!)),
            ].join(', '),
          )
        : null;
    final autoAdvanceButton = hasChunkNavigation
        ? _InlineViewerPillButton(
            key: _key('auto-advance'),
            label: widget.autoAdvanceChunks
                ? l10n.encoder_auto
                : l10n.encoder_manual,
            semanticLabel: widget.autoAdvanceChunks
                ? l10n.encoder_autoAdvanceOn
                : l10n.encoder_autoAdvanceOff,
            icon: widget.autoAdvanceChunks ? 'play_circle' : 'pause_circle',
            selected: widget.autoAdvanceChunks,
            onPressed: widget.onToggleAutoAdvanceChunks!,
          )
        : null;

    return LayoutBuilder(
      builder: (context, constraints) {
        if (chunkBadge == null && minScanBadge == null) {
          return Align(alignment: Alignment.centerLeft, child: frameBadge);
        }
        final usesLargeText = MediaQuery.textScalerOf(context).scale(10) > 14;
        if (hasChunkNavigation) {
          if (constraints.maxWidth < 304 ||
              (usesLargeText && constraints.maxWidth < 440)) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Align(alignment: Alignment.centerLeft, child: frameBadge),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: Wrap(
                    alignment: WrapAlignment.end,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 8,
                    runSpacing: 6,
                    children: [chunkBadge!, autoAdvanceButton!],
                  ),
                ),
              ],
            );
          }
          return Row(
            children: [
              frameBadge,
              const Spacer(),
              chunkBadge!,
              const SizedBox(width: 8),
              autoAdvanceButton!,
            ],
          );
        }
        final trailing = minScanBadge!;
        if (constraints.maxWidth < 250 ||
            (usesLargeText && constraints.maxWidth < 440)) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(alignment: Alignment.centerLeft, child: frameBadge),
              const SizedBox(height: 8),
              Align(alignment: Alignment.centerRight, child: trailing),
            ],
          );
        }
        return Row(
          children: [
            Expanded(
              child: Align(alignment: Alignment.centerLeft, child: frameBadge),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Align(alignment: Alignment.centerRight, child: trailing),
            ),
          ],
        );
      },
    );
  }

  Widget _buildControls(
    BuildContext context,
    AppLocalizations l10n,
    int total,
  ) {
    return Container(
      key: _key('controls'),
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AirQrTheme.controlPanelSurface(context),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AirQrTheme.controlBorder(context)),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final collapse = _InlineViewerIconButton(
            key: _key('collapse-controls'),
            label: l10n.encoder_collapseControls,
            icon: 'expand_more',
            onPressed: () => setState(() => _controlsCollapsed = true),
          );
          final play = _InlineViewerIconButton(
            key: _key('play-toggle'),
            label: widget.isPlaying
                ? l10n.encoder_pauseAutomaticPlayback
                : l10n.encoder_startAutomaticPlayback,
            icon: widget.isPlaying ? 'pause' : 'play_arrow',
            onPressed: widget.canPlay ? widget.onTogglePlayback ?? () {} : null,
          );
          final frameStepper = _InlineViewerStepper(
            key: _key('frame-stepper'),
            label: l10n.encoder_frame,
            value: widget.currentFrame,
            suffix: '/ $total',
            onDecrease: () =>
                widget.onFrameChanged?.call(widget.currentFrame - 1),
            onIncrease: () =>
                widget.onFrameChanged?.call(widget.currentFrame + 1),
          );
          final fpsStepper = _InlineViewerStepper(
            key: _key('fps-stepper'),
            label: l10n.encoder_playbackFps,
            value: widget.playbackFps,
            onDecrease: () =>
                widget.onPlaybackFpsChanged?.call(widget.playbackFps - 1),
            onIncrease: () =>
                widget.onPlaybackFpsChanged?.call(widget.playbackFps + 1),
          );
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (constraints.maxWidth < 480) ...[
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [collapse, play],
                ),
                if (widget.controlsAddon != null) ...[
                  const SizedBox(height: 8),
                  widget.controlsAddon!,
                ],
                const SizedBox(height: 8),
                frameStepper,
                const SizedBox(height: 8),
                fpsStepper,
              ] else ...[
                Row(
                  children: [
                    collapse,
                    const SizedBox(width: 8),
                    Expanded(flex: 3, child: frameStepper),
                    const SizedBox(width: 8),
                    Expanded(flex: 2, child: fpsStepper),
                    const SizedBox(width: 8),
                    play,
                  ],
                ),
                if (widget.controlsAddon != null) ...[
                  const SizedBox(height: 8),
                  widget.controlsAddon!,
                ],
              ],
              SliderTheme(
                key: _key('frame-slider-theme'),
                data: AirQrTheme.viewerTimelineTheme(context),
                child: Slider(
                  key: _key('frame-slider'),
                  value: widget.currentFrame.toDouble().clamp(
                    1,
                    total.toDouble(),
                  ),
                  min: 1,
                  max: total.toDouble(),
                  onChanged: (value) =>
                      widget.onFrameChanged?.call(value.round()),
                ),
              ),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 4,
                runSpacing: 4,
                children: [
                  _InlineViewerIconButton(
                    key: _key('zoom-out'),
                    label: l10n.encoder_zoomOut,
                    icon: 'zoom_out',
                    onPressed: () => _setZoom(_zoom - 0.5),
                  ),
                  TextButton(
                    key: _key('zoom-reset'),
                    onPressed: () => _setZoom(1),
                    child: Text(
                      '${(_zoom * 100).round()}%',
                      style: TextStyle(
                        color: AirQrTheme.textSecondary(context),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  _InlineViewerIconButton(
                    key: _key('zoom-in'),
                    label: l10n.encoder_zoomIn,
                    icon: 'zoom_in',
                    onPressed: () => _setZoom(_zoom + 0.5),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    width: 1,
                    height: 24,
                    color: AirQrTheme.divider(context),
                  ),
                  const SizedBox(width: 8),
                  _InlineViewerIconButton(
                    key: _key('fullscreen-action'),
                    label: l10n.encoder_openFullscreen,
                    icon: 'fullscreen',
                    onPressed: widget.onFullscreen,
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

class _InlineViewerBadge extends StatelessWidget {
  final String label;
  final String? semanticLabel;

  const _InlineViewerBadge({
    super.key,
    required this.label,
    this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) => Semantics(
    label: semanticLabel,
    container: semanticLabel != null,
    excludeSemantics: semanticLabel != null,
    child: Container(
      constraints: const BoxConstraints(maxWidth: 280),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AirQrTheme.actionSurface(context),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AirQrTheme.controlBorder(context)),
      ),
      child: Text(
        label,
        textAlign: TextAlign.center,
        style: AirQrTypography.of(context).compactStatus.copyWith(
          color: AirQrTheme.progressText(context),
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
  );
}

class _InlineViewerPillButton extends StatelessWidget {
  final String label;
  final String semanticLabel;
  final String icon;
  final bool selected;
  final VoidCallback onPressed;

  const _InlineViewerPillButton({
    super.key,
    required this.label,
    required this.semanticLabel,
    required this.icon,
    required this.selected,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) => Semantics(
    label: semanticLabel,
    button: true,
    selected: selected,
    onTap: onPressed,
    child: ExcludeSemantics(
      child: TextButton.icon(
        onPressed: onPressed,
        style: TextButton.styleFrom(
          minimumSize: const Size(48, 32),
          padding: const EdgeInsets.symmetric(horizontal: 8),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          backgroundColor: selected
              ? AirQrTheme.navActive(context)
              : AirQrTheme.actionSurface(context),
          foregroundColor: selected
              ? AirQrTheme.textPrimary(context)
              : AirQrTheme.textSecondary(context),
          shape: const StadiumBorder(),
        ),
        icon: AirQrIcon(icon, size: 14),
        label: Text(
          label,
          maxLines: 1,
          style: AirQrTypography.of(
            context,
          ).compactStatus.copyWith(fontSize: 10, fontWeight: FontWeight.w800),
        ),
      ),
    ),
  );
}

class _InlineViewerIconButton extends StatelessWidget {
  final String label;
  final String icon;
  final VoidCallback? onPressed;

  const _InlineViewerIconButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    button: true,
    enabled: onPressed != null,
    onTap: onPressed,
    child: ExcludeSemantics(
      child: IconButton(
        tooltip: label,
        onPressed: onPressed,
        constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
        style: IconButton.styleFrom(
          backgroundColor: AirQrTheme.actionSurface(context),
        ),
        icon: AirQrIcon(icon, color: AirQrTheme.textPrimary(context), size: 18),
      ),
    ),
  );
}

class _InlineViewerStepper extends StatelessWidget {
  final String label;
  final int value;
  final String? suffix;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;

  const _InlineViewerStepper({
    super.key,
    required this.label,
    required this.value,
    this.suffix,
    required this.onDecrease,
    required this.onIncrease,
  });

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(5),
    decoration: BoxDecoration(
      color: AirQrTheme.navActive(context),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: AirQrTheme.textSecondary(context),
            fontSize: 10,
            fontWeight: FontWeight.w800,
          ),
        ),
        Row(
          children: [
            IconButton(
              onPressed: onDecrease,
              visualDensity: VisualDensity.compact,
              constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
              style: IconButton.styleFrom(
                backgroundColor: AirQrTheme.actionSurface(context),
              ),
              icon: AirQrIcon(
                'remove',
                color: AirQrTheme.textPrimary(context),
                size: 16,
              ),
            ),
            Expanded(
              child: Text(
                suffix == null ? '$value' : '$value  $suffix',
                textAlign: TextAlign.center,
                maxLines: 1,
                style: TextStyle(
                  color: AirQrTheme.textPrimary(context),
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
            IconButton(
              onPressed: onIncrease,
              visualDensity: VisualDensity.compact,
              constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
              style: IconButton.styleFrom(
                backgroundColor: AirQrTheme.actionSurface(context),
              ),
              icon: AirQrIcon(
                'add',
                color: AirQrTheme.textPrimary(context),
                size: 16,
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class EncoderChunkResultCard extends StatelessWidget {
  final List<Uint8List> chunkGifs;
  final List<int> chunkFrameCounts;
  final int selectedChunkIndex;
  final int totalChunks;
  final int totalFrames;
  final int currentChunkFrame;
  final int minFrames;
  final String resultSizeLabel;
  final String durationLabel;
  final int resultSizeBytes;
  final int originalSizeBytes;
  final int playbackFps;
  final bool isChunkPlaying;
  final bool canPlay;
  final VoidCallback onDownload;
  final VoidCallback onFullscreen;
  final ValueChanged<int> onChunkSelected;
  final VoidCallback onOpenMultiView;
  final bool autoAdvanceChunks;
  final VoidCallback? onToggleAutoAdvanceChunks;
  final VoidCallback onTogglePlayPause;
  final ValueChanged<int>? onFrameChanged;
  final ValueChanged<int>? onPlaybackFpsChanged;

  const EncoderChunkResultCard({
    super.key,
    required this.chunkGifs,
    required this.chunkFrameCounts,
    required this.selectedChunkIndex,
    required this.totalChunks,
    required this.totalFrames,
    required this.currentChunkFrame,
    required this.minFrames,
    required this.resultSizeLabel,
    required this.durationLabel,
    this.resultSizeBytes = 0,
    this.originalSizeBytes = 0,
    this.playbackFps = 10,
    required this.isChunkPlaying,
    this.canPlay = true,
    required this.onDownload,
    required this.onFullscreen,
    required this.onChunkSelected,
    required this.onOpenMultiView,
    this.autoAdvanceChunks = true,
    this.onToggleAutoAdvanceChunks,
    required this.onTogglePlayPause,
    this.onFrameChanged,
    this.onPlaybackFpsChanged,
  });

  @override
  Widget build(BuildContext context) {
    if (chunkGifs.isEmpty) {
      return const SizedBox.shrink(key: Key('encoder-chunk-empty'));
    }

    final l10n = AppLocalizations.of(context)!;
    final safeChunkIndex = selectedChunkIndex.clamp(0, chunkGifs.length - 1);
    final currentChunkFrames = safeChunkIndex < chunkFrameCounts.length
        ? chunkFrameCounts[safeChunkIndex]
        : 0;
    final displayFrameCount = currentChunkFrames.clamp(1, 1 << 31);
    final displayCurrentFrame = currentChunkFrame.clamp(1, displayFrameCount);
    final displayChunkCount = totalChunks > 0 ? totalChunks : chunkGifs.length;

    return EncoderGifResultCard(
      gifData: chunkGifs[safeChunkIndex],
      currentFrame: displayCurrentFrame,
      totalFrames: displayFrameCount,
      minFrames: minFrames,
      sizeLabel: resultSizeLabel,
      durationLabel: durationLabel,
      originalSizeBytes: originalSizeBytes,
      resultSizeBytes: resultSizeBytes > 0 ? resultSizeBytes : null,
      playbackFps: playbackFps,
      isPlaying: isChunkPlaying,
      canPlay: canPlay,
      keyPrefix: 'encoder-chunk',
      downloadLabel: l10n.encoder_downloadZip,
      selectedChunkIndex: safeChunkIndex,
      totalChunks: displayChunkCount,
      autoAdvanceChunks: autoAdvanceChunks,
      onToggleAutoAdvanceChunks: onToggleAutoAdvanceChunks,
      onDownload: onDownload,
      onFullscreen: onFullscreen,
      onTogglePlayback: onTogglePlayPause,
      onFrameChanged: onFrameChanged,
      onPlaybackFpsChanged: onPlaybackFpsChanged,
      resultFooter: _EncoderChunkSelector(
        selectedChunkIndex: safeChunkIndex,
        totalChunks: displayChunkCount,
        availableChunkCount: chunkGifs.length,
        onChunkSelected: onChunkSelected,
        onOpenMultiView: onOpenMultiView,
      ),
    );
  }
}

class _EncoderChunkSelector extends StatelessWidget {
  final int selectedChunkIndex;
  final int totalChunks;
  final int availableChunkCount;
  final ValueChanged<int> onChunkSelected;
  final VoidCallback onOpenMultiView;

  const _EncoderChunkSelector({
    required this.selectedChunkIndex,
    required this.totalChunks,
    required this.availableChunkCount,
    required this.onChunkSelected,
    required this.onOpenMultiView,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final title = Text(
      l10n.encoder_dataChunks.toUpperCase(),
      style: AirQrTypography.of(context).compactStatus.copyWith(
        color: AirQrTheme.textSecondary(context),
        fontWeight: FontWeight.w800,
        letterSpacing: 1.1,
      ),
    );
    final multiViewButton = TextButton.icon(
      key: const Key('encoder-chunk-multi-view-action'),
      onPressed: onOpenMultiView,
      style: TextButton.styleFrom(
        minimumSize: const Size(48, 40),
        padding: const EdgeInsets.symmetric(horizontal: 10),
        backgroundColor: AirQrTheme.actionSurface(context),
        foregroundColor: AirQrTheme.textPrimary(context),
        shape: const StadiumBorder(),
      ),
      icon: AirQrIcon('grid_view', size: 15),
      label: Text(
        l10n.encoder_multiView,
        style: const TextStyle(fontWeight: FontWeight.w800),
      ),
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final scaledLabelSize = MediaQuery.textScalerOf(context).scale(12);
        final stackHeader = constraints.maxWidth < 300 || scaledLabelSize > 18;
        return Column(
          key: const Key('encoder-chunk-selector'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (stackHeader) ...[
              title,
              const SizedBox(height: 4),
              Align(alignment: Alignment.centerRight, child: multiViewButton),
            ] else
              Row(
                children: [
                  Expanded(child: title),
                  multiViewButton,
                ],
              ),
            const SizedBox(height: 6),
            SizedBox(
              height: 48,
              child: ListView.separated(
                key: const Key('encoder-chunk-selector-list'),
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 1),
                itemCount: availableChunkCount,
                separatorBuilder: (_, _) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  final selected = index == selectedChunkIndex;
                  return SizedBox(
                    width: 48,
                    child: Material(
                      color: selected
                          ? AirQrTheme.navActive(context)
                          : AirQrTheme.controlSurface(context),
                      borderRadius: BorderRadius.circular(16),
                      child: InkWell(
                        key: Key('encoder-chunk-option-${index + 1}'),
                        borderRadius: BorderRadius.circular(16),
                        onTap: () => onChunkSelected(index),
                        child: Semantics(
                          button: true,
                          selected: selected,
                          excludeSemantics: true,
                          label: l10n.encoder_chunk(index + 1, totalChunks),
                          child: Center(
                            child: Text(
                              '${index + 1}',
                              style: TextStyle(
                                color: selected
                                    ? AirQrTheme.textPrimary(context)
                                    : AirQrTheme.textSecondary(context),
                                fontWeight: FontWeight.w800,
                                fontFeatures: const <FontFeature>[
                                  FontFeature.tabularFigures(),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}

class _EncoderSliderRow extends StatelessWidget {
  final String label;
  final String valueLabel;
  final String? lowLabel;
  final String? highLabel;
  final double value;
  final double min;
  final double max;
  final int? divisions;
  final ValueChanged<double> onChanged;

  const _EncoderSliderRow({
    required this.label,
    required this.valueLabel,
    this.lowLabel,
    this.highLabel,
    required this.value,
    required this.min,
    required this.max,
    this.divisions,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: AirQrTheme.textPrimary(context),
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                valueLabel,
                style: TextStyle(
                  color: AirQrTheme.textPrimary(context),
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          SliderTheme(
            data: SliderThemeData(
              activeTrackColor: AirQrTheme.isDark(context)
                  ? AirQrTheme.navActive(context)
                  : AirQrTheme.primaryButtonSurface(context),
              inactiveTrackColor: AirQrTheme.controlBorder(context),
              thumbColor: AirQrTheme.primaryButtonSurface(context),
              overlayColor: AirQrTheme.primaryButtonSurface(
                context,
              ).withValues(alpha: 0.18),
              trackHeight: 4,
              tickMarkShape: SliderTickMarkShape.noTickMark,
            ),
            child: Slider(
              value: value,
              min: min,
              max: max,
              divisions: divisions,
              onChanged: onChanged,
            ),
          ),
          if (lowLabel != null || highLabel != null) ...[
            const SizedBox(height: 2),
            Row(
              children: [
                Text(
                  lowLabel ?? '',
                  style: TextStyle(
                    color: AirQrTheme.textMuted(context),
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                Text(
                  highLabel ?? '',
                  style: TextStyle(
                    color: AirQrTheme.textMuted(context),
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _EncoderStringDropdown extends StatelessWidget {
  final String label;
  final String value;
  final List<String> options;
  final ValueChanged<String> onChanged;

  const _EncoderStringDropdown({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final selectedOption = options.firstWhere(
      (option) => option.startsWith(value),
      orElse: () => options.first,
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            label,
            style: TextStyle(
              color: AirQrTheme.textPrimary(context),
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: AirQrTheme.controlSurface(context),
              borderRadius: BorderRadius.circular(16),
            ),
            child: DropdownButton<String>(
              value: selectedOption,
              isExpanded: true,
              dropdownColor: AirQrTheme.controlSurface(context),
              underline: const SizedBox(),
              style: TextStyle(color: AirQrTheme.textPrimary(context)),
              items: options
                  .map(
                    (option) => DropdownMenuItem<String>(
                      value: option,
                      child: Text(option),
                    ),
                  )
                  .toList(),
              onChanged: (next) {
                if (next != null) {
                  onChanged(next);
                }
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _EncoderSwitchTile extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const _EncoderSwitchTile({
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AirQrTheme.controlSurface(context),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: AirQrTheme.textPrimary(context),
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(color: AirQrTheme.textMuted(context)),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Switch(
            value: value,
            onChanged: onChanged,
            thumbColor: WidgetStateProperty.resolveWith((states) {
              if (states.contains(WidgetState.selected)) {
                return Colors.white;
              }
              return AirQrTheme.textPrimary(context).withValues(alpha: 0.72);
            }),
            trackColor: WidgetStateProperty.resolveWith((states) {
              if (states.contains(WidgetState.selected)) {
                return AirQrTheme.switchSelectedTrack(context);
              }
              return AirQrTheme.textSecondary(context).withValues(alpha: 0.22);
            }),
            trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
          ),
        ],
      ),
    );
  }
}
