import 'dart:io';

import 'package:airqr_mobile/airqr_icon.dart';
import 'package:airqr_mobile/airqr_theme.dart';
import 'package:airqr_mobile/decoder_page.dart';
import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:file_picker/file_picker.dart';

class _TestFilePicker extends FilePicker {
  final FilePickerResult? result;
  bool? lastWithData;

  _TestFilePicker(this.result);

  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    void Function(FilePickerStatus)? onFileLoading,
    bool allowCompression = true,
    int compressionQuality = 30,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
  }) async {
    lastWithData = withData;
    return result;
  }
}

void main() {
  late FilePicker baselinePicker;

  setUpAll(() {
    baselinePicker = _TestFilePicker(null);
    FilePicker.platform = baselinePicker;
  });

  testWidgets('Decoder picker matches web file card copy', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const DecoderPage(),
      ),
    );

    expect(find.text('GIF or ZIP file'), findsOneWidget);
    expect(find.text('Drop a GIF or ZIP file to decode'), findsNothing);
    expect(find.text('Tap to select a GIF file'), findsOneWidget);
    expect(
      find.text(
        'Decode only works with GIFs created by AirQR, not a regular photo GIF.',
      ),
      findsOneWidget,
    );
    expect(find.text('Try a sample GIF'), findsOneWidget);
    final pickerIconFinder = find.byKey(const Key('decoder_file_picker_icon'));
    final pickerIcon = tester.widget<Container>(pickerIconFinder);
    final pickerIconDecoration = pickerIcon.decoration as BoxDecoration;
    expect(tester.getSize(pickerIconFinder), const Size(52, 52));
    expect(pickerIcon.alignment, Alignment.center);
    expect(pickerIconDecoration.shape, BoxShape.circle);
    expect(pickerIconDecoration.color, AirQrTheme.lightIconSurface);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is AirQrIcon && widget.name == 'info',
      ),
      findsOneWidget,
    );
  });

  testWidgets('Decoder primary controls use web light button tokens', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light(),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const DecoderPage(),
      ),
    );

    final tapToSelectContainer = tester.widget<Container>(
      find
          .ancestor(
            of: find.text('Tap to select a GIF file'),
            matching: find.byType(Container),
          )
          .first,
    );
    final tapDecoration = tapToSelectContainer.decoration as BoxDecoration;
    expect(tapDecoration.color, AirQrTheme.lightPrimaryButtonSurface);

    final decodeButton = tester.widget<ElevatedButton>(
      find.widgetWithText(ElevatedButton, 'Decode GIF'),
    );
    expect(
      decodeButton.style?.backgroundColor?.resolve(<WidgetState>{}),
      AirQrTheme.lightPrimaryButtonSurface,
    );
    expect(
      decodeButton.style?.foregroundColor?.resolve(<WidgetState>{}),
      AirQrTheme.lightTextPrimary,
    );
  });

  testWidgets('Decoder picker is a keyboard-accessible labeled action', (
    tester,
  ) async {
    var pickCount = 0;
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: DecoderPage(onPickFile: () async => pickCount++),
      ),
    );

    final picker = find.byKey(const Key('decoder-file-picker-action'));
    final size = tester.getSize(picker);
    expect(size.width, greaterThanOrEqualTo(48));
    expect(size.height, greaterThanOrEqualTo(48));
    final data = tester.getSemantics(picker).getSemanticsData();
    expect(data.label, 'Select a GIF file to decode');
    expect(data.hasAction(SemanticsAction.tap), isTrue);
    final material = tester.widget<Material>(
      find.descendant(of: picker, matching: find.byType(Material)).first,
    );
    final inkWell = tester.widget<InkWell>(
      find.descendant(of: picker, matching: find.byType(InkWell)).first,
    );
    expect(material.color, AirQrTheme.card(tester.element(picker)));
    expect(
      inkWell.overlayColor?.resolve(<WidgetState>{WidgetState.focused})?.a,
      greaterThan(0),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(pickCount, 1);
    semantics.dispose();
  });

  testWidgets('Decoder file metadata uses Manrope rather than technical type', (
    tester,
  ) async {
    final file = File(
      '${Directory.systemTemp.path}/airqr-decoder-metadata.gif',
    );
    file.writeAsBytesSync(List<int>.filled(2048, 0));
    final originalPicker = FilePicker.platform;
    FilePicker.platform = _TestFilePicker(
      FilePickerResult([
        PlatformFile(name: 'holiday-2026.gif', size: 2048, path: file.path),
      ]),
    );
    addTearDown(() {
      FilePicker.platform = originalPicker;
      if (file.existsSync()) file.deleteSync();
    });

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const DecoderPage(),
      ),
    );
    await tester.tap(find.byKey(const Key('decoder-file-picker-action')));
    await tester.pump();

    expect(FilePicker.platform, isA<_TestFilePicker>());
    expect((FilePicker.platform as _TestFilePicker).lastWithData, isTrue);

    final filename = tester.widget<Text>(find.text('holiday-2026.gif'));
    expect(filename.style?.fontFamily, 'Manrope');
    expect(filename.style?.fontFeatures, isNull);
    final size = tester.widget<Text>(find.text('2.00 KB'));
    expect(size.style?.fontFamily, 'Manrope');
    expect(size.style?.fontFeatures, isNull);
  });

  test('Decoder metadata test restores the FilePicker platform', () {
    expect(FilePicker.platform, same(baselinePicker));
  });
}
