import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'src/rust/api/simple.dart';
import 'encoder_download_controller.dart';
import 'encoder_defaults.dart';
import 'encoder_fullscreen_view.dart';
import 'encoder_source_controller.dart';
import 'encoder_storage_service.dart';
import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'encoder_page_widgets.dart';
import 'l10n/app_localizations.dart';
import 'multi_chunk_viewer.dart';
import 'note_detection.dart';
import 'utils.dart';

@immutable
class EncoderChunkPlaybackState {
  final int selectedChunkIndex;
  final int currentFrame;
  final int playbackFps;
  final bool isPlaying;
  final bool autoAdvanceChunks;

  const EncoderChunkPlaybackState({
    this.selectedChunkIndex = 0,
    this.currentFrame = 1,
    this.playbackFps = EncoderDefaults.fps,
    this.isPlaying = true,
    this.autoAdvanceChunks = true,
  });

  EncoderChunkPlaybackState copyWith({
    int? selectedChunkIndex,
    int? currentFrame,
    int? playbackFps,
    bool? isPlaying,
    bool? autoAdvanceChunks,
  }) {
    return EncoderChunkPlaybackState(
      selectedChunkIndex: selectedChunkIndex ?? this.selectedChunkIndex,
      currentFrame: currentFrame ?? this.currentFrame,
      playbackFps: playbackFps ?? this.playbackFps,
      isPlaying: isPlaying ?? this.isPlaying,
      autoAdvanceChunks: autoAdvanceChunks ?? this.autoAdvanceChunks,
    );
  }
}

class EncoderChunkPlaybackController
    extends ValueNotifier<EncoderChunkPlaybackState> {
  EncoderChunkPlaybackController() : super(const EncoderChunkPlaybackState());

  Timer? _timer;
  List<int> _frameCounts = const <int>[];
  int _chunkCount = 0;
  int _fps = 0;
  bool _animationsDisabled = false;

  void configure({
    required List<int> frameCounts,
    required int chunkCount,
    required int fps,
    required bool autoplay,
  }) {
    _stopTimer();
    _frameCounts = frameCounts;
    _chunkCount = chunkCount;
    _fps = fps.clamp(1, 60);
    value = EncoderChunkPlaybackState(
      playbackFps: _fps,
      isPlaying: autoplay && !_animationsDisabled,
    );
    _startTimer();
  }

  void selectChunk(int index) {
    if (index < 0 || index >= _chunkCount) return;
    value = value.copyWith(selectedChunkIndex: index, currentFrame: 1);
    _startTimer();
  }

  void seekFrame(int frame) {
    final selectedChunkIndex = value.selectedChunkIndex;
    if (selectedChunkIndex >= _frameCounts.length) return;
    final frameCount = _frameCounts[selectedChunkIndex];
    if (frameCount <= 0) return;
    value = value.copyWith(currentFrame: frame.clamp(1, frameCount));
  }

  void setPlaybackFps(int fps) {
    final next = fps.clamp(1, 60);
    if (next == _fps) return;
    _fps = next;
    value = value.copyWith(playbackFps: next);
    _startTimer();
  }

  void pause() {
    _stopTimer();
    if (value.isPlaying) value = value.copyWith(isPlaying: false);
  }

  void resume() {
    if (_animationsDisabled || value.isPlaying) return;
    value = value.copyWith(isPlaying: true);
    _startTimer();
  }

  void toggle() => value.isPlaying ? pause() : resume();

  void toggleAutoAdvanceChunks() {
    setAutoAdvanceChunks(!value.autoAdvanceChunks);
  }

  void setAutoAdvanceChunks(bool enabled) {
    if (value.autoAdvanceChunks == enabled) return;
    value = value.copyWith(autoAdvanceChunks: enabled);
  }

  void suspend() => _stopTimer();

  void restart() => _startTimer();

  void setAnimationsDisabled(bool disabled) {
    if (_animationsDisabled == disabled) return;
    _animationsDisabled = disabled;
    if (disabled) pause();
  }

  void _startTimer() {
    _stopTimer();
    if (_animationsDisabled ||
        !value.isPlaying ||
        _fps <= 0 ||
        value.selectedChunkIndex >= _frameCounts.length ||
        _frameCounts[value.selectedChunkIndex] <= 0) {
      return;
    }
    final interval = Duration(milliseconds: (1000 / _fps).round());
    _timer = Timer.periodic(interval, (timer) {
      if (_animationsDisabled ||
          !value.isPlaying ||
          !identical(_timer, timer)) {
        timer.cancel();
        if (identical(_timer, timer)) _timer = null;
        return;
      }
      final current = value;
      if (current.selectedChunkIndex >= _frameCounts.length) {
        pause();
        return;
      }
      final frameCount = _frameCounts[current.selectedChunkIndex];
      if (current.currentFrame >= frameCount) {
        final nextChunk = current.autoAdvanceChunks
            ? current.selectedChunkIndex < _chunkCount - 1
                  ? current.selectedChunkIndex + 1
                  : 0
            : current.selectedChunkIndex;
        value = current.copyWith(
          selectedChunkIndex: nextChunk,
          currentFrame: 1,
        );
        _startTimer();
      } else {
        value = current.copyWith(currentFrame: current.currentFrame + 1);
      }
    });
  }

  void _stopTimer() {
    _timer?.cancel();
    _timer = null;
  }

  @override
  void dispose() {
    _stopTimer();
    super.dispose();
  }
}

