import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

import 'history_item.dart';
import 'parse/wire.dart';
import 'sync_service.dart';
import 'sync_settings.dart';
import 'utils.dart';

class HistoryService {
  static const String _key = 'airqr_history';

  static Future<List<HistoryItem>> getHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final jsonString = prefs.getString(_key);
    if (jsonString == null) return [];

    final decoded = parseJsonText(jsonString);
    final jsonList = tryWireList(decoded);
    if (jsonList == null) return [];
    final list = jsonList.map(HistoryItem.fromJson).toList();
    final deduped = _deduplicate(list);
    if (deduped.length != list.length) {
      final normalizedJson = jsonEncode(
        deduped.map((e) => e.toJson()).toList(),
      );
      await prefs.setString(_key, normalizedJson);
    }
    return deduped;
  }

  static Future<void> addItem(HistoryItem item) async {
    final list = await getHistory();
    list.insert(0, item);
    await _save(list);
  }

  static Future<void> add({
    required String path,
    required String origin,
    String? mimeType,
    int? totalFrames,
    int? minFrames,
    List<int>? chunkMinFrames,
    int? timestamp,
    bool syncToServer = true,
    bool isSynced = false,
    String? serverId,
    String? serverSessionId,
  }) async {
    final file = File(path);
    final size = await file.exists() ? await file.length() : 0;
    final ts = timestamp ?? DateTime.now().millisecondsSinceEpoch;

    final item = HistoryItem(
      path: path,
      timestamp: ts,
      size: size,
      origin: origin,
      mimeType: mimeType,
      totalFrames: totalFrames,
      minFrames: minFrames,
      chunkMinFrames: chunkMinFrames,
      isSynced: isSynced,
      serverId: serverId ?? serverSessionId,
    );

    final list = await getHistory();
    final key = _dedupeKey(item);
    list.removeWhere((existing) => _dedupeKey(existing) == key);
    list.insert(0, item);
    await _save(list);

    if (syncToServer) {
      final settings = await SyncSettingsService.load();
      debugPrint(
        'Sync check: enabled=${settings.enabled}, isConfigured=${settings.isConfigured}, autoSync=${settings.autoSync}, syncScanned=${settings.syncScanned}, origin=$origin, serverSessionId=$serverSessionId',
      );
      if (settings.isConfigured && settings.autoSync) {
        final fileBytes = await file.readAsBytes();
        final filename = p.basename(path);
        final safeFilename = sanitizeId(filename);
        final uniqueId = '${origin}_${safeFilename}_$ts';
        final isoTimestamp = DateTime.fromMillisecondsSinceEpoch(
          ts,
        ).toUtc().toIso8601String();

        if (origin == 'scanned' && settings.syncScanned) {
          final sessionIdToUse = serverSessionId ?? 'mobile_$uniqueId';
          debugPrint(
            '📤 SCAN_LOG: Completing scan on server with sessionId=$sessionIdToUse',
          );
          await SyncService.uploadScan(
            sessionId: sessionIdToUse,
            filename: filename,
            fileBytes: fileBytes,
            mimeType: mimeType ?? 'application/octet-stream',
            completedAt: isoTimestamp,
          );
        } else if (origin == 'generated' && settings.syncGenerated) {
          await SyncService.uploadGenerated(
            historyId: 'mobile_$uniqueId',
            filename: filename,
            fileBytes: fileBytes,
            mimeType: mimeType ?? 'application/octet-stream',
            createdAt: isoTimestamp,
            totalFrames: totalFrames,
            minFrames: minFrames,
            chunkMinFrames: chunkMinFrames,
          );
        }
      }
    }
  }

  static Future<void> remove(String path) async {
    final list = await getHistory();
    list.removeWhere((item) => item.path == path);
    await _save(list);

    final file = File(path);
    if (await file.exists()) {
      await file.delete();
    }
  }

  static Future<void> markAsSynced(String path, String serverId) async {
    final list = await getHistory();
    for (int i = 0; i < list.length; i++) {
      if (list[i].path == path) {
        list[i] = list[i].copyWith(isSynced: true, serverId: serverId);
        break;
      }
    }
    await _save(list);
  }

  static Future<void> removeByServerId(String serverId) async {
    final list = await getHistory();
    final toRemove = list.where((item) => item.serverId == serverId).toList();

    for (final item in toRemove) {
      final file = File(item.path);
      if (await file.exists()) {
        await file.delete();
      }
    }

    list.removeWhere((item) => item.serverId == serverId);
    await _save(list);
  }

  static Future<void> markAsLocal(String path) async {
    final list = await getHistory();
    for (int i = 0; i < list.length; i++) {
      if (list[i].path == path) {
        list[i] = HistoryItem(
          path: list[i].path,
          timestamp: list[i].timestamp,
          size: list[i].size,
          origin: list[i].origin,
          mimeType: list[i].mimeType,
          totalFrames: list[i].totalFrames,
          minFrames: list[i].minFrames,
          chunkMinFrames: list[i].chunkMinFrames,
          isSynced: false,
          serverId: null,
          isLocalOnly: true,
        );
        break;
      }
    }
    await _save(list);
  }

  static Future<void> enableSync(String path) async {
    final list = await getHistory();
    for (int i = 0; i < list.length; i++) {
      if (list[i].path == path) {
        list[i] = HistoryItem(
          path: list[i].path,
          timestamp: list[i].timestamp,
          size: list[i].size,
          origin: list[i].origin,
          mimeType: list[i].mimeType,
          totalFrames: list[i].totalFrames,
          minFrames: list[i].minFrames,
          chunkMinFrames: list[i].chunkMinFrames,
          isSynced: false,
          serverId: null,
          isLocalOnly: false,
        );
        break;
      }
    }
    await _save(list);
  }

  static Future<void> _save(List<HistoryItem> list) async {
    final prefs = await SharedPreferences.getInstance();
    final deduped = _deduplicate(list);
    final jsonString = jsonEncode(deduped.map((e) => e.toJson()).toList());
    await prefs.setString(_key, jsonString);
  }

  static String _dedupeKey(HistoryItem item) {
    final serverId = item.serverId;
    if (serverId != null && serverId.isNotEmpty) {
      return '${item.origin}|sid|$serverId';
    }
    return '${item.origin}|path|${item.path}';
  }

  static List<HistoryItem> _deduplicate(List<HistoryItem> items) {
    final seen = <String>{};
    final result = <HistoryItem>[];
    for (final item in items) {
      final key = _dedupeKey(item);
      if (seen.contains(key)) continue;
      seen.add(key);
      result.add(item);
    }
    return result;
  }
}
