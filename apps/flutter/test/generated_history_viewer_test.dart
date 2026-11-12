import 'dart:convert';
import 'dart:typed_data';

import 'package:airqr_mobile/generated_history_viewer.dart';
import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:archive/archive.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final gif = Uint8List.fromList(
    base64Decode('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='),
  );

  test('generated GIF and ZIP items use the integrated viewer', () {
    HistoryItem item(String path, String mime, String origin) => HistoryItem(
      path: path,
      timestamp: 1,
      size: 1,
      origin: origin,
      mimeType: mime,
    );

    expect(
      usesGeneratedGifViewer(item('/a.gif', 'image/gif', 'generated')),
      isTrue,
    );
    expect(
      usesGeneratedGifViewer(
        item('/chunks.zip', 'application/zip', 'generated'),
      ),
      isTrue,
    );
    expect(
      usesGeneratedGifViewer(item('/a.gif', 'image/gif', 'scanned')),
      isFalse,
    );
  });

  test('loads naturally ordered GIF chunks from generated ZIP', () async {
    final archive = Archive()
      ..addFile(ArchiveFile('chunk_10.gif', gif.length, gif))
      ..addFile(ArchiveFile('chunk_2.gif', gif.length, gif));
    final zip = Uint8List.fromList(ZipEncoder().encode(archive)!);

    final source = await loadGeneratedViewerSource(
      '/chunks.zip',
      readFile: (_) async => zip,
    );

    expect(source.gifs, hasLength(2));
    expect(source.frameCounts, <int>[1, 1]);
    expect(source.fps, greaterThan(0));
  });

  testWidgets(
    'history viewer renders the shared controls and download action',
    (tester) async {
      var downloads = 0;
      final item = HistoryItem(
        path: '/generated/preview.gif',
        timestamp: 1,
        size: gif.length,
        origin: 'generated',
        mimeType: 'image/gif',
        totalFrames: 1,
        minFrames: 1,
        chunkMinFrames: const <int>[1],
      );

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: GeneratedHistoryViewerPage(
            item: item,
            onDownload: () async => downloads++,
            sourceLoader: () async => GeneratedViewerSource(
              gifs: <Uint8List>[gif],
              frameCounts: const <int>[1],
              fps: 10,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('qr-viewer-controls')), findsOneWidget);
      expect(find.text('preview.gif'), findsOneWidget);
      await tester.tap(find.byKey(const Key('qr-viewer-download')));
      await tester.pump();
      expect(downloads, 1);
    },
  );

  testWidgets(
    'chunk history viewer maximizes the QR and scrolls controls on mobile',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final item = HistoryItem(
        path: '/generated/chunks.zip',
        timestamp: 1,
        size: gif.length * 3,
        origin: 'generated',
        mimeType: 'application/zip',
        totalFrames: 273,
        minFrames: 210,
        chunkMinFrames: const <int>[70, 70, 70],
      );

      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: GeneratedHistoryViewerPage(
            item: item,
            onDownload: () async {},
            sourceLoader: () async => GeneratedViewerSource(
              gifs: <Uint8List>[gif, gif, gif],
              frameCounts: const <int>[91, 91, 91],
              fps: 10,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final preview = find.byKey(const Key('qr-viewer-interactive-preview'));
      final scroll = find.byKey(const Key('qr-viewer-scroll'));
      final frameBadge = find.byKey(const Key('qr-viewer-frame-badge'));
      final chunkBadge = find.byKey(const Key('qr-viewer-chunk-badge'));
      final auto = find.byKey(const Key('qr-viewer-auto-advance'));
      final controls = find.byKey(const Key('qr-viewer-controls'));
      final chunkStrip = find.byKey(const Key('qr-viewer-chunk-strip'));
      final lastChunk = find.byKey(const Key('qr-viewer-chunk-3'));

      expect(preview, findsOneWidget);
      expect(scroll, findsOneWidget);
      expect(frameBadge, findsOneWidget);
      expect(chunkBadge, findsOneWidget);
      expect(auto, findsOneWidget);
      expect(controls, findsOneWidget);
      expect(chunkStrip, findsOneWidget);
      expect(lastChunk, findsOneWidget);
      expect(
        tester.getCenter(frameBadge).dy,
        moreOrLessEquals(tester.getCenter(chunkBadge).dy, epsilon: 1),
      );
      expect(
        tester.getCenter(frameBadge).dy,
        moreOrLessEquals(tester.getCenter(auto).dy, epsilon: 1),
      );
      expect(
        tester.getTopLeft(preview).dy,
        greaterThanOrEqualTo(tester.getBottomLeft(auto).dy),
      );
      expect(tester.widget<InteractiveViewer>(preview).panEnabled, isFalse);
      final previewSize = tester.getSize(preview);
      expect(previewSize.width, greaterThanOrEqualTo(310));
      expect(
        previewSize.height,
        moreOrLessEquals(previewSize.width, epsilon: 1),
      );
      expect(tester.getSize(chunkStrip).height, 94);
      expect(
        find.descendant(of: controls, matching: chunkStrip),
        findsOneWidget,
      );
      expect(tester.getTopLeft(controls).dy, greaterThan(400));
      expect(tester.getBottomLeft(controls).dy, greaterThan(800));
      expect(lastChunk.hitTestable(), findsNothing);

      await tester.ensureVisible(lastChunk);
      await tester.pumpAndSettle();

      expect(lastChunk.hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
