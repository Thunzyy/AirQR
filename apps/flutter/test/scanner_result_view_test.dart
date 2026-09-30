import 'dart:ui' show SemanticsAction, Tristate;

import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/app/app_shell.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:airqr_mobile/scanner_result_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Widget wrapApp(Widget child) {
    return MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: child,
    );
  }

  testWidgets('ScannerResultView renders metadata and forwards actions', (
    tester,
  ) async {
    var downloaded = false;
    var closed = false;

    await tester.pumpWidget(
      wrapApp(
        ScannerResultView(
          primaryColor: const Color(0xFF3b82f6),
          successColor: const Color(0xFF22c55e),
          filename: 'archive.zip',
          sizeLabel: '4.2 MB',
          durationLabel: '8.1s',
          subtitle: 'Synced from iPhone',
          canDownload: true,
          isSaving: false,
          onDownload: () => downloaded = true,
          onClose: () => closed = true,
        ),
      ),
    );

    expect(find.text('archive.zip'), findsOneWidget);
    expect(find.text('4.2 MB'), findsOneWidget);
    expect(find.text('8.1s'), findsOneWidget);
    expect(find.text('Synced from iPhone'), findsOneWidget);

    await tester.tap(find.text('Download'));
    await tester.pump();
    expect(downloaded, isTrue);

    await tester.tap(find.byKey(const Key('scanner_result_close_button')));
    await tester.pump();
    expect(closed, isTrue);
  });

  testWidgets('ScannerResultView centers its title on the viewport', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      wrapApp(
        ScannerResultView(
          primaryColor: AirQrTheme.accentBlue,
          successColor: AirQrTheme.success,
          filename: 'archive.zip',
          sizeLabel: null,
          durationLabel: null,
          subtitle: null,
          canDownload: true,
          isSaving: false,
          onDownload: () {},
          onClose: () {},
        ),
      ),
    );

    final title = find.byKey(const Key('scanner_result_header_title'));
    expect(title, findsOneWidget);
    expect(tester.getCenter(title).dx, closeTo(195, 0.5));
  });

  testWidgets('ScannerResultView exposes a localized enabled back action', (
    tester,
  ) async {
    var closed = false;
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('fr'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: ScannerResultView(
          primaryColor: AirQrTheme.accentBlue,
          successColor: AirQrTheme.success,
          filename: 'archive.zip',
          sizeLabel: null,
          durationLabel: null,
          subtitle: null,
          canDownload: true,
          isSaving: false,
          onDownload: () {},
          onClose: () => closed = true,
        ),
      ),
    );

    final back = find.bySemanticsLabel('Retour');
    expect(back, findsOneWidget);
    final data = tester.getSemantics(back).getSemanticsData();
    expect(data.hasAction(SemanticsAction.tap), isTrue);
    expect(data.flagsCollection.isEnabled, Tristate.isTrue);

    await tester.tap(back);
    await tester.pump();
    expect(closed, isTrue);
    semantics.dispose();
  });

  testWidgets('ScannerResultView header supports large text without overflow', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(320, 700);
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      MaterialApp(
        theme: buildAirQrDarkTheme(),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(2)),
          child: child!,
        ),
        home: ScannerResultView(
          primaryColor: AirQrTheme.accentBlue,
          successColor: AirQrTheme.success,
          filename: 'archive.zip',
          sizeLabel: null,
          durationLabel: null,
          subtitle: null,
          canDownload: true,
          isSaving: false,
          onDownload: () {},
          onClose: () {},
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    final title = tester.widget<Text>(
      find.byKey(const Key('scanner_result_header_title')),
    );
    expect(title.maxLines, 2);
    expect(title.overflow, TextOverflow.ellipsis);
    final paragraph = tester.renderObject<RenderParagraph>(
      find.byKey(const Key('scanner_result_header_title')),
    );
    expect(
      paragraph.didExceedMaxLines,
      isFalse,
      reason:
          'header ${paragraph.text.toPlainText()} rendered at ${paragraph.size}',
    );
    final titleRect = tester.getRect(
      find.byKey(const Key('scanner_result_header_title')),
    );
    final backRect = tester.getRect(find.bySemanticsLabel('Back'));
    final closeRect = tester.getRect(
      find.byKey(const Key('scanner_result_close_button')),
    );
    expect(
      tester.getCenter(find.byKey(const Key('scanner_result_header_title'))).dx,
      closeTo(160, 0.5),
    );
    expect(backRect.right, lessThanOrEqualTo(titleRect.left));
    expect(titleRect.right, lessThanOrEqualTo(closeRect.left));
  });

  testWidgets('ScannerResultPreview outlines its container outside content', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        const ScannerResultPreview(
          filename: 'archive.zip',
          previewPath: null,
          primaryColor: AirQrTheme.accentBlue,
          successColor: AirQrTheme.success,
        ),
      ),
    );

    final previewFinder = find.byKey(const Key('scanner_result_preview'));
    final preview = tester.widget<Container>(previewFinder);
    final decoration = preview.decoration! as BoxDecoration;
    final context = tester.element(previewFinder);
    expect(decoration.borderRadius, AirQrRadii.panel);
    expect(
      decoration.border,
      Border.all(color: AirQrTheme.controlBorder(context)),
    );
    expect(decoration.boxShadow, isNull);
    expect(preview.padding, const EdgeInsets.all(1));
    expect(preview.clipBehavior, Clip.antiAlias);
  });

  testWidgets(
    'ScannerResultView download button uses web light button tokens',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData.light(),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: ScannerResultView(
            primaryColor: AirQrTheme.accentBlue,
            successColor: const Color(0xFF22c55e),
            filename: 'archive.zip',
            sizeLabel: '4.2 MB',
            durationLabel: '8.1s',
            subtitle: null,
            canDownload: true,
            isSaving: false,
            onDownload: () {},
            onClose: () {},
          ),
        ),
      );

      final downloadButton = tester.widget<ElevatedButton>(
        find.byWidgetPredicate((widget) => widget is ElevatedButton).first,
      );
      expect(
        downloadButton.style?.backgroundColor?.resolve(<WidgetState>{}),
        AirQrTheme.lightPrimaryButtonSurface,
      );
      expect(
        downloadButton.style?.foregroundColor?.resolve(<WidgetState>{}),
        AirQrTheme.lightTextPrimary,
      );
    },
  );

  testWidgets('ScannerResultView shows saving spinner and disables download', (
    tester,
  ) async {
    var downloaded = false;

    await tester.pumpWidget(
      wrapApp(
        ScannerResultView(
          primaryColor: const Color(0xFF3b82f6),
          successColor: const Color(0xFF22c55e),
          filename: 'archive.zip',
          sizeLabel: null,
          durationLabel: null,
          subtitle: null,
          canDownload: false,
          isSaving: true,
          onDownload: () => downloaded = true,
          onClose: () {},
        ),
      ),
    );

    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.tap(find.text('Download'));
    await tester.pump();

    expect(downloaded, isFalse);
  });

  testWidgets('ScannerResultView uses AirQR icons for result actions', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrapApp(
        ScannerResultView(
          primaryColor: const Color(0xFF3b82f6),
          successColor: const Color(0xFF22c55e),
          filename: 'archive.zip',
          sizeLabel: '4.2 MB',
          durationLabel: '8.1s',
          subtitle: null,
          canDownload: true,
          isSaving: false,
          onDownload: () {},
          onClose: () {},
        ),
      ),
    );

    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'download',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'check',
      ),
      findsOneWidget,
    );
  });

  testWidgets('ScannerResultView renders note preview and forwards copy', (
    tester,
  ) async {
    var copied = false;

    await tester.pumpWidget(
      wrapApp(
        ScannerResultView(
          primaryColor: const Color(0xFF3b82f6),
          successColor: const Color(0xFF22c55e),
          filename: 'note.md',
          sizeLabel: '24 bytes',
          durationLabel: '0.2s',
          subtitle: 'Completed on Desktop',
          isNote: true,
          noteContent: '# hello\nworld',
          canDownload: false,
          isSaving: false,
          onDownload: () {},
          onCopy: () => copied = true,
          onClose: () {},
        ),
      ),
    );

    expect(find.byKey(const Key('note_view')), findsOneWidget);
    expect(find.text('note.md'), findsOneWidget);
    expect(find.text('# hello'), findsOneWidget);
    expect(find.text('world'), findsOneWidget);
    expect(find.byKey(const Key('scanner_note_copy_button')), findsOneWidget);
    expect(find.byKey(const Key('note_view_line_count')), findsOneWidget);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'content_copy',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'close',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'qr_code_scanner',
      ),
      findsOneWidget,
    );

    await tester.tap(find.text('Copy'));
    await tester.pump();

    expect(copied, isTrue);
  });
}