Future<void> pushEncoderFullscreenRoute({
  required BuildContext context,
  required WidgetBuilder builder,
  VoidCallback? onReturn,
}) async {
  await Navigator.of(context).push(MaterialPageRoute<void>(builder: builder));
  if (!context.mounted) return;
  onReturn?.call();
}

class EncoderPage extends StatefulWidget {
  final VoidCallback? onOpenOfflineWebSettings;
  final VoidCallback? onOpenGithubReleases;

  const EncoderPage({
    super.key,
    this.onOpenOfflineWebSettings,
    this.onOpenGithubReleases,
  });

  @override
  State<EncoderPage> createState() => _EncoderPageState();
}

class EncoderProgressIndicator extends StatelessWidget {
  const EncoderProgressIndicator({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 20,
      height: 20,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        color: AirQrTheme.loadingIndicator(context),
      ),
    );
  }
}

class _EncoderPageState extends State<EncoderPage> {
  static final Uri _githubReleasesUrl = Uri.parse(
    'https://github.com/Thunzyy/AirQR/releases',
  );
  static const String _networkAccessNoticeHiddenKey =
      'airqr_encoder_network_notice_hidden';

  late final EncoderDownloadController _downloadController;
  late final EncoderSourceController _sourceController;
  final EncoderStorageService _storageService = EncoderStorageService();
  File? _selectedFile;
  Uint8List? _fileData;
  String? _fileName;
  String _encoderMode = 'file';
  String _noteText = '';
  NoteFormat _noteFormat = NoteFormat.plain;

  bool _isEncoding = false;
  bool _showSettings = false;
  bool _isNetworkAccessNoticeHidden = false;

  Uint8List? _gifData;
  Uint8List? _zipData; // For chunked mode
  List<Uint8List> _chunkGifs = []; // Individual GIFs for preview
  List<int> _chunkFrameCounts = []; // Frame count per chunk
  List<int> _chunkMinFrames = []; // Minimum required frames per chunk
  int _totalFrames = 0;
  int _minFrames = 0;
  int _totalChunks = 0;
  late final ValueNotifier<int> _currentFrameNotifier;
  late final EncoderChunkPlaybackController _chunkPlaybackController;
  double _encodingDuration = 0;
  int _encodedInputSize = 0;
  String? _error;
  Timer? _frameTimer;
  int _previewPlaybackFps = EncoderDefaults.fps;
  bool _isPreviewPlaying = true;
  bool _animationsDisabled = false;
  bool _mediaQueryInitialized = false;

  // Encoding settings
  int _fps = EncoderDefaults.fps;
  String _eccLevel = EncoderDefaults.errorCorrection;
  int _packetSize = EncoderDefaults.packetSize;
  double _raptorqOverhead = EncoderDefaults.raptorqOverhead;
  int _targetQrSize = EncoderDefaults.targetQrSize;
  bool _forceChunkMode = false;
  bool _compressionEnabled = EncoderDefaults.compressionEnabled;
  int _scale = 0; // 0=Auto, matches web app
  int _chunkSizeKB = 10240; // KB per chunk (default 10MB)

