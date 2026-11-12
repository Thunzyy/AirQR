import 'dart:async';
import 'dart:collection';

/// Admits packets without waiting for storage, up to a bounded backlog.
/// A failed batch stays queued, including records committed before the failure;
/// the writer must therefore support idempotent retry.
class ScanPersistenceQueue<T> {
  final Future<void> Function(List<T>) writeBatch;
  final int Function(T) sizeOf;
  final void Function(Object?)? onError;
  final Duration interval;
  final int batchSize;
  final int maxPackets;
  final int maxBytes;
  final _pending = Queue<T>();
  int _bytes = 0;
  Timer? _timer;
  Future<void>? _flushing;
  bool _closed = false;
  bool _discarded = false;
  bool _failed = false;

  ScanPersistenceQueue({
    required this.writeBatch,
    required this.sizeOf,
    this.onError,
    this.interval = const Duration(milliseconds: 500),
    this.batchSize = 16,
    this.maxPackets = 128,
    this.maxBytes = 512 * 1024,
  }) : assert(batchSize > 0),
       assert(maxPackets >= batchSize),
       assert(maxBytes > 0);

  int get pendingCount => _pending.length;
  int get pendingBytes => _bytes;
  bool get isClosed => _closed;

  Future<void> waitForCapacity(int bytes) async {
    if (bytes < 0 || bytes > maxBytes) {
      throw ArgumentError.value(
        bytes,
        'bytes',
        'Packet exceeds queue capacity',
      );
    }
    while (_pending.length >= maxPackets || _bytes + bytes > maxBytes) {
      await flush();
    }
  }

  Future<void> add(T record) async {
    if (_closed) throw StateError('Scan persistence session is closed');
    final bytes = sizeOf(record);
    if (bytes < 0 || bytes > maxBytes) {
      throw ArgumentError.value(
        bytes,
        'bytes',
        'Packet exceeds queue capacity',
      );
    }
    // Check and reserve without yielding when there is room: concurrent
    // producers must not all pass an asynchronous capacity check at once.
    while (_pending.length >= maxPackets || _bytes + bytes > maxBytes) {
      await flush();
    }
    if (_closed) throw StateError('Scan persistence session is closed');
    _pending.add(record);
    _bytes += bytes;
    if (_pending.length >= batchSize && _flushing == null) {
      _startBackgroundFlush();
    } else {
      _schedule();
    }
  }

  void _schedule() {
    if (_closed ||
        _discarded ||
        _pending.isEmpty ||
        _timer != null ||
        _flushing != null) {
      return;
    }
    _timer = Timer(_failed ? const Duration(seconds: 2) : interval, () {
      _timer = null;
      _startBackgroundFlush();
    });
  }

  void _startBackgroundFlush() {
    // flush reports the failure and keeps the batch for retry. Background
    // errors must not become unhandled asynchronous exceptions.
    unawaited(flush().catchError((Object _) {}));
  }

  Future<void> flush() {
    if (_flushing != null) return _flushing!;
    _timer?.cancel();
    _timer = null;
    final operation = _drain().whenComplete(() {
      _flushing = null;
      _schedule();
    });
    _flushing = operation;
    return operation;
  }

  Future<void> _drain() async {
    try {
      while (_pending.isNotEmpty && !_discarded) {
        final batch = _pending.take(batchSize).toList(growable: false);
        await writeBatch(batch);
        for (var i = 0; i < batch.length; i++) {
          _bytes -= sizeOf(_pending.removeFirst());
        }
      }
      if (_failed && !_discarded) onError?.call(null);
      _failed = false;
    } catch (error) {
      _failed = true;
      onError?.call(error);
      rethrow;
    }
  }

  /// Close admission immediately, then commit every already accepted packet.
  Future<void> close() {
    _closed = true;
    return flush();
  }

  /// Explicit deletion: wait for any active transaction, then forget the rest.
  /// No writer can run after this returns and recreate a deleted session.
  Future<void> discard() async {
    _closed = true;
    _discarded = true;
    _timer?.cancel();
    _timer = null;
    try {
      await _flushing;
    } catch (_) {
      // The caller is intentionally deleting this session, including retries.
    }
    _pending.clear();
    _bytes = 0;
  }
}
