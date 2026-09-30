// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get nav_encoder => 'Encodeur';

  @override
  String get nav_decoder => 'Décodeur';

  @override
  String get nav_scanner => 'Scanner';

  @override
  String get nav_history => 'Historique';

  @override
  String get nav_settings => 'Paramètres';

  @override
  String get common_loading => 'Chargement...';

  @override
  String get common_error => 'Erreur';

  @override
  String get common_success => 'Succès';

  @override
  String get common_cancel => 'Annuler';

  @override
  String get common_save => 'Enregistrer';

  @override
  String get common_delete => 'Supprimer';

  @override
  String get common_download => 'Télécharger';

  @override
  String get common_copy => 'Copier';

  @override
  String get common_open => 'Ouvrir';

  @override
  String get common_upload => 'Envoyer';

  @override
  String get common_close => 'Fermer';

  @override
  String get common_yes => 'Oui';

  @override
  String get common_no => 'Non';

  @override
  String get common_confirm => 'Confirmer';

  @override
  String get common_back => 'Retour';

  @override
  String get common_next => 'Suivant';

  @override
  String get common_reset => 'Réinitialiser';

  @override
  String get common_retry => 'Réessayer';

  @override
  String get common_clear => 'Effacer';

  @override
  String get common_search => 'Rechercher';

  @override
  String get common_noResults => 'Aucun résultat';

  @override
  String get common_items => 'éléments';

  @override
  String get common_files => 'fichiers';

  @override
  String get common_file => 'fichier';

  @override
  String get common_folder => 'dossier';

  @override
  String get common_frames => 'images';

  @override
  String get common_bytes => 'octets';

  @override
  String get common_fps => 'ips';

  @override
  String get common_today => 'Aujourd\'hui';

  @override
  String get common_yesterday => 'Hier';

  @override
  String get common_older => 'Plus ancien';

  @override
  String common_lineCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count lignes',
      one: '$count ligne',
    );
    return '$_temp0';
  }

  @override
  String common_charCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count caractères',
      one: '$count caractère',
    );
    return '$_temp0';
  }

  @override
  String common_byteCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count octets',
      one: '$count octet',
    );
    return '$_temp0';
  }

  @override
  String get encoder_title => 'Encodeur';

  @override
  String get encoder_selectFiles => 'Sélectionner fichier(s)';

  @override
  String get encoder_selectFolder => 'Sélectionner dossier';

  @override
  String get encoder_dropzone =>
      'Choisissez des fichiers ou un dossier entier à encoder';

  @override
  String get encoder_filesSelected => 'fichiers sélectionnés';

  @override
  String get encoder_advancedSettings => 'Paramètres avancés';

  @override
  String get encoder_frameRate => 'Fréquence d\'images (FPS)';

  @override
  String get encoder_slowFps => 'Lent (1)';

  @override
  String get encoder_fastFps => 'Rapide (60)';

  @override
  String get encoder_packetSize => 'Taille du paquet';

  @override
  String get encoder_smallPacket => 'Petit (100)';

  @override
  String get encoder_largePacket => 'Grand (2800)';

  @override
  String get encoder_errorCorrection => 'Correction d\'erreur';

  @override
  String get encoder_targetQrSize => 'Taille QR cible';

  @override
  String get encoder_raptorqOverhead => 'Redondance';

  @override
  String get encoder_lessRedundancy => 'Moins de redondance (1x)';

  @override
  String get encoder_moreRedundancy => 'Plus de redondance (3x)';

  @override
  String get encoder_compression => 'Compression';

  @override
  String get encoder_compressionDesc =>
      'Activer la compression ZIP pour des fichiers plus petits';

  @override
  String get encoder_forceChunkMode => 'Mode découpage forcé';

  @override
  String get encoder_forceChunkModeDesc =>
      'Diviser les gros fichiers en plusieurs GIFs';

  @override
  String get encoder_chunkSize => 'Taille des chunks';

  @override
  String get encoder_generate => 'Générer le QR GIF';

  @override
  String get encoder_encoding => 'Encodage...';

  @override
  String encoder_encodingProgress(int percent) {
    return 'Encodage... $percent%';
  }

  @override
  String get encoder_result => 'Résultat';

  @override
  String get encoder_expansion => 'expansion';

  @override
  String encoder_chunk(int current, int total) {
    return 'Chunk $current/$total';
  }

  @override
  String get encoder_autoAdvanceOn => 'Avance auto ACTIVÉE';

  @override
  String get encoder_autoAdvanceOff => 'Avance auto DÉSACTIVÉE';

  @override
  String get encoder_auto => 'Auto';

  @override
  String get encoder_manual => 'Manuel';

  @override
  String get encoder_frame => 'Image';

  @override
  String get encoder_playbackFps => 'FPS de lecture';

  @override
  String encoder_minScanTime(String time) {
    return 'Scan min. $time';
  }

  @override
  String get encoder_collapseControls => 'Réduire les commandes';

  @override
  String get encoder_showControls => 'Afficher les commandes';

  @override
  String get encoder_minRequired => 'Min requis';

  @override
  String get encoder_minShort => 'Min';

  @override
  String get encoder_zoomOut => 'Zoom arrière';

  @override
  String get encoder_zoomIn => 'Zoom avant';

  @override
  String get encoder_resetZoom => 'Réinitialiser le zoom';

  @override
  String get encoder_dataChunks => 'Chunks';

  @override
  String get encoder_multiView => 'Vue multiple';

  @override
  String get encoder_downloadZip => 'Télécharger ZIP';

  @override
  String get encoder_downloadGif => 'Télécharger GIF';

  @override
  String get encoder_tapToSelect => 'Appuyez pour sélectionner un fichier';

  @override
  String get encoder_fileSelected => 'Fichier sélectionné';

  @override
  String get encoder_selectSource => 'Choisir la source';

  @override
  String get encoder_modeFile => 'Fichier';

  @override
  String get encoder_modeNote => 'Note';

  @override
  String get encoder_noteEditorTitle => 'Note rapide';

  @override
  String get encoder_noteFormat => 'Format';

  @override
  String get encoder_notePlaceholder => 'Tapez ou collez votre note ici...';

  @override
  String get encoder_clearNote => 'Effacer la note';

  @override
  String encoder_noteStats(int chars, int bytes) {
    return '$chars caractères • $bytes octets';
  }

  @override
  String get encoder_noteFormat_plain => 'Texte brut';

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
  String get encoder_singleFile => 'Fichier';

  @override
  String get encoder_singleFileDesc => 'Sélectionner un fichier unique';

  @override
  String get encoder_folderDesc => 'Sélectionner un dossier (sera zippé)';

  @override
  String get encoder_zipFile => 'Fichier ZIP';

  @override
  String get encoder_zipFileDesc => 'Importer une archive ZIP existante';

  @override
  String get encoder_scale => 'Échelle (0=Auto)';

  @override
  String get encoder_chunkSizeMb => 'Taille des chunks (Mo)';

  @override
  String encoder_savedToDownloads(String filename) {
    return 'Enregistré dans Téléchargements : $filename';
  }

  @override
  String encoder_saved(String filename) {
    return 'Enregistré : $filename';
  }

  @override
  String encoder_savedChunks(String filename, int chunks) {
    return 'Enregistré dans Téléchargements : $filename ($chunks chunks)';
  }

  @override
  String encoder_totalFrames(int count) {
    return '$count images au total';
  }

  @override
  String encoder_encodedIn(String seconds) {
    return 'Encodé en ${seconds}s';
  }

  @override
  String get encoder_networkTitle => 'Utiliser AirQR depuis un autre appareil';

  @override
  String get encoder_networkBody =>
      'Activez le serveur web hors ligne dans les paramètres pour partager l\'encodeur et le décodeur sur votre réseau local. Vous pouvez aussi télécharger la version desktop, mobile ou web depuis GitHub.';

  @override
  String get encoder_openOfflineWebSettings => 'Ouvrir le serveur';

  @override
  String get encoder_openGithubReleases => 'Versions GitHub';

  @override
  String get encoder_hideNetworkNotice => 'Ne plus afficher';

  @override
  String get decoder_title => 'Décodeur';

  @override
  String get decoder_selectFileCardTitle => 'Fichier GIF ou ZIP';

  @override
  String get decoder_dropGif => 'Déposez un fichier GIF ou ZIP à décoder';

  @override
  String get decoder_tapToSelect => 'Appuyez pour sélectionner un fichier GIF';

  @override
  String get decoder_readingFile => 'Lecture du fichier...';

  @override
  String get decoder_initDecoder => 'Initialisation du décodeur...';

  @override
  String get decoder_extractingFrames => 'Extraction des images du GIF...';

  @override
  String decoder_processingFrames(int count) {
    return 'Traitement de $count images...';
  }

  @override
  String decoder_decodingProgress(int percent, int count) {
    return 'Décodage : $percent% ($count codes QR détectés)';
  }

  @override
  String decoder_chunkComplete(int current, int total) {
    return 'Chunk $current/$total terminé';
  }

  @override
  String get decoder_decodingComplete => 'Décodage terminé !';

  @override
  String get decoder_decodeGif => 'Décoder le GIF';

  @override
  String get decoder_saveFile => 'Enregistrer le fichier';

  @override
  String get decoder_notEnoughQr =>
      'Impossible de terminer le décodage. Pas assez de codes QR valides trouvés.';

  @override
  String get decoder_notAirQrGif =>
      'Ce GIF n’est pas un transfert AirQR. Encodez d’abord un fichier dans l’onglet Encoder, puis décodez ce GIF — ou essayez l’exemple ci-dessous.';

  @override
  String get decoder_notAirQrStatus =>
      'Aucun code QR AirQR n’a été trouvé dans ce GIF.';

  @override
  String get decoder_invalidGif =>
      'Ce fichier n’a pas pu être lu comme un GIF ou un ZIP AirQR.';

  @override
  String get decoder_fileUnreadable =>
      'Le fichier sélectionné n’a pas pu être lu. Sélectionnez-le à nouveau.';

  @override
  String get decoder_airQrOnlyHint =>
      'Le décodage ne fonctionne qu’avec les GIF créés par AirQR, pas avec un GIF photo classique.';

  @override
  String get decoder_trySample => 'Essayer un GIF d’exemple';

  @override
  String get decoder_sampleFilename => 'airqr-sample.txt';

  @override
  String get decoder_sampleNote =>
      'Bonjour de AirQR.\nCette note a été récupérée depuis un GIF QR animé.';

  @override
  String get decoder_sampleFailed => 'Impossible de générer le GIF d’exemple.';

  @override
  String get decoder_noGifInZip =>
      'Aucun fichier GIF trouvé dans l\'archive ZIP';

  @override
  String get decoder_chunkWaiting =>
      'Chunk traité. En attente des chunks restants...';

  @override
  String get decoder_fileSelected =>
      'Fichier sélectionné. Appuyez sur décoder pour commencer.';

  @override
  String get decoder_status => 'Statut';

  @override
  String get decoder_processingZip => 'Traitement de l\'archive ZIP...';

  @override
  String get decoder_processingGif => 'Traitement des images du GIF...';

  @override
  String decoder_complete(int frames, int qrCodes, int time) {
    return 'Terminé ! $frames images, $qrCodes codes QR (${time}ms)';
  }

  @override
  String decoder_failed(int frames, int qrCodes) {
    return 'Échec : $frames images, $qrCodes codes QR';
  }

  @override
  String get decoder_unknownFile => 'Fichier inconnu';

  @override
  String get decoder_fileSaved => 'Fichier enregistré avec succès';

  @override
  String decoder_saveFailed(String error) {
    return 'Échec de l\'enregistrement : $error';
  }

  @override
  String get scanner_title => 'Scanner';

  @override
  String get scanner_initCamera => 'Initialisation de la caméra...';

  @override
  String get scanner_cameraError => 'Accès à la caméra refusé ou indisponible';

  @override
  String get scanner_scanning => 'Scan en cours...';

  @override
  String get scanner_resumingScan => 'Reprise du scan...';

  @override
  String get scanner_readyToScan => 'Prêt à scanner';

  @override
  String get scanner_decoderError => 'Erreur d\'initialisation du décodeur';

  @override
  String get scanner_resetScanner => 'Réinitialiser le scanner';

  @override
  String get scanner_scanned => 'Scannés';

  @override
  String get scanner_min => 'Min';

  @override
  String get scanner_max => 'Max';

  @override
  String scanner_syncSource(String source) {
    return 'Sync : $source';
  }

  @override
  String scanner_sessionProgress(int received, int expected) {
    return 'Session : $received/$expected';
  }

  @override
  String scanner_missingPackets(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count manquants',
      one: '$count manquant',
    );
    return '$_temp0';
  }

  @override
  String get scanner_selectChunk => 'Sélectionner un chunk';

  @override
  String get scanner_chunkScrollTrack => 'Parcourir les chunks';

  @override
  String scanner_chunkScrollValue(int percent) {
    return '$percent %';
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
      other: '$received reçus',
      one: '$received reçu',
    );
    return '$_temp0';
  }

  @override
  String scanner_toThreshold(int received, int threshold) {
    return '$received/$threshold jusqu’au seuil';
  }

  @override
  String scanner_moreUniqueQr(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Encore $count QR uniques',
      one: 'Encore $count QR unique',
    );
    return '$_temp0';
  }

  @override
  String get scanner_candidates => 'Candidats';

  @override
  String get scanner_unseen => 'Non vus';

  @override
  String get scanner_chunkComplete => 'Terminé';

  @override
  String get scanner_chunkReady => 'Prêt';

  @override
  String get scanner_chunkScanning => 'Scan en cours';

  @override
  String get scanner_chunkMissing => 'Manquant';

  @override
  String get scanner_backCamera => 'Caméra arrière';

  @override
  String get scanner_frontCamera => 'Caméra avant';

  @override
  String get scanner_helpConfirm => 'Compris';

  @override
  String scanner_currentChunk(int current, int total) {
    return 'Chunk $current/$total';
  }

  @override
  String get scanner_total => 'Total';

  @override
  String scanner_receiving(int percent) {
    return 'Réception : $percent%';
  }

  @override
  String get scanner_selectCamera => 'Choisir une caméra';

  @override
  String get scanner_camera => 'Caméra';

  @override
  String get scanner_torchOn => 'Allumer la lampe';

  @override
  String get scanner_torchOff => 'Éteindre la lampe';

  @override
  String get scanner_help => 'Aide';

  @override
  String get scanner_helpTitle => 'Conseils de scan';

  @override
  String get scanner_helpTip_positioning => 'Positionnez le QR Code';

  @override
  String get scanner_helpTip_positioningDesc =>
      'Centrez le QR code animé dans le viseur. Gardez une distance stable de 15-25cm pour de meilleurs résultats.';

  @override
  String get scanner_helpTip_lighting => 'Bon éclairage';

  @override
  String get scanner_helpTip_lightingDesc =>
      'Assurez un éclairage adéquat sur le QR code. Évitez les reflets et l\'éblouissement direct sur l\'écran.';

  @override
  String get scanner_helpTip_torch => 'Utilisez la lampe';

  @override
  String get scanner_helpTip_torchDesc =>
      'En conditions de faible luminosité, appuyez sur le bouton lampe pour éclairer le QR code.';

  @override
  String get scanner_helpTip_speed => 'Restez stable';

  @override
  String get scanner_helpTip_speedDesc =>
      'Gardez votre téléphone stable pendant le scan. Le décodeur a besoin de temps pour capturer toutes les images.';

  @override
  String get scanner_receiveComplete => 'Réception terminée !';

  @override
  String get scanner_noteReceived => 'Note reçue';

  @override
  String get scanner_noteCopied => 'Note copiée';

  @override
  String get scanner_fileSaved => 'Fichier enregistré';

  @override
  String scanner_progressLabel(int scanned, int minRequired) {
    return '$scanned/$minRequired';
  }

  @override
  String get scanner_paused => 'En pause';

  @override
  String get scanner_scanAnother => 'Scanner un autre';

  @override
  String scanner_resumingWithPackets(int count) {
    return 'Reprise du scan... ($count paquets chargés)';
  }

  @override
  String scanner_resumingProgress(String percent, int received, int expected) {
    return 'Reprise : $percent% ($received/$expected)';
  }

  @override
  String scanner_completed(
    String filename,
    String time,
    String size,
    int frames,
  ) {
    return 'Terminé ! $filename\nTemps : $time | Taille : $size Ko\nImages : $frames';
  }

  @override
  String scanner_resumedTapPlay(int received, int expected) {
    return 'Repris $received/$expected - Appuyez sur play pour continuer';
  }

  @override
  String scanner_presetActive(String name) {
    return 'Préréglage : $name';
  }

  @override
  String scanner_errorProcessing(String error) {
    return 'Erreur de traitement : $error';
  }

  @override
  String scanner_progressDetails(
    String percent,
    int received,
    int expected,
    int fps,
  ) {
    return 'Progression : $percent% ($received/$expected)\nVitesse : $fps FPS';
  }

  @override
  String scanner_errorMsg(String msg) {
    return 'Erreur : $msg';
  }

  @override
  String scanner_errorSaving(String error) {
    return 'Erreur d\'enregistrement : $error';
  }

  @override
  String scanner_fileSavedAs(String name) {
    return 'Fichier enregistré : $name';
  }

  @override
  String get history_title => 'Historique';

  @override
  String get history_all => 'Tout';

  @override
  String get history_scanned => 'Scannés';

  @override
  String get history_generated => 'Générés';

  @override
  String get history_searchHistory => 'Rechercher dans l\'historique';

  @override
  String get history_searchFiles => 'Rechercher des fichiers...';

  @override
  String get history_clearSearch => 'Effacer la recherche';

  @override
  String get history_refresh => 'Actualiser';

  @override
  String get history_connected => 'Connecté';

  @override
  String get history_keepLocal => 'Conserver en local';

  @override
  String get history_syncToServer =>
      'Synchroniser l\'historique local vers le serveur';

  @override
  String get history_incompleteScans => 'SCANS INCOMPLETS';

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
    return 'Chunks : $current/$total • Images : $frames/$totalFrames';
  }

  @override
  String get history_resumeScan => 'Reprendre le scan';

  @override
  String get history_deleteIncomplete => 'Supprimer le scan incomplet';

  @override
  String get history_viewGif => 'Voir le GIF';

  @override
  String get history_zipArchive => 'Archive ZIP';

  @override
  String get history_noGifFound => 'Aucun fichier GIF trouvé';

  @override
  String get history_exitFullscreen => 'Quitter le plein écran';

  @override
  String get history_fullscreen => 'Plein écran';

  @override
  String history_multiChunkView(int count) {
    return 'Vue multi-chunks ($count chunks)';
  }

  @override
  String get history_columns => 'Colonnes :';

  @override
  String get history_zoom => 'Zoom :';

  @override
  String get history_select => 'Sélectionner';

  @override
  String get history_noFilesScanned => 'Aucun fichier reçu';

  @override
  String get history_noFilesGenerated => 'Aucun fichier généré';

  @override
  String get history_deleteFileTitle => 'Supprimer le fichier ?';

  @override
  String history_deleteFileConfirm(String filename) {
    return 'Êtes-vous sûr de vouloir supprimer \"$filename\" ?';
  }

  @override
  String history_localOnly(String filename) {
    return '\"$filename\" est maintenant stocké localement uniquement';
  }

  @override
  String get history_syncNotConfigured =>
      'La synchronisation n\'est pas configurée';

  @override
  String get history_fileNotFound => 'Fichier introuvable';

  @override
  String history_syncQueued(String filename) {
    return '\"$filename\" en file d\'attente pour la synchronisation';
  }

  @override
  String history_syncFailed(String error) {
    return 'Échec de la synchronisation : $error';
  }

  @override
  String history_scanCompleted(String filename) {
    return 'Scan terminé : $filename';
  }

  @override
  String history_packets(int received, int expected) {
    return '$received/$expected paquets';
  }

  @override
  String history_serverSyncPackets(int received, int expected) {
    return 'Sync serveur : $received/$expected paquets';
  }

  @override
  String get history_sharedFromAirQR => 'Partagé depuis l\'historique AirQR';

  @override
  String get settings_title => 'Paramètres';

  @override
  String get settings_encoderSection => 'ENCODEUR';

  @override
  String get settings_slowFps => 'Lent (1)';

  @override
  String get settings_fastFps => 'Rapide (60)';

  @override
  String get settings_smallPacket => 'Petit (100)';

  @override
  String get settings_largePacket => 'Grand (2800)';

  @override
  String get settings_frameRate => 'Fréquence d\'images (FPS)';

  @override
  String get settings_packetSize => 'Taille du paquet';

  @override
  String get settings_overhead => 'Redondance';

  @override
  String get settings_scannerSection => 'SCANNER';

  @override
  String get settings_scannerPresetSection => 'PRÉRÉGLAGES SCANNER';

  @override
  String get settings_scannerAdvancedSection => 'SCANNER AVANCÉ';

  @override
  String get settings_preset => 'Préréglage';

  @override
  String get settings_preset_turbo => 'Turbo';

  @override
  String get settings_preset_turboDesc => 'Vitesse maximale, précision réduite';

  @override
  String get settings_preset_fast => 'Rapide';

  @override
  String get settings_preset_fastDesc => 'Scan rapide, bon équilibre';

  @override
  String get settings_preset_balanced => 'Équilibré';

  @override
  String get settings_preset_balancedDesc =>
      'Recommandé pour la plupart des cas';

  @override
  String get settings_preset_reliable => 'Fiable';

  @override
  String get settings_preset_reliableDesc => 'Meilleure précision, plus lent';

  @override
  String get settings_preset_silent => 'Silencieux';

  @override
  String get settings_preset_silentDesc => 'Sans sons ni vibrations';

  @override
  String get settings_preset_custom => 'Personnalisé';

  @override
  String get settings_preset_customDesc => 'Vos paramètres personnalisés';

  @override
  String get settings_customModeHint =>
      'Modifier ces paramètres passera en mode \"Personnalisé\".';

  @override
  String get settings_scanInterval => 'Intervalle de scan';

  @override
  String get settings_maxSpeed => 'Vitesse max (0ms)';

  @override
  String get settings_batterySaver => 'Économie batterie (500ms)';

  @override
  String get settings_resolution => 'Résolution';

  @override
  String get settings_detectionSpeed => 'Vitesse de détection';

  @override
  String get settings_fast => 'Rapide';

  @override
  String get settings_accurate => 'Précis';

  @override
  String get settings_accurateModeHint =>
      'Le mode précis améliore la détection dans les images bruitées mais utilise plus de CPU.';

  @override
  String get settings_torch => 'Lampe torche';

  @override
  String get settings_torchDesc => 'Activer le flash de la caméra si supporté';

  @override
  String get settings_scannerTip =>
      'Pour de meilleurs résultats avec le scanner, utilisez l\'application native pour votre appareil.';

  @override
  String get settings_wakelock => 'Verrouillage écran';

  @override
  String get settings_wakelockDesc => 'Garder l\'écran allumé pendant le scan';

  @override
  String get settings_scanMode => 'Mode de scan';

  @override
  String get settings_scanModeRealtime => 'Temps réel';

  @override
  String get settings_scanModeRealtimeDesc =>
      'Traiter chaque image immédiatement (latence réduite)';

  @override
  String get settings_scanModeBatch => 'Par lots';

  @override
  String get settings_scanModeBatchDesc =>
      'Collecter les images puis traiter (plus fiable)';

  @override
  String get settings_batchDelay => 'Délai entre lots (ms)';

  @override
  String get settings_maxCacheFrames => 'Images en cache max';

  @override
  String get settings_unknownResolution => 'Résolution inconnue';

  @override
  String get settings_detectionTimeout => 'Délai de détection';

  @override
  String get settings_detectionNormal => 'Normal';

  @override
  String get settings_detectionNoDuplicates => 'Sans doublons';

  @override
  String get settings_detectionUnrestricted => 'Sans restriction';

  @override
  String get settings_torchFlash => 'Flash (Lampe)';

  @override
  String get settings_torchFlashDesc => 'Activer en faible luminosité';

  @override
  String get settings_syncScannedFiles => 'Sync fichiers scannés';

  @override
  String get settings_syncScannedFilesDesc =>
      'Envoyer les fichiers scannés au serveur';

  @override
  String get settings_syncGeneratedFiles => 'Sync fichiers générés';

  @override
  String get settings_syncGeneratedFilesDesc =>
      'Envoyer les GIFs générés au serveur';

  @override
  String get settings_autoSyncShort => 'Sync auto';

  @override
  String get settings_autoSyncShortDesc =>
      'Synchroniser automatiquement après scan/génération';

  @override
  String get settings_poweredBy => 'Propulsé par les codes fontaine RaptorQ';

  @override
  String get settings_serverSyncSection => 'SYNCHRONISATION SERVEUR';

  @override
  String get settings_enableSync => 'Activer la synchronisation';

  @override
  String get settings_enableSyncDesc =>
      'Synchroniser l\'historique entre les appareils et reprendre les scans.';

  @override
  String get settings_syncScanned => 'Synchroniser l\'historique des scans';

  @override
  String get settings_syncScannedDesc =>
      'Envoyer les paquets scannés et afficher l\'historique distant.';

  @override
  String get settings_syncGenerated => 'Synchroniser l\'historique généré';

  @override
  String get settings_syncGeneratedDesc =>
      'Envoyer les fichiers QR générés vers le serveur.';

  @override
  String get settings_autoSync => 'Synchronisation automatique';

  @override
  String get settings_autoSyncDesc =>
      'Envoyer automatiquement les éléments scannés et générés vers le serveur.';

  @override
  String get settings_testConnection => 'Connexion';

  @override
  String get settings_testingConnection => 'Connexion...';

  @override
  String get settings_syncNow => 'Sync';

  @override
  String get settings_syncing => 'Synchronisation...';

  @override
  String get settings_localServerTitle => 'Serveur local';

  @override
  String get settings_localServerDesc =>
      'Démarrer le serveur de synchronisation intégré depuis cette app.';

  @override
  String get settings_localServerDesktopOnly =>
      'Le lancement du serveur local est disponible sur desktop uniquement.';

  @override
  String settings_localServerRunningOn(Object serverUrl) {
    return 'Lancé sur $serverUrl';
  }

  @override
  String get settings_launchLocalServer => 'Lancer le serveur local';

  @override
  String get settings_localServerRunning => 'Lancé';

  @override
  String get settings_stopLocalServer => 'Arrêter le serveur';

  @override
  String get settings_localServerStopped => 'Serveur local arrêté.';

  @override
  String get settings_localServerStarting => 'Démarrage...';

  @override
  String get settings_localServerDialogTitle => 'Lancer le serveur local';

  @override
  String get settings_startServer => 'Démarrer le serveur';

  @override
  String get settings_localServerPort => 'Port';

  @override
  String get settings_connectionSuccess => 'Connecté !';

  @override
  String get settings_offlineWebTitle => 'App web hors ligne';

  @override
  String get settings_offlineWebMenuDesc =>
      'Servir encodeur et décodeur sur le réseau';

  @override
  String get settings_offlineWebDesc =>
      'Démarrez l\'app web AirQR intégrée pour qu\'un autre appareil du réseau ouvre l\'encodeur et le décodeur dans un navigateur.';

  @override
  String get settings_startOfflineWeb => 'Démarrer l\'app web hors ligne';

  @override
  String get settings_stopOfflineWeb => 'Arrêter l\'app web hors ligne';

  @override
  String get settings_offlineWebStarting => 'Démarrage...';

  @override
  String get settings_offlineWebRunning => 'Lancé';

  @override
  String get settings_offlineWebStoppedStatus => 'Arrêté';

  @override
  String get settings_offlineWebStopped => 'App web hors ligne arrêtée.';

  @override
  String get settings_offlineWebNoUrl =>
      'Démarrez le serveur pour obtenir une URL réseau.';

  @override
  String get settings_offlineWebCopied => 'URL de l\'app web hors ligne copiée';

  @override
  String get settings_offlineWebStartFailed =>
      'Impossible de démarrer le serveur web hors ligne.';

  @override
  String settings_offlineWebRunningOn(Object serverUrl) {
    return 'Disponible sur $serverUrl';
  }

  @override
  String settings_offlineWebMoreUrls(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count autres URL réseau disponibles',
      one: '1 autre URL réseau disponible',
    );
    return '$_temp0';
  }

  @override
  String get settings_fileExportSection => 'EXPORT FICHIERS (SERVEUR)';

  @override
  String get settings_fileExportDesc =>
      'Configurez où le serveur enregistre les fichiers reçus. Les fichiers sont organisés par date (AAAA-MM-JJ).';

  @override
  String get settings_enableExport => 'Activer l\'export de fichiers';

  @override
  String get settings_enableExportDesc =>
      'Enregistrer les fichiers reçus dans le répertoire configuré.';

  @override
  String get settings_exportScanned => 'Exporter les fichiers scannés';

  @override
  String get settings_exportScannedDesc =>
      'Enregistrer les fichiers reçus par scan QR.';

  @override
  String get settings_exportGenerated => 'Exporter les fichiers générés';

  @override
  String get settings_exportGeneratedDesc =>
      'Enregistrer les fichiers QR générés.';

  @override
  String get settings_exportDirectory =>
      'Répertoire d\'export (chemin PC ou NAS)';

  @override
  String get settings_exportDirectoryPlaceholder =>
      'C:\\AirQR-Files ou \\\\NAS\\partage\\AirQR';

  @override
  String get settings_exportDirectoryHint =>
      'Chemin sur la machine serveur. Utilisez un chemin UNC (\\\\NAS\\partage) pour les lecteurs réseau.';

  @override
  String get settings_pathWarning =>
      'Chemin enregistré mais pas encore accessible :';

  @override
  String get settings_pathReady => 'Chemin d\'export prêt :';

  @override
  String get settings_configSaved => 'Configuration enregistrée !';

  @override
  String settings_syncSuccess(int uploaded, int downloaded) {
    return 'Sync : $uploaded envoyés, $downloaded reçus';
  }

  @override
  String get settings_serverUrl => 'URL du serveur';

  @override
  String get settings_serverUrlHint =>
      'Envoie les paquets vers /api/scan/packet';

  @override
  String get settings_username => 'Nom d\'utilisateur';

  @override
  String get settings_password => 'Mot de passe';

  @override
  String get settings_apiKey => 'Clé API (optionnel)';

  @override
  String get settings_optional => 'Optionnel';

  @override
  String get settings_deviceName => 'Nom de l\'appareil';

  @override
  String get settings_deviceNameHint =>
      'Nom pour identifier cet appareil sur le serveur';

  @override
  String get settings_appearanceSection => 'APPARENCE';

  @override
  String get settings_language => 'Langue';

  @override
  String get settings_languageEnglish => 'English';

  @override
  String get settings_languageFrench => 'Français';

  @override
  String get settings_languageSystem => 'Système';

  @override
  String get settings_defaultCamera => 'Caméra par défaut';

  @override
  String get settings_defaultCameraDesc =>
      'Caméra à utiliser par défaut lors de l\'ouverture du scanner';

  @override
  String get settings_selectDefaultCamera => 'Choisir une caméra';

  @override
  String get settings_noCameraDetected => 'Aucune caméra détectée';

  @override
  String get settings_theme => 'Thème';

  @override
  String get settings_themeLight => 'Clair';

  @override
  String get settings_themeDark => 'Sombre';

  @override
  String get settings_themeSystem => 'Système';

  @override
  String get settings_clearData => 'Effacer toutes les données';

  @override
  String get settings_clearDataConfirm =>
      'Ceci effacera toutes les données de l\'application, y compris l\'historique, les paramètres et les fichiers en cache. Continuer ?';

  @override
  String get settings_clearDataFailed => 'Échec de l\'effacement des données';

  @override
  String get settings_aboutSection => 'À PROPOS';

  @override
  String get settings_appName => 'AirQR Mobile';

  @override
  String get settings_appDescription =>
      'Transfert de fichiers air-gap via codes QR animés';

  @override
  String get settings_madeWith => 'Fait avec ❤️ par';

  @override
  String get settings_starOnGithub => 'Étoiler sur GitHub';

  @override
  String get settings_version => 'Version';

  @override
  String get errors_cameraAccessDenied =>
      'Accès à la caméra refusé ou indisponible';

  @override
  String get errors_fileTooLarge => 'Le fichier est trop volumineux';

  @override
  String get errors_invalidFileType =>
      'Type de fichier invalide. Veuillez sélectionner un fichier valide.';

  @override
  String get errors_encodingFailed =>
      'Échec de l\'encodage du fichier en codes QR';

  @override
  String get errors_decodingFailed => 'Échec du décodage des codes QR';

  @override
  String get errors_fileSaveFailed => 'Échec de l\'enregistrement du fichier';

  @override
  String get errors_invalidServerUrl => 'URL du serveur invalide';

  @override
  String errors_serverError(String status) {
    return 'Erreur serveur : $status';
  }

  @override
  String get errors_connectionFailed => 'Impossible de se connecter au serveur';

  @override
  String errors_zipFolderFailed(String error) {
    return 'Échec de la compression du dossier : $error';
  }

  @override
  String get errors_unsupportedFormat =>
      'Format de fichier non supporté. Utilisez .gif ou .zip';

  @override
  String get errors_nativeInitFailed =>
      'Échec de l\'initialisation de la bibliothèque native';

  @override
  String get errors_chunkEncodingFailed => 'Échec de l\'encodage par chunks';

  @override
  String get encoder_targetSizePx => 'Taille cible (px)';

  @override
  String encoder_overheadValue(String value) {
    return 'Redondance ($value)';
  }

  @override
  String get encoder_enableCompression => 'Activer la compression';

  @override
  String get encoder_enableCompressionDesc =>
      'Compresser les données avec ZIP (taille réduite)';

  @override
  String history_errorSaving(String error) {
    return 'Erreur d\'enregistrement : $error';
  }

  @override
  String get decoder_decoding => 'Décodage...';

  @override
  String get decoder_selectGifFile => 'Sélectionnez un fichier GIF à décoder';

  @override
  String get settings_serverConnected => 'CONNECTÉ';

  @override
  String get settings_serverUnavailable => 'INDISPONIBLE';

  @override
  String get settings_loggingSection => 'JOURNALISATION';

  @override
  String get settings_logLevel => 'Niveau de journalisation';

  @override
  String get settings_modules => 'Modules';

  @override
  String get settings_resetToDefaults => 'Rétablir les valeurs par défaut';

  @override
  String get settings_backToSettings => 'Retour aux réglages';

  @override
  String get settings_logDebug => 'Débogage';

  @override
  String get settings_logInfo => 'Info';

  @override
  String get settings_logWarn => 'Avertissement';

  @override
  String get settings_logError => 'Erreur';

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
  String get settings_syncEnabled => 'Sync : activée';

  @override
  String get settings_syncDisabled => 'Sync : désactivée';

  @override
  String get settings_encoderMenu => 'Encodeur';

  @override
  String get settings_scannerMenu => 'Scanner';

  @override
  String get settings_serverSyncMenu => 'Synchronisation serveur';

  @override
  String get settings_appearanceMenu => 'Apparence';

  @override
  String get settings_loggingMenu => 'Journalisation';

  @override
  String get settings_aboutMenu => 'À propos';

  @override
  String get decoder_unknownError => 'Erreur inconnue';

  @override
  String get encoder_startAutomaticPlayback =>
      'Démarrer la lecture automatique';

  @override
  String get encoder_pauseAutomaticPlayback =>
      'Suspendre la lecture automatique';

  @override
  String get encoder_playbackAutomatic => 'AUTO';

  @override
  String get encoder_playbackFixed => 'FIXE';

  @override
  String get encoder_openFullscreen => 'Ouvrir en plein écran';

  @override
  String get encoder_previousChunk => 'Chunk précédent';

  @override
  String get encoder_nextChunk => 'Chunk suivant';

  @override
  String encoder_frameProgress(int current, int total, int minimum) {
    return 'Image : $current/$total (Min. : $minimum)';
  }

  @override
  String get history_sort => 'Trier';

  @override
  String get history_sortNewest => 'Plus récent';

  @override
  String get history_sortOldest => 'Plus ancien';

  @override
  String get history_sortLargest => 'Plus volumineux';

  @override
  String get history_sortSmallest => 'Moins volumineux';

  @override
  String get history_sortNameAscending => 'Nom A–Z';

  @override
  String get history_sortNameDescending => 'Nom Z–A';

  @override
  String get history_clearHistory => 'Effacer l’historique';

  @override
  String get history_clearHistoryTitle => 'Effacer l’historique ?';

  @override
  String get history_clearHistoryMessage =>
      'Tous les fichiers de l’historique et les scans incomplets seront supprimés. Continuer ?';

  @override
  String get history_previewOpenFailed =>
      'Impossible d’ouvrir l’aperçu du fichier.';

  @override
  String history_previewOpenError(String error) {
    return 'Erreur à l’ouverture du fichier : $error';
  }

  @override
  String get settings_localServerStartFailed =>
      'Impossible de démarrer le serveur local.';

  @override
  String get history_serverDeleteFailed =>
      'Suppression côté serveur impossible.';

  @override
  String scanner_cameraListFailed(String error) {
    return 'Impossible de lister les caméras : $error';
  }

  @override
  String scanner_cameraOpenFailed(String error) {
    return 'Impossible d’ouvrir la caméra : $error';
  }

  @override
  String get scanner_cameraOpenUnavailable => 'Impossible d’ouvrir la caméra.';

  @override
  String scanner_cameraCaptureFailed(String error) {
    return 'Erreur de caméra : $error';
  }
}
