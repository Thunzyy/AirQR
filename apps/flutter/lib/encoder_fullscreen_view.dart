import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'encoder_inline_preview.dart';
import 'l10n/app_localizations.dart';
import 'multi_chunk_viewer.dart';

class EncoderFullscreenGifView extends StatefulWidget {
  final Uint8List gifData;
  final int totalFrames;
  final int minFrames;
  final int fps;
  final int? chunkIndex;
  final int? totalChunks;
  final List<Uint8List>? allChunkGifs;
  final List<int>? allChunkFrameCounts;
  final List<int>? allChunkMinFrames;
  final bool initialAutoAdvanceChunks;
  final ValueChanged<bool>? onAutoAdvanceChunksChanged;
  final VoidCallback? onDownload;
  final String? title;

  const EncoderFullscreenGifView({
    super.key,
    required this.gifData,
    required this.totalFrames,
    required this.minFrames,
    required this.fps,
    this.chunkIndex,
    this.totalChunks,
    this.allChunkGifs,
    this.allChunkFrameCounts,
    this.allChunkMinFrames,
    this.initialAutoAdvanceChunks = true,
    this.onAutoAdvanceChunksChanged,
    this.onDownload,
    this.title,
  });

  @override
  State<EncoderFullscreenGifView> createState() =>
      _EncoderFullscreenGifViewState();
}

class _EncoderFullscreenGifViewState extends State<EncoderFullscreenGifView> {
  final TransformationController _transformationController =
      TransformationController();
  final FocusNode _shortcutFocusNode = FocusNode();
  late final TextEditingController _frameController;
  late final TextEditingController _fpsController;
  Timer? _frameTimer;
  int _currentFrame = 1;
  int _currentChunkIndex = 0;
  int _playbackFps = 10;
  double _zoom = 1;
  bool _isPlaying = true;
  bool _autoAdvanceChunks = true;
  bool _controlsCollapsed = false;
  bool _animationsDisabled = false;
  bool _mediaQueryInitialized = false;

  @override
  void initState() {
    super.initState();
    _currentChunkIndex = _normalizedInitialChunk;
    _playbackFps = widget.fps.clamp(1, 60);
    _autoAdvanceChunks = widget.initialAutoAdvanceChunks;
    _frameController = TextEditingController(text: '1');
    _fpsController = TextEditingController(text: '$_playbackFps');
    _transformationController.addListener(_syncZoomFromGesture);
    unawaited(_setWakeLock(true));
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disabled = MediaQuery.disableAnimationsOf(context);
    if (_mediaQueryInitialized && disabled == _animationsDisabled) return;
    _mediaQueryInitialized = true;
    _animationsDisabled = disabled;
    if (disabled) {
      _isPlaying = false;
      _stopPlayback();
    } else if (_isPlaying) {
      _startPlayback();
    }
  }

