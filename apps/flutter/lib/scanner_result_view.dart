import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'l10n/app_localizations.dart';
import 'note_view.dart';

class ScannerResultView extends StatelessWidget {
  final Color primaryColor;
  final Color successColor;
  final String filename;
  final String? sizeLabel;
  final String? durationLabel;
  final String? subtitle;
  final String? previewPath;
  final bool isNote;
  final String? noteContent;
  final bool canDownload;
  final bool isSaving;
  final VoidCallback onDownload;
  final VoidCallback? onCopy;
  final VoidCallback onClose;

  const ScannerResultView({
    super.key,
    required this.primaryColor,
    required this.successColor,
    required this.filename,
    required this.sizeLabel,
    required this.durationLabel,
    required this.subtitle,
    this.previewPath,
    this.isNote = false,
    this.noteContent,
    required this.canDownload,
    required this.isSaving,
    required this.onDownload,
    this.onCopy,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    if (isNote && noteContent != null) {
      return NoteViewerScaffold(
        filename: filename,
        content: noteContent!,
        onBack: onClose,
        toolbarActions: [
          NoteToolbarButton(
            key: const Key('scanner_note_copy_button'),
            iconName: 'content_copy',
            label: l10n.common_copy,
            onPressed: onCopy ?? () {},
          ),
          NoteToolbarIconButton(
            key: const Key('scanner_note_close_button'),
            iconName: 'close',
            tooltip: l10n.common_close,
            onPressed: onClose,
          ),
        ],
        footerTrailing: TextButton.icon(
          onPressed: onClose,
          style: TextButton.styleFrom(
            foregroundColor: AirQrTheme.textSecondary(context),
          ),
          icon: const AirQrIcon('qr_code_scanner', size: 14),
          label: Text(
            l10n.scanner_scanAnother,
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AirQrTheme.background(context),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final textScaler = MediaQuery.textScalerOf(context);
                  final useCompactActions =
                      constraints.maxWidth <= 360 && textScaler.scale(14) >= 24;
                  final actionWidth = useCompactActions ? 48.0 : 96.0;

                  return ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 48),
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        Padding(
                          padding: EdgeInsets.symmetric(
                            horizontal: actionWidth,
                          ),
                          child: Text(
                            isNote
                                ? l10n.scanner_noteReceived
                                : l10n.scanner_fileSaved,
                            key: const Key('scanner_result_header_title'),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.titleLarge
                                ?.copyWith(
                                  color: AirQrTheme.textPrimary(context),
                                ),
                          ),
                        ),
                        Positioned(
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: actionWidth,
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: Semantics(
                              label: l10n.common_back,
                              button: true,
                              enabled: true,
                              onTap: onClose,
                              excludeSemantics: true,
                              child: IconButton(
                                onPressed: onClose,
                                icon: AirQrIcon(
                                  'arrow_back',
                                  color: AirQrTheme.textPrimary(context),
                                ),
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          right: 0,
                          top: 0,
                          bottom: 0,
                          width: actionWidth,
                          child: Center(
                            child: useCompactActions
                                ? Semantics(
                                    label: l10n.common_close,
                                    button: true,
                                    enabled: true,
                                    onTap: onClose,
                                    excludeSemantics: true,
                                    child: IconButton(
                                      key: const Key(
                                        'scanner_result_close_button',
                                      ),
                                      onPressed: onClose,
                                      icon: AirQrIcon(
                                        'close',
                                        color: AirQrTheme.textSecondary(
                                          context,
                                        ),
                                      ),
                                    ),
                                  )
                                : SizedBox(
                                    width: actionWidth,
                                    height: 48,
                                    child: TextButton(
                                      key: const Key(
                                        'scanner_result_close_button',
                                      ),
                                      onPressed: onClose,
                                      style: TextButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 4,
                                        ),
                                      ),
                                      child: Text(
                                        l10n.common_close,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          color: AirQrTheme.textSecondary(
                                            context,
                                          ),
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                  ),
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        minHeight: constraints.maxHeight,
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          ScannerResultPreview(
                            filename: filename,
                            previewPath: previewPath,
                            primaryColor: primaryColor,
                            successColor: successColor,
                          ),
                          const SizedBox(height: 26),
                          Text(
                            filename,
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.titleLarge
                                ?.copyWith(
                                  color: AirQrTheme.textPrimary(context),
                                ),
                          ),
                          const SizedBox(height: 10),
                          Wrap(
                            alignment: WrapAlignment.center,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            spacing: 8,
                            children: [
                              if (sizeLabel != null)
                                Text(
                                  sizeLabel!,
                                  style: Theme.of(context).textTheme.labelMedium
                                      ?.copyWith(
                                        color: AirQrTheme.textSecondary(
                                          context,
                                        ),
                                        fontWeight: FontWeight.w500,
                                      ),
                                ),
                              if (sizeLabel != null && durationLabel != null)
                                Container(
                                  width: 4,
                                  height: 4,
                                  decoration: BoxDecoration(
                                    color: AirQrTheme.divider(context),
                                    shape: BoxShape.circle,
                                  ),
                                ),
                              if (durationLabel != null)
                                Text(
                                  durationLabel!,
                                  style: Theme.of(context).textTheme.labelMedium
                                      ?.copyWith(
                                        color: AirQrTheme.textSecondary(
                                          context,
                                        ),
                                        fontWeight: FontWeight.w500,
                                      ),
                                ),
                            ],
                          ),
                          if (subtitle != null) ...[
                            const SizedBox(height: 10),
                            Text(
                              subtitle!,
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.labelMedium
                                  ?.copyWith(
                                    color: AirQrTheme.textSecondary(context),
                                  ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
              child: Column(
                children: [
                  SizedBox(
                    width: double.infinity,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 54),
                      child: ElevatedButton.icon(
                        onPressed: isNote
                            ? onCopy
                            : (canDownload ? onDownload : null),
                        icon: isSaving
                            ? SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AirQrTheme.primaryButtonForeground(
                                    context,
                                  ),
                                ),
                              )
                            : AirQrIcon(isNote ? 'content_copy' : 'download'),
                        label: Text(
                          isNote ? l10n.common_copy : l10n.common_download,
                          style: AirQrTypography.of(context).primaryAction,
                        ),
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
                          disabledForegroundColor: AirQrTheme.textSecondary(
                            context,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(999),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextButton(
                    onPressed: onClose,
                    child: Text(
                      l10n.scanner_scanAnother,
                      style: AirQrTypography.of(context).primaryAction.copyWith(
                        color: AirQrTheme.textSecondary(context),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class ScannerResultPreview extends StatelessWidget {
  final String filename;
  final String? previewPath;
  final Color primaryColor;
  final Color successColor;

  const ScannerResultPreview({
    super.key,
    required this.filename,
    required this.previewPath,
    required this.primaryColor,
    required this.successColor,
  });

  bool get _isImage {
    final extension = p.extension(filename).toLowerCase();
    return <String>{
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.bmp',
    }.contains(extension);
  }

  String get _iconName {
    final extension = p.extension(filename).toLowerCase();
    if (extension == '.pdf') return 'description';
    if (<String>{'.mp4', '.mov', '.webm', '.mkv', '.avi'}.contains(extension)) {
      return 'videocam';
    }
    if (extension == '.zip') return 'folder_zip';
    return 'upload_file';
  }

  @override
  Widget build(BuildContext context) {
    final path = previewPath;
    final canRenderImage =
        path != null && path.isNotEmpty && _isImage && File(path).existsSync();

    return Container(
      key: const Key('scanner_result_preview'),
      constraints: const BoxConstraints(maxWidth: 360),
      padding: const EdgeInsets.all(1),
      decoration: BoxDecoration(
        color: AirQrTheme.card(context),
        borderRadius: AirQrRadii.panel,
        border: Border.all(color: AirQrTheme.controlBorder(context)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          AspectRatio(
            aspectRatio: canRenderImage ? 0.72 : 1.0,
            child: canRenderImage
                ? Image.file(
                    File(path),
                    key: const Key('scanner_result_image_preview'),
                    fit: BoxFit.contain,
                  )
                : Center(
                    child: Container(
                      width: 132,
                      height: 132,
                      decoration: BoxDecoration(
                        color: AirQrTheme.actionSurface(context),
                        borderRadius: BorderRadius.circular(34),
                      ),
                      child: Center(
                        child: AirQrIcon(
                          _iconName,
                          size: 70,
                          color: primaryColor,
                        ),
                      ),
                    ),
                  ),
          ),
          Positioned(
            right: 18,
            bottom: 18,
            child: Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: successColor,
                shape: BoxShape.circle,
                border: Border.all(
                  color: AirQrTheme.background(context),
                  width: 3,
                ),
              ),
              child: const AirQrIcon('check', size: 17, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}
