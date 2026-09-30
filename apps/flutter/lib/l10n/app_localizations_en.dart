// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get nav_encoder => 'Encoder';

  @override
  String get nav_decoder => 'Decoder';

  @override
  String get nav_scanner => 'Scanner';

  @override
  String get nav_history => 'History';

  @override
  String get nav_settings => 'Settings';

  @override
  String get common_loading => 'Loading...';

  @override
  String get common_error => 'Error';

  @override
  String get common_success => 'Success';

  @override
  String get common_cancel => 'Cancel';

  @override
  String get common_save => 'Save';

  @override
  String get common_delete => 'Delete';

  @override
  String get common_download => 'Download';

  @override
  String get common_copy => 'Copy';

  @override
  String get common_open => 'Open';

  @override
  String get common_upload => 'Upload';

  @override
  String get common_close => 'Close';

  @override
  String get common_yes => 'Yes';

  @override
  String get common_no => 'No';

  @override
  String get common_confirm => 'Confirm';

  @override
  String get common_back => 'Back';

  @override
  String get common_next => 'Next';

  @override
  String get common_reset => 'Reset';

  @override
  String get common_retry => 'Try again';

  @override
  String get common_clear => 'Clear';

  @override
  String get common_search => 'Search';

  @override
  String get common_noResults => 'No results';

  @override
  String get common_items => 'items';

  @override
  String get common_files => 'files';

  @override
  String get common_file => 'file';

  @override
  String get common_folder => 'folder';

  @override
  String get common_frames => 'frames';

  @override
  String get common_bytes => 'bytes';

  @override
  String get common_fps => 'fps';

  @override
  String get common_today => 'Today';

  @override
  String get common_yesterday => 'Yesterday';

  @override
  String get common_older => 'Older';

  @override
  String common_lineCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count lines',
      one: '$count line',
    );
    return '$_temp0';
  }

  @override
  String common_charCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count chars',
      one: '$count char',
    );
    return '$_temp0';
  }

  @override
  String common_byteCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count bytes',
      one: '$count byte',
    );
    return '$_temp0';
  }

  @override
  String get encoder_title => 'Encoder';

  @override
  String get encoder_selectFiles => 'Select File(s)';

  @override
  String get encoder_selectFolder => 'Select Folder';

  @override
  String get encoder_dropzone => 'Choose files or an entire folder to encode';

  @override
  String get encoder_filesSelected => 'files selected';

  @override
  String get encoder_advancedSettings => 'Advanced Settings';

  @override
  String get encoder_frameRate => 'Frame Rate (FPS)';

  @override
  String get encoder_slowFps => 'Slow (1)';

  @override
  String get encoder_fastFps => 'Fast (60)';

  @override
  String get encoder_packetSize => 'Packet Size';

  @override
  String get encoder_smallPacket => 'Small (100)';

  @override
  String get encoder_largePacket => 'Large (2800)';

  @override
  String get encoder_errorCorrection => 'Error Correction';

  @override
  String get encoder_targetQrSize => 'Target QR Size';

  @override
  String get encoder_raptorqOverhead => 'Redundancy';

  @override
  String get encoder_lessRedundancy => 'Less redundancy (1x)';

  @override
  String get encoder_moreRedundancy => 'More redundancy (3x)';

  @override
  String get encoder_compression => 'Compression';

  @override
  String get encoder_compressionDesc =>
      'Enable ZIP compression for smaller files';

  @override
  String get encoder_forceChunkMode => 'Force Chunk Mode';

  @override
  String get encoder_forceChunkModeDesc =>
      'Split large files into multiple GIFs';

  @override
  String get encoder_chunkSize => 'Chunk Size';

  @override
  String get encoder_generate => 'Generate QR GIF';

  @override
  String get encoder_encoding => 'Encoding...';

  @override
  String encoder_encodingProgress(int percent) {
    return 'Encoding... $percent%';
  }

  @override
  String get encoder_result => 'Result';

  @override
  String get encoder_expansion => 'expansion';

  @override
  String encoder_chunk(int current, int total) {
    return 'Chunk $current/$total';
  }

  @override
  String get encoder_autoAdvanceOn => 'Auto-advance ON';

  @override
  String get encoder_autoAdvanceOff => 'Auto-advance OFF';

  @override
  String get encoder_auto => 'Auto';

  @override
  String get encoder_manual => 'Manual';

  @override
  String get encoder_frame => 'Frame';

  @override
  String get encoder_playbackFps => 'Playback FPS';

  @override
  String encoder_minScanTime(String time) {
    return 'Min scan $time';
  }

  @override
  String get encoder_collapseControls => 'Collapse controls';

  @override
  String get encoder_showControls => 'Show controls';

  @override
  String get encoder_minRequired => 'Min Required';

  @override
  String get encoder_minShort => 'Min';

  @override
  String get encoder_zoomOut => 'Zoom Out';

  @override
  String get encoder_zoomIn => 'Zoom In';

  @override
  String get encoder_resetZoom => 'Reset zoom';

  @override
  String get encoder_dataChunks => 'Data Chunks';

  @override
  String get encoder_multiView => 'Multi-View';

  @override
  String get encoder_downloadZip => 'Download ZIP';

  @override
  String get encoder_downloadGif => 'Download GIF';

  @override
  String get encoder_tapToSelect => 'Tap to select a file';

  @override
  String get encoder_fileSelected => 'File selected';

  @override
  String get encoder_selectSource => 'Select Source';

  @override
  String get encoder_modeFile => 'File';

  @override
  String get encoder_modeNote => 'Note';

  @override
  String get encoder_noteEditorTitle => 'Quick Note';

  @override
  String get encoder_noteFormat => 'Format';

  @override
  String get encoder_notePlaceholder => 'Type or paste your note here...';

  @override
  String get encoder_clearNote => 'Clear note';

  @override
  String encoder_noteStats(int chars, int bytes) {
    return '$chars chars • $bytes bytes';
  }

  @override
  String get encoder_noteFormat_plain => 'Plain text';

  @override
  String get encoder_noteFormat_markdown => 'Markdown';

  @override
  String get encoder_noteFormat_javascript => 'JavaScript';

  @override
  String get encoder_noteFormat_python => 'Python';

  @override
  String get encoder_noteFormat_typescript => 'TypeScript';

  @override
  String get encoder_noteFormat_json => 'JSON';

  @override
  String get encoder_noteFormat_html => 'HTML';

  @override
  String get encoder_noteFormat_css => 'CSS';

  @override
  String get encoder_noteFormat_rust => 'Rust';

  @override
  String get encoder_noteFormat_sql => 'SQL';

  @override
  String get encoder_noteFormat_yaml => 'YAML';

  @override
  String get encoder_noteFormat_shell => 'Shell';

  @override
  String get encoder_singleFile => 'File';

  @override
  String get encoder_singleFileDesc => 'Select a single file';

  @override
  String get encoder_folderDesc => 'Select folder (will be zipped)';

  @override
  String get encoder_zipFile => 'ZIP File';

  @override
  String get encoder_zipFileDesc => 'Import existing ZIP archive';

  @override
  String get encoder_scale => 'Scale (0=Auto)';

  @override
  String get encoder_chunkSizeMb => 'Chunk Size (MB)';

  @override
  String encoder_savedToDownloads(String filename) {
    return 'Saved to Downloads: $filename';
  }

  @override
  String encoder_saved(String filename) {
    return 'Saved: $filename';
  }

  @override
  String encoder_savedChunks(String filename, int chunks) {
    return 'Saved to Downloads: $filename ($chunks chunks)';
  }

  @override
  String encoder_totalFrames(int count) {
    return '$count total frames';
  }

  @override
  String encoder_encodedIn(String seconds) {
    return 'Encoded in ${seconds}s';
  }

  @override
  String get encoder_networkTitle => 'Use AirQR from another device';

  @override
  String get encoder_networkBody =>
      'Start the offline web app server in Settings to share the encoder and decoder on your local network. You can also download the desktop, mobile, or web version from GitHub.';

  @override
  String get encoder_openOfflineWebSettings => 'Open server settings';

  @override
  String get encoder_openGithubReleases => 'GitHub releases';

  @override
  String get encoder_hideNetworkNotice => 'Do not show again';

  @override
  String get decoder_title => 'Decoder';

  @override
  String get decoder_selectFileCardTitle => 'GIF or ZIP file';

  @override
  String get decoder_dropGif => 'Drop a GIF or ZIP file to decode';

  @override
  String get decoder_tapToSelect => 'Tap to select a GIF file';

  @override
  String get decoder_readingFile => 'Reading file...';

  @override
  String get decoder_initDecoder => 'Initializing decoder...';

  @override
  String get decoder_extractingFrames => 'Extracting GIF frames...';

  @override
  String decoder_processingFrames(int count) {
    return 'Processing $count frames...';
  }

  @override
  String decoder_decodingProgress(int percent, int count) {
    return 'Decoding: $percent% ($count QR codes detected)';
  }

  @override
  String decoder_chunkComplete(int current, int total) {
    return 'Chunk $current/$total complete';
  }

  @override
  String get decoder_decodingComplete => 'Decoding complete!';

  @override
  String get decoder_decodeGif => 'Decode GIF';

  @override
  String get decoder_saveFile => 'Save File';

  @override
  String get decoder_notEnoughQr =>
      'Could not complete decoding. Not enough valid QR codes found.';

  @override
  String get decoder_notAirQrGif =>
      'This GIF is not an AirQR transfer. Encode a file in the Encode tab first, then decode that GIF — or try the sample below.';

  @override
  String get decoder_notAirQrStatus => 'No AirQR QR codes found in this GIF.';

  @override
  String get decoder_invalidGif =>
      'This file could not be read as an AirQR GIF or ZIP.';

  @override
  String get decoder_fileUnreadable =>
      'The selected file could not be read. Try selecting it again.';

  @override
  String get decoder_airQrOnlyHint =>
      'Decode only works with GIFs created by AirQR, not a regular photo GIF.';

  @override
  String get decoder_trySample => 'Try a sample GIF';

  @override
  String get decoder_sampleFilename => 'airqr-sample.txt';

  @override
  String get decoder_sampleNote =>
      'Hello from AirQR.\nThis note was recovered from an animated QR GIF.';

  @override
  String get decoder_sampleFailed => 'Could not build the sample GIF.';

  @override
  String get decoder_noGifInZip => 'No GIF files found in ZIP archive';

  @override
  String get decoder_chunkWaiting =>
      'Chunk processed. Waiting for remaining chunks...';

  @override
  String get decoder_fileSelected => 'File selected. Tap decode to start.';

  @override
  String get decoder_status => 'Status';

  @override
  String get decoder_processingZip => 'Processing ZIP archive...';

  @override
  String get decoder_processingGif => 'Processing GIF frames...';

  @override
  String decoder_complete(int frames, int qrCodes, int time) {
    return 'Complete! $frames frames, $qrCodes QR codes (${time}ms)';
  }

  @override
  String decoder_failed(int frames, int qrCodes) {
    return 'Failed: $frames frames, $qrCodes QR codes';
  }

  @override
  String get decoder_unknownFile => 'Unknown file';

  @override
  String get decoder_fileSaved => 'File saved successfully';

  @override
  String decoder_saveFailed(String error) {
    return 'Save failed: $error';
  }

  @override
  String get scanner_title => 'Scanner';

  @override
  String get scanner_initCamera => 'Initializing camera...';

  @override
  String get scanner_cameraError => 'Camera access denied or unavailable';

  @override
  String get scanner_scanning => 'Scanning...';

  @override
  String get scanner_resumingScan => 'Resuming scan...';

  @override
  String get scanner_readyToScan => 'Ready to scan';

  @override
  String get scanner_decoderError => 'Error initializing decoder';

  @override
  String get scanner_resetScanner => 'Reset Scanner';

  @override
  String get scanner_scanned => 'Scanned';

  @override
  String get scanner_min => 'Min';

  @override
  String get scanner_max => 'Max';

  @override
  String scanner_syncSource(String source) {
    return 'Sync: $source';
  }

  @override
  String scanner_sessionProgress(int received, int expected) {
    return 'Session: $received/$expected';
  }

  @override
  String scanner_missingPackets(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count missing',
      one: '$count missing',
    );
    return '$_temp0';
  }

  @override
  String get scanner_selectChunk => 'Select chunk';

  @override
  String get scanner_chunkScrollTrack => 'Scroll through chunks';

  @override
  String scanner_chunkScrollValue(int percent) {
    return '$percent%';
  }

  @override
  String scanner_chunkLabel(int number) {
    return 'Chunk $number';
  }

  @override
  String scanner_receivedCount(int received) {
    String _temp0 = intl.Intl.pluralLogic(
      received,
      locale: localeName,
      other: '$received received',
      one: '$received received',
    );
    return '$_temp0';
  }

  @override
  String scanner_toThreshold(int received, int threshold) {
    return '$received/$threshold to threshold';
  }

  @override
  String scanner_moreUniqueQr(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count more unique QR',
      one: '$count more unique QR',
    );
    return '$_temp0';
  }

  @override
  String get scanner_candidates => 'Candidates';

  @override
  String get scanner_unseen => 'Unseen';

  @override
  String get scanner_chunkComplete => 'Complete';

  @override
  String get scanner_chunkReady => 'Ready';

  @override
  String get scanner_chunkScanning => 'Scanning';

  @override
  String get scanner_chunkMissing => 'Missing';

  @override
  String get scanner_backCamera => 'Back Camera';

  @override
  String get scanner_frontCamera => 'Front Camera';

  @override
  String get scanner_helpConfirm => 'Got it';

  @override
  String scanner_currentChunk(int current, int total) {
    return 'Chunk $current/$total';
  }

  @override
  String get scanner_total => 'Total';

  @override
  String scanner_receiving(int percent) {
    return 'Receiving: $percent%';
  }

  @override
  String get scanner_selectCamera => 'Select Camera';

  @override
  String get scanner_camera => 'Camera';

  @override
  String get scanner_torchOn => 'Turn on flashlight';

  @override
  String get scanner_torchOff => 'Turn off flashlight';

  @override
  String get scanner_help => 'Help';

  @override
  String get scanner_helpTitle => 'Scanning Tips';

  @override
  String get scanner_helpTip_positioning => 'Position the QR Code';

  @override
  String get scanner_helpTip_positioningDesc =>
      'Center the animated QR code in the camera view. Keep a stable distance of 15-25cm for best results.';

  @override
  String get scanner_helpTip_lighting => 'Good Lighting';

  @override
  String get scanner_helpTip_lightingDesc =>
      'Ensure adequate lighting on the QR code. Avoid reflections and direct glare on the screen.';

  @override
  String get scanner_helpTip_torch => 'Use the Flashlight';

  @override
  String get scanner_helpTip_torchDesc =>
      'In low light conditions, tap the flashlight button to illuminate the QR code.';

  @override
  String get scanner_helpTip_speed => 'Stay Steady';

  @override
  String get scanner_helpTip_speedDesc =>
      'Keep your phone steady while scanning. The decoder needs time to capture all frames.';

  @override
  String get scanner_receiveComplete => 'Receive complete!';

  @override
  String get scanner_noteReceived => 'Note received';

  @override
  String get scanner_noteCopied => 'Note copied';

  @override
  String get scanner_fileSaved => 'File saved';

  @override
  String scanner_progressLabel(int scanned, int minRequired) {
    return '$scanned/$minRequired';
  }

  @override
  String get scanner_paused => 'Paused';

  @override
  String get scanner_scanAnother => 'Scan Another';

  @override
  String scanner_resumingWithPackets(int count) {
    return 'Resuming scan... ($count packets loaded)';
  }

  @override
  String scanner_resumingProgress(String percent, int received, int expected) {
    return 'Resuming: $percent% ($received/$expected)';
  }

  @override
  String scanner_completed(
    String filename,
    String time,
    String size,
    int frames,
  ) {
    return 'Completed! $filename\nTime: $time | Size: $size KB\nFrames: $frames';
  }

  @override
  String scanner_resumedTapPlay(int received, int expected) {
    return 'Resumed $received/$expected - Tap play to continue';
  }

  @override
  String scanner_presetActive(String name) {
    return 'Preset: $name';
  }

  @override
  String scanner_errorProcessing(String error) {
    return 'Error processing chunk: $error';
  }

  @override
  String scanner_progressDetails(
    String percent,
    int received,
    int expected,
    int fps,
  ) {
    return 'Progress: $percent% ($received/$expected)\nScan Rate: $fps FPS';
  }

  @override
  String scanner_errorMsg(String msg) {
    return 'Error: $msg';
  }

  @override
  String scanner_errorSaving(String error) {
    return 'Error saving: $error';
  }

  @override
  String scanner_fileSavedAs(String name) {
    return 'File saved: $name';
  }

  @override
  String get history_title => 'History';

  @override
  String get history_all => 'All';

  @override
  String get history_scanned => 'Scanned';

  @override
  String get history_generated => 'Generated';

  @override
  String get history_searchHistory => 'Search history';

  @override
  String get history_searchFiles => 'Search files...';

  @override
  String get history_clearSearch => 'Clear search';

  @override
  String get history_refresh => 'Refresh';

  @override
  String get history_connected => 'Connected';

  @override
  String get history_keepLocal => 'Keep local';

  @override
  String get history_syncToServer => 'Sync local history to server';

  @override
  String get history_incompleteScans => 'INCOMPLETE SCANS';

  @override
  String history_scanItem(String index) {
    return 'Scan $index';
  }

  @override
  String history_chunksProgress(
    int current,
    int total,
    int frames,
    int totalFrames,
  ) {
    return 'Chunks: $current/$total • Frames: $frames/$totalFrames';
  }

  @override
  String get history_resumeScan => 'Resume scan';

  @override
  String get history_deleteIncomplete => 'Delete incomplete scan';

  @override
  String get history_viewGif => 'View GIF';

  @override
  String get history_zipArchive => 'ZIP Archive';

  @override
  String get history_noGifFound => 'No GIF files found';

  @override
  String get history_exitFullscreen => 'Exit fullscreen';

  @override
  String get history_fullscreen => 'Fullscreen';

  @override
  String history_multiChunkView(int count) {
    return 'Multi-Chunk View ($count chunks)';
  }

  @override
  String get history_columns => 'Columns:';

  @override
  String get history_zoom => 'Zoom:';

  @override
  String get history_select => 'Select';

  @override
  String get history_noFilesScanned => 'No files received yet';

  @override
  String get history_noFilesGenerated => 'No files generated yet';

  @override
  String get history_deleteFileTitle => 'Delete file?';

  @override
  String history_deleteFileConfirm(String filename) {
    return 'Are you sure you want to delete \"$filename\"?';
  }

  @override
  String history_localOnly(String filename) {
    return '\"$filename\" is now stored locally only';
  }

  @override
  String get history_syncNotConfigured => 'Sync is not configured';

  @override
  String get history_fileNotFound => 'File not found';

  @override
  String history_syncQueued(String filename) {
    return '\"$filename\" queued for sync';
  }

  @override
  String history_syncFailed(String error) {
    return 'Sync failed: $error';
  }

  @override
  String history_scanCompleted(String filename) {
    return 'Scan completed: $filename';
  }

  @override
  String history_packets(int received, int expected) {
    return '$received/$expected packets';
  }

  @override
  String history_serverSyncPackets(int received, int expected) {
    return 'Server sync: $received/$expected packets';
  }

  @override
  String get history_sharedFromAirQR => 'Shared from AirQR History';

  @override
  String get settings_title => 'Settings';

  @override
  String get settings_encoderSection => 'ENCODER';

  @override
  String get settings_slowFps => 'Slow (1)';

  @override
  String get settings_fastFps => 'Fast (60)';

  @override
  String get settings_smallPacket => 'Small (100)';

  @override
  String get settings_largePacket => 'Large (2800)';

  @override
  String get settings_frameRate => 'Frame Rate (FPS)';

  @override
  String get settings_packetSize => 'Packet Size';

  @override
  String get settings_overhead => 'Overhead';

  @override
  String get settings_scannerSection => 'SCANNER';

  @override
  String get settings_scannerPresetSection => 'SCANNER PRESET';

  @override
  String get settings_scannerAdvancedSection => 'SCANNER ADVANCED';

  @override
  String get settings_preset => 'Preset';

  @override
  String get settings_preset_turbo => 'Turbo';

  @override
  String get settings_preset_turboDesc => 'Maximum speed, lower accuracy';

  @override
  String get settings_preset_fast => 'Fast';

  @override
  String get settings_preset_fastDesc => 'Fast scanning, good balance';

  @override
  String get settings_preset_balanced => 'Balanced';

  @override
  String get settings_preset_balancedDesc => 'Recommended for most cases';

  @override
  String get settings_preset_reliable => 'Reliable';

  @override
  String get settings_preset_reliableDesc => 'Best accuracy, slower';

  @override
  String get settings_preset_silent => 'Silent';

  @override
  String get settings_preset_silentDesc => 'No sounds or vibrations';

  @override
  String get settings_preset_custom => 'Custom';

  @override
  String get settings_preset_customDesc => 'Your custom settings';

  @override
  String get settings_customModeHint =>
      'Modifying these settings will switch to \"Custom\" mode.';

  @override
  String get settings_scanInterval => 'Scan Interval';

  @override
  String get settings_maxSpeed => 'Max speed (0ms)';

  @override
  String get settings_batterySaver => 'Battery saver (500ms)';

  @override
  String get settings_resolution => 'Resolution';

  @override
  String get settings_detectionSpeed => 'Detection Speed';

  @override
  String get settings_fast => 'Fast';

  @override
  String get settings_accurate => 'Accurate';

  @override
  String get settings_accurateModeHint =>
      'Accurate mode improves detection in noisy frames but uses more CPU.';

  @override
  String get settings_torch => 'Torch';

  @override
  String get settings_torchDesc => 'Enable the camera flashlight if supported';

  @override
  String get settings_scannerTip =>
      'For best results with scanner, please use the native application for your device.';

  @override
  String get settings_wakelock => 'Wakelock';

  @override
  String get settings_wakelockDesc => 'Keep screen on during scanning';

  @override
  String get settings_scanMode => 'Scan Mode';

  @override
  String get settings_scanModeRealtime => 'Realtime';

  @override
  String get settings_scanModeRealtimeDesc =>
      'Process each frame immediately (lower latency)';

  @override
  String get settings_scanModeBatch => 'Batch';

  @override
  String get settings_scanModeBatchDesc =>
      'Collect frames then process (more reliable)';

  @override
  String get settings_batchDelay => 'Batch Delay (ms)';

  @override
  String get settings_maxCacheFrames => 'Max Cache Frames';

  @override
  String get settings_unknownResolution => 'Unknown resolution';

  @override
  String get settings_detectionTimeout => 'Detection Timeout';

  @override
  String get settings_detectionNormal => 'Normal';

  @override
  String get settings_detectionNoDuplicates => 'No Duplicates';

  @override
  String get settings_detectionUnrestricted => 'Unrestricted';

  @override
  String get settings_torchFlash => 'Torch (Flash)';

  @override
  String get settings_torchFlashDesc => 'Enable for low light';

  @override
  String get settings_syncScannedFiles => 'Sync Scanned Files';

  @override
  String get settings_syncScannedFilesDesc => 'Upload scanned files to server';

  @override
  String get settings_syncGeneratedFiles => 'Sync Generated Files';

  @override
  String get settings_syncGeneratedFilesDesc =>
      'Upload generated GIFs to server';

  @override
  String get settings_autoSyncShort => 'Auto Sync';

  @override
  String get settings_autoSyncShortDesc =>
      'Sync automatically after scan/generate';

  @override
  String get settings_poweredBy => 'Powered by RaptorQ fountain codes';

  @override
  String get settings_serverSyncSection => 'SERVER SYNC';

  @override
  String get settings_enableSync => 'Enable server sync';

  @override
  String get settings_enableSyncDesc =>
      'Sync history across devices and resume scans.';

  @override
  String get settings_syncScanned => 'Sync scanned history';

  @override
  String get settings_syncScannedDesc =>
      'Upload scan packets and show remote scan history.';

  @override
  String get settings_syncGenerated => 'Sync generated history';

  @override
  String get settings_syncGeneratedDesc =>
      'Upload generated QR files to the server.';

  @override
  String get settings_autoSync => 'Auto-sync history';

  @override
  String get settings_autoSyncDesc =>
      'Automatically upload local scanned and generated items to the server.';

  @override
  String get settings_testConnection => 'Connection';

  @override
  String get settings_testingConnection => 'Connecting...';

  @override
  String get settings_syncNow => 'Sync';

  @override
  String get settings_syncing => 'Syncing...';

  @override
  String get settings_localServerTitle => 'Local server';

  @override
  String get settings_localServerDesc =>
      'Start the built-in sync server from this app.';

  @override
  String get settings_localServerDesktopOnly =>
      'Local server launch is available on desktop only.';

  @override
  String settings_localServerRunningOn(Object serverUrl) {
    return 'Running on $serverUrl';
  }

  @override
  String get settings_launchLocalServer => 'Launch local server';

  @override
  String get settings_localServerRunning => 'Running';

  @override
  String get settings_stopLocalServer => 'Stop server';

  @override
  String get settings_localServerStopped => 'Local server stopped.';

  @override
  String get settings_localServerStarting => 'Starting...';

  @override
  String get settings_localServerDialogTitle => 'Launch local server';

  @override
  String get settings_startServer => 'Start server';

  @override
  String get settings_localServerPort => 'Port';

  @override
  String get settings_connectionSuccess => 'Connected!';

  @override
  String get settings_offlineWebTitle => 'Offline web app';

  @override
  String get settings_offlineWebMenuDesc =>
      'Serve encoder and decoder on your network';

  @override
  String get settings_offlineWebDesc =>
      'Start the bundled AirQR web app so another device on this network can open encoder and decoder in a browser.';

  @override
  String get settings_startOfflineWeb => 'Start offline web app';

  @override
  String get settings_stopOfflineWeb => 'Stop offline web app';

  @override
  String get settings_offlineWebStarting => 'Starting...';

  @override
  String get settings_offlineWebRunning => 'Running';

  @override
  String get settings_offlineWebStoppedStatus => 'Stopped';

  @override
  String get settings_offlineWebStopped => 'Offline web app stopped.';

  @override
  String get settings_offlineWebNoUrl =>
      'Start the server to get a network URL.';

  @override
  String get settings_offlineWebCopied => 'Offline web app URL copied';

  @override
  String get settings_offlineWebStartFailed =>
      'Could not start offline web app server.';

  @override
  String settings_offlineWebRunningOn(Object serverUrl) {
    return 'Available at $serverUrl';
  }

  @override
  String settings_offlineWebMoreUrls(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count other network URLs available',
      one: '1 other network URL available',
    );
    return '$_temp0';
  }

  @override
  String get settings_fileExportSection => 'FILE EXPORT (SERVER)';

  @override
  String get settings_fileExportDesc =>
      'Configure where the server saves received files. Files are organized in folders by date (YYYY-MM-DD).';

  @override
  String get settings_enableExport => 'Enable file export';

  @override
  String get settings_enableExportDesc =>
      'Save received files to the configured directory.';

  @override
  String get settings_exportScanned => 'Export scanned files';

  @override
  String get settings_exportScannedDesc =>
      'Save files received from QR code scanning.';

  @override
  String get settings_exportGenerated => 'Export generated files';

  @override
  String get settings_exportGeneratedDesc => 'Save generated QR code files.';

  @override
  String get settings_exportDirectory => 'Export Directory (PC or NAS path)';

  @override
  String get settings_exportDirectoryPlaceholder =>
      'C:\\AirQR-Files or \\\\NAS\\share\\AirQR';

  @override
  String get settings_exportDirectoryHint =>
      'Path on the server machine. Use UNC path (\\\\NAS\\share) for network drives.';

  @override
  String get settings_pathWarning => 'Path saved but not accessible yet:';

  @override
  String get settings_pathReady => 'Export path ready:';

  @override
  String get settings_configSaved => 'Configuration saved!';

  @override
  String settings_syncSuccess(int uploaded, int downloaded) {
    return 'Synced: $uploaded up, $downloaded down';
  }

  @override
  String get settings_serverUrl => 'Server URL';

  @override
  String get settings_serverUrlHint => 'Sends packets to /api/scan/packet';

  @override
  String get settings_username => 'Username';

  @override
  String get settings_password => 'Password';

  @override
  String get settings_apiKey => 'API Key (optional)';

  @override
  String get settings_optional => 'Optional';

  @override
  String get settings_deviceName => 'Device Name';

  @override
  String get settings_deviceNameHint =>
      'Name to identify this device on the server';

  @override
  String get settings_appearanceSection => 'APPEARANCE';

  @override
  String get settings_language => 'Language';

  @override
  String get settings_languageEnglish => 'English';

  @override
  String get settings_languageFrench => 'Français';

  @override
  String get settings_languageSystem => 'System';

  @override
  String get settings_defaultCamera => 'Default Camera';

  @override
  String get settings_defaultCameraDesc =>
      'Camera to use by default when opening the scanner';

  @override
  String get settings_selectDefaultCamera => 'Select a camera';

  @override
  String get settings_noCameraDetected => 'No camera detected';

  @override
  String get settings_theme => 'Theme';

  @override
  String get settings_themeLight => 'Light';

  @override
  String get settings_themeDark => 'Dark';

  @override
  String get settings_themeSystem => 'System';

  @override
  String get settings_clearData => 'Clear All App Data';

  @override
  String get settings_clearDataConfirm =>
      'This will clear all app data including history, settings, and cached files. Continue?';

  @override
  String get settings_clearDataFailed => 'Failed to clear app data';

  @override
  String get settings_aboutSection => 'ABOUT';

  @override
  String get settings_appName => 'AirQR Mobile';

  @override
  String get settings_appDescription =>
      'Air-gapped file transfer using animated QR codes';

  @override
  String get settings_madeWith => 'Made with ❤️ by';

  @override
  String get settings_starOnGithub => 'Star on GitHub';

  @override
  String get settings_version => 'Version';

  @override
  String get errors_cameraAccessDenied => 'Camera access denied or unavailable';

  @override
  String get errors_fileTooLarge => 'File is too large to process';

  @override
  String get errors_invalidFileType =>
      'Invalid file type. Please select a valid file.';

  @override
  String get errors_encodingFailed => 'Failed to encode file to QR codes';

  @override
  String get errors_decodingFailed => 'Failed to decode QR codes';

  @override
  String get errors_fileSaveFailed => 'Failed to save file';

  @override
  String get errors_invalidServerUrl => 'Invalid server URL';

  @override
  String errors_serverError(String status) {
    return 'Server error: $status';
  }

  @override
  String get errors_connectionFailed => 'Could not connect to server';

  @override
  String errors_zipFolderFailed(String error) {
    return 'Failed to zip folder: $error';
  }

  @override
  String get errors_unsupportedFormat =>
      'Unsupported file format. Use .gif or .zip';

  @override
  String get errors_nativeInitFailed => 'Native Library Init Failed';

  @override
  String get errors_chunkEncodingFailed => 'Chunked encoding failed';

  @override
  String get encoder_targetSizePx => 'Target Size (px)';

  @override
  String encoder_overheadValue(String value) {
    return 'Overhead ($value)';
  }

  @override
  String get encoder_enableCompression => 'Enable Compression';

  @override
  String get encoder_enableCompressionDesc =>
      'Compress data with ZIP (smaller size)';

  @override
  String history_errorSaving(String error) {
    return 'Error saving file: $error';
  }

  @override
  String get decoder_decoding => 'Decoding...';

  @override
  String get decoder_selectGifFile => 'Select a GIF file to decode';

  @override
  String get settings_serverConnected => 'CONNECTED';

  @override
  String get settings_serverUnavailable => 'UNAVAILABLE';

  @override
  String get settings_loggingSection => 'LOGGING';

  @override
  String get settings_logLevel => 'Log level';

  @override
  String get settings_modules => 'Modules';

  @override
  String get settings_resetToDefaults => 'Reset to defaults';

  @override
  String get settings_backToSettings => 'Back to settings';

  @override
  String get settings_logDebug => 'Debug';

  @override
  String get settings_logInfo => 'Info';

  @override
  String get settings_logWarn => 'Warn';

  @override
  String get settings_logError => 'Error';

  @override
  String get settings_moduleServices => 'Services';

  @override
  String get settings_moduleWorkers => 'Workers';

  @override
  String get settings_moduleHooks => 'Hooks';

  @override
  String get settings_moduleScanner => 'Scanner';

  @override
  String get settings_moduleUi => 'UI';

  @override
  String get settings_moduleApp => 'App';

  @override
  String get settings_syncEnabled => 'Sync: enabled';

  @override
  String get settings_syncDisabled => 'Sync: disabled';

  @override
  String get settings_encoderMenu => 'Encoder';

  @override
  String get settings_scannerMenu => 'Scanner';

  @override
  String get settings_serverSyncMenu => 'Server sync';

  @override
  String get settings_appearanceMenu => 'Appearance';

  @override
  String get settings_loggingMenu => 'Logging';

  @override
  String get settings_aboutMenu => 'About';

  @override
  String get decoder_unknownError => 'Unknown error';

  @override
  String get encoder_startAutomaticPlayback => 'Start automatic playback';

  @override
  String get encoder_pauseAutomaticPlayback => 'Pause automatic playback';

  @override
  String get encoder_playbackAutomatic => 'AUTO';

  @override
  String get encoder_playbackFixed => 'FIXED';

  @override
  String get encoder_openFullscreen => 'Open fullscreen';

  @override
  String get encoder_previousChunk => 'Previous chunk';

  @override
  String get encoder_nextChunk => 'Next chunk';

  @override
  String encoder_frameProgress(int current, int total, int minimum) {
    return 'Frame: $current/$total (Min: $minimum)';
  }

  @override
  String get history_sort => 'Sort';

  @override
  String get history_sortNewest => 'Newest first';

  @override
  String get history_sortOldest => 'Oldest first';

  @override
  String get history_sortLargest => 'Largest first';

  @override
  String get history_sortSmallest => 'Smallest first';

  @override
  String get history_sortNameAscending => 'Name A–Z';

  @override
  String get history_sortNameDescending => 'Name Z–A';

  @override
  String get history_clearHistory => 'Clear history';

  @override
  String get history_clearHistoryTitle => 'Clear history?';

  @override
  String get history_clearHistoryMessage =>
      'All history files and incomplete scans will be deleted. Continue?';

  @override
  String get history_previewOpenFailed => 'Could not open file preview.';

  @override
  String history_previewOpenError(String error) {
    return 'Error opening file: $error';
  }

  @override
  String get settings_localServerStartFailed => 'Could not start local server.';

  @override
  String get history_serverDeleteFailed => 'Failed to delete on server.';

  @override
  String scanner_cameraListFailed(String error) {
    return 'Failed to list cameras: $error';
  }

  @override
  String scanner_cameraOpenFailed(String error) {
    return 'Failed to open camera: $error';
  }

  @override
  String get scanner_cameraOpenUnavailable => 'The camera could not be opened.';

  @override
  String scanner_cameraCaptureFailed(String error) {
    return 'Camera error: $error';
  }
}
