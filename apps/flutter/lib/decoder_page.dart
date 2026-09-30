import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart';
import 'src/rust/api/simple.dart';
import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'decoder_failure.dart';
import 'file_export.dart';
import 'l10n/app_localizations.dart';
import 'note_detection.dart';
import 'note_view.dart';
import 'utils.dart';

class DecoderPage extends StatefulWidget {
  final Future<void> Function()? onPickFile;

  const DecoderPage({super.key, this.onPickFile});

  @override
  State<DecoderPage> createState() => _DecoderPageState();
}

class _DecoderPageState extends State<DecoderPage> {
  File? _selectedFile;
  Uint8List? _selectedBytes;
  String? _fileName;
  String? _fileSizeLabel;

  bool _isDecoding = false;
  String? _status; // null = use localized default

  Uint8List? _resultData;
  String? _resultFilename;
  String? _resultNoteContent;
  bool _resultIsNote = false;
  String? _error;
  String? _guidance;

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['gif', 'zip'],
      allowMultiple: false,
      withData: true,
    );

    if (result != null && result.files.isNotEmpty) {
      final picked = result.files.single;
      final path = picked.path;

      setState(() {
        _selectedFile = path == null ? null : File(path);
        _selectedBytes = picked.bytes;
        _fileName = picked.name;
        _fileSizeLabel = formatBytes(picked.size);
        _resultData = null;
        _resultNoteContent = null;
        _resultIsNote = false;
        _error = null;
        _guidance = null;
        _status = null; // Will use localized 'File selected...'
      });
    }
  }

  Future<void> _handlePickFile() => widget.onPickFile?.call() ?? _pickFile();

  bool get _hasSelectedSource =>
      _selectedFile != null ||
      (_selectedBytes != null && _selectedBytes!.isNotEmpty);

  Future<void> _decode() async {
    if (!_hasSelectedSource) return;

    setState(() {
      _isDecoding = true;
      _status = '__decoding__';
      _error = null;
      _guidance = null;
      _resultData = null;
    });

    try {
      final bytes = await _loadSelectedBytes();
      final fileName = _fileName?.toLowerCase() ?? '';
      final startTime = DateTime.now();

      GifDecodeResult result;

      if (fileName.endsWith('.zip')) {
        setState(() => _status = '__processingZip__');
        result = await decodeZipFile(zipData: bytes);
      } else if (fileName.endsWith('.gif')) {
        setState(() => _status = '__processingGif__');
        result = await decodeGifFile(gifData: bytes);
      } else {
        throw Exception('__unsupportedFormat__');
      }

      if (!mounted) return;
      _applyDecodeResult(result, startTime: startTime);
    } catch (e) {
      if (!mounted) return;
      _presentFailure(
        classifyDecoderFailure(
          errorMsg: e.toString(),
          qrDetected: 0,
          caughtError: e,
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isDecoding = false;
        });
      }
    }
  }

  Future<void> _decodeSample() async {
    setState(() {
      _isDecoding = true;
      _status = '__decoding__';
      _error = null;
      _guidance = null;
      _resultData = null;
    });

    try {
      final l10n = AppLocalizations.of(context)!;
      final startTime = DateTime.now();
      final encoded = await encodeToGif(
        filename: l10n.decoder_sampleFilename,
        data: utf8.encode(l10n.decoder_sampleNote),
        fps: 5,
        eccLevel: 'LOW',
        packetSize: 80,
        raptorqOverhead: 0.5,
        compress: false,
      );
      if (!encoded.success || encoded.gifData == null) {
        throw Exception(l10n.decoder_sampleFailed);
      }
      setState(() => _status = '__processingGif__');
      final result = await decodeGifFile(gifData: encoded.gifData!);
      if (!mounted) return;
      _applyDecodeResult(result, startTime: startTime);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = AppLocalizations.of(context)!.decoder_sampleFailed;
        _guidance = null;
        _status = '__error__';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isDecoding = false;
        });
      }
    }
  }

  Future<Uint8List> _loadSelectedBytes() async {
    final inline = _selectedBytes;
    if (inline != null && inline.isNotEmpty) {
      return inline;
    }
    final file = _selectedFile;
    if (file == null) {
      throw const FileSystemException('No file data');
    }
    return file.readAsBytes();
  }

  void _applyDecodeResult(
    GifDecodeResult result, {
    required DateTime startTime,
  }) {
    final elapsed = DateTime.now().difference(startTime);
    if (result.success) {
      final rawFilename = result.filename ?? 'decoded_file';
      final isNote = isNoteFilename(rawFilename);
      final fileData = Uint8List.fromList(result.fileData ?? []);
      setState(() {
        _resultData = fileData;
        _resultFilename = isNote
            ? getDisplayNoteFilename(rawFilename)
            : rawFilename;
        _resultIsNote = isNote;
        _resultNoteContent = isNote
            ? const Utf8Decoder(allowMalformed: true).convert(fileData)
            : null;
        _error = null;
        _guidance = null;
        _status =
            '__complete__:${result.framesProcessed}:${result.qrDetected}:${elapsed.inMilliseconds}';
      });
      return;
    }

    _presentFailure(
      classifyDecoderFailure(
        errorMsg: result.errorMsg,
        qrDetected: result.qrDetected,
      ),
      failedStatus:
          '__failed__:${result.framesProcessed}:${result.qrDetected}',
    );
  }

  void _presentFailure(
    DecoderFailureKind kind, {
    String? failedStatus,
  }) {
    setState(() {
      if (decoderFailureShowsError(kind)) {
        _error = _messageForFailure(kind);
        _guidance = null;
        _status = failedStatus ?? '__error__';
      } else {
        _error = null;
        _guidance = _messageForFailure(kind);
        _status = '__notAirQr__';
      }
    });
  }

  String _messageForFailure(DecoderFailureKind kind) {
    final l10n = AppLocalizations.of(context)!;
    return switch (kind) {
      DecoderFailureKind.notAirQr => l10n.decoder_notAirQrGif,
      DecoderFailureKind.invalidFile => l10n.decoder_invalidGif,
      DecoderFailureKind.incomplete => l10n.decoder_notEnoughQr,
      DecoderFailureKind.unreadable => l10n.decoder_fileUnreadable,
      DecoderFailureKind.unknown => l10n.decoder_unknownError,
    };
  }

  String _getLocalizedStatus(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (_status == null) {
      return _hasSelectedSource
          ? l10n.decoder_fileSelected
          : l10n.decoder_selectGifFile;
    }
    if (_status == '__decoding__') return l10n.decoder_decoding;
    if (_status == '__processingZip__') return l10n.decoder_processingZip;
    if (_status == '__processingGif__') return l10n.decoder_processingGif;
    if (_status == '__error__') return l10n.common_error;
    if (_status == '__notAirQr__') return l10n.decoder_notAirQrStatus;
    if (_status!.startsWith('__complete__:')) {
      final parts = _status!.split(':');
      return l10n.decoder_complete(
        int.parse(parts[1]),
        int.parse(parts[2]),
        int.parse(parts[3]),
      );
    }
    if (_status!.startsWith('__failed__:')) {
      final parts = _status!.split(':');
      return l10n.decoder_failed(int.parse(parts[1]), int.parse(parts[2]));
    }
    return _status!;
  }

  Future<void> _saveResult() async {
    if (_resultData == null || _resultFilename == null) return;

    try {
      final filePath = await saveBytesToDevice(
        data: _resultData!,
        fileName: _resultFilename!,
      );

      if (filePath != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)!.decoder_fileSaved),
          ),
        );
      }
    } catch (e) {
      debugPrint('Save error: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              AppLocalizations.of(context)!.decoder_saveFailed(e.toString()),
            ),
          ),
        );
      }
    }
  }

  Future<void> _copyNote() async {
    final noteContent = _resultNoteContent;
    if (noteContent == null || noteContent.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: noteContent));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.scanner_noteCopied),
        ),
      );
    }
  }

  void _closeNotePreview() {
    setState(() {
      _resultData = null;
      _resultFilename = null;
      _resultNoteContent = null;
      _resultIsNote = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_resultIsNote &&
        _resultData != null &&
        _resultFilename != null &&
        _resultNoteContent != null) {
      return NoteViewerScaffold(
        filename: _resultFilename!,
        content: _resultNoteContent!,
        onBack: _closeNotePreview,
        toolbarActions: [
          NoteToolbarButton(
            iconName: 'content_copy',
            label: AppLocalizations.of(context)!.common_copy,
            onPressed: _copyNote,
          ),
          NoteToolbarButton(
            iconName: 'download',
            label: AppLocalizations.of(context)!.decoder_saveFile,
            onPressed: _saveResult,
          ),
        ],
        footerTrailing: Text(
          formatBytes(_resultData!.length),
          style: AirQrTypography.of(context).compactStatus.copyWith(
            color: AirQrTheme.textMuted(context),
            fontWeight: FontWeight.w500,
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AirQrTheme.background(context),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // File Picker
              Semantics(
                key: const Key('decoder-file-picker-action'),
                button: true,
                label: AppLocalizations.of(context)!.decoder_selectGifFile,
                onTap: _handlePickFile,
                child: ExcludeSemantics(
                  child: Tooltip(
                    message: AppLocalizations.of(
                      context,
                    )!.decoder_selectGifFile,
                    excludeFromSemantics: true,
                    child: Material(
                      color: AirQrTheme.card(context),
                      borderRadius: BorderRadius.circular(30),
                      clipBehavior: Clip.antiAlias,
                      child: InkWell(
                        onTap: _handlePickFile,
                        borderRadius: BorderRadius.circular(30),
                        overlayColor: AirQrTheme.interactionOverlay(context),
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    key: const Key('decoder_file_picker_icon'),
                                    width: 52,
                                    height: 52,
                                    alignment: Alignment.center,
                                    decoration: BoxDecoration(
                                      color: _hasSelectedSource
                                          ? AirQrTheme.accentBlue.withValues(
                                              alpha: 0.85,
                                            )
                                          : AirQrTheme.iconSurface(context),
                                      shape: BoxShape.circle,
                                    ),
                                    child: AirQrIcon(
                                      _hasSelectedSource
                                          ? 'gif_box'
                                          : 'upload_file',
                                      size: 28,
                                      color: _hasSelectedSource
                                          ? Colors.white
                                          : AirQrTheme.textPrimary(context),
                                    ),
                                  ),
                                  const SizedBox(width: 16),
                                  Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            _hasSelectedSource
                                                ? _fileName ??
                                                      AppLocalizations.of(
                                                        context,
                                                      )!.encoder_fileSelected
                                                : AppLocalizations.of(
                                                    context,
                                                  )!.decoder_selectFileCardTitle,
                                            style: Theme.of(context)
                                                .textTheme
                                                .titleLarge
                                                ?.copyWith(
                                                  height: 1.08,
                                                  fontFamily:
                                                      AirQrTypography.of(
                                                            context,
                                                          )
                                                          .compactStatus
                                                          .fontFamily,
                                                  color: AirQrTheme.textPrimary(
                                                    context,
                                                  ),
                                                ),
                                          ),
                                          if (_hasSelectedSource) ...[
                                            const SizedBox(height: 6),
                                            Text(
                                              _fileSizeLabel ?? '',
                                              style: AirQrTypography.of(context)
                                                  .compactStatus
                                                  .copyWith(
                                                    color:
                                                        AirQrTheme.textSecondary(
                                                          context,
                                                        ),
                                                  ),
                                            ),
                                          ],
                                        ],
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 22),
                              Container(
                                height: 48,
                                decoration: BoxDecoration(
                                  color: AirQrTheme.primaryButtonSurface(
                                    context,
                                  ),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Center(
                                  child: Text(
                                    AppLocalizations.of(
                                      context,
                                    )!.decoder_tapToSelect,
                                    style: AirQrTypography.of(context)
                                        .primaryAction
                                        .copyWith(
                                          color:
                                              AirQrTheme.primaryButtonForeground(
                                                context,
                                              ),
                                        ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Text(
                AppLocalizations.of(context)!.decoder_airQrOnlyHint,
                style: AirQrTypography.of(context).compactStatus.copyWith(
                  color: AirQrTheme.textSecondary(context),
                ),
              ),
              const SizedBox(height: 16),

              // Status
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AirQrTheme.card(context),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Row(
                  children: [
                    if (_isDecoding)
                      const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    else
                      AirQrIcon(
                        _error != null ? 'error' : 'info',
                        color: _error != null
                            ? AirQrTheme.destructive
                            : AirQrTheme.textSecondary(context),
                        size: 20,
                      ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _getLocalizedStatus(context),
                        style: TextStyle(
                          color: _error != null
                              ? AirQrTheme.destructive
                              : AirQrTheme.textSecondary(context),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              // Decode Button
              ElevatedButton(
                onPressed: _hasSelectedSource && !_isDecoding ? _decode : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AirQrTheme.primaryButtonSurface(context),
                  foregroundColor: AirQrTheme.primaryButtonForeground(context),
                  disabledBackgroundColor: AirQrTheme.controlSurface(context),
                  disabledForegroundColor: AirQrTheme.textSecondary(context),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                child: _isDecoding
                    ? SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AirQrTheme.primaryButtonForeground(context),
                        ),
                      )
                    : Text(
                        AppLocalizations.of(context)!.decoder_decodeGif,
                        style: AirQrTypography.of(context).primaryAction,
                      ),
              ),
              const SizedBox(height: 8),
              TextButton(
                key: const Key('decoder-try-sample'),
                onPressed: _isDecoding ? null : _decodeSample,
                child: Text(
                  AppLocalizations.of(context)!.decoder_trySample,
                ),
              ),

              // Guidance for expected non-AirQR GIFs (not a product error)
              if (_guidance != null) ...[
                const SizedBox(height: 16),
                Container(
                  key: const Key('decoder-not-airqr-guidance'),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AirQrTheme.card(context),
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Text(
                    _guidance!,
                    style: TextStyle(color: AirQrTheme.textSecondary(context)),
                  ),
                ),
              ],

              // Error
              if (_error != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AirQrTheme.destructive.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: AirQrTheme.destructive),
                  ),
                ),
              ],

              // Result
              if (_resultData != null) ...[
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AirQrTheme.card(context),
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: Column(
                    children: [
                      AirQrIcon(
                        'check_circle',
                        size: 48,
                        color: AirQrTheme.successText(context),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        AppLocalizations.of(context)!.decoder_decodingComplete,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          color: AirQrTheme.textPrimary(context),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _resultFilename ??
                            AppLocalizations.of(context)!.decoder_unknownFile,
                        style: AirQrTypography.of(context).compactStatus
                            .copyWith(color: AirQrTheme.textSecondary(context)),
                      ),
                      Text(
                        formatBytes(_resultData!.length),
                        style: AirQrTypography.of(context).compactStatus
                            .copyWith(color: AirQrTheme.textMuted(context)),
                      ),
                      const SizedBox(height: 16),
                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        alignment: WrapAlignment.center,
                        children: [
                          if (_resultIsNote)
                            ElevatedButton.icon(
                              onPressed: _copyNote,
                              icon: const AirQrIcon('content_copy'),
                              label: Text(
                                AppLocalizations.of(context)!.common_copy,
                              ),
                              style: ElevatedButton.styleFrom(
                                backgroundColor:
                                    AirQrTheme.primaryButtonSurface(context),
                                foregroundColor:
                                    AirQrTheme.primaryButtonForeground(context),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 24,
                                  vertical: 12,
                                ),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(999),
                                ),
                              ),
                            ),
                          ElevatedButton.icon(
                            onPressed: _saveResult,
                            icon: const AirQrIcon('save'),
                            label: Text(
                              AppLocalizations.of(context)!.decoder_saveFile,
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AirQrTheme.primaryButtonSurface(
                                context,
                              ),
                              foregroundColor:
                                  AirQrTheme.primaryButtonForeground(context),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 32,
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
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
