import 'package:airqr_mobile/l10n/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('remaining native copy is localized in English and French', () {
    final en = lookupAppLocalizations(const Locale('en'));
    final fr = lookupAppLocalizations(const Locale('fr'));

    expect(en.decoder_unknownError, 'Unknown error');
    expect(fr.decoder_unknownError, 'Erreur inconnue');
    expect(en.settings_noCameraDetected, 'No camera detected');
    expect(fr.settings_noCameraDetected, 'Aucune caméra détectée');
    expect(
      en.scanner_cameraListFailed('USB error'),
      'Failed to list cameras: USB error',
    );
    expect(
      fr.scanner_cameraListFailed('Erreur USB'),
      'Impossible de lister les caméras : Erreur USB',
    );
    expect(
      en.scanner_cameraOpenFailed('USB error'),
      'Failed to open camera: USB error',
    );
    expect(
      fr.scanner_cameraOpenFailed('Erreur USB'),
      'Impossible d’ouvrir la caméra : Erreur USB',
    );
    expect(
      en.scanner_cameraCaptureFailed('USB error'),
      'Camera error: USB error',
    );
    expect(
      fr.scanner_cameraCaptureFailed('Erreur USB'),
      'Erreur de caméra : Erreur USB',
    );
    expect(en.encoder_startAutomaticPlayback, 'Start automatic playback');
    expect(
      fr.encoder_startAutomaticPlayback,
      'Démarrer la lecture automatique',
    );
    expect(en.encoder_pauseAutomaticPlayback, 'Pause automatic playback');
    expect(
      fr.encoder_pauseAutomaticPlayback,
      'Suspendre la lecture automatique',
    );
    expect(en.encoder_playbackAutomatic, 'AUTO');
    expect(fr.encoder_playbackAutomatic, 'AUTO');
    expect(en.encoder_playbackFixed, 'FIXED');
    expect(fr.encoder_playbackFixed, 'FIXE');
    expect(en.encoder_openFullscreen, 'Open fullscreen');
    expect(fr.encoder_openFullscreen, 'Ouvrir en plein écran');
    expect(en.encoder_previousChunk, 'Previous chunk');
    expect(fr.encoder_previousChunk, 'Chunk précédent');
    expect(en.encoder_nextChunk, 'Next chunk');
    expect(fr.encoder_nextChunk, 'Chunk suivant');
    expect(fr.encoder_dataChunks, 'Chunks');
    expect(fr.encoder_chunk(2, 6), 'Chunk 2/6');
    expect(en.history_sortNewest, 'Newest first');
    expect(fr.history_sortNewest, 'Plus récent');
    expect(en.history_sortOldest, 'Oldest first');
    expect(fr.history_sortOldest, 'Plus ancien');
    expect(en.history_clearHistory, 'Clear history');
    expect(fr.history_clearHistory, 'Effacer l’historique');
    expect(en.history_previewOpenFailed, 'Could not open file preview.');
    expect(
      fr.history_previewOpenFailed,
      'Impossible d’ouvrir l’aperçu du fichier.',
    );
    expect(en.history_serverDeleteFailed, 'Failed to delete on server.');
    expect(
      fr.history_serverDeleteFailed,
      'Suppression côté serveur impossible.',
    );
    expect(en.settings_localServerStartFailed, 'Could not start local server.');
    expect(
      fr.settings_localServerStartFailed,
      'Impossible de démarrer le serveur local.',
    );
  });
}
