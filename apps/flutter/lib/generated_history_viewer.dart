import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:archive/archive.dart';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

import 'airqr_theme.dart';
import 'encoder_fullscreen_view.dart';
import 'history_item.dart';

class GeneratedViewerSource {
  final List<Uint8List> gifs;
  final List<int> frameCounts;
  final int fps;

  const GeneratedViewerSource({
    required this.gifs,
    required this.frameCounts,
    required this.fps,
  });
}

/// Retains compressed GIFs and their metadata, not every decoded image.
class GeneratedViewerSourceCache {
  final int maxBytes;
  final int maxEntries;
  final Future<GeneratedViewerSource> Function(String, int?) _loader;
  final _entries = <String, GeneratedViewerSource>{};
  final _pending = <String, Future<GeneratedViewerSource>>{};
  final _versions = <String, String>{};

  GeneratedViewerSourceCache({
    this.maxBytes = 64 * 1024 * 1024,
    this.maxEntries = 3,
    Future<GeneratedViewerSource> Function(String, int?)? loader,
  }) : _loader =
           loader ??
           ((path, count) =>
               loadGeneratedViewerSource(path, fallbackFrameCount: count));

  int _size(GeneratedViewerSource source) =>
      source.gifs.fold(0, (bytes, gif) => bytes + gif.lengthInBytes);

  Future<GeneratedViewerSource> load(
    String path, {
    int? fallbackFrameCount,
  }) async {
    final file = File(path).absolute;
    final stat = await file.stat();
    if (stat.type != FileSystemEntityType.file) {
      final oldKey = _versions.remove(file.path);
      if (oldKey != null) _entries.remove(oldKey);
      throw FileSystemException('History file unavailable', path);
    }
    final key =
        '${file.path}:${stat.size}:${stat.modified.microsecondsSinceEpoch}:$fallbackFrameCount';
    final oldKey = _versions[file.path];
    if (oldKey != null && oldKey != key) _entries.remove(oldKey);
    _versions[file.path] = key;
    final cached = _entries.remove(key);
    if (cached != null) {
      _entries[key] = cached;
      return cached;
    }
    final existing = _pending[key];
    if (existing != null) return existing;
    late final Future<GeneratedViewerSource> loading;
    loading = _loader(file.path, fallbackFrameCount)
        .then((source) {
          if (identical(_pending[key], loading) &&
              _versions[file.path] == key) {
            if (_size(source) <= maxBytes) {
              _entries[key] = source;
              var bytes = _entries.values.fold(
                0,
                (sum, value) => sum + _size(value),
              );
              while (_entries.length > maxEntries || bytes > maxBytes) {
                final evicted = _entries.keys.first;
                bytes -= _size(_entries.remove(evicted)!);
                _versions.removeWhere((_, version) => version == evicted);
              }
            }
          }
          return source;
        })
        .whenComplete(() {
          if (identical(_pending[key], loading)) _pending.remove(key);
          if (!_entries.containsKey(key) && _versions[file.path] == key) {
            _versions.remove(file.path);
          }
        });
    _pending[key] = loading;
    return loading;
  }

  void clear() {
    _entries.clear();
    _pending.clear();
    _versions.clear();
  }
}

final generatedViewerSourceCache = GeneratedViewerSourceCache();

bool usesGeneratedGifViewer(HistoryItem item) {
  if (item.origin != 'generated') return false;
  final extension = p.extension(item.path).toLowerCase();
  return item.mimeType == 'image/gif' ||
      item.mimeType == 'application/zip' ||
      extension == '.gif' ||
      extension == '.zip';
}

Future<GeneratedViewerSource> loadGeneratedViewerSource(
  String path, {
  int? fallbackFrameCount,
  Future<Uint8List> Function(String path)? readFile,
}) async {
  final bytes = await (readFile ?? _readFile)(path);
  final extension = p.extension(path).toLowerCase();
  final gifs = extension == '.zip'
      ? await Isolate.run(() => _extractGifChunks(bytes))
      : <Uint8List>[bytes];
  if (gifs.isEmpty) {
    throw const FormatException('The archive does not contain a GIF');
  }

  final frameCounts = <int>[];
  var detectedFps = 0;
  for (final gif in gifs) {
    final info = await _inspectGif(gif);
    frameCounts.add(info.$1);
    detectedFps = detectedFps == 0 ? info.$2 : detectedFps;
  }
  if (gifs.length == 1 &&
      frameCounts.single <= 1 &&
      fallbackFrameCount != null &&
      fallbackFrameCount > 1) {
    frameCounts[0] = fallbackFrameCount;
  }

  return GeneratedViewerSource(
    gifs: gifs,
    frameCounts: frameCounts,
    fps: detectedFps > 0 ? detectedFps : 10,
  );
}

