import 'scanner_history_save_controller.dart';

sealed class ScannerHistoryFeedbackTransition {
  const ScannerHistoryFeedbackTransition();
}

class ScannerHistoryFeedbackSuccessTransition
    extends ScannerHistoryFeedbackTransition {
  final String filePath;
  final String fileName;

  const ScannerHistoryFeedbackSuccessTransition({
    required this.filePath,
    required this.fileName,
  });
}

class ScannerHistoryFeedbackFailureTransition
    extends ScannerHistoryFeedbackTransition {
  final String status;

  const ScannerHistoryFeedbackFailureTransition({required this.status});
}

typedef ScannerHistoryFeedbackSaveCallback =
    Future<ScannerHistorySaveResult> Function({
      required List<int> data,
      required String? filename,
      required String? sessionId,
    });

class ScannerHistoryFeedbackController {
  final ScannerHistoryFeedbackSaveCallback _saveHistoryItem;

  ScannerHistoryFeedbackController({
    ScannerHistoryFeedbackSaveCallback? saveHistoryItem,
  }) : _saveHistoryItem =
           saveHistoryItem ??
           (({
             required data,
             required filename,
             required sessionId,
           }) => ScannerHistorySaveController().save(
             data: data,
             filename: filename,
             sessionId: sessionId,
           ));

  Future<ScannerHistoryFeedbackTransition> save({
    required List<int> data,
    required String? filename,
    required String? sessionId,
  }) async {
    try {
      final saveResult = await _saveHistoryItem(
        data: data,
        filename: filename,
        sessionId: sessionId,
      );
      return ScannerHistoryFeedbackSuccessTransition(
        filePath: saveResult.filePath,
        fileName: saveResult.fileName,
      );
    } catch (error) {
      return ScannerHistoryFeedbackFailureTransition(
        status: 'Error saving: $error',
      );
    }
  }
}