  @override
  void didUpdateWidget(covariant EncoderFullscreenGifView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.gifData == widget.gifData &&
        oldWidget.totalFrames == widget.totalFrames &&
        oldWidget.allChunkGifs == widget.allChunkGifs &&
        oldWidget.allChunkFrameCounts == widget.allChunkFrameCounts) {
      return;
    }
    _currentChunkIndex = _normalizedInitialChunk;
    _setFrame(1, rebuild: false);
    if (_isPlaying && !_animationsDisabled) _startPlayback();
  }

  @override
  void dispose() {
    _stopPlayback();
    _frameController.dispose();
    _fpsController.dispose();
    _transformationController.dispose();
    _shortcutFocusNode.dispose();
    unawaited(_setWakeLock(false));
    super.dispose();
  }

  Future<void> _setWakeLock(bool enabled) async {
    try {
      if (enabled) {
        await WakelockPlus.enable();
      } else {
        await WakelockPlus.disable();
      }
    } catch (_) {
      // Some desktop/test hosts do not expose a wakelock implementation.
    }
  }

  int get _normalizedInitialChunk {
    final length = widget.allChunkGifs?.length ?? 0;
    if (length == 0) return 0;
    return (widget.chunkIndex ?? 0).clamp(0, length - 1);
  }

  List<Uint8List> get _gifs => widget.allChunkGifs?.isNotEmpty == true
      ? widget.allChunkGifs!
      : <Uint8List>[widget.gifData];

  bool get _hasChunks => _gifs.length > 1;

  bool get _hasChunkMode =>
      _hasChunks || widget.chunkIndex != null || widget.totalChunks != null;

  String get _minScanDurationLabel {
    final seconds = _currentMinFrames / _playbackFps;
    return seconds >= 60
        ? '${seconds ~/ 60}:${(seconds % 60).round().toString().padLeft(2, '0')}'
        : '${seconds.toStringAsFixed(seconds >= 10 ? 0 : 1)}s';
  }

  String _minScanTimeLabel(AppLocalizations l10n) =>
      l10n.encoder_minScanTime(_minScanDurationLabel);

  Uint8List get _currentGif =>
      _gifs[_currentChunkIndex.clamp(0, _gifs.length - 1)];

  int get _currentTotalFrames {
    final counts = widget.allChunkFrameCounts;
    if (counts != null && _currentChunkIndex < counts.length) {
      return counts[_currentChunkIndex].clamp(1, 1 << 31);
    }
    return widget.totalFrames.clamp(1, 1 << 31);
  }

  int get _currentMinFrames {
    final minimums = widget.allChunkMinFrames;
    if (minimums != null && _currentChunkIndex < minimums.length) {
      return minimums[_currentChunkIndex].clamp(0, 1 << 31);
    }
    return widget.minFrames.clamp(0, 1 << 31);
  }

  void _syncZoomFromGesture() {
    final next = _transformationController.value.getMaxScaleOnAxis().clamp(
      0.5,
      12.0,
    );
    if (!mounted || (next - _zoom).abs() < 0.01) return;
    setState(() => _zoom = next);
  }

  void _startPlayback() {
    _stopPlayback();
    if (!_isPlaying || _animationsDisabled || _playbackFps <= 0) return;
    _frameTimer = Timer.periodic(
      Duration(milliseconds: (1000 / _playbackFps).round()),
      (_) => _advancePlayback(),
    );
  }

  void _stopPlayback() {
    _frameTimer?.cancel();
    _frameTimer = null;
  }

  void _advancePlayback() {
    if (!mounted || !_isPlaying || _animationsDisabled) return;
    if (_currentFrame < _currentTotalFrames) {
      _setFrame(_currentFrame + 1);
      return;
    }
    if (_hasChunks && _autoAdvanceChunks) {
      _selectChunk((_currentChunkIndex + 1) % _gifs.length);
    } else {
      _setFrame(1);
    }
  }

  void _togglePlayback() {
    if (_animationsDisabled) return;
    setState(() => _isPlaying = !_isPlaying);
    if (_isPlaying) {
      _startPlayback();
    } else {
      _stopPlayback();
    }
  }

  void _toggleAutoAdvanceChunks() {
    setState(() => _autoAdvanceChunks = !_autoAdvanceChunks);
    widget.onAutoAdvanceChunksChanged?.call(_autoAdvanceChunks);
  }

  void _setFrame(int frame, {bool rebuild = true}) {
    final next = frame.clamp(1, _currentTotalFrames);
    _currentFrame = next;
    _frameController.text = '$next';
    if (rebuild && mounted) setState(() {});
  }

  void _seekFrame(int frame) {
    _stopPlayback();
    setState(() => _isPlaying = false);
    _setFrame(frame);
  }

  void _setPlaybackFps(int fps) {
    final next = fps.clamp(1, 60);
    setState(() {
      _playbackFps = next;
      _fpsController.text = '$next';
    });
    if (_isPlaying) _startPlayback();
  }

  void _selectChunk(int index) {
    if (index < 0 || index >= _gifs.length) return;
    setState(() {
      _currentChunkIndex = index;
      _isPlaying = !_animationsDisabled;
      _currentFrame = 1;
      _frameController.text = '1';
    });
    if (_isPlaying) _startPlayback();
  }

  void _setZoom(double zoom) {
    final next = zoom.clamp(0.5, 12.0);
    setState(() => _zoom = next);
    _transformationController.value = Matrix4.diagonal3Values(next, next, 1);
  }

  void _recenterZoom() => _setZoom(_zoom);

  Future<void> _showMultiView() async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => Dialog.fullscreen(
        child: MultiChunkViewer(
          gifs: _gifs,
          frameCounts:
              widget.allChunkFrameCounts ??
              List<int>.filled(_gifs.length, widget.totalFrames),
          fps: _playbackFps,
          onOpenChunk: _selectChunk,
        ),
      ),
    );
  }

  bool _hasInteractiveFocus() {
    final focusedContext = FocusManager.instance.primaryFocus?.context;
    if (focusedContext == null) return false;
    var interactive =
        focusedContext.widget is EditableText ||
        focusedContext.widget is TextField ||
        focusedContext.widget is IconButton ||
        focusedContext.widget is Slider;
    focusedContext.visitAncestorElements((element) {
      final widget = element.widget;
      if (widget is EditableText ||
          widget is TextField ||
          widget is IconButton ||
          widget is Slider) {
        interactive = true;
        return false;
      }
      return true;
    });
    return interactive;
  }

  KeyEventResult _handleKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;
    if (_hasInteractiveFocus()) return KeyEventResult.ignored;
    if (event.logicalKey == LogicalKeyboardKey.space) {
      _togglePlayback();
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      _setPlaybackFps(_playbackFps + 1);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      _setPlaybackFps(_playbackFps - 1);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowLeft ||
        (_hasChunks && event.logicalKey == LogicalKeyboardKey.keyA)) {
      _hasChunks
          ? _selectChunk((_currentChunkIndex - 1).clamp(0, _gifs.length - 1))
          : _seekFrame(_currentFrame - 1);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowRight ||
        (_hasChunks && event.logicalKey == LogicalKeyboardKey.keyD)) {
      _hasChunks
          ? _selectChunk((_currentChunkIndex + 1).clamp(0, _gifs.length - 1))
          : _seekFrame(_currentFrame + 1);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final playing = _isPlaying && !_animationsDisabled;
    final surface = AirQrTheme.previewSurface(context);
    final total = _currentTotalFrames;

    return Focus(
      autofocus: true,
      focusNode: _shortcutFocusNode,
      onKeyEvent: _handleKey,
      child: Scaffold(
        backgroundColor: AirQrTheme.background(context),
        appBar: AppBar(
          backgroundColor: AirQrTheme.background(context),
          elevation: 0,
          leading: IconButton(
            tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
            onPressed: () => Navigator.of(context).maybePop(),
            icon: AirQrIcon('close', color: AirQrTheme.textPrimary(context)),
          ),
          title: Text(
            widget.title ?? l10n.encoder_result,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: AirQrTheme.textPrimary(context),
              fontWeight: FontWeight.w800,
            ),
          ),
          actions: [
            if (widget.onDownload != null)
              IconButton(
                key: const Key('qr-viewer-download'),
                tooltip: _hasChunks
                    ? l10n.encoder_downloadZip
                    : l10n.encoder_downloadGif,
                onPressed: widget.onDownload,
                icon: AirQrIcon('download', color: Colors.white),
              ),
            const SizedBox(width: 8),
          ],
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            key: const Key('qr-viewer-scroll'),
            padding: const EdgeInsets.all(12),
            child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 720),
                child: Column(
                  children: [
                    Container(
                      key: const Key('qr-viewer-surface'),
                      width: double.infinity,
                      decoration: BoxDecoration(
                        color: surface,
                        borderRadius: AirQrRadii.panel,
                        border: Border.all(
                          color: AirQrTheme.controlBorder(context),
                        ),
                      ),
                      clipBehavior: Clip.antiAlias,
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          _buildPreviewStatus(context, l10n),
                          const SizedBox(height: 12),
                          AspectRatio(
                            aspectRatio: 1,
                            child: InteractiveViewer(
                              key: const Key('qr-viewer-interactive-preview'),
                              transformationController:
                                  _transformationController,
                              minScale: 0.5,
                              maxScale: 12,
                              panEnabled: false,
                              boundaryMargin: const EdgeInsets.all(160),
                              onInteractionEnd: (_) => _recenterZoom(),
                              child: SizedBox.expand(
                                key: const Key('qr-viewer-auto-fit'),
                                child: EncoderInlineGifPreview(
                                  gifData: _currentGif,
                                  frameNumber: _currentFrame,
                                  isPlaying: playing,
                                  fit: BoxFit.contain,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (_controlsCollapsed)
                      _ViewerIconButton(
                        key: const Key('qr-viewer-collapse-toggle'),
                        label: l10n.encoder_showControls,
                        icon: 'expand_less',
                        onPressed: () =>
                            setState(() => _controlsCollapsed = false),
                      )
                    else
                      _buildControls(context, l10n, playing, total),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPreviewStatus(BuildContext context, AppLocalizations l10n) {
    final total = _currentTotalFrames;
    final frameSemanticLabel = l10n.encoder_frameProgress(
      _currentFrame,
      total,
      _currentMinFrames,
    );
    final frameBadge = _ViewerBadge(
      key: const Key('qr-viewer-frame-badge'),
      label: _hasChunkMode
          ? '$_currentFrame/$total • ${l10n.encoder_minShort} $_currentMinFrames'
          : frameSemanticLabel,
      semanticLabel: frameSemanticLabel,
    );
    final minScanBadge = _currentMinFrames > 0
        ? _ViewerBadge(
            key: const Key('qr-viewer-min-scan-badge'),
            label: _minScanTimeLabel(l10n),
          )
        : null;
    final chunkBadge = _hasChunkMode
        ? _ViewerBadge(
            key: const Key('qr-viewer-chunk-badge'),
            label:
                '${l10n.encoder_chunk(_currentChunkIndex + 1, widget.totalChunks ?? _gifs.length)} • $_minScanDurationLabel',
            semanticLabel:
                '${l10n.encoder_chunk(_currentChunkIndex + 1, widget.totalChunks ?? _gifs.length)}, ${_minScanTimeLabel(l10n)}',
          )
        : null;
    final autoAdvanceButton = _hasChunkMode
        ? _ViewerPillButton(
            key: const Key('qr-viewer-auto-advance'),
            label: _autoAdvanceChunks ? l10n.encoder_auto : l10n.encoder_manual,
            semanticLabel: _autoAdvanceChunks
                ? l10n.encoder_autoAdvanceOn
                : l10n.encoder_autoAdvanceOff,
            icon: _autoAdvanceChunks ? 'play_circle' : 'pause_circle',
            selected: _autoAdvanceChunks,
            onPressed: _toggleAutoAdvanceChunks,
          )
        : null;

    return LayoutBuilder(
      builder: (context, constraints) {
        if (chunkBadge == null && minScanBadge == null) {
          return Align(alignment: Alignment.centerLeft, child: frameBadge);
        }
        final usesLargeText = MediaQuery.textScalerOf(context).scale(10) > 14;
        if (_hasChunkMode) {
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
          if (constraints.maxWidth < 440) {
            return Row(
              children: [
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: frameBadge,
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerRight,
                      child: chunkBadge!,
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                autoAdvanceButton!,
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
        return Row(
          children: [
            Expanded(
              child: Align(alignment: Alignment.centerLeft, child: frameBadge),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Align(
                alignment: Alignment.centerRight,
                child: minScanBadge!,
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildControls(
    BuildContext context,
    AppLocalizations l10n,
    bool playing,
    int total,
  ) {
    return Container(
      key: const Key('qr-viewer-controls'),
      width: double.infinity,
      constraints: const BoxConstraints(maxWidth: 720),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AirQrTheme.controlPanelSurface(context),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final collapse = _ViewerIconButton(
                key: const Key('qr-viewer-collapse-toggle'),
                label: l10n.encoder_collapseControls,
                icon: 'expand_more',
                onPressed: () => setState(() => _controlsCollapsed = true),
              );
              final play = _ViewerIconButton(
                key: const Key('qr-viewer-play-toggle'),
                label: playing
                    ? l10n.encoder_pauseAutomaticPlayback
                    : l10n.encoder_startAutomaticPlayback,
                icon: playing ? 'pause' : 'play_arrow',
                onPressed: _animationsDisabled ? null : _togglePlayback,
              );
              final frameStepper = _ViewerStepper(
                key: const Key('qr-viewer-frame-stepper'),
                label: l10n.encoder_frame,
                controller: _frameController,
                suffix: '/ $total',
                decreaseKey: const Key('qr-viewer-previous-frame'),
                increaseKey: const Key('qr-viewer-next-frame'),
                onDecrease: () => _seekFrame(_currentFrame - 1),
                onIncrease: () => _seekFrame(_currentFrame + 1),
                onSubmitted: (value) =>
                    _seekFrame(int.tryParse(value) ?? _currentFrame),
              );
              final fpsStepper = _ViewerStepper(
                key: const Key('qr-viewer-fps-stepper'),
                label: l10n.encoder_playbackFps,
                controller: _fpsController,
                decreaseKey: const Key('qr-viewer-fps-decrease'),
                increaseKey: const Key('qr-viewer-fps-increase'),
                onDecrease: () => _setPlaybackFps(_playbackFps - 1),
                onIncrease: () => _setPlaybackFps(_playbackFps + 1),
                onSubmitted: (value) =>
                    _setPlaybackFps(int.tryParse(value) ?? _playbackFps),
              );
              if (constraints.maxWidth < 480) {
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [collapse, play],
                    ),
                    const SizedBox(height: 8),
                    frameStepper,
                    const SizedBox(height: 8),
                    fpsStepper,
                  ],
                );
              }
              return Row(
                children: [
                  collapse,
                  const SizedBox(width: 8),
                  Expanded(flex: 3, child: frameStepper),
                  const SizedBox(width: 8),
                  Expanded(flex: 2, child: fpsStepper),
                  const SizedBox(width: 8),
                  play,
                ],
              );
            },
          ),
          SliderTheme(
            key: const Key('qr-viewer-frame-slider-theme'),
            data: AirQrTheme.viewerTimelineTheme(context),
            child: Slider(
              key: const Key('qr-viewer-frame-slider'),
              value: _currentFrame.toDouble().clamp(1, total.toDouble()),
              min: 1,
              max: total.toDouble().clamp(1, double.infinity),
              onChanged: (value) => _seekFrame(value.round()),
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _ViewerIconButton(
                key: const Key('qr-viewer-zoom-out'),
                label: l10n.encoder_zoomOut,
                icon: 'zoom_out',
                onPressed: () => _setZoom(_zoom - 0.5),
              ),
              TextButton(
                key: const Key('qr-viewer-zoom-reset'),
                onPressed: () => _setZoom(1),
                child: Text(
                  '${(_zoom * 100).round()}%',
                  style: TextStyle(
                    color: AirQrTheme.textSecondary(context),
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              _ViewerIconButton(
                key: const Key('qr-viewer-zoom-in'),
                label: l10n.encoder_zoomIn,
                icon: 'zoom_in',
                onPressed: () => _setZoom(_zoom + 0.5),
              ),
            ],
          ),
          if (_hasChunks) ...[
            const SizedBox(height: 8),
            Divider(
              height: 1,
              thickness: 1,
              color: AirQrTheme.controlBorder(context),
            ),
            const SizedBox(height: 8),
            _buildChunkStrip(context, l10n),
          ],
        ],
      ),
    );
  }

  Widget _buildChunkStrip(BuildContext context, AppLocalizations l10n) {
    return SizedBox(
      key: const Key('qr-viewer-chunk-strip'),
      height: 94,
      child: Column(
        children: [
          Row(
            children: [
              Text(
                l10n.encoder_dataChunks,
                style: AirQrTypography.of(context).compactStatus.copyWith(
                  color: AirQrTheme.textSecondary(context),
                ),
              ),
              const Spacer(),
              _ViewerPillButton(
                key: const Key('qr-viewer-multi-view'),
                label: l10n.encoder_multiView,
                icon: 'grid_view',
                onPressed: _showMultiView,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _gifs.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) => SizedBox(
                width: 48,
                child: Material(
                  color: index == _currentChunkIndex
                      ? AirQrTheme.navActive(context)
                      : AirQrTheme.controlSurface(context),
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    key: Key('qr-viewer-chunk-${index + 1}'),
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => _selectChunk(index),
                    child: Center(
                      child: Text(
                        '${index + 1}',
                        style: TextStyle(
                          color: index == _currentChunkIndex
                              ? AirQrTheme.textPrimary(context)
                              : AirQrTheme.textSecondary(context),
                          fontWeight: FontWeight.w800,
                        ),
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

class _ViewerBadge extends StatelessWidget {
  final String label;
  final String? semanticLabel;

  const _ViewerBadge({super.key, required this.label, this.semanticLabel});

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
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AirQrTypography.of(context).compactStatus.copyWith(
          color: AirQrTheme.progressText(context),
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    ),
  );
}

class _ViewerIconButton extends StatelessWidget {
  final String label;
  final String icon;
  final VoidCallback? onPressed;

  const _ViewerIconButton({
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
        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        style: IconButton.styleFrom(
          backgroundColor: AirQrTheme.actionSurface(context),
        ),
        icon: AirQrIcon(
          icon,
          color: onPressed == null
              ? AirQrTheme.disabledText(context)
              : AirQrTheme.textPrimary(context),
          size: 19,
        ),
      ),
    ),
  );
}

class _ViewerPillButton extends StatelessWidget {
  final String label;
  final String icon;
  final VoidCallback onPressed;
  final bool selected;
  final String? semanticLabel;

  const _ViewerPillButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onPressed,
    this.selected = false,
    this.semanticLabel,
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

class _ViewerStepper extends StatelessWidget {
  final String label;
  final TextEditingController controller;
  final String? suffix;
  final Key decreaseKey;
  final Key increaseKey;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;
  final ValueChanged<String> onSubmitted;

  const _ViewerStepper({
    super.key,
    required this.label,
    required this.controller,
    this.suffix,
    required this.decreaseKey,
    required this.increaseKey,
    required this.onDecrease,
    required this.onIncrease,
    required this.onSubmitted,
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
            _StepperButton(
              key: decreaseKey,
              icon: 'remove',
              onPressed: onDecrease,
            ),
            Expanded(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Flexible(
                    child: TextField(
                      controller: controller,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      textAlign: TextAlign.center,
                      onSubmitted: onSubmitted,
                      style: TextStyle(
                        color: AirQrTheme.textPrimary(context),
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                      decoration: const InputDecoration(
                        isDense: true,
                        border: InputBorder.none,
                        contentPadding: EdgeInsets.zero,
                      ),
                    ),
                  ),
                  if (suffix != null)
                    Text(
                      suffix!,
                      style: TextStyle(
                        color: AirQrTheme.textMuted(context),
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                ],
              ),
            ),
            _StepperButton(
              key: increaseKey,
              icon: 'add',
              onPressed: onIncrease,
            ),
          ],
        ),
      ],
    ),
  );
}

class _StepperButton extends StatelessWidget {
  final String icon;
  final VoidCallback onPressed;

  const _StepperButton({
    super.key,
    required this.icon,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) => IconButton(
    onPressed: onPressed,
    visualDensity: VisualDensity.compact,
    constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
    style: IconButton.styleFrom(
      backgroundColor: AirQrTheme.actionSurface(context),
    ),
    icon: AirQrIcon(icon, color: AirQrTheme.textPrimary(context), size: 16),
  );
}