Future<Uint8List> _readFile(String path) => File(path).readAsBytes();

List<Uint8List> _extractGifChunks(Uint8List bytes) {
  final archive = ZipDecoder().decodeBytes(bytes, verify: true);
  final files =
      archive.files
          .where(
            (file) => file.isFile && file.name.toLowerCase().endsWith('.gif'),
          )
          .toList()
        ..sort((left, right) => _naturalCompare(left.name, right.name));
  return files
      .map((file) => Uint8List.fromList(file.content as List<int>))
      .toList(growable: false);
}

int _naturalCompare(String left, String right) {
  final number = RegExp(r'\d+');
  final leftMatch = number.allMatches(left).lastOrNull;
  final rightMatch = number.allMatches(right).lastOrNull;
  if (leftMatch != null && rightMatch != null) {
    final leftNumber = int.tryParse(leftMatch.group(0)!);
    final rightNumber = int.tryParse(rightMatch.group(0)!);
    if (leftNumber != null &&
        rightNumber != null &&
        leftNumber != rightNumber) {
      return leftNumber.compareTo(rightNumber);
    }
  }
  return left.compareTo(right);
}

Future<(int, int)> _inspectGif(Uint8List bytes) async {
  final codec = await ui.instantiateImageCodec(bytes);
  try {
    final frameCount = codec.frameCount.clamp(1, 1 << 31);
    final firstFrame = await codec.getNextFrame();
    final durationMs = firstFrame.duration.inMilliseconds;
    firstFrame.image.dispose();
    final fps = durationMs > 0 ? (1000 / durationMs).round().clamp(1, 60) : 0;
    return (frameCount, fps);
  } finally {
    codec.dispose();
  }
}

class GeneratedHistoryViewerPage extends StatefulWidget {
  final HistoryItem item;
  final Future<void> Function() onDownload;
  final Future<GeneratedViewerSource> Function()? sourceLoader;

  const GeneratedHistoryViewerPage({
    super.key,
    required this.item,
    required this.onDownload,
    this.sourceLoader,
  });

  @override
  State<GeneratedHistoryViewerPage> createState() =>
      _GeneratedHistoryViewerPageState();
}

class _GeneratedHistoryViewerPageState
    extends State<GeneratedHistoryViewerPage> {
  late Future<GeneratedViewerSource> _source;

  @override
  void initState() {
    super.initState();
    _source = _loadSource();
  }

  @override
  void didUpdateWidget(covariant GeneratedHistoryViewerPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.item.path != widget.item.path ||
        oldWidget.item.timestamp != widget.item.timestamp ||
        oldWidget.item.size != widget.item.size ||
        oldWidget.item.totalFrames != widget.item.totalFrames ||
        oldWidget.sourceLoader != widget.sourceLoader) {
      _source = _loadSource();
    }
  }

  Future<GeneratedViewerSource> _loadSource() =>
      widget.sourceLoader?.call() ??
      generatedViewerSourceCache.load(
        widget.item.path,
        fallbackFrameCount: widget.item.totalFrames,
      );

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<GeneratedViewerSource>(
      future: _source,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Scaffold(
            backgroundColor: AirQrTheme.background(context),
            appBar: AppBar(backgroundColor: AirQrTheme.background(context)),
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  snapshot.error.toString(),
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AirQrTheme.destructive),
                ),
              ),
            ),
          );
        }
        final source = snapshot.data;
        if (source == null) {
          return Scaffold(
            backgroundColor: AirQrTheme.background(context),
            body: const Center(child: CircularProgressIndicator()),
          );
        }

        return EncoderFullscreenGifView(
          gifData: source.gifs.first,
          totalFrames: source.frameCounts.first,
          minFrames: widget.item.minFrames ?? 0,
          fps: source.fps,
          chunkIndex: source.gifs.length > 1 ? 0 : null,
          totalChunks: source.gifs.length > 1 ? source.gifs.length : null,
          allChunkGifs: source.gifs.length > 1 ? source.gifs : null,
          allChunkFrameCounts: source.gifs.length > 1
              ? source.frameCounts
              : null,
          allChunkMinFrames: source.gifs.length > 1
              ? widget.item.chunkMinFrames
              : null,
          title: p.basename(widget.item.path),
          onDownload: () => widget.onDownload(),
        );
      },
    );
  }
}
