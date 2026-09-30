import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'airqr_icon.dart';
import 'airqr_theme.dart';
import 'encoder_inline_preview.dart';
import 'l10n/app_localizations.dart';

enum _MultiLayout { grid, horizontal, vertical }

class MultiChunkViewer extends StatefulWidget {
  final List<Uint8List> gifs;
  final List<int> frameCounts;
  final int fps;
  final ValueChanged<int> onOpenChunk;

  const MultiChunkViewer({
    super.key,
    required this.gifs,
    required this.frameCounts,
    required this.fps,
    required this.onOpenChunk,
  });

  @override
  State<MultiChunkViewer> createState() => _MultiChunkViewerState();
}

class _MultiChunkViewerState extends State<MultiChunkViewer> {
  late final List<int> _frames;
  final Map<int, Rect> _customRects = <int, Rect>{};
  Timer? _timer;
  _MultiLayout _layout = _MultiLayout.grid;
  int _page = 0;
  int _perPage = 6;
  bool _animationsDisabled = false;

  @override
  void initState() {
    super.initState();
    _frames = List<int>.filled(widget.gifs.length, 1);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final disabled = MediaQuery.disableAnimationsOf(context);
    if (disabled == _animationsDisabled && _timer != null) return;
    _animationsDisabled = disabled;
    _restartTimer();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _restartTimer() {
    _timer?.cancel();
    if (_animationsDisabled || widget.gifs.isEmpty) return;
    _timer = Timer.periodic(
      Duration(milliseconds: (1000 / widget.fps.clamp(1, 60)).round()),
      (_) {
        if (!mounted) return;
        setState(() {
          for (var index = 0; index < _frames.length; index++) {
            final total = index < widget.frameCounts.length
                ? widget.frameCounts[index].clamp(1, 1 << 31)
                : 1;
            _frames[index] = (_frames[index] % total) + 1;
          }
        });
      },
    );
  }

  void _setLayout(_MultiLayout layout) {
    setState(() {
      _layout = layout;
      _customRects.clear();
    });
  }

  void _setPerPage(int value) {
    setState(() {
      _perPage = value;
      _page = 0;
      _customRects.clear();
    });
  }

  List<int> get _visibleIndices {
    final start = _page * _perPage;
    final end = (start + _perPage).clamp(0, widget.gifs.length);
    return <int>[for (var index = start; index < end; index++) index];
  }

  int get _pageCount => (widget.gifs.length / _perPage).ceil().clamp(1, 9999);

  Rect _automaticRect(int localIndex, int count, Size size) {
    const gap = 12.0;
    if (_layout == _MultiLayout.horizontal) {
      final width = (size.width - gap * (count - 1)) / count;
      return Rect.fromLTWH(localIndex * (width + gap), 0, width, size.height);
    }
    if (_layout == _MultiLayout.vertical) {
      final height = (size.height - gap * (count - 1)) / count;
      return Rect.fromLTWH(0, localIndex * (height + gap), size.width, height);
    }
    final columns = size.width < 420
        ? 1
        : size.width < 760
        ? 2
        : count <= 1
        ? 1
        : count <= 4
        ? 2
        : 3;
    final rows = (count / columns).ceil();
    final width = (size.width - gap * (columns - 1)) / columns;
    final height = (size.height - gap * (rows - 1)) / rows;
    return Rect.fromLTWH(
      (localIndex % columns) * (width + gap),
      (localIndex ~/ columns) * (height + gap),
      width,
      height,
    );
  }

  Rect _clampRect(Rect rect, Size bounds) {
    final width = rect.width.clamp(150.0, bounds.width);
    final height = rect.height.clamp(150.0, bounds.height);
    return Rect.fromLTWH(
      rect.left.clamp(0.0, (bounds.width - width).clamp(0.0, bounds.width)),
      rect.top.clamp(0.0, (bounds.height - height).clamp(0.0, bounds.height)),
      width,
      height,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final visible = _visibleIndices;
    final compactToolbar = MediaQuery.sizeOf(context).width < 600;
    return Scaffold(
      backgroundColor: AirQrTheme.background(context),
      appBar: AppBar(
        backgroundColor: AirQrTheme.background(context),
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: AirQrIcon('close', color: AirQrTheme.textPrimary(context)),
        ),
        title: Text(
          l10n.encoder_multiView,
          style: TextStyle(
            color: AirQrTheme.textPrimary(context),
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          if (compactToolbar)
            PopupMenuButton<_MultiLayout>(
              tooltip: l10n.encoder_multiView,
              color: AirQrTheme.controlSurface(context),
              initialValue: _layout,
              onSelected: _setLayout,
              icon: Icon(
                Icons.dashboard_customize_outlined,
                color: AirQrTheme.iconPrimary(context),
              ),
              itemBuilder: (context) => <PopupMenuEntry<_MultiLayout>>[
                PopupMenuItem(
                  value: _MultiLayout.grid,
                  child: Icon(
                    Icons.grid_view_rounded,
                    color: AirQrTheme.iconPrimary(context),
                  ),
                ),
                PopupMenuItem(
                  value: _MultiLayout.horizontal,
                  child: Icon(
                    Icons.view_column_outlined,
                    color: AirQrTheme.iconPrimary(context),
                  ),
                ),
                PopupMenuItem(
                  value: _MultiLayout.vertical,
                  child: Icon(
                    Icons.view_stream_outlined,
                    color: AirQrTheme.iconPrimary(context),
                  ),
                ),
              ],
            )
          else ...[
            _toolbarButton(
              Icons.grid_view_rounded,
              () => _setLayout(_MultiLayout.grid),
            ),
            _toolbarButton(
              Icons.view_column_outlined,
              () => _setLayout(_MultiLayout.horizontal),
            ),
            _toolbarButton(
              Icons.view_stream_outlined,
              () => _setLayout(_MultiLayout.vertical),
            ),
          ],
          _toolbarButton(Icons.restart_alt_rounded, () => _setLayout(_layout)),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final size = Size(
                      constraints.maxWidth,
                      constraints.maxHeight,
                    );
                    return Stack(
                      key: const Key('qr-viewer-multi-view-grid'),
                      clipBehavior: Clip.hardEdge,
                      children: [
                        for (
                          var localIndex = 0;
                          localIndex < visible.length;
                          localIndex++
                        )
                          _positionedCard(
                            visible[localIndex],
                            _customRects[visible[localIndex]] ??
                                _automaticRect(
                                  localIndex,
                                  visible.length,
                                  size,
                                ),
                            size,
                            l10n,
                          ),
                      ],
                    );
                  },
                ),
              ),
            ),
            _footer(context),
          ],
        ),
      ),
    );
  }

  Widget _positionedCard(
    int index,
    Rect rect,
    Size bounds,
    AppLocalizations l10n,
  ) {
    final total = index < widget.frameCounts.length
        ? widget.frameCounts[index].clamp(1, 1 << 31)
        : 1;
    return Positioned.fromRect(
      rect: rect,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: AirQrTheme.previewSurface(context),
          borderRadius: AirQrRadii.panel,
          border: Border.all(color: AirQrTheme.controlBorder(context)),
        ),
        child: ClipRRect(
          borderRadius: AirQrRadii.panel,
          child: Stack(
            children: [
              Positioned.fill(
                top: 38,
                child: EncoderInlineGifPreview(
                  gifData: widget.gifs[index],
                  frameNumber: _frames[index],
                  isPlaying: !_animationsDisabled,
                  fit: BoxFit.contain,
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                top: 0,
                height: 38,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onPanUpdate: (details) {
                    setState(() {
                      _customRects[index] = _clampRect(
                        rect.shift(details.delta),
                        bounds,
                      );
                    });
                  },
                  child: ColoredBox(
                    color: AirQrTheme.controlSurface(context),
                    child: Row(
                      children: [
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            '${l10n.encoder_chunk(index + 1, widget.gifs.length)}  •  ${_frames[index]}/$total',
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: AirQrTheme.textPrimary(context),
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          key: Key('multi-view-open-$index'),
                          visualDensity: VisualDensity.compact,
                          onPressed: () {
                            Navigator.of(context).pop();
                            widget.onOpenChunk(index);
                          },
                          icon: Icon(
                            Icons.open_in_full_rounded,
                            size: 18,
                            color: AirQrTheme.iconPrimary(context),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                right: 0,
                bottom: 0,
                width: 34,
                height: 34,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onPanUpdate: (details) {
                    setState(() {
                      _customRects[index] = _clampRect(
                        Rect.fromLTWH(
                          rect.left,
                          rect.top,
                          rect.width + details.delta.dx,
                          rect.height + details.delta.dy,
                        ),
                        bounds,
                      );
                    });
                  },
                  child: Align(
                    alignment: Alignment.bottomRight,
                    child: Icon(
                      Icons.drag_handle_rounded,
                      size: 20,
                      color: AirQrTheme.textSecondary(context),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _footer(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            key: const Key('multi-view-previous-page'),
            onPressed: _page > 0 ? () => setState(() => _page--) : null,
            icon: const Icon(Icons.chevron_left),
          ),
          Text(
            '${_page + 1} / $_pageCount',
            style: TextStyle(color: AirQrTheme.textPrimary(context)),
          ),
          IconButton(
            key: const Key('multi-view-next-page'),
            onPressed: _page + 1 < _pageCount
                ? () => setState(() => _page++)
                : null,
            icon: const Icon(Icons.chevron_right),
          ),
          const SizedBox(width: 12),
          for (final value in const <int>[4, 6, 9])
            Padding(
              padding: const EdgeInsets.only(left: 6),
              child: ChoiceChip(
                label: Text('$value'),
                selected: _perPage == value,
                backgroundColor: AirQrTheme.actionSurface(context),
                selectedColor: AirQrTheme.navActive(context),
                side: BorderSide(color: AirQrTheme.controlBorder(context)),
                labelStyle: TextStyle(
                  color: _perPage == value
                      ? AirQrTheme.textPrimary(context)
                      : AirQrTheme.textSecondary(context),
                  fontWeight: FontWeight.w800,
                ),
                onSelected: (_) => _setPerPage(value),
              ),
            ),
        ],
      ),
    );
  }

  Widget _toolbarButton(IconData icon, VoidCallback onPressed) {
    return IconButton(
      onPressed: onPressed,
      icon: Icon(icon, color: AirQrTheme.iconPrimary(context)),
    );
  }
}
