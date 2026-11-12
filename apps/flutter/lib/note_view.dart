import 'package:flutter/material.dart';

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'l10n/app_localizations.dart';

class NoteViewerScaffold extends StatelessWidget {
  static const double _lineGutterWidth = 40;
  static const double _contentLeftPadding = 4;
  static const double _lineHeight = 24;
  static const double _contentFontSize = 14;
  static const double _lineNumberFontSize = 10;

  final String filename;
  final String content;
  final VoidCallback onBack;
  final List<Widget> toolbarActions;
  final Widget? footerTrailing;
  final double bottomClearance;

  const NoteViewerScaffold({
    super.key,
    required this.filename,
    required this.content,
    required this.onBack,
    this.toolbarActions = const <Widget>[],
    this.footerTrailing,
    this.bottomClearance = 0,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final lines = content.split('\n');

    return Scaffold(
      key: const Key('note_view'),
      backgroundColor: AirQrTheme.previewSurface(context),
      body: SafeArea(
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: AirQrTheme.controlPanelSurface(context),
                border: Border(
                  bottom: BorderSide(color: AirQrTheme.divider(context)),
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  IconButton(
                    key: const Key('note_view_back'),
                    onPressed: onBack,
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints.tightFor(
                      width: 36,
                      height: 36,
                    ),
                    style: IconButton.styleFrom(
                      foregroundColor: AirQrTheme.textPrimary(context),
                      backgroundColor: AirQrTheme.backSurface(context),
                      side: BorderSide(
                        color: AirQrTheme.controlBorder(context),
                      ),
                      shape: const CircleBorder(),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    icon: AirQrIcon(
                      'arrow_back',
                      size: 20,
                      color: AirQrTheme.textPrimary(context),
                    ),
                    tooltip: l10n.common_back,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Row(
                      children: [
                        AirQrIcon(
                          'description',
                          key: const Key('note_view_file_icon'),
                          size: 16,
                          color: AirQrTheme.accentText(context),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            filename,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleMedium
                                ?.copyWith(
                                  color: AirQrTheme.textPrimary(context),
                                ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (toolbarActions.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Wrap(
                      spacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: toolbarActions,
                    ),
                  ],
                ],
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final contentStyle = AirQrTypography.of(context).numeric
                      .copyWith(
                        color: AirQrTheme.textPrimary(context),
                        fontSize: _contentFontSize,
                        height: _lineHeight / _contentFontSize,
                        fontWeight: FontWeight.w400,
                      );
                  final lineNumberStyle = AirQrTypography.of(context).numeric
                      .copyWith(
                        color: AirQrTheme.textMuted(context),
                        fontSize: _lineNumberFontSize,
                        height: _lineHeight / _lineNumberFontSize,
                        fontWeight: FontWeight.w400,
                      );
                  final contentWidth =
                      constraints.maxWidth -
                      _lineGutterWidth -
                      _contentLeftPadding -
                      16;
                  final textPainter = TextPainter(
                    text: TextSpan(
                      text: content.isEmpty ? '\u00A0' : content,
                      style: contentStyle,
                    ),
                    strutStyle: const StrutStyle(
                      fontFamily: 'monospace',
                      fontSize: _contentFontSize,
                      height: _lineHeight / _contentFontSize,
                      forceStrutHeight: true,
                    ),
                    textDirection: Directionality.of(context),
                    textScaler: MediaQuery.textScalerOf(context),
                  )..layout(maxWidth: contentWidth.clamp(1, double.infinity));
                  final visualLineCount = textPainter
                      .computeLineMetrics()
                      .length
                      .clamp(1, 1 << 20);

                  return Stack(
                    children: [
                      Positioned(
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: _lineGutterWidth,
                        child: DecoratedBox(
                          key: const Key('note_view_line_gutter'),
                          decoration: BoxDecoration(
                            color: AirQrTheme.controlSurface(context),
                            border: Border(
                              right: BorderSide(
                                color: AirQrTheme.divider(context),
                              ),
                            ),
                          ),
                        ),
                      ),
                      SingleChildScrollView(
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: _lineGutterWidth,
                              child: Column(
                                children: List.generate(
                                  visualLineCount,
                                  (index) => SizedBox(
                                    height: _lineHeight,
                                    child: Transform.translate(
                                      offset: const Offset(0, 2),
                                      child: Text(
                                        key: Key(
                                          'note_view_line_number_$index',
                                        ),
                                        '${index + 1}',
                                        textAlign: TextAlign.center,
                                        style: lineNumberStyle,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            Expanded(
                              child: Padding(
                                padding: const EdgeInsets.only(
                                  left: _contentLeftPadding,
                                  right: 16,
                                ),
                                child: SelectableText(
                                  content.isEmpty ? '\u00A0' : content,
                                  key: const Key('note_view_content'),
                                  style: contentStyle,
                                  strutStyle: const StrutStyle(
                                    fontFamily: 'monospace',
                                    fontSize: _contentFontSize,
                                    height: _lineHeight / _contentFontSize,
                                    forceStrutHeight: true,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: AirQrTheme.controlPanelSurface(context),
                border: Border(
                  top: BorderSide(color: AirQrTheme.divider(context)),
                ),
              ),
              child: Row(
                children: [
                  Text(
                    l10n.common_lineCount(lines.length),
                    key: const Key('note_view_line_count'),
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: AirQrTheme.textMuted(context),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const Spacer(),
                  if (footerTrailing != null) Flexible(child: footerTrailing!),
                ],
              ),
            ),
            if (bottomClearance > 0) SizedBox(height: bottomClearance),
          ],
        ),
      ),
    );
  }
}

class NoteToolbarButton extends StatelessWidget {
  final String iconName;
  final String label;
  final VoidCallback onPressed;

  const NoteToolbarButton({
    super.key,
    required this.iconName,
    required this.label,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return TextButton.icon(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: AirQrTheme.textPrimary(context),
        backgroundColor: AirQrTheme.actionSurface(context),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
      icon: AirQrIcon(iconName, size: 14),
      label: Text(label, style: Theme.of(context).textTheme.labelMedium),
    );
  }
}

class NoteToolbarIconButton extends StatelessWidget {
  final String iconName;
  final String tooltip;
  final VoidCallback onPressed;

  const NoteToolbarIconButton({
    super.key,
    required this.iconName,
    required this.tooltip,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onPressed,
      tooltip: tooltip,
      style: IconButton.styleFrom(
        foregroundColor: AirQrTheme.textSecondary(context),
        backgroundColor: AirQrTheme.actionSurface(context),
      ),
      icon: AirQrIcon(iconName, size: 18),
    );
  }
}
