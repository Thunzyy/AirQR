import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_fr.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('fr'),
  ];

  /// No description provided for @nav_encoder.
  ///
  /// In en, this message translates to:
  /// **'Encoder'**
  String get nav_encoder;

  /// No description provided for @nav_decoder.
  ///
  /// In en, this message translates to:
  /// **'Decoder'**
  String get nav_decoder;

  /// No description provided for @nav_scanner.
  ///
  /// In en, this message translates to:
  /// **'Scanner'**
  String get nav_scanner;

  /// No description provided for @nav_history.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get nav_history;

  /// No description provided for @nav_settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get nav_settings;

  /// No description provided for @common_loading.
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get common_loading;

  /// No description provided for @common_error.
  ///
  /// In en, this message translates to:
  /// **'Error'**
  String get common_error;

  /// No description provided for @common_success.
  ///
  /// In en, this message translates to:
  /// **'Success'**
  String get common_success;

  /// No description provided for @common_cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get common_cancel;

  /// No description provided for @common_save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get common_save;

  /// No description provided for @common_delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get common_delete;

  /// No description provided for @common_download.
  ///
  /// In en, this message translates to:
  /// **'Download'**
  String get common_download;

  /// No description provided for @common_copy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get common_copy;

  /// No description provided for @common_open.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get common_open;

  /// No description provided for @common_upload.
  ///
  /// In en, this message translates to:
  /// **'Upload'**
  String get common_upload;

  /// No description provided for @common_close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get common_close;

  /// No description provided for @common_yes.
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get common_yes;

  /// No description provided for @common_no.
  ///
  /// In en, this message translates to:
  /// **'No'**
  String get common_no;

  /// No description provided for @common_confirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get common_confirm;

  /// No description provided for @common_back.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get common_back;

  /// No description provided for @common_next.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get common_next;

  /// No description provided for @common_reset.
  ///
  /// In en, this message translates to:
  /// **'Reset'**
  String get common_reset;

  /// No description provided for @common_retry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get common_retry;

  /// No description provided for @common_clear.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get common_clear;

  /// No description provided for @common_search.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get common_search;

  /// No description provided for @common_noResults.
  ///
  /// In en, this message translates to:
  /// **'No results'**
  String get common_noResults;

  /// No description provided for @common_items.
  ///
  /// In en, this message translates to:
  /// **'items'**
  String get common_items;

  /// No description provided for @common_files.
  ///
  /// In en, this message translates to:
  /// **'files'**
  String get common_files;

  /// No description provided for @common_file.
  ///
  /// In en, this message translates to:
  /// **'file'**
  String get common_file;

  /// No description provided for @common_folder.
  ///
  /// In en, this message translates to:
  /// **'folder'**
  String get common_folder;

  /// No description provided for @common_frames.
  ///
  /// In en, this message translates to:
  /// **'frames'**
  String get common_frames;

  /// No description provided for @common_bytes.
  ///
  /// In en, this message translates to:
  /// **'bytes'**
  String get common_bytes;

  /// No description provided for @common_fps.
  ///
  /// In en, this message translates to:
  /// **'fps'**
  String get common_fps;

  /// No description provided for @common_today.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get common_today;

  /// No description provided for @common_yesterday.
  ///
  /// In en, this message translates to:
  /// **'Yesterday'**
  String get common_yesterday;

  /// No description provided for @common_older.
  ///
  /// In en, this message translates to:
  /// **'Older'**
  String get common_older;

  /// No description provided for @common_lineCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one {{count} line} other {{count} lines}}'**
  String common_lineCount(int count);

  /// No description provided for @common_charCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one {{count} char} other {{count} chars}}'**
  String common_charCount(int count);

  /// No description provided for @common_byteCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one {{count} byte} other {{count} bytes}}'**
  String common_byteCount(int count);

  /// No description provided for @encoder_title.
  ///
  /// In en, this message translates to:
  /// **'Encoder'**
  String get encoder_title;

  /// No description provided for @encoder_selectFiles.
  ///
  /// In en, this message translates to:
  /// **'Select File(s)'**
  String get encoder_selectFiles;

  /// No description provided for @encoder_selectFolder.
  ///
  /// In en, this message translates to:
  /// **'Select Folder'**
  String get encoder_selectFolder;

  /// No description provided for @encoder_dropzone.
  ///
  /// In en, this message translates to:
  /// **'Choose files or an entire folder to encode'**
  String get encoder_dropzone;

  /// No description provided for @encoder_filesSelected.
  ///
  /// In en, this message translates to:
  /// **'files selected'**
  String get encoder_filesSelected;

  /// No description provided for @encoder_advancedSettings.
  ///
  /// In en, this message translates to:
  /// **'Advanced Settings'**
  String get encoder_advancedSettings;

  /// No description provided for @encoder_frameRate.
  ///
  /// In en, this message translates to:
  /// **'Frame Rate (FPS)'**
  String get encoder_frameRate;

  /// No description provided for @encoder_slowFps.
  ///
  /// In en, this message translates to:
  /// **'Slow (1)'**
  String get encoder_slowFps;

  /// No description provided for @encoder_fastFps.
  ///
  /// In en, this message translates to:
  /// **'Fast (60)'**
  String get encoder_fastFps;

  /// No description provided for @encoder_packetSize.
  ///
  /// In en, this message translates to:
  /// **'Packet Size'**
  String get encoder_packetSize;

  /// No description provided for @encoder_smallPacket.
  ///
  /// In en, this message translates to:
  /// **'Small (100)'**
  String get encoder_smallPacket;

  /// No description provided for @encoder_largePacket.
  ///
  /// In en, this message translates to:
  /// **'Large (2800)'**
  String get encoder_largePacket;

  /// No description provided for @encoder_errorCorrection.
  ///
  /// In en, this message translates to:
  /// **'Error Correction'**
  String get encoder_errorCorrection;

  /// No description provided for @encoder_targetQrSize.
  ///
  /// In en, this message translates to:
  /// **'Target QR Size'**
  String get encoder_targetQrSize;

  /// No description provided for @encoder_raptorqOverhead.
  ///
  /// In en, this message translates to:
  /// **'Redundancy'**
  String get encoder_raptorqOverhead;

  /// No description provided for @encoder_lessRedundancy.
  ///
  /// In en, this message translates to:
  /// **'Less redundancy (1x)'**
  String get encoder_lessRedundancy;

  /// No description provided for @encoder_moreRedundancy.
  ///
  /// In en, this message translates to:
  /// **'More redundancy (3x)'**
  String get encoder_moreRedundancy;

  /// No description provided for @encoder_compression.
  ///
  /// In en, this message translates to:
  /// **'Compression'**
  String get encoder_compression;

  /// No description provided for @encoder_compressionDesc.
  ///
  /// In en, this message translates to:
  /// **'Enable ZIP compression for smaller files'**
  String get encoder_compressionDesc;

  /// No description provided for @encoder_forceChunkMode.
  ///
  /// In en, this message translates to:
  /// **'Force Chunk Mode'**
  String get encoder_forceChunkMode;

  /// No description provided for @encoder_forceChunkModeDesc.
  ///
  /// In en, this message translates to:
  /// **'Split large files into multiple GIFs'**
  String get encoder_forceChunkModeDesc;

  /// No description provided for @encoder_chunkSize.
  ///
  /// In en, this message translates to:
  /// **'Chunk Size'**
  String get encoder_chunkSize;

  /// No description provided for @encoder_generate.
  ///
  /// In en, this message translates to:
  /// **'Generate QR GIF'**
  String get encoder_generate;

  /// No description provided for @encoder_encoding.
  ///
  /// In en, this message translates to:
  /// **'Encoding...'**
  String get encoder_encoding;

  /// No description provided for @encoder_encodingProgress.
  ///
  /// In en, this message translates to:
  /// **'Encoding... {percent}%'**
  String encoder_encodingProgress(int percent);

  /// No description provided for @encoder_result.
  ///
  /// In en, this message translates to:
  /// **'Result'**
  String get encoder_result;

  /// No description provided for @encoder_expansion.
  ///
  /// In en, this message translates to:
  /// **'expansion'**
  String get encoder_expansion;

  /// No description provided for @encoder_chunk.
  ///
  /// In en, this message translates to:
  /// **'Chunk {current}/{total}'**
  String encoder_chunk(int current, int total);

  /// No description provided for @encoder_autoAdvanceOn.
  ///
  /// In en, this message translates to:
  /// **'Auto-advance ON'**
  String get encoder_autoAdvanceOn;

  /// No description provided for @encoder_autoAdvanceOff.
  ///
  /// In en, this message translates to:
  /// **'Auto-advance OFF'**
  String get encoder_autoAdvanceOff;

  /// No description provided for @encoder_auto.
  ///
  /// In en, this message translates to:
  /// **'Auto'**
  String get encoder_auto;

  /// No description provided for @encoder_manual.
  ///
  /// In en, this message translates to:
  /// **'Manual'**
  String get encoder_manual;

  /// No description provided for @encoder_frame.
  ///
  /// In en, this message translates to:
  /// **'Frame'**
  String get encoder_frame;

  /// No description provided for @encoder_playbackFps.
  ///
  /// In en, this message translates to:
  /// **'Playback FPS'**
  String get encoder_playbackFps;

  /// No description provided for @encoder_minScanTime.
  ///
  /// In en, this message translates to:
  /// **'Min scan {time}'**
  String encoder_minScanTime(String time);

  /// No description provided for @encoder_collapseControls.
  ///
  /// In en, this message translates to:
  /// **'Collapse controls'**
  String get encoder_collapseControls;

  /// No description provided for @encoder_showControls.
  ///
  /// In en, this message translates to:
  /// **'Show controls'**
  String get encoder_showControls;

  /// No description provided for @encoder_minRequired.
  ///
  /// In en, this message translates to:
  /// **'Min Required'**
  String get encoder_minRequired;

  /// No description provided for @encoder_minShort.
  ///
  /// In en, this message translates to:
  /// **'Min'**
  String get encoder_minShort;

  /// No description provided for @encoder_zoomOut.
  ///
  /// In en, this message translates to:
  /// **'Zoom Out'**
  String get encoder_zoomOut;

  /// No description provided for @encoder_zoomIn.
  ///
  /// In en, this message translates to:
  /// **'Zoom In'**
  String get encoder_zoomIn;

  /// No description provided for @encoder_resetZoom.
  ///
  /// In en, this message translates to:
  /// **'Reset zoom'**
  String get encoder_resetZoom;

  /// No description provided for @encoder_dataChunks.
  ///
  /// In en, this message translates to:
  /// **'Data Chunks'**
  String get encoder_dataChunks;

  /// No description provided for @encoder_multiView.
  ///
  /// In en, this message translates to:
  /// **'Multi-View'**
  String get encoder_multiView;

  /// No description provided for @encoder_downloadZip.
  ///
  /// In en, this message translates to:
  /// **'Download ZIP'**
  String get encoder_downloadZip;

  /// No description provided for @encoder_downloadGif.
  ///
  /// In en, this message translates to:
  /// **'Download GIF'**
  String get encoder_downloadGif;

  /// No description provided for @encoder_tapToSelect.
  ///
  /// In en, this message translates to:
  /// **'Tap to select a file'**
  String get encoder_tapToSelect;

  /// No description provided for @encoder_fileSelected.
  ///
  /// In en, this message translates to:
  /// **'File selected'**
  String get encoder_fileSelected;

  /// No description provided for @encoder_selectSource.
  ///
  /// In en, this message translates to:
  /// **'Select Source'**
  String get encoder_selectSource;

  /// No description provided for @encoder_modeFile.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get encoder_modeFile;

  /// No description provided for @encoder_modeNote.
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get encoder_modeNote;

  /// No description provided for @encoder_noteEditorTitle.
  ///
  /// In en, this message translates to:
  /// **'Quick Note'**
  String get encoder_noteEditorTitle;

  /// No description provided for @encoder_noteFormat.
  ///
  /// In en, this message translates to:
  /// **'Format'**
  String get encoder_noteFormat;

  /// No description provided for @encoder_notePlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Type or paste your note here...'**
  String get encoder_notePlaceholder;

  /// No description provided for @encoder_clearNote.
  ///
  /// In en, this message translates to:
  /// **'Clear note'**
  String get encoder_clearNote;

  /// No description provided for @encoder_noteStats.
  ///
  /// In en, this message translates to:
  /// **'{chars} chars • {bytes} bytes'**
  String encoder_noteStats(int chars, int bytes);

  /// No description provided for @encoder_noteFormat_plain.
  ///
  /// In en, this message translates to:
  /// **'Plain text'**
  String get encoder_noteFormat_plain;

  /// No description provided for @encoder_noteFormat_markdown.
  ///
  /// In en, this message translates to:
  /// **'Markdown'**
  String get encoder_noteFormat_markdown;

  /// No description provided for @encoder_noteFormat_javascript.
  ///
  /// In en, this message translates to:
  /// **'JavaScript'**
  String get encoder_noteFormat_javascript;

  /// No description provided for @encoder_noteFormat_python.
  ///
  /// In en, this message translates to:
  /// **'Python'**
  String get encoder_noteFormat_python;

  /// No description provided for @encoder_noteFormat_typescript.
  ///
  /// In en, this message translates to:
  /// **'TypeScript'**
  String get encoder_noteFormat_typescript;

  /// No description provided for @encoder_noteFormat_json.
  ///
  /// In en, this message translates to:
  /// **'JSON'**
  String get encoder_noteFormat_json;

  /// No description provided for @encoder_noteFormat_html.
  ///
  /// In en, this message translates to:
  /// **'HTML'**
  String get encoder_noteFormat_html;

  /// No description provided for @encoder_noteFormat_css.
  ///
  /// In en, this message translates to:
  /// **'CSS'**
  String get encoder_noteFormat_css;

  /// No description provided for @encoder_noteFormat_rust.
  ///
  /// In en, this message translates to:
  /// **'Rust'**
  String get encoder_noteFormat_rust;

  /// No description provided for @encoder_noteFormat_sql.
  ///
  /// In en, this message translates to:
  /// **'SQL'**
  String get encoder_noteFormat_sql;

  /// No description provided for @encoder_noteFormat_yaml.
  ///
  /// In en, this message translates to:
  /// **'YAML'**
  String get encoder_noteFormat_yaml;

  /// No description provided for @encoder_noteFormat_shell.
  ///
  /// In en, this message translates to:
  /// **'Shell'**
  String get encoder_noteFormat_shell;

  /// No description provided for @encoder_singleFile.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get encoder_singleFile;

  /// No description provided for @encoder_singleFileDesc.
  ///
  /// In en, this message translates to:
  /// **'Select a single file'**
  String get encoder_singleFileDesc;

  /// No description provided for @encoder_folderDesc.
  ///
  /// In en, this message translates to:
  /// **'Select folder (will be zipped)'**
  String get encoder_folderDesc;

  /// No description provided for @encoder_zipFile.
  ///
  /// In en, this message translates to:
  /// **'ZIP File'**
  String get encoder_zipFile;

  /// No description provided for @encoder_zipFileDesc.
  ///
  /// In en, this message translates to:
  /// **'Import existing ZIP archive'**
  String get encoder_zipFileDesc;

  /// No description provided for @encoder_scale.
  ///
  /// In en, this message translates to:
  /// **'Scale (0=Auto)'**
  String get encoder_scale;

  /// No description provided for @encoder_chunkSizeMb.
  ///
  /// In en, this message translates to:
  /// **'Chunk Size (MB)'**
  String get encoder_chunkSizeMb;

  /// No description provided for @encoder_savedToDownloads.
  ///
  /// In en, this message translates to:
  /// **'Saved to Downloads: {filename}'**
  String encoder_savedToDownloads(String filename);

  /// No description provided for @encoder_saved.
  ///
  /// In en, this message translates to:
  /// **'Saved: {filename}'**
  String encoder_saved(String filename);

  /// No description provided for @encoder_savedChunks.
  ///
  /// In en, this message translates to:
  /// **'Saved to Downloads: {filename} ({chunks} chunks)'**
  String encoder_savedChunks(String filename, int chunks);

  /// No description provided for @encoder_totalFrames.
  ///
  /// In en, this message translates to:
  /// **'{count} total frames'**
  String encoder_totalFrames(int count);

  /// No description provided for @encoder_encodedIn.
  ///
  /// In en, this message translates to:
  /// **'Encoded in {seconds}s'**
  String encoder_encodedIn(String seconds);

  /// No description provided for @encoder_networkTitle.
  ///
  /// In en, this message translates to:
  /// **'Use AirQR from another device'**
  String get encoder_networkTitle;

  /// No description provided for @encoder_networkBody.
  ///
  /// In en, this message translates to:
  /// **'Start the offline web app server in Settings to share the encoder and decoder on your local network. You can also download the desktop, mobile, or web version from GitHub.'**
  String get encoder_networkBody;

  /// No description provided for @encoder_openOfflineWebSettings.
  ///
  /// In en, this message translates to:
  /// **'Open server settings'**
  String get encoder_openOfflineWebSettings;

  /// No description provided for @encoder_openGithubReleases.
  ///
  /// In en, this message translates to:
  /// **'GitHub releases'**
  String get encoder_openGithubReleases;

  /// No description provided for @encoder_hideNetworkNotice.
  ///
  /// In en, this message translates to:
  /// **'Do not show again'**
  String get encoder_hideNetworkNotice;

  /// No description provided for @decoder_title.
  ///
  /// In en, this message translates to:
  /// **'Decoder'**
  String get decoder_title;

  /// No description provided for @decoder_selectFileCardTitle.
  ///
  /// In en, this message translates to:
  /// **'GIF or ZIP file'**
  String get decoder_selectFileCardTitle;

  /// No description provided for @decoder_dropGif.
  ///
  /// In en, this message translates to:
  /// **'Drop a GIF or ZIP file to decode'**
  String get decoder_dropGif;

  /// No description provided for @decoder_tapToSelect.
  ///
  /// In en, this message translates to:
  /// **'Tap to select a GIF file'**
  String get decoder_tapToSelect;

  /// No description provided for @decoder_readingFile.
  ///
  /// In en, this message translates to:
  /// **'Reading file...'**
  String get decoder_readingFile;

  /// No description provided for @decoder_initDecoder.
  ///
  /// In en, this message translates to:
  /// **'Initializing decoder...'**
  String get decoder_initDecoder;

  /// No description provided for @decoder_extractingFrames.
  ///
  /// In en, this message translates to:
  /// **'Extracting GIF frames...'**
  String get decoder_extractingFrames;

  /// No description provided for @decoder_processingFrames.
  ///
  /// In en, this message translates to:
  /// **'Processing {count} frames...'**
  String decoder_processingFrames(int count);

  /// No description provided for @decoder_decodingProgress.
  ///
  /// In en, this message translates to:
  /// **'Decoding: {percent}% ({count} QR codes detected)'**
  String decoder_decodingProgress(int percent, int count);

  /// No description provided for @decoder_chunkComplete.
  ///
  /// In en, this message translates to:
  /// **'Chunk {current}/{total} complete'**
  String decoder_chunkComplete(int current, int total);

  /// No description provided for @decoder_decodingComplete.
  ///
  /// In en, this message translates to:
  /// **'Decoding complete!'**
  String get decoder_decodingComplete;

  /// No description provided for @decoder_decodeGif.
  ///
  /// In en, this message translates to:
  /// **'Decode GIF'**
  String get decoder_decodeGif;

  /// No description provided for @decoder_saveFile.
  ///
  /// In en, this message translates to:
  /// **'Save File'**
  String get decoder_saveFile;

  /// No description provided for @decoder_notEnoughQr.
  ///
  /// In en, this message translates to:
  /// **'Could not complete decoding. Not enough valid QR codes found.'**
  String get decoder_notEnoughQr;

  /// No description provided for @decoder_notAirQrGif.
  ///
  /// In en, this message translates to:
  /// **'This GIF is not an AirQR transfer. Encode a file in the Encode tab first, then decode that GIF — or try the sample below.'**
  String get decoder_notAirQrGif;

  /// No description provided for @decoder_notAirQrStatus.
  ///
  /// In en, this message translates to:
  /// **'No AirQR QR codes found in this GIF.'**
  String get decoder_notAirQrStatus;

  /// No description provided for @decoder_invalidGif.
  ///
  /// In en, this message translates to:
  /// **'This file could not be read as an AirQR GIF or ZIP.'**
  String get decoder_invalidGif;

  /// No description provided for @decoder_fileUnreadable.
  ///
  /// In en, this message translates to:
  /// **'The selected file could not be read. Try selecting it again.'**
  String get decoder_fileUnreadable;

  /// No description provided for @decoder_airQrOnlyHint.
  ///
  /// In en, this message translates to:
  /// **'Decode only works with GIFs created by AirQR, not a regular photo GIF.'**
  String get decoder_airQrOnlyHint;

  /// No description provided for @decoder_trySample.
  ///
  /// In en, this message translates to:
  /// **'Try a sample GIF'**
  String get decoder_trySample;

  /// No description provided for @decoder_sampleFilename.
  ///
  /// In en, this message translates to:
  /// **'airqr-sample.txt'**
  String get decoder_sampleFilename;

  /// No description provided for @decoder_sampleNote.
  ///
  /// In en, this message translates to:
  /// **'Hello from AirQR.\nThis note was recovered from an animated QR GIF.'**
  String get decoder_sampleNote;

  /// No description provided for @decoder_sampleFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not build the sample GIF.'**
  String get decoder_sampleFailed;

  /// No description provided for @decoder_noGifInZip.
  ///
  /// In en, this message translates to:
  /// **'No GIF files found in ZIP archive'**
  String get decoder_noGifInZip;

  /// No description provided for @decoder_chunkWaiting.
  ///
  /// In en, this message translates to:
  /// **'Chunk processed. Waiting for remaining chunks...'**
  String get decoder_chunkWaiting;

  /// No description provided for @decoder_fileSelected.
  ///
  /// In en, this message translates to:
  /// **'File selected. Tap decode to start.'**
  String get decoder_fileSelected;

  /// No description provided for @decoder_status.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get decoder_status;

  /// No description provided for @decoder_processingZip.
  ///
  /// In en, this message translates to:
  /// **'Processing ZIP archive...'**
  String get decoder_processingZip;

  /// No description provided for @decoder_processingGif.
  ///
  /// In en, this message translates to:
  /// **'Processing GIF frames...'**
  String get decoder_processingGif;

  /// No description provided for @decoder_complete.
  ///
  /// In en, this message translates to:
  /// **'Complete! {frames} frames, {qrCodes} QR codes ({time}ms)'**
  String decoder_complete(int frames, int qrCodes, int time);

  /// No description provided for @decoder_failed.
  ///
  /// In en, this message translates to:
  /// **'Failed: {frames} frames, {qrCodes} QR codes'**
  String decoder_failed(int frames, int qrCodes);

  /// No description provided for @decoder_unknownFile.
  ///
  /// In en, this message translates to:
  /// **'Unknown file'**
  String get decoder_unknownFile;

  /// No description provided for @decoder_fileSaved.
  ///
  /// In en, this message translates to:
  /// **'File saved successfully'**
  String get decoder_fileSaved;

  /// No description provided for @decoder_saveFailed.
  ///
  /// In en, this message translates to:
  /// **'Save failed: {error}'**
  String decoder_saveFailed(String error);

  /// No description provided for @scanner_title.
  ///
  /// In en, this message translates to:
  /// **'Scanner'**
  String get scanner_title;

  /// No description provided for @scanner_initCamera.
  ///
  /// In en, this message translates to:
  /// **'Initializing camera...'**
  String get scanner_initCamera;

  /// No description provided for @scanner_cameraError.
  ///
  /// In en, this message translates to:
  /// **'Camera access denied or unavailable'**
  String get scanner_cameraError;

  /// No description provided for @scanner_scanning.
  ///
  /// In en, this message translates to:
  /// **'Scanning...'**
  String get scanner_scanning;

  /// No description provided for @scanner_resumingScan.
  ///
  /// In en, this message translates to:
  /// **'Resuming scan...'**
  String get scanner_resumingScan;

  /// No description provided for @scanner_readyToScan.
  ///
  /// In en, this message translates to:
  /// **'Ready to scan'**
  String get scanner_readyToScan;

  /// No description provided for @scanner_decoderError.
  ///
  /// In en, this message translates to:
  /// **'Error initializing decoder'**
  String get scanner_decoderError;

  /// No description provided for @scanner_resetScanner.
  ///
  /// In en, this message translates to:
  /// **'Reset Scanner'**
  String get scanner_resetScanner;

  /// No description provided for @scanner_scanned.
  ///
  /// In en, this message translates to:
  /// **'Scanned'**
  String get scanner_scanned;

  /// No description provided for @scanner_min.
  ///
  /// In en, this message translates to:
  /// **'Min'**
  String get scanner_min;

  /// No description provided for @scanner_max.
  ///
  /// In en, this message translates to:
  /// **'Max'**
  String get scanner_max;

  /// Scanner synchronization source
  ///
  /// In en, this message translates to:
  /// **'Sync: {source}'**
  String scanner_syncSource(String source);

  /// Scanner session packet progress
  ///
  /// In en, this message translates to:
  /// **'Session: {received}/{expected}'**
  String scanner_sessionProgress(int received, int expected);

  /// Number of packets still missing
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one {{count} missing} other {{count} missing}}'**
  String scanner_missingPackets(int count);

  /// No description provided for @scanner_selectChunk.
  ///
  /// In en, this message translates to:
  /// **'Select chunk'**
  String get scanner_selectChunk;

  /// No description provided for @scanner_chunkScrollTrack.
  ///
  /// In en, this message translates to:
  /// **'Scroll through chunks'**
  String get scanner_chunkScrollTrack;

  /// Horizontal position in the scanner chunk list
  ///
  /// In en, this message translates to:
  /// **'{percent}%'**
  String scanner_chunkScrollValue(int percent);

  /// Chunk label by one-based index
  ///
  /// In en, this message translates to:
  /// **'Chunk {number}'**
  String scanner_chunkLabel(int number);

  /// Number of scanner packets received
  ///
  /// In en, this message translates to:
  /// **'{received, plural, one {{received} received} other {{received} received}}'**
  String scanner_receivedCount(int received);

  /// Chunk progress toward its decode threshold
  ///
  /// In en, this message translates to:
  /// **'{received}/{threshold} to threshold'**
  String scanner_toThreshold(int received, int threshold);

  /// Additional unique QR frames needed
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one {{count} more unique QR} other {{count} more unique QR}}'**
  String scanner_moreUniqueQr(int count);

  /// No description provided for @scanner_candidates.
  ///
  /// In en, this message translates to:
  /// **'Candidates'**
  String get scanner_candidates;

  /// No description provided for @scanner_unseen.
  ///
  /// In en, this message translates to:
  /// **'Unseen'**
  String get scanner_unseen;

  /// No description provided for @scanner_chunkComplete.
  ///
  /// In en, this message translates to:
  /// **'Complete'**
  String get scanner_chunkComplete;

  /// No description provided for @scanner_chunkReady.
  ///
  /// In en, this message translates to:
  /// **'Ready'**
  String get scanner_chunkReady;

  /// No description provided for @scanner_chunkScanning.
  ///
  /// In en, this message translates to:
  /// **'Scanning'**
  String get scanner_chunkScanning;

  /// No description provided for @scanner_chunkMissing.
  ///
  /// In en, this message translates to:
  /// **'Missing'**
  String get scanner_chunkMissing;

  /// No description provided for @scanner_backCamera.
  ///
  /// In en, this message translates to:
  /// **'Back Camera'**
  String get scanner_backCamera;

  /// No description provided for @scanner_frontCamera.
  ///
  /// In en, this message translates to:
  /// **'Front Camera'**
  String get scanner_frontCamera;

  /// No description provided for @scanner_helpConfirm.
  ///
  /// In en, this message translates to:
  /// **'Got it'**
  String get scanner_helpConfirm;

  /// No description provided for @scanner_currentChunk.
  ///
  /// In en, this message translates to:
  /// **'Chunk {current}/{total}'**
  String scanner_currentChunk(int current, int total);

  /// No description provided for @scanner_total.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get scanner_total;

  /// No description provided for @scanner_receiving.
  ///
  /// In en, this message translates to:
  /// **'Receiving: {percent}%'**
  String scanner_receiving(int percent);

  /// No description provided for @scanner_selectCamera.
  ///
  /// In en, this message translates to:
  /// **'Select Camera'**
  String get scanner_selectCamera;

  /// No description provided for @scanner_camera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get scanner_camera;

  /// No description provided for @scanner_torchOn.
  ///
  /// In en, this message translates to:
  /// **'Turn on flashlight'**
  String get scanner_torchOn;

  /// No description provided for @scanner_torchOff.
  ///
  /// In en, this message translates to:
  /// **'Turn off flashlight'**
  String get scanner_torchOff;

  /// No description provided for @scanner_help.
  ///
  /// In en, this message translates to:
  /// **'Help'**
  String get scanner_help;

  /// No description provided for @scanner_helpTitle.
  ///
  /// In en, this message translates to:
  /// **'Scanning Tips'**
  String get scanner_helpTitle;

  /// No description provided for @scanner_helpTip_positioning.
  ///
  /// In en, this message translates to:
  /// **'Position the QR Code'**
  String get scanner_helpTip_positioning;

  /// No description provided for @scanner_helpTip_positioningDesc.
  ///
  /// In en, this message translates to:
  /// **'Center the animated QR code in the camera view. Keep a stable distance of 15-25cm for best results.'**
  String get scanner_helpTip_positioningDesc;

  /// No description provided for @scanner_helpTip_lighting.
  ///
  /// In en, this message translates to:
  /// **'Good Lighting'**
  String get scanner_helpTip_lighting;

  /// No description provided for @scanner_helpTip_lightingDesc.
  ///
  /// In en, this message translates to:
  /// **'Ensure adequate lighting on the QR code. Avoid reflections and direct glare on the screen.'**
  String get scanner_helpTip_lightingDesc;

  /// No description provided for @scanner_helpTip_torch.
  ///
  /// In en, this message translates to:
  /// **'Use the Flashlight'**
  String get scanner_helpTip_torch;

  /// No description provided for @scanner_helpTip_torchDesc.
  ///
  /// In en, this message translates to:
  /// **'In low light conditions, tap the flashlight button to illuminate the QR code.'**
  String get scanner_helpTip_torchDesc;

  /// No description provided for @scanner_helpTip_speed.
  ///
  /// In en, this message translates to:
  /// **'Stay Steady'**
  String get scanner_helpTip_speed;

  /// No description provided for @scanner_helpTip_speedDesc.
  ///
  /// In en, this message translates to:
  /// **'Keep your phone steady while scanning. The decoder needs time to capture all frames.'**
  String get scanner_helpTip_speedDesc;

  /// No description provided for @scanner_receiveComplete.
  ///
  /// In en, this message translates to:
  /// **'Receive complete!'**
  String get scanner_receiveComplete;

  /// No description provided for @scanner_noteReceived.
  ///
  /// In en, this message translates to:
  /// **'Note received'**
  String get scanner_noteReceived;

  /// No description provided for @scanner_noteCopied.
  ///
  /// In en, this message translates to:
  /// **'Note copied'**
  String get scanner_noteCopied;

  /// No description provided for @scanner_fileSaved.
  ///
  /// In en, this message translates to:
  /// **'File saved'**
  String get scanner_fileSaved;

  /// No description provided for @scanner_progressLabel.
  ///
  /// In en, this message translates to:
  /// **'{scanned}/{minRequired}'**
  String scanner_progressLabel(int scanned, int minRequired);

  /// No description provided for @scanner_paused.
  ///
  /// In en, this message translates to:
  /// **'Paused'**
  String get scanner_paused;

  /// No description provided for @scanner_scanAnother.
  ///
  /// In en, this message translates to:
  /// **'Scan Another'**
  String get scanner_scanAnother;

  /// No description provided for @scanner_resumingWithPackets.
  ///
  /// In en, this message translates to:
  /// **'Resuming scan... ({count} packets loaded)'**
  String scanner_resumingWithPackets(int count);

  /// No description provided for @scanner_resumingProgress.
  ///
  /// In en, this message translates to:
  /// **'Resuming: {percent}% ({received}/{expected})'**
  String scanner_resumingProgress(String percent, int received, int expected);

  /// No description provided for @scanner_completed.
  ///
  /// In en, this message translates to:
  /// **'Completed! {filename}\nTime: {time} | Size: {size} KB\nFrames: {frames}'**
  String scanner_completed(
    String filename,
    String time,
    String size,
    int frames,
  );

  /// No description provided for @scanner_resumedTapPlay.
  ///
  /// In en, this message translates to:
  /// **'Resumed {received}/{expected} - Tap play to continue'**
  String scanner_resumedTapPlay(int received, int expected);

  /// No description provided for @scanner_presetActive.
  ///
  /// In en, this message translates to:
  /// **'Preset: {name}'**
  String scanner_presetActive(String name);

  /// No description provided for @scanner_errorProcessing.
  ///
  /// In en, this message translates to:
  /// **'Error processing chunk: {error}'**
  String scanner_errorProcessing(String error);

  /// No description provided for @scanner_progressDetails.
  ///
  /// In en, this message translates to:
  /// **'Progress: {percent}% ({received}/{expected})\nScan Rate: {fps} FPS'**
  String scanner_progressDetails(
    String percent,
    int received,
    int expected,
    int fps,
  );

  /// No description provided for @scanner_errorMsg.
  ///
  /// In en, this message translates to:
  /// **'Error: {msg}'**
  String scanner_errorMsg(String msg);

  /// No description provided for @scanner_errorSaving.
  ///
  /// In en, this message translates to:
  /// **'Error saving: {error}'**
  String scanner_errorSaving(String error);

  /// No description provided for @scanner_fileSavedAs.
  ///
  /// In en, this message translates to:
  /// **'File saved: {name}'**
  String scanner_fileSavedAs(String name);

  /// No description provided for @history_title.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get history_title;

  /// No description provided for @history_all.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get history_all;

  /// No description provided for @history_scanned.
  ///
  /// In en, this message translates to:
  /// **'Scanned'**
  String get history_scanned;

  /// No description provided for @history_generated.
  ///
  /// In en, this message translates to:
  /// **'Generated'**
  String get history_generated;

  /// No description provided for @history_searchHistory.
  ///
  /// In en, this message translates to:
  /// **'Search history'**
  String get history_searchHistory;

  /// No description provided for @history_searchFiles.
  ///
  /// In en, this message translates to:
  /// **'Search files...'**
  String get history_searchFiles;

  /// No description provided for @history_clearSearch.
  ///
  /// In en, this message translates to:
  /// **'Clear search'**
  String get history_clearSearch;

  /// No description provided for @history_refresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get history_refresh;

  /// No description provided for @history_connected.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get history_connected;

  /// No description provided for @history_keepLocal.
  ///
  /// In en, this message translates to:
  /// **'Keep local'**
  String get history_keepLocal;

  /// No description provided for @history_syncToServer.
  ///
  /// In en, this message translates to:
  /// **'Sync local history to server'**
  String get history_syncToServer;

  /// No description provided for @history_incompleteScans.
  ///
  /// In en, this message translates to:
  /// **'INCOMPLETE SCANS'**
  String get history_incompleteScans;

  /// No description provided for @history_scanItem.
  ///
  /// In en, this message translates to:
  /// **'Scan {index}'**
  String history_scanItem(String index);

  /// No description provided for @history_chunksProgress.
  ///
  /// In en, this message translates to:
  /// **'Chunks: {current}/{total} • Frames: {frames}/{totalFrames}'**
  String history_chunksProgress(
    int current,
    int total,
    int frames,
    int totalFrames,
  );

  /// No description provided for @history_resumeScan.
  ///
  /// In en, this message translates to:
  /// **'Resume scan'**
  String get history_resumeScan;

  /// No description provided for @history_deleteIncomplete.
  ///
  /// In en, this message translates to:
  /// **'Delete incomplete scan'**
  String get history_deleteIncomplete;

  /// No description provided for @history_viewGif.
  ///
  /// In en, this message translates to:
  /// **'View GIF'**
  String get history_viewGif;

  /// No description provided for @history_zipArchive.
  ///
  /// In en, this message translates to:
  /// **'ZIP Archive'**
  String get history_zipArchive;

  /// No description provided for @history_noGifFound.
  ///
  /// In en, this message translates to:
  /// **'No GIF files found'**
  String get history_noGifFound;

  /// No description provided for @history_exitFullscreen.
  ///
  /// In en, this message translates to:
  /// **'Exit fullscreen'**
  String get history_exitFullscreen;

  /// No description provided for @history_fullscreen.
  ///
  /// In en, this message translates to:
  /// **'Fullscreen'**
  String get history_fullscreen;

  /// No description provided for @history_multiChunkView.
  ///
  /// In en, this message translates to:
  /// **'Multi-Chunk View ({count} chunks)'**
  String history_multiChunkView(int count);

  /// No description provided for @history_columns.
  ///
  /// In en, this message translates to:
  /// **'Columns:'**
  String get history_columns;

  /// No description provided for @history_zoom.
  ///
  /// In en, this message translates to:
  /// **'Zoom:'**
  String get history_zoom;

  /// No description provided for @history_select.
  ///
  /// In en, this message translates to:
  /// **'Select'**
  String get history_select;

  /// No description provided for @history_noFilesScanned.
  ///
  /// In en, this message translates to:
  /// **'No files received yet'**
  String get history_noFilesScanned;

  /// No description provided for @history_noFilesGenerated.
  ///
  /// In en, this message translates to:
  /// **'No files generated yet'**
  String get history_noFilesGenerated;

  /// No description provided for @history_deleteFileTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete file?'**
  String get history_deleteFileTitle;

  /// No description provided for @history_deleteFileConfirm.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to delete \"{filename}\"?'**
  String history_deleteFileConfirm(String filename);

  /// No description provided for @history_localOnly.
  ///
  /// In en, this message translates to:
  /// **'\"{filename}\" is now stored locally only'**
  String history_localOnly(String filename);

  /// No description provided for @history_syncNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'Sync is not configured'**
  String get history_syncNotConfigured;

  /// No description provided for @history_fileNotFound.
  ///
  /// In en, this message translates to:
  /// **'File not found'**
  String get history_fileNotFound;

  /// No description provided for @history_syncQueued.
  ///
  /// In en, this message translates to:
  /// **'\"{filename}\" queued for sync'**
  String history_syncQueued(String filename);

  /// No description provided for @history_syncFailed.
  ///
  /// In en, this message translates to:
  /// **'Sync failed: {error}'**
  String history_syncFailed(String error);

  /// No description provided for @history_scanCompleted.
  ///
  /// In en, this message translates to:
  /// **'Scan completed: {filename}'**
  String history_scanCompleted(String filename);

  /// No description provided for @history_packets.
  ///
  /// In en, this message translates to:
  /// **'{received}/{expected} packets'**
  String history_packets(int received, int expected);

  /// No description provided for @history_serverSyncPackets.
  ///
  /// In en, this message translates to:
  /// **'Server sync: {received}/{expected} packets'**
  String history_serverSyncPackets(int received, int expected);

  /// No description provided for @history_sharedFromAirQR.
  ///
  /// In en, this message translates to:
  /// **'Shared from AirQR History'**
  String get history_sharedFromAirQR;

  /// No description provided for @settings_title.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings_title;

  /// No description provided for @settings_encoderSection.
  ///
  /// In en, this message translates to:
  /// **'ENCODER'**
  String get settings_encoderSection;

  /// No description provided for @settings_slowFps.
  ///
  /// In en, this message translates to:
  /// **'Slow (1)'**
  String get settings_slowFps;

  /// No description provided for @settings_fastFps.
  ///
  /// In en, this message translates to:
  /// **'Fast (60)'**
  String get settings_fastFps;

  /// No description provided for @settings_smallPacket.
  ///
  /// In en, this message translates to:
  /// **'Small (100)'**
  String get settings_smallPacket;

  /// No description provided for @settings_largePacket.
  ///
  /// In en, this message translates to:
  /// **'Large (2800)'**
  String get settings_largePacket;

  /// No description provided for @settings_frameRate.
  ///
  /// In en, this message translates to:
  /// **'Frame Rate (FPS)'**
  String get settings_frameRate;

  /// No description provided for @settings_packetSize.
  ///
  /// In en, this message translates to:
  /// **'Packet Size'**
  String get settings_packetSize;

  /// No description provided for @settings_overhead.
  ///
  /// In en, this message translates to:
  /// **'Overhead'**
  String get settings_overhead;

  /// No description provided for @settings_scannerSection.
  ///
  /// In en, this message translates to:
  /// **'SCANNER'**
  String get settings_scannerSection;

  /// No description provided for @settings_scannerPresetSection.
  ///
  /// In en, this message translates to:
  /// **'SCANNER PRESET'**
  String get settings_scannerPresetSection;

  /// No description provided for @settings_scannerAdvancedSection.
  ///
  /// In en, this message translates to:
  /// **'SCANNER ADVANCED'**
  String get settings_scannerAdvancedSection;

  /// No description provided for @settings_preset.
  ///
  /// In en, this message translates to:
  /// **'Preset'**
  String get settings_preset;

  /// No description provided for @settings_preset_turbo.
  ///
  /// In en, this message translates to:
  /// **'Turbo'**
  String get settings_preset_turbo;

  /// No description provided for @settings_preset_turboDesc.
  ///
  /// In en, this message translates to:
  /// **'Maximum speed, lower accuracy'**
  String get settings_preset_turboDesc;

  /// No description provided for @settings_preset_fast.
  ///
  /// In en, this message translates to:
  /// **'Fast'**
  String get settings_preset_fast;

  /// No description provided for @settings_preset_fastDesc.
  ///
  /// In en, this message translates to:
  /// **'Fast scanning, good balance'**
  String get settings_preset_fastDesc;

  /// No description provided for @settings_preset_balanced.
  ///
  /// In en, this message translates to:
  /// **'Balanced'**
  String get settings_preset_balanced;

  /// No description provided for @settings_preset_balancedDesc.
  ///
  /// In en, this message translates to:
  /// **'Recommended for most cases'**
  String get settings_preset_balancedDesc;

  /// No description provided for @settings_preset_reliable.
  ///
  /// In en, this message translates to:
  /// **'Reliable'**
  String get settings_preset_reliable;

  /// No description provided for @settings_preset_reliableDesc.
  ///
  /// In en, this message translates to:
  /// **'Best accuracy, slower'**
  String get settings_preset_reliableDesc;

  /// No description provided for @settings_preset_silent.
  ///
  /// In en, this message translates to:
  /// **'Silent'**
  String get settings_preset_silent;

  /// No description provided for @settings_preset_silentDesc.
  ///
  /// In en, this message translates to:
  /// **'No sounds or vibrations'**
  String get settings_preset_silentDesc;

  /// No description provided for @settings_preset_custom.
  ///
  /// In en, this message translates to:
  /// **'Custom'**
  String get settings_preset_custom;

  /// No description provided for @settings_preset_customDesc.
  ///
  /// In en, this message translates to:
  /// **'Your custom settings'**
  String get settings_preset_customDesc;

  /// No description provided for @settings_customModeHint.
  ///
  /// In en, this message translates to:
  /// **'Modifying these settings will switch to \"Custom\" mode.'**
  String get settings_customModeHint;

  /// No description provided for @settings_scanInterval.
  ///
  /// In en, this message translates to:
  /// **'Scan Interval'**
  String get settings_scanInterval;

  /// No description provided for @settings_maxSpeed.
  ///
  /// In en, this message translates to:
  /// **'Max speed (0ms)'**
  String get settings_maxSpeed;

  /// No description provided for @settings_batterySaver.
  ///
  /// In en, this message translates to:
  /// **'Battery saver (500ms)'**
  String get settings_batterySaver;

  /// No description provided for @settings_resolution.
  ///
  /// In en, this message translates to:
  /// **'Resolution'**
  String get settings_resolution;

  /// No description provided for @settings_detectionSpeed.
  ///
  /// In en, this message translates to:
  /// **'Detection Speed'**
  String get settings_detectionSpeed;

  /// No description provided for @settings_fast.
  ///
  /// In en, this message translates to:
  /// **'Fast'**
  String get settings_fast;

  /// No description provided for @settings_accurate.
  ///
  /// In en, this message translates to:
  /// **'Accurate'**
  String get settings_accurate;

  /// No description provided for @settings_accurateModeHint.
  ///
  /// In en, this message translates to:
  /// **'Accurate mode improves detection in noisy frames but uses more CPU.'**
  String get settings_accurateModeHint;

  /// No description provided for @settings_torch.
  ///
  /// In en, this message translates to:
  /// **'Torch'**
  String get settings_torch;

  /// No description provided for @settings_torchDesc.
  ///
  /// In en, this message translates to:
  /// **'Enable the camera flashlight if supported'**
  String get settings_torchDesc;

  /// No description provided for @settings_scannerTip.
  ///
  /// In en, this message translates to:
  /// **'For best results with scanner, please use the native application for your device.'**
  String get settings_scannerTip;

  /// No description provided for @settings_wakelock.
  ///
  /// In en, this message translates to:
  /// **'Wakelock'**
  String get settings_wakelock;

  /// No description provided for @settings_wakelockDesc.
  ///
  /// In en, this message translates to:
  /// **'Keep screen on during scanning'**
  String get settings_wakelockDesc;

  /// No description provided for @settings_scanMode.
  ///
  /// In en, this message translates to:
  /// **'Scan Mode'**
  String get settings_scanMode;

  /// No description provided for @settings_scanModeRealtime.
  ///
  /// In en, this message translates to:
  /// **'Realtime'**
  String get settings_scanModeRealtime;

  /// No description provided for @settings_scanModeRealtimeDesc.
  ///
  /// In en, this message translates to:
  /// **'Process each frame immediately (lower latency)'**
  String get settings_scanModeRealtimeDesc;

  /// No description provided for @settings_scanModeBatch.
  ///
  /// In en, this message translates to:
  /// **'Batch'**
  String get settings_scanModeBatch;

  /// No description provided for @settings_scanModeBatchDesc.
  ///
  /// In en, this message translates to:
  /// **'Collect frames then process (more reliable)'**
  String get settings_scanModeBatchDesc;

  /// No description provided for @settings_batchDelay.
  ///
  /// In en, this message translates to:
  /// **'Batch Delay (ms)'**
  String get settings_batchDelay;

  /// No description provided for @settings_maxCacheFrames.
  ///
  /// In en, this message translates to:
  /// **'Max Cache Frames'**
  String get settings_maxCacheFrames;

  /// No description provided for @settings_unknownResolution.
  ///
  /// In en, this message translates to:
  /// **'Unknown resolution'**
  String get settings_unknownResolution;

  /// No description provided for @settings_detectionTimeout.
  ///
  /// In en, this message translates to:
  /// **'Detection Timeout'**
  String get settings_detectionTimeout;

  /// No description provided for @settings_detectionNormal.
  ///
  /// In en, this message translates to:
  /// **'Normal'**
  String get settings_detectionNormal;

  /// No description provided for @settings_detectionNoDuplicates.
  ///
  /// In en, this message translates to:
  /// **'No Duplicates'**
  String get settings_detectionNoDuplicates;

  /// No description provided for @settings_detectionUnrestricted.
  ///
  /// In en, this message translates to:
  /// **'Unrestricted'**
  String get settings_detectionUnrestricted;

  /// No description provided for @settings_torchFlash.
  ///
  /// In en, this message translates to:
  /// **'Torch (Flash)'**
  String get settings_torchFlash;

  /// No description provided for @settings_torchFlashDesc.
  ///
  /// In en, this message translates to:
  /// **'Enable for low light'**
  String get settings_torchFlashDesc;

  /// No description provided for @settings_syncScannedFiles.
  ///
  /// In en, this message translates to:
  /// **'Sync Scanned Files'**
  String get settings_syncScannedFiles;

  /// No description provided for @settings_syncScannedFilesDesc.
  ///
  /// In en, this message translates to:
  /// **'Upload scanned files to server'**
  String get settings_syncScannedFilesDesc;

  /// No description provided for @settings_syncGeneratedFiles.
  ///
  /// In en, this message translates to:
  /// **'Sync Generated Files'**
  String get settings_syncGeneratedFiles;

  /// No description provided for @settings_syncGeneratedFilesDesc.
  ///
  /// In en, this message translates to:
  /// **'Upload generated GIFs to server'**
  String get settings_syncGeneratedFilesDesc;

  /// No description provided for @settings_autoSyncShort.
  ///
  /// In en, this message translates to:
  /// **'Auto Sync'**
  String get settings_autoSyncShort;

  /// No description provided for @settings_autoSyncShortDesc.
  ///
  /// In en, this message translates to:
  /// **'Sync automatically after scan/generate'**
  String get settings_autoSyncShortDesc;

  /// No description provided for @settings_poweredBy.
  ///
  /// In en, this message translates to:
  /// **'Powered by RaptorQ fountain codes'**
  String get settings_poweredBy;

  /// No description provided for @settings_serverSyncSection.
  ///
  /// In en, this message translates to:
  /// **'SERVER SYNC'**
  String get settings_serverSyncSection;

  /// No description provided for @settings_enableSync.
  ///
  /// In en, this message translates to:
  /// **'Enable server sync'**
  String get settings_enableSync;

  /// No description provided for @settings_enableSyncDesc.
  ///
  /// In en, this message translates to:
  /// **'Sync history across devices and resume scans.'**
  String get settings_enableSyncDesc;

  /// No description provided for @settings_syncScanned.
  ///
  /// In en, this message translates to:
  /// **'Sync scanned history'**
  String get settings_syncScanned;

  /// No description provided for @settings_syncScannedDesc.
  ///
  /// In en, this message translates to:
  /// **'Upload scan packets and show remote scan history.'**
  String get settings_syncScannedDesc;

  /// No description provided for @settings_syncGenerated.
  ///
  /// In en, this message translates to:
  /// **'Sync generated history'**
  String get settings_syncGenerated;

  /// No description provided for @settings_syncGeneratedDesc.
  ///
  /// In en, this message translates to:
  /// **'Upload generated QR files to the server.'**
  String get settings_syncGeneratedDesc;

  /// No description provided for @settings_autoSync.
  ///
  /// In en, this message translates to:
  /// **'Auto-sync history'**
  String get settings_autoSync;

  /// No description provided for @settings_autoSyncDesc.
  ///
  /// In en, this message translates to:
  /// **'Automatically upload local scanned and generated items to the server.'**
  String get settings_autoSyncDesc;

  /// No description provided for @settings_testConnection.
  ///
  /// In en, this message translates to:
  /// **'Connection'**
  String get settings_testConnection;

  /// No description provided for @settings_testingConnection.
  ///
  /// In en, this message translates to:
  /// **'Connecting...'**
  String get settings_testingConnection;

  /// No description provided for @settings_syncNow.
  ///
  /// In en, this message translates to:
  /// **'Sync'**
  String get settings_syncNow;

  /// No description provided for @settings_syncing.
  ///
  /// In en, this message translates to:
  /// **'Syncing...'**
  String get settings_syncing;

  /// No description provided for @settings_localServerTitle.
  ///
  /// In en, this message translates to:
  /// **'Local server'**
  String get settings_localServerTitle;

  /// No description provided for @settings_localServerDesc.
  ///
  /// In en, this message translates to:
  /// **'Start the built-in sync server from this app.'**
  String get settings_localServerDesc;

  /// No description provided for @settings_localServerDesktopOnly.
  ///
  /// In en, this message translates to:
  /// **'Local server launch is available on desktop only.'**
  String get settings_localServerDesktopOnly;

  /// No description provided for @settings_localServerRunningOn.
  ///
  /// In en, this message translates to:
  /// **'Running on {serverUrl}'**
  String settings_localServerRunningOn(Object serverUrl);

  /// No description provided for @settings_launchLocalServer.
  ///
  /// In en, this message translates to:
  /// **'Launch local server'**
  String get settings_launchLocalServer;

  /// No description provided for @settings_localServerRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get settings_localServerRunning;

  /// No description provided for @settings_stopLocalServer.
  ///
  /// In en, this message translates to:
  /// **'Stop server'**
  String get settings_stopLocalServer;

  /// No description provided for @settings_localServerStopped.
  ///
  /// In en, this message translates to:
  /// **'Local server stopped.'**
  String get settings_localServerStopped;

  /// No description provided for @settings_localServerStarting.
  ///
  /// In en, this message translates to:
  /// **'Starting...'**
  String get settings_localServerStarting;

  /// No description provided for @settings_localServerDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Launch local server'**
  String get settings_localServerDialogTitle;

  /// No description provided for @settings_startServer.
  ///
  /// In en, this message translates to:
  /// **'Start server'**
  String get settings_startServer;

  /// No description provided for @settings_localServerPort.
  ///
  /// In en, this message translates to:
  /// **'Port'**
  String get settings_localServerPort;

  /// No description provided for @settings_connectionSuccess.
  ///
  /// In en, this message translates to:
  /// **'Connected!'**
  String get settings_connectionSuccess;

  /// No description provided for @settings_offlineWebTitle.
  ///
  /// In en, this message translates to:
  /// **'Offline web app'**
  String get settings_offlineWebTitle;

  /// No description provided for @settings_offlineWebMenuDesc.
  ///
  /// In en, this message translates to:
  /// **'Serve encoder and decoder on your network'**
  String get settings_offlineWebMenuDesc;

  /// No description provided for @settings_offlineWebDesc.
  ///
  /// In en, this message translates to:
  /// **'Start the bundled AirQR web app so another device on this network can open encoder and decoder in a browser.'**
  String get settings_offlineWebDesc;

  /// No description provided for @settings_startOfflineWeb.
  ///
  /// In en, this message translates to:
  /// **'Start offline web app'**
  String get settings_startOfflineWeb;

  /// No description provided for @settings_stopOfflineWeb.
  ///
  /// In en, this message translates to:
  /// **'Stop offline web app'**
  String get settings_stopOfflineWeb;

  /// No description provided for @settings_offlineWebStarting.
  ///
  /// In en, this message translates to:
  /// **'Starting...'**
  String get settings_offlineWebStarting;

  /// No description provided for @settings_offlineWebRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get settings_offlineWebRunning;

  /// No description provided for @settings_offlineWebStoppedStatus.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get settings_offlineWebStoppedStatus;

  /// No description provided for @settings_offlineWebStopped.
  ///
  /// In en, this message translates to:
  /// **'Offline web app stopped.'**
  String get settings_offlineWebStopped;

  /// No description provided for @settings_offlineWebNoUrl.
  ///
  /// In en, this message translates to:
  /// **'Start the server to get a network URL.'**
  String get settings_offlineWebNoUrl;

  /// No description provided for @settings_offlineWebCopied.
  ///
  /// In en, this message translates to:
  /// **'Offline web app URL copied'**
  String get settings_offlineWebCopied;

  /// No description provided for @settings_offlineWebStartFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not start offline web app server.'**
  String get settings_offlineWebStartFailed;

  /// No description provided for @settings_offlineWebRunningOn.
  ///
  /// In en, this message translates to:
  /// **'Available at {serverUrl}'**
  String settings_offlineWebRunningOn(Object serverUrl);

  /// No description provided for @settings_offlineWebMoreUrls.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one {1 other network URL available} other {{count} other network URLs available}}'**
  String settings_offlineWebMoreUrls(int count);

  /// No description provided for @settings_fileExportSection.
  ///
  /// In en, this message translates to:
  /// **'FILE EXPORT (SERVER)'**
  String get settings_fileExportSection;

  /// No description provided for @settings_fileExportDesc.
  ///
  /// In en, this message translates to:
  /// **'Configure where the server saves received files. Files are organized in folders by date (YYYY-MM-DD).'**
  String get settings_fileExportDesc;

  /// No description provided for @settings_enableExport.
  ///
  /// In en, this message translates to:
  /// **'Enable file export'**
  String get settings_enableExport;

  /// No description provided for @settings_enableExportDesc.
  ///
  /// In en, this message translates to:
  /// **'Save received files to the configured directory.'**
  String get settings_enableExportDesc;

  /// No description provided for @settings_exportScanned.
  ///
  /// In en, this message translates to:
  /// **'Export scanned files'**
  String get settings_exportScanned;

  /// No description provided for @settings_exportScannedDesc.
  ///
  /// In en, this message translates to:
  /// **'Save files received from QR code scanning.'**
  String get settings_exportScannedDesc;

  /// No description provided for @settings_exportGenerated.
  ///
  /// In en, this message translates to:
  /// **'Export generated files'**
  String get settings_exportGenerated;

  /// No description provided for @settings_exportGeneratedDesc.
  ///
  /// In en, this message translates to:
  /// **'Save generated QR code files.'**
  String get settings_exportGeneratedDesc;

  /// No description provided for @settings_exportDirectory.
  ///
  /// In en, this message translates to:
  /// **'Export Directory (PC or NAS path)'**
  String get settings_exportDirectory;

  /// No description provided for @settings_exportDirectoryPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'C:\\AirQR-Files or \\\\NAS\\share\\AirQR'**
  String get settings_exportDirectoryPlaceholder;

  /// No description provided for @settings_exportDirectoryHint.
  ///
  /// In en, this message translates to:
  /// **'Path on the server machine. Use UNC path (\\\\NAS\\share) for network drives.'**
  String get settings_exportDirectoryHint;

  /// No description provided for @settings_pathWarning.
  ///
  /// In en, this message translates to:
  /// **'Path saved but not accessible yet:'**
  String get settings_pathWarning;

  /// No description provided for @settings_pathReady.
  ///
  /// In en, this message translates to:
  /// **'Export path ready:'**
  String get settings_pathReady;

  /// No description provided for @settings_configSaved.
  ///
  /// In en, this message translates to:
  /// **'Configuration saved!'**
  String get settings_configSaved;

  /// No description provided for @settings_syncSuccess.
  ///
  /// In en, this message translates to:
  /// **'Synced: {uploaded} up, {downloaded} down'**
  String settings_syncSuccess(int uploaded, int downloaded);

  /// No description provided for @settings_serverUrl.
  ///
  /// In en, this message translates to:
  /// **'Server URL'**
  String get settings_serverUrl;

  /// No description provided for @settings_serverUrlHint.
  ///
  /// In en, this message translates to:
  /// **'Sends packets to /api/scan/packet'**
  String get settings_serverUrlHint;

  /// No description provided for @settings_username.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get settings_username;

  /// No description provided for @settings_password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get settings_password;

  /// No description provided for @settings_apiKey.
  ///
  /// In en, this message translates to:
  /// **'API Key (optional)'**
  String get settings_apiKey;

  /// No description provided for @settings_optional.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get settings_optional;

  /// No description provided for @settings_deviceName.
  ///
  /// In en, this message translates to:
  /// **'Device Name'**
  String get settings_deviceName;

  /// No description provided for @settings_deviceNameHint.
  ///
  /// In en, this message translates to:
  /// **'Name to identify this device on the server'**
  String get settings_deviceNameHint;

  /// No description provided for @settings_appearanceSection.
  ///
  /// In en, this message translates to:
  /// **'APPEARANCE'**
  String get settings_appearanceSection;

  /// No description provided for @settings_language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settings_language;

  /// No description provided for @settings_languageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get settings_languageEnglish;

  /// No description provided for @settings_languageFrench.
  ///
  /// In en, this message translates to:
  /// **'Français'**
  String get settings_languageFrench;

  /// No description provided for @settings_languageSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settings_languageSystem;

  /// No description provided for @settings_defaultCamera.
  ///
  /// In en, this message translates to:
  /// **'Default Camera'**
  String get settings_defaultCamera;

  /// No description provided for @settings_defaultCameraDesc.
  ///
  /// In en, this message translates to:
  /// **'Camera to use by default when opening the scanner'**
  String get settings_defaultCameraDesc;

  /// No description provided for @settings_selectDefaultCamera.
  ///
  /// In en, this message translates to:
  /// **'Select a camera'**
  String get settings_selectDefaultCamera;

  /// No description provided for @settings_noCameraDetected.
  ///
  /// In en, this message translates to:
  /// **'No camera detected'**
  String get settings_noCameraDetected;

  /// No description provided for @settings_theme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get settings_theme;

  /// No description provided for @settings_themeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settings_themeLight;

  /// No description provided for @settings_themeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settings_themeDark;

  /// No description provided for @settings_themeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settings_themeSystem;

  /// No description provided for @settings_clearData.
  ///
  /// In en, this message translates to:
  /// **'Clear All App Data'**
  String get settings_clearData;

  /// No description provided for @settings_clearDataConfirm.
  ///
  /// In en, this message translates to:
  /// **'This will clear all app data including history, settings, and cached files. Continue?'**
  String get settings_clearDataConfirm;

  /// No description provided for @settings_clearDataFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to clear app data'**
  String get settings_clearDataFailed;

  /// No description provided for @settings_aboutSection.
  ///
  /// In en, this message translates to:
  /// **'ABOUT'**
  String get settings_aboutSection;

  /// No description provided for @settings_appName.
  ///
  /// In en, this message translates to:
  /// **'AirQR Mobile'**
  String get settings_appName;

  /// No description provided for @settings_appDescription.
  ///
  /// In en, this message translates to:
  /// **'Air-gapped file transfer using animated QR codes'**
  String get settings_appDescription;

  /// No description provided for @settings_madeWith.
  ///
  /// In en, this message translates to:
  /// **'Made with ❤️ by'**
  String get settings_madeWith;

  /// No description provided for @settings_starOnGithub.
  ///
  /// In en, this message translates to:
  /// **'Star on GitHub'**
  String get settings_starOnGithub;

  /// No description provided for @settings_version.
  ///
  /// In en, this message translates to:
  /// **'Version'**
  String get settings_version;

  /// No description provided for @errors_cameraAccessDenied.
  ///
  /// In en, this message translates to:
  /// **'Camera access denied or unavailable'**
  String get errors_cameraAccessDenied;

  /// No description provided for @errors_fileTooLarge.
  ///
  /// In en, this message translates to:
  /// **'File is too large to process'**
  String get errors_fileTooLarge;

  /// No description provided for @errors_invalidFileType.
  ///
  /// In en, this message translates to:
  /// **'Invalid file type. Please select a valid file.'**
  String get errors_invalidFileType;

  /// No description provided for @errors_encodingFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to encode file to QR codes'**
  String get errors_encodingFailed;

  /// No description provided for @errors_decodingFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to decode QR codes'**
  String get errors_decodingFailed;

  /// No description provided for @errors_fileSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to save file'**
  String get errors_fileSaveFailed;

  /// No description provided for @errors_invalidServerUrl.
  ///
  /// In en, this message translates to:
  /// **'Invalid server URL'**
  String get errors_invalidServerUrl;

  /// No description provided for @errors_serverError.
  ///
  /// In en, this message translates to:
  /// **'Server error: {status}'**
  String errors_serverError(String status);

  /// No description provided for @errors_connectionFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not connect to server'**
  String get errors_connectionFailed;

  /// No description provided for @errors_zipFolderFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to zip folder: {error}'**
  String errors_zipFolderFailed(String error);

  /// No description provided for @errors_unsupportedFormat.
  ///
  /// In en, this message translates to:
  /// **'Unsupported file format. Use .gif or .zip'**
  String get errors_unsupportedFormat;

  /// No description provided for @errors_nativeInitFailed.
  ///
  /// In en, this message translates to:
  /// **'Native Library Init Failed'**
  String get errors_nativeInitFailed;

  /// No description provided for @errors_chunkEncodingFailed.
  ///
  /// In en, this message translates to:
  /// **'Chunked encoding failed'**
  String get errors_chunkEncodingFailed;

  /// No description provided for @encoder_targetSizePx.
  ///
  /// In en, this message translates to:
  /// **'Target Size (px)'**
  String get encoder_targetSizePx;

  /// No description provided for @encoder_overheadValue.
  ///
  /// In en, this message translates to:
  /// **'Overhead ({value})'**
  String encoder_overheadValue(String value);

  /// No description provided for @encoder_enableCompression.
  ///
  /// In en, this message translates to:
  /// **'Enable Compression'**
  String get encoder_enableCompression;

  /// No description provided for @encoder_enableCompressionDesc.
  ///
  /// In en, this message translates to:
  /// **'Compress data with ZIP (smaller size)'**
  String get encoder_enableCompressionDesc;

  /// No description provided for @history_errorSaving.
  ///
  /// In en, this message translates to:
  /// **'Error saving file: {error}'**
  String history_errorSaving(String error);

  /// No description provided for @decoder_decoding.
  ///
  /// In en, this message translates to:
  /// **'Decoding...'**
  String get decoder_decoding;

  /// No description provided for @decoder_selectGifFile.
  ///
  /// In en, this message translates to:
  /// **'Select a GIF file to decode'**
  String get decoder_selectGifFile;

  /// No description provided for @settings_serverConnected.
  ///
  /// In en, this message translates to:
  /// **'CONNECTED'**
  String get settings_serverConnected;

  /// No description provided for @settings_serverUnavailable.
  ///
  /// In en, this message translates to:
  /// **'UNAVAILABLE'**
  String get settings_serverUnavailable;

  /// No description provided for @settings_loggingSection.
  ///
  /// In en, this message translates to:
  /// **'LOGGING'**
  String get settings_loggingSection;

  /// No description provided for @settings_logLevel.
  ///
  /// In en, this message translates to:
  /// **'Log level'**
  String get settings_logLevel;

  /// No description provided for @settings_modules.
  ///
  /// In en, this message translates to:
  /// **'Modules'**
  String get settings_modules;

  /// No description provided for @settings_resetToDefaults.
  ///
  /// In en, this message translates to:
  /// **'Reset to defaults'**
  String get settings_resetToDefaults;

  /// No description provided for @settings_backToSettings.
  ///
  /// In en, this message translates to:
  /// **'Back to settings'**
  String get settings_backToSettings;

  /// No description provided for @settings_logDebug.
  ///
  /// In en, this message translates to:
  /// **'Debug'**
  String get settings_logDebug;

  /// No description provided for @settings_logInfo.
  ///
  /// In en, this message translates to:
  /// **'Info'**
  String get settings_logInfo;

  /// No description provided for @settings_logWarn.
  ///
  /// In en, this message translates to:
  /// **'Warn'**
  String get settings_logWarn;

  /// No description provided for @settings_logError.
  ///
  /// In en, this message translates to:
  /// **'Error'**
  String get settings_logError;

  /// No description provided for @settings_moduleServices.
  ///
  /// In en, this message translates to:
  /// **'Services'**
  String get settings_moduleServices;

  /// No description provided for @settings_moduleWorkers.
  ///
  /// In en, this message translates to:
  /// **'Workers'**
  String get settings_moduleWorkers;

  /// No description provided for @settings_moduleHooks.
  ///
  /// In en, this message translates to:
  /// **'Hooks'**
  String get settings_moduleHooks;

  /// No description provided for @settings_moduleScanner.
  ///
  /// In en, this message translates to:
  /// **'Scanner'**
  String get settings_moduleScanner;

  /// No description provided for @settings_moduleUi.
  ///
  /// In en, this message translates to:
  /// **'UI'**
  String get settings_moduleUi;

  /// No description provided for @settings_moduleApp.
  ///
  /// In en, this message translates to:
  /// **'App'**
  String get settings_moduleApp;

  /// No description provided for @settings_syncEnabled.
  ///
  /// In en, this message translates to:
  /// **'Sync: enabled'**
  String get settings_syncEnabled;

  /// No description provided for @settings_syncDisabled.
  ///
  /// In en, this message translates to:
  /// **'Sync: disabled'**
  String get settings_syncDisabled;

  /// No description provided for @settings_encoderMenu.
  ///
  /// In en, this message translates to:
  /// **'Encoder'**
  String get settings_encoderMenu;

  /// No description provided for @settings_scannerMenu.
  ///
  /// In en, this message translates to:
  /// **'Scanner'**
  String get settings_scannerMenu;

  /// No description provided for @settings_serverSyncMenu.
  ///
  /// In en, this message translates to:
  /// **'Server sync'**
  String get settings_serverSyncMenu;

  /// No description provided for @settings_appearanceMenu.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get settings_appearanceMenu;

  /// No description provided for @settings_loggingMenu.
  ///
  /// In en, this message translates to:
  /// **'Logging'**
  String get settings_loggingMenu;

  /// No description provided for @settings_aboutMenu.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get settings_aboutMenu;

  /// No description provided for @decoder_unknownError.
  ///
  /// In en, this message translates to:
  /// **'Unknown error'**
  String get decoder_unknownError;

  /// No description provided for @encoder_startAutomaticPlayback.
  ///
  /// In en, this message translates to:
  /// **'Start automatic playback'**
  String get encoder_startAutomaticPlayback;

  /// No description provided for @encoder_pauseAutomaticPlayback.
  ///
  /// In en, this message translates to:
  /// **'Pause automatic playback'**
  String get encoder_pauseAutomaticPlayback;

  /// No description provided for @encoder_playbackAutomatic.
  ///
  /// In en, this message translates to:
  /// **'AUTO'**
  String get encoder_playbackAutomatic;

  /// No description provided for @encoder_playbackFixed.
  ///
  /// In en, this message translates to:
  /// **'FIXED'**
  String get encoder_playbackFixed;

  /// No description provided for @encoder_openFullscreen.
  ///
  /// In en, this message translates to:
  /// **'Open fullscreen'**
  String get encoder_openFullscreen;

  /// No description provided for @encoder_previousChunk.
  ///
  /// In en, this message translates to:
  /// **'Previous chunk'**
  String get encoder_previousChunk;

  /// No description provided for @encoder_nextChunk.
  ///
  /// In en, this message translates to:
  /// **'Next chunk'**
  String get encoder_nextChunk;

  /// Current animated QR frame and minimum frame requirement
  ///
  /// In en, this message translates to:
  /// **'Frame: {current}/{total} (Min: {minimum})'**
  String encoder_frameProgress(int current, int total, int minimum);

  /// No description provided for @history_sort.
  ///
  /// In en, this message translates to:
  /// **'Sort'**
  String get history_sort;

  /// No description provided for @history_sortNewest.
  ///
  /// In en, this message translates to:
  /// **'Newest first'**
  String get history_sortNewest;

  /// No description provided for @history_sortOldest.
  ///
  /// In en, this message translates to:
  /// **'Oldest first'**
  String get history_sortOldest;

  /// No description provided for @history_sortLargest.
  ///
  /// In en, this message translates to:
  /// **'Largest first'**
  String get history_sortLargest;

  /// No description provided for @history_sortSmallest.
  ///
  /// In en, this message translates to:
  /// **'Smallest first'**
  String get history_sortSmallest;

  /// No description provided for @history_sortNameAscending.
  ///
  /// In en, this message translates to:
  /// **'Name A–Z'**
  String get history_sortNameAscending;

  /// No description provided for @history_sortNameDescending.
  ///
  /// In en, this message translates to:
  /// **'Name Z–A'**
  String get history_sortNameDescending;

  /// No description provided for @history_clearHistory.
  ///
  /// In en, this message translates to:
  /// **'Clear history'**
  String get history_clearHistory;

  /// No description provided for @history_clearHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Clear history?'**
  String get history_clearHistoryTitle;

  /// No description provided for @history_clearHistoryMessage.
  ///
  /// In en, this message translates to:
  /// **'All history files and incomplete scans will be deleted. Continue?'**
  String get history_clearHistoryMessage;

  /// No description provided for @history_previewOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open file preview.'**
  String get history_previewOpenFailed;

  /// No description provided for @history_previewOpenError.
  ///
  /// In en, this message translates to:
  /// **'Error opening file: {error}'**
  String history_previewOpenError(String error);

  /// No description provided for @settings_localServerStartFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not start local server.'**
  String get settings_localServerStartFailed;

  /// No description provided for @history_serverDeleteFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to delete on server.'**
  String get history_serverDeleteFailed;

  /// No description provided for @scanner_cameraListFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to list cameras: {error}'**
  String scanner_cameraListFailed(String error);

  /// No description provided for @scanner_cameraOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to open camera: {error}'**
  String scanner_cameraOpenFailed(String error);

  /// No description provided for @scanner_cameraOpenUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The camera could not be opened.'**
  String get scanner_cameraOpenUnavailable;

  /// No description provided for @scanner_cameraCaptureFailed.
  ///
  /// In en, this message translates to:
  /// **'Camera error: {error}'**
  String scanner_cameraCaptureFailed(String error);
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'fr'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'fr':
      return AppLocalizationsFr();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