  @override
  void initState() {
    super.initState();
    _currentFrameNotifier = ValueNotifier<int>(1);
    _chunkPlaybackController = EncoderChunkPlaybackController();
    _downloadController = EncoderDownloadController(
      saveBinaryFile: _storageService.saveBinaryFile,
      recordGeneratedDownload: _storageService.recordGeneratedDownload,
    );
    _sourceController = EncoderSourceController(
      pickFile: _pickPlatformFile,
      pickDirectory: _pickPlatformDirectory,
      zipDirectory: _storageService.zipFolder,
    );
    _loadNetworkAccessNoticePreference();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final animationsDisabled = MediaQuery.disableAnimationsOf(context);
    if (_mediaQueryInitialized && animationsDisabled == _animationsDisabled) {
      return;
    }
    _mediaQueryInitialized = true;
    _animationsDisabled = animationsDisabled;
    if (_animationsDisabled) {
      _stopFrameAnimation();
      _chunkPlaybackController.setAnimationsDisabled(true);
    } else if (_gifData != null) {
      _startFrameAnimation();
    }
    if (!_animationsDisabled) {
      _chunkPlaybackController.setAnimationsDisabled(false);
    }
  }

  @override
  void dispose() {
    _stopFrameAnimation();
    _currentFrameNotifier.dispose();
    _chunkPlaybackController.dispose();
    super.dispose();
  }

