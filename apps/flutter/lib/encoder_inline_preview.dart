import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

class EncoderInlineGifPreview extends StatefulWidget {
  final Uint8List gifData;
  final int frameNumber;
  final bool isPlaying;
  final BoxFit fit;

  const EncoderInlineGifPreview({
    super.key,
    required this.gifData,
    required this.frameNumber,
    required this.isPlaying,
    required this.fit,
  });

  @override
  State<EncoderInlineGifPreview> createState() =>
      _EncoderInlineGifPreviewState();
}

class _EncoderInlineGifPreviewState extends State<EncoderInlineGifPreview> {
  ui.Codec? _codec;
  ui.Image? _currentImage;
  Uint8List? _codecSource;
  int? _codecFrameNumber;
  int _decodeGeneration = 0;
  bool _animationsDisabled = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final animationsDisabled = MediaQuery.disableAnimationsOf(context);
    if (_animationsDisabled == animationsDisabled && _codecSource != null) {
      return;
    }
    _animationsDisabled = animationsDisabled;
    _ensureFrame();
  }

  @override
  void didUpdateWidget(covariant EncoderInlineGifPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.gifData, widget.gifData) ||
        oldWidget.frameNumber != widget.frameNumber) {
      _ensureFrame();
    }
  }

  @override
  void dispose() {
    _decodeGeneration++;
    _codec?.dispose();
    _currentImage?.dispose();
    super.dispose();
  }

  bool get _isActivelyPlaying => widget.isPlaying && !_animationsDisabled;

  void _ensureFrame() {
    final frameNumber = widget.frameNumber < 1 ? 1 : widget.frameNumber;
    if (identical(_codecSource, widget.gifData) &&
        _codecFrameNumber == frameNumber &&
        _currentImage != null) {
      return;
    }

    final generation = ++_decodeGeneration;
    unawaited(_decodeFrame(widget.gifData, frameNumber, generation));
  }

  Future<void> _decodeFrame(
    Uint8List source,
    int frameNumber,
    int generation,
  ) async {
    ui.Codec? codec;
    ui.Image? decodedImage;
    var decodedFrameNumber = 0;
    try {
      final canAdvanceExistingCodec =
          identical(_codecSource, source) &&
          _codec != null &&
          _codecFrameNumber != null &&
          frameNumber > _codecFrameNumber!;
      if (canAdvanceExistingCodec) {
        codec = _codec;
        decodedFrameNumber = _codecFrameNumber!;
        _codec = null;
      } else {
        _codec?.dispose();
        _codec = null;
        codec = await ui.instantiateImageCodec(source);
      }
      final activeCodec = codec!;
      final availableFrameNumber = frameNumber.clamp(1, activeCodec.frameCount);
      while (decodedFrameNumber < availableFrameNumber) {
        final frame = await activeCodec.getNextFrame();
        decodedImage?.dispose();
        decodedImage = frame.image;
        decodedFrameNumber++;
      }
    } catch (_) {
      decodedImage?.dispose();
      codec?.dispose();
      return;
    }

    if (!mounted || generation != _decodeGeneration) {
      decodedImage?.dispose();
      codec.dispose();
      return;
    }
    final replacedImage = _currentImage;
    setState(() {
      _codec = codec;
      _codecSource = source;
      _codecFrameNumber = decodedFrameNumber;
      _currentImage = decodedImage;
    });
    if (replacedImage != null && !identical(replacedImage, decodedImage)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!identical(_currentImage, replacedImage)) {
          replacedImage.dispose();
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return RawImage(
      key: _isActivelyPlaying
          ? const Key('encoder-inline-animated-image')
          : const Key('encoder-inline-static-image'),
      image: _currentImage,
      fit: widget.fit,
      filterQuality: FilterQuality.none,
    );
  }
}
