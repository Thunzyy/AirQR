import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;

typedef SafeLocalFileBeforeCommit = FutureOr<void> Function(String path);
typedef SafeLocalFileAfterReserve = FutureOr<void> Function(String path);

/// Owns safe persistence of bytes received with an untrusted remote filename.
class SafeLocalFileWriter {
  static const String _fallbackFilename = 'download.bin';
  static final RegExp _invalidCharacters = RegExp(r'[<>:"/\\|?*\x00-\x1F]');
  static final RegExp _windowsReservedName = RegExp(
    r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',
    caseSensitive: false,
  );
  static SafeLocalFileBeforeCommit? _beforeCommitForTesting;
  static SafeLocalFileAfterReserve? _afterReserveForTesting;

  static String safeBasename(String untrustedFilename) {
    final segments = untrustedFilename.split(RegExp(r'[/\\]+'));
    var candidate = segments.isEmpty ? '' : segments.last;
    candidate = candidate.replaceFirst(RegExp(r'^[A-Za-z]:'), '');
    candidate = candidate.replaceAll(_invalidCharacters, '_').trim();
    candidate = candidate.replaceFirst(RegExp(r'[. ]+$'), '');

    if (candidate.isEmpty || candidate == '.' || candidate == '..') {
      candidate = _fallbackFilename;
    }
    if (_windowsReservedName.hasMatch(candidate)) {
      candidate = '_$candidate';
    }
    return candidate;
  }

  @visibleForTesting
  static void setBeforeCommitForTesting(
    SafeLocalFileBeforeCommit? beforeCommit,
  ) {
    _beforeCommitForTesting = beforeCommit;
  }

  @visibleForTesting
  static void setAfterReserveForTesting(
    SafeLocalFileAfterReserve? afterReserve,
  ) {
    _afterReserveForTesting = afterReserve;
  }

  static Future<String> writeBytes(
    Directory directory,
    String untrustedFilename,
    List<int> bytes,
  ) async {
    await directory.create(recursive: true);
    final canonicalRoot = p.normalize(await directory.resolveSymbolicLinks());
    final filename = safeBasename(untrustedFilename);
    final extension = p.extension(filename);
    final basename = p.basenameWithoutExtension(filename);
    var counter = 0;

    while (true) {
      final candidateName = counter == 0
          ? filename
          : '$basename ($counter)$extension';
      final candidatePath = p.normalize(p.join(canonicalRoot, candidateName));
      if (!p.isWithin(canonicalRoot, candidatePath)) {
        throw StateError('Resolved download path escaped its target directory');
      }

      await _beforeCommitForTesting?.call(candidatePath);
      final candidateFile = File(candidatePath);
      try {
        // This exclusive create is the no-replace linearization point shared
        // by isolates and processes. Existing files, directories, links, and
        // junctions all lose the candidate and force a suffixed retry.
        await candidateFile.create(exclusive: true);
      } on FileSystemException {
        final candidateType = await FileSystemEntity.type(
          candidatePath,
          followLinks: false,
        );
        if (candidateType == FileSystemEntityType.notFound) rethrow;
        counter += 1;
        continue;
      }

      RandomAccessFile? handle;
      var committed = false;
      try {
        await _afterReserveForTesting?.call(candidatePath);
        final reservedType = await FileSystemEntity.type(
          candidatePath,
          followLinks: false,
        );
        if (reservedType != FileSystemEntityType.file) {
          throw StateError(
            'Reserved download path is no longer a regular file',
          );
        }
        final canonicalCandidate = p.normalize(
          await candidateFile.resolveSymbolicLinks(),
        );
        if (!p.isWithin(canonicalRoot, canonicalCandidate)) {
          throw StateError(
            'Reserved download path escaped its target directory',
          );
        }

        // Dart has no public exclusive-open FileMode, so the public API
        // requires one reopen after the exclusive reservation. Benign
        // cross-process/isolate writers cannot clobber the reservation. A
        // malicious local writer able to replace this file between these two
        // operations is outside the remote-filename threat model.
        handle = await candidateFile.open(mode: FileMode.writeOnly);
        await handle.writeFrom(bytes);
        await handle.flush();
        await handle.close();
        handle = null;
        committed = true;
        return candidatePath;
      } finally {
        await handle?.close();
        if (!committed) {
          final failedType = await FileSystemEntity.type(
            candidatePath,
            followLinks: false,
          );
          if (failedType != FileSystemEntityType.notFound) {
            await candidateFile.delete();
          }
        }
      }
    }
  }
}