  Future<void> _loadNetworkAccessNoticePreference() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (!mounted) {
        return;
      }
      setState(() {
        _isNetworkAccessNoticeHidden =
            prefs.getBool(_networkAccessNoticeHiddenKey) ?? false;
      });
    } catch (_) {
      // Keep the notice visible if preferences are unavailable.
    }
  }

  void _dismissNetworkAccessNotice() {
    setState(() {
      _isNetworkAccessNoticeHidden = true;
    });
    unawaited(_saveNetworkAccessNoticePreference());
  }

  Future<void> _saveNetworkAccessNoticePreference() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_networkAccessNoticeHiddenKey, true);
    } catch (_) {
      // The in-memory state already hides the notice for this session.
    }
  }

  void _startFrameAnimation() {
    _stopFrameAnimation();
    if (_animationsDisabled ||
        !_isPreviewPlaying ||
        _totalFrames <= 0 ||
        _previewPlaybackFps <= 0) {
      return;
    }

    final interval = Duration(
      milliseconds: (1000 / _previewPlaybackFps).round(),
    );
    _frameTimer = Timer.periodic(interval, (timer) {
      if (!mounted || _animationsDisabled) {
        timer.cancel();
        if (identical(_frameTimer, timer)) _frameTimer = null;
        return;
      }
      _currentFrameNotifier.value =
          (_currentFrameNotifier.value % _totalFrames) + 1;
    });
  }

  void _stopFrameAnimation() {
    _frameTimer?.cancel();
    _frameTimer = null;
  }

  void _togglePreviewPlayback() {
    if (_animationsDisabled) return;
    setState(() => _isPreviewPlaying = !_isPreviewPlaying);
    if (_isPreviewPlaying) {
      _startFrameAnimation();
    } else {
      _stopFrameAnimation();
    }
  }

  void _seekPreviewFrame(int frame) {
    if (_totalFrames <= 0) return;
    _currentFrameNotifier.value = frame.clamp(1, _totalFrames);
  }

  void _setPreviewPlaybackFps(int fps) {
    final next = fps.clamp(1, 60);
    if (next == _previewPlaybackFps) return;
    setState(() => _previewPlaybackFps = next);
    if (_isPreviewPlaying) _startFrameAnimation();
  }

  Future<void> _openFullscreenView({
    required Uint8List gifData,
    required int totalFrames,
    int? playbackFps,
    int? chunkIndex,
    int? totalChunks,
    List<Uint8List>? allChunkGifs,
    List<int>? allChunkFrameCounts,
    List<int>? allChunkMinFrames,
    bool initialAutoAdvanceChunks = true,
    ValueChanged<bool>? onAutoAdvanceChunksChanged,
    VoidCallback? onDownload,
    VoidCallback? onReturn,
  }) async {
    await pushEncoderFullscreenRoute(
      context: context,
      builder: (context) => EncoderFullscreenGifView(
        gifData: gifData,
        totalFrames: totalFrames,
        minFrames: _minFrames,
        fps: playbackFps ?? _fps,
        chunkIndex: chunkIndex,
        totalChunks: totalChunks,
        allChunkGifs: allChunkGifs,
        allChunkFrameCounts: allChunkFrameCounts,
        allChunkMinFrames: allChunkMinFrames,
        initialAutoAdvanceChunks: initialAutoAdvanceChunks,
        onAutoAdvanceChunksChanged: onAutoAdvanceChunksChanged,
        onDownload: onDownload,
      ),
      onReturn: onReturn,
    );
  }

  Future<PickedSourceFile?> _pickPlatformFile({
    List<String>? allowedExtensions,
  }) async {
    final result = await FilePicker.platform.pickFiles(
      type: allowedExtensions == null ? FileType.any : FileType.custom,
      allowedExtensions: allowedExtensions,
      allowMultiple: false,
    );
    final pickedFile = result?.files.isNotEmpty == true
        ? result!.files.single
        : null;
    final pickedPath = pickedFile?.path;
    if (pickedFile == null || pickedPath == null) {
      return null;
    }
    return PickedSourceFile(path: pickedPath, name: pickedFile.name);
  }

  Future<String?> _pickPlatformDirectory() {
    return FilePicker.platform.getDirectoryPath();
  }

  void _applySelectedSource(EncoderSelectedSource source) {
    _stopFrameAnimation();
    _currentFrameNotifier.value = 1;
    _chunkPlaybackController.configure(
      frameCounts: const <int>[],
      chunkCount: 0,
      fps: _fps,
      autoplay: !_animationsDisabled,
    );
    setState(() {
      _selectedFile = source.selectedFile;
      _fileData = source.data;
      _fileName = source.fileName;
      _gifData = null;
      _zipData = null;
      _chunkGifs = [];
      _error = null;
    });
  }

  bool get _isNoteMode => _encoderMode == 'note';

  String _encodedOutputBaseName() {
    if (_isNoteMode) {
      final friendlyNoteName = getDisplayNoteFilename(
        buildNoteFilename(_noteFormat),
      );
      return friendlyNoteName.replaceAll('.', '_');
    }
    return _fileName?.replaceAll('.', '_') ?? 'encoded';
  }

  void _clearEncoderOutput() {
    _stopFrameAnimation();
    _currentFrameNotifier.value = 1;
    _chunkPlaybackController.configure(
      frameCounts: const <int>[],
      chunkCount: 0,
      fps: _fps,
      autoplay: !_animationsDisabled,
    );
    setState(() {
      _gifData = null;
      _zipData = null;
      _chunkGifs = [];
      _chunkFrameCounts = [];
      _chunkMinFrames = [];
      _error = null;
      _totalChunks = 0;
      _totalFrames = 0;
      _minFrames = 0;
      _encodingDuration = 0;
      _encodedInputSize = 0;
    });
  }

  void _setEncoderMode(String mode) {
    if (_encoderMode == mode) return;
    setState(() {
      _encoderMode = mode;
    });
    _clearEncoderOutput();
  }

  void _updateNoteText(String value) {
    setState(() {
      _noteText = value;
    });
    _clearEncoderOutput();
  }

  void _updateNoteFormat(NoteFormat value) {
    if (_noteFormat == value) return;
    setState(() {
      _noteFormat = value;
    });
    _clearEncoderOutput();
  }

  void _clearNote() {
    if (_noteText.isEmpty) return;
    setState(() {
      _noteText = '';
    });
    _clearEncoderOutput();
  }

  Future<void> _pickSingleFile() async {
    final source = await _sourceController.pickSingleFile();
    if (source == null) return;
    _applySelectedSource(source);
  }

  Future<void> _pickFolder() async {
    setState(() {
      _isEncoding = true;
      _error = null;
    });

    try {
      final source = await _sourceController.pickFolder();
      if (source != null) {
        _applySelectedSource(source);
      }
    } catch (e) {
      setState(() {
        _error = AppLocalizations.of(
          context,
        )!.errors_zipFolderFailed(e.toString());
      });
    } finally {
      if (mounted) {
        setState(() {
          _isEncoding = false;
        });
      }
    }
  }

  Future<void> _encode() async {
    if (!_isNoteMode && (_fileData == null || _fileName == null)) return;
    if (_isNoteMode && _noteText.trim().isEmpty) return;

    final startTime = DateTime.now();

    _stopFrameAnimation();
    _chunkPlaybackController.suspend();
    setState(() {
      _isEncoding = true;
      _error = null;
      _gifData = null;
      _zipData = null;
      _chunkGifs = [];
    });

    try {
      late final Uint8List inputData;
      late final String transportFilename;
      Uint8List? generatedHistoryBytes;
      String? generatedHistoryFilename;
      String? generatedHistoryMimeType;

      if (_isNoteMode) {
        final noteBytes = Uint8List.fromList(utf8.encode(_noteText));
        inputData = noteBytes;
        transportFilename = buildNoteFilename(_noteFormat);
        generatedHistoryBytes = Uint8List.fromList(noteBytes);
        generatedHistoryFilename = getDisplayNoteFilename(transportFilename);
        generatedHistoryMimeType = 'text/plain';
      } else {
        inputData = _fileData!;
        transportFilename = _fileName!;
      }

      if (_forceChunkMode) {
        // Chunked mode - generate ZIP with multiple GIFs
        final result = await encodeChunkedToZip(
          filename: transportFilename,
          data: inputData.toList(),
          chunkSizeKb: _chunkSizeKB,
          fps: _fps,
          eccLevel: _eccLevel,
          packetSize: _packetSize,
          raptorqOverhead: _raptorqOverhead,
          compress: _compressionEnabled,
        );

        final duration =
            DateTime.now().difference(startTime).inMilliseconds / 1000.0;

        if (result.success && result.zipData != null) {
          _chunkPlaybackController.configure(
            frameCounts: result.chunkFrameCounts.toList(),
            chunkCount: result.chunkGifs.length,
            fps: _fps,
            autoplay: !_animationsDisabled,
          );
          setState(() {
            _zipData = result.zipData;
            _chunkGifs = result.chunkGifs;
            _chunkFrameCounts = result.chunkFrameCounts.toList();
            _chunkMinFrames = result.chunkMinFrames.toList();
            _totalChunks = result.totalChunks;
            _totalFrames = result.totalFrames;
            _minFrames = result.minFrames;
            _encodingDuration = duration;
            _encodedInputSize = inputData.length;
          });

          if (_isNoteMode &&
              generatedHistoryBytes != null &&
              generatedHistoryFilename != null &&
              generatedHistoryMimeType != null) {
            await _autoSaveToHistory(
              generatedHistoryBytes,
              generatedHistoryFilename,
              generatedHistoryMimeType,
              result.totalFrames,
              result.minFrames,
              chunkMinFrames: result.chunkMinFrames.toList(),
            );
          } else {
            await _autoSaveToHistory(
              result.zipData!,
              '${_encodedOutputBaseName()}_chunks.zip',
              'application/zip',
              result.totalFrames,
              result.minFrames,
              chunkMinFrames: result.chunkMinFrames.toList(),
            );
          }
        } else {
          setState(() {
            _error =
                result.errorMsg ??
                AppLocalizations.of(context)!.errors_chunkEncodingFailed;
          });
        }
      } else {
        // Normal mode - single GIF
        final result = await encodeToGif(
          filename: transportFilename,
          data: inputData.toList(),
          fps: _fps,
          eccLevel: _eccLevel,
          packetSize: _packetSize,
          raptorqOverhead: _raptorqOverhead,
          compress: _compressionEnabled,
        );

        final duration =
            DateTime.now().difference(startTime).inMilliseconds / 1000.0;

        if (result.success && result.gifData != null) {
          _currentFrameNotifier.value = 1;
          setState(() {
            _gifData = result.gifData;
            _totalFrames = result.totalFrames;
            _minFrames = result.minFrames;
            _encodingDuration = duration;
            _encodedInputSize = inputData.length;
            _previewPlaybackFps = _fps.clamp(1, 60);
            _isPreviewPlaying = !_animationsDisabled;
          });
          _startFrameAnimation();

          if (_isNoteMode &&
              generatedHistoryBytes != null &&
              generatedHistoryFilename != null &&
              generatedHistoryMimeType != null) {
            await _autoSaveToHistory(
              generatedHistoryBytes,
              generatedHistoryFilename,
              generatedHistoryMimeType,
              result.totalFrames,
              result.minFrames,
            );
          } else {
            await _autoSaveToHistory(
              result.gifData!,
              '${_encodedOutputBaseName()}.gif',
              'image/gif',
              result.totalFrames,
              result.minFrames,
            );
          }
        } else {
          setState(() {
            _error =
                result.errorMsg ??
                AppLocalizations.of(context)!.errors_encodingFailed;
          });
        }
      }
    } catch (e) {
      setState(() {
        _error = e.toString();
      });
    } finally {
      setState(() {
        _isEncoding = false;
      });
    }
  }

  Future<void> _autoSaveToHistory(
    Uint8List data,
    String fileName,
    String mimeType,
    int totalFrames,
    int minFrames, {
    List<int>? chunkMinFrames,
  }) async {
    try {
      await _storageService.saveGeneratedToHistory(
        data: data,
        fileName: fileName,
        mimeType: mimeType,
        totalFrames: totalFrames,
        minFrames: minFrames,
        chunkMinFrames: chunkMinFrames,
      );
      debugPrint('[ENCODE] Auto-saved to history: $fileName');
    } catch (e) {
      debugPrint('[ENCODE] Auto-save failed: $e');
    }
  }

  Future<void> _downloadGif() async {
    if (_gifData == null) return;

    final gifName = '${_encodedOutputBaseName()}.gif';
    final timestamp = DateTime.now().millisecondsSinceEpoch;

    try {
      final result = await _downloadController.download(
        data: _gifData!,
        fileName: gifName,
        mimeType: 'image/gif',
        totalFrames: _totalFrames,
        minFrames: _minFrames,
        timestamp: timestamp,
        recordHistory: !_isNoteMode,
      );
      if (result == null) return;

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)!.decoder_fileSaved),
            backgroundColor: AirQrTheme.success,
          ),
        );
      }

      if (!_isNoteMode && !result.historyRecorded) {
        debugPrint('[ENCODE] History save failed after GIF download');
      }
    } catch (e) {
      debugPrint('[ENCODE] Save failed: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.errors_fileSaveFailed),
          backgroundColor: AirQrTheme.destructive,
        ),
      );
    }
  }

  Future<void> _downloadZip() async {
    if (_zipData == null) return;

    final zipName = '${_encodedOutputBaseName()}_chunks.zip';
    final timestamp = DateTime.now().millisecondsSinceEpoch;

    try {
      final result = await _downloadController.download(
        data: _zipData!,
        fileName: zipName,
        mimeType: 'application/zip',
        totalFrames: _totalFrames,
        minFrames: _minFrames,
        chunkMinFrames: _chunkMinFrames,
        timestamp: timestamp,
        recordHistory: !_isNoteMode,
      );
      if (result == null) return;

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)!.decoder_fileSaved),
            backgroundColor: AirQrTheme.success,
          ),
        );
      }

      if (!_isNoteMode && !result.historyRecorded) {
        debugPrint('[ENCODE] History save failed after ZIP download');
      }
    } catch (e) {
      debugPrint('[ENCODE] Save failed: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.errors_fileSaveFailed),
          backgroundColor: AirQrTheme.destructive,
        ),
      );
    }
  }

  Future<void> _openGithubReleases() async {
    final opened = await launchUrl(
      _githubReleasesUrl,
      mode: LaunchMode.externalApplication,
    );
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.errors_connectionFailed),
          backgroundColor: AirQrTheme.destructive,
        ),
      );
    }
  }

  void _showFullscreen() {
    if (_gifData == null) return;
    _stopFrameAnimation();
    _openFullscreenView(
      gifData: _gifData!,
      totalFrames: _totalFrames,
      playbackFps: _previewPlaybackFps,
      onDownload: _downloadGif,
      onReturn: _startFrameAnimation,
    );
  }

  void _showChunkFullscreen() {
    final playback = _chunkPlaybackController.value;
    final selectedChunkIndex = playback.selectedChunkIndex;
    if (_chunkGifs.isEmpty || selectedChunkIndex >= _chunkGifs.length) return;

    final chunkFrames =
        _chunkFrameCounts.isNotEmpty &&
            selectedChunkIndex < _chunkFrameCounts.length
        ? _chunkFrameCounts[selectedChunkIndex]
        : 0;

    _chunkPlaybackController.suspend();
    _openFullscreenView(
      gifData: _chunkGifs[selectedChunkIndex],
      totalFrames: chunkFrames,
      playbackFps: playback.playbackFps,
      chunkIndex: selectedChunkIndex,
      totalChunks: _totalChunks,
      allChunkGifs: _chunkGifs,
      allChunkFrameCounts: _chunkFrameCounts,
      allChunkMinFrames: _chunkMinFrames,
      initialAutoAdvanceChunks: playback.autoAdvanceChunks,
      onAutoAdvanceChunksChanged: _chunkPlaybackController.setAutoAdvanceChunks,
      onDownload: _downloadZip,
      onReturn: playback.isPlaying ? _chunkPlaybackController.restart : null,
    );
  }

  Future<void> _showChunkMultiView() async {
    final playback = _chunkPlaybackController.value;
    if (_chunkGifs.length < 2) return;

    _chunkPlaybackController.suspend();
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => Dialog.fullscreen(
        child: MultiChunkViewer(
          gifs: _chunkGifs,
          frameCounts: _chunkFrameCounts,
          fps: playback.playbackFps,
          onOpenChunk: _chunkPlaybackController.selectChunk,
        ),
      ),
    );
    if (mounted && playback.isPlaying) {
      _chunkPlaybackController.restart();
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasEncoderInput = _isNoteMode
        ? _noteText.trim().isNotEmpty
        : _selectedFile != null;

    return Scaffold(
      backgroundColor: AirQrTheme.background(context),
      body: SafeArea(
        child: SingleChildScrollView(
          key: const Key('encoder-page-scroll-view'),
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 128),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              EncoderModeToggle(
                noteMode: _isNoteMode,
                onSelectFileMode: () => _setEncoderMode('file'),
                onSelectNoteMode: () => _setEncoderMode('note'),
              ),
              const SizedBox(height: 16),
              if (!_isNetworkAccessNoticeHidden) ...[
                EncoderNetworkAccessNotice(
                  onOpenOfflineWebSettings: widget.onOpenOfflineWebSettings,
                  onOpenGithubReleases:
                      widget.onOpenGithubReleases ?? _openGithubReleases,
                  onDismiss: _dismissNetworkAccessNotice,
                ),
                const SizedBox(height: 16),
              ],
              if (_isNoteMode)
                EncoderNoteEditor(
                  noteText: _noteText,
                  noteFormat: _noteFormat,
                  onNoteTextChanged: _updateNoteText,
                  onNoteFormatChanged: _updateNoteFormat,
                  onClear: _clearNote,
                )
              else
                EncoderSourceCard(
                  fileName: _fileName,
                  fileSizeLabel: _fileData != null
                      ? formatBytes(_fileData!.length)
                      : null,
                  hasSelection: _selectedFile != null,
                  onSelectFile: _pickSingleFile,
                  onSelectFolder: _pickFolder,
                ),
              const SizedBox(height: 16),

              // Settings Toggle
              if (hasEncoderInput) ...[
                EncoderSettingsPanel(
                  expanded: _showSettings,
                  onToggleExpanded: () =>
                      setState(() => _showSettings = !_showSettings),
                  fps: _fps,
                  eccLevel: _eccLevel,
                  packetSize: _packetSize,
                  targetQrSize: _targetQrSize,
                  scale: _scale,
                  raptorqOverhead: _raptorqOverhead,
                  compressionEnabled: _compressionEnabled,
                  forceChunkMode: _forceChunkMode,
                  chunkSizeMbText: (_chunkSizeKB / 1024).toStringAsFixed(1),
                  onFpsChanged: (v) => setState(() => _fps = v.round()),
                  onEccLevelChanged: (v) =>
                      setState(() => _eccLevel = v.split(' ')[0]),
                  onPacketSizeChanged: (v) => setState(
                    () => _packetSize =
                        int.tryParse(v) ?? EncoderDefaults.packetSize,
                  ),
                  onTargetQrSizeChanged: (v) => setState(
                    () => _targetQrSize =
                        int.tryParse(v) ?? EncoderDefaults.targetQrSize,
                  ),
                  onScaleChanged: (v) =>
                      setState(() => _scale = int.tryParse(v) ?? 0),
                  onRaptorqOverheadChanged: (v) =>
                      setState(() => _raptorqOverhead = (v * 20).round() / 20),
                  onCompressionChanged: (v) =>
                      setState(() => _compressionEnabled = v),
                  onForceChunkModeChanged: (v) =>
                      setState(() => _forceChunkMode = v),
                  onChunkSizeChanged: (v) => setState(
                    () => _chunkSizeKB = ((double.tryParse(v) ?? 10.0) * 1024)
                        .round(),
                  ),
                ),
              ],
              const SizedBox(height: 24),

              // Encode Button
              ElevatedButton(
                onPressed: (hasEncoderInput && !_isEncoding) ? _encode : null,
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
                child: _isEncoding
                    ? Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const EncoderProgressIndicator(
                            key: Key('encoder-progress-indicator'),
                          ),
                          const SizedBox(width: 12),
                          Text(
                            AppLocalizations.of(context)!.encoder_encoding,
                            style: AirQrTypography.of(context).primaryAction,
                          ),
                        ],
                      )
                    : Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const AirQrIcon(
                            'qr_code_2',
                            key: Key('encoder-generate-qr-icon'),
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            AppLocalizations.of(context)!.encoder_generate,
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
              ),

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

              // Result Preview
              if (_gifData != null) ...[
                const SizedBox(height: 24),
                ValueListenableBuilder<int>(
                  valueListenable: _currentFrameNotifier,
                  builder: (context, currentFrame, child) {
                    return EncoderGifResultCard(
                      gifData: _gifData!,
                      currentFrame: currentFrame,
                      totalFrames: _totalFrames,
                      minFrames: _minFrames,
                      sizeLabel: formatBytes(_gifData!.length),
                      durationLabel: '${_encodingDuration.toStringAsFixed(1)}s',
                      originalSizeBytes: _encodedInputSize,
                      playbackFps: _previewPlaybackFps,
                      isPlaying: _isPreviewPlaying && !_animationsDisabled,
                      onDownload: _downloadGif,
                      onFullscreen: _showFullscreen,
                      onTogglePlayback: _togglePreviewPlayback,
                      onFrameChanged: _seekPreviewFrame,
                      onPlaybackFpsChanged: _setPreviewPlaybackFps,
                    );
                  },
                ),
              ],

              // ZIP Result Preview (for chunked mode)
              if (_zipData != null) ...[
                const SizedBox(height: 24),
                ValueListenableBuilder<EncoderChunkPlaybackState>(
                  valueListenable: _chunkPlaybackController,
                  builder: (context, playback, child) {
                    final selectedChunkIndex = playback.selectedChunkIndex;
                    return EncoderChunkResultCard(
                      chunkGifs: _chunkGifs,
                      chunkFrameCounts: _chunkFrameCounts,
                      selectedChunkIndex: selectedChunkIndex,
                      totalChunks: _totalChunks,
                      totalFrames: _totalFrames,
                      currentChunkFrame: playback.currentFrame,
                      minFrames: selectedChunkIndex < _chunkMinFrames.length
                          ? _chunkMinFrames[selectedChunkIndex]
                          : _minFrames,
                      resultSizeLabel: formatBytes(_zipData!.length),
                      durationLabel: '${_encodingDuration.toStringAsFixed(1)}s',
                      resultSizeBytes: _zipData!.length,
                      originalSizeBytes: _encodedInputSize,
                      playbackFps: playback.playbackFps,
                      isChunkPlaying: playback.isPlaying,
                      canPlay: !_animationsDisabled,
                      onDownload: _downloadZip,
                      onFullscreen: _showChunkFullscreen,
                      onChunkSelected: _chunkPlaybackController.selectChunk,
                      onOpenMultiView: _showChunkMultiView,
                      autoAdvanceChunks: playback.autoAdvanceChunks,
                      onToggleAutoAdvanceChunks:
                          _chunkPlaybackController.toggleAutoAdvanceChunks,
                      onTogglePlayPause: _chunkPlaybackController.toggle,
                      onFrameChanged: _chunkPlaybackController.seekFrame,
                      onPlaybackFpsChanged:
                          _chunkPlaybackController.setPlaybackFps,
                    );
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
