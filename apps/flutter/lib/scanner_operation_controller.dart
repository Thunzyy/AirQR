import 'dart:async';

/// Serializes decoder work with reset/resume and invalidates late UI results.
class ScannerOperationController {
  int _generation = 0;
  Future<void>? _frame;
  Future<void>? _transition;

  int get generation => _generation;
  bool get isBusy => _frame != null || _transition != null;
  bool isCurrent(int generation) => generation == _generation;

  void invalidate() => _generation++;

  Future<void> get idle => _frame ?? Future<void>.value();

  Future<void> process(Future<void> Function(int generation) action) {
    if (isBusy) return Future<void>.value();
    final done = Completer<void>();
    _frame = done.future;
    final generation = _generation;
    Future<void>.sync(() => action(generation)).then(
      (_) {
        _frame = null;
        done.complete();
      },
      onError: (Object error, StackTrace stack) {
        _frame = null;
        done.completeError(error, stack);
      },
    );
    return done.future;
  }

  Future<void> restart(Future<void> Function() action) {
    if (_transition != null) return _transition!;
    invalidate();
    final done = Completer<void>();
    _transition = done.future;
    () async {
      try {
        // An obsolete frame may fail; it must not prevent the user's reset.
        try {
          await idle;
        } catch (_) {}
        await action();
        done.complete();
      } catch (error, stack) {
        done.completeError(error, stack);
      } finally {
        _transition = null;
      }
    }();
    return done.future;
  }
}
