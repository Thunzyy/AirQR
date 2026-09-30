import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_page_refresh.dart';
import 'package:airqr_mobile/history_service.dart';
import 'package:airqr_mobile/incomplete_scans.dart';
import 'package:airqr_mobile/sync_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('HistoryPageRefreshController', () {
    late Directory tempDir;

    setUp(() async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      tempDir = await Directory.systemTemp.createTemp('airqr-history-refresh');
    });

    tearDown(() async {
      SyncService.setHttpClientForTesting(null);
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    for (final invalidId in const <String>[
      '../x',
      'a/b',
      'a?b',
      'a#b',
      ' x ',
    ]) {
      test(
        'download rejects invalid server id $invalidId before request',
        () async {
          var requests = 0;
          SharedPreferences.setMockInitialValues(<String, Object>{
            'airqr_sync_settings': jsonEncode(<String, dynamic>{
              'enabled': true,
              'serverUrl': 'https://airqr.test',
            }),
          });
          SyncService.clearCache();
          SyncService.setHttpClientForTesting(
            MockClient((request) async {
              requests++;
              return http.Response('', 404);
            }),
          );

          final result = await HistoryPageRefreshController()
              .downloadCompletedScan(<String, dynamic>{
                'sessionId': invalidId,
                'filename': 'payload.bin',
              });

          expect(result.status, HistoryCompletedScanDownloadStatus.failed);
          expect(requests, 0);
        },
      );
    }

    test(
      'refresh returns local history and local incomplete scans offline',
      () async {
        final file = File('${tempDir.path}/offline.gif');
        await file.writeAsBytes(const <int>[1, 2, 3]);

        SharedPreferences.setMockInitialValues(<String, Object>{
          'airqr_history': jsonEncode(<Map<String, dynamic>>[
            HistoryItem(
              path: file.path,
              timestamp: 7,
              size: 3,
              origin: 'generated',
            ).toJson(),
          ]),
          'airqr_incomplete_scans': jsonEncode(<Map<String, dynamic>>[
            IncompleteScan(
              id: 'scan-1',
              startTimestamp: 10,
              lastUpdateTimestamp: 20,
              progress: 0.25,
              receivedPackets: 25,
              expectedPackets: 100,
              filename: 'offline.bin',
            ).toJson(),
          ]),
        });

        final controller = HistoryPageRefreshController();
        final snapshot = await controller.refresh();

        expect(snapshot.syncEnabled, isFalse);
        expect(snapshot.items, hasLength(1));
        expect(snapshot.items.single.path, file.path);
        expect(snapshot.incompleteScans, hasLength(1));
        expect(snapshot.incompleteScans.single.id, 'scan-1');
      },
    );

    test(
      'configured refresh merges completed server metadata and prefers local duplicates',
      () async {
        final localFile = File('${tempDir.path}/local-note.txt');
        await localFile.writeAsString('local');
        final duplicateLocalFile = File('${tempDir.path}/duplicate-local.txt');
        await duplicateLocalFile.writeAsString('duplicate');
        final localOnlyFile = File('${tempDir.path}/local-only.txt');
        await localOnlyFile.writeAsString('local-only');
        SharedPreferences.setMockInitialValues(<String, Object>{
          'airqr_sync_settings': jsonEncode(<String, dynamic>{
            'enabled': true,
            'serverUrl': 'https://airqr.test',
            'syncScanned': true,
            'syncGenerated': true,
          }),
          'airqr_history': jsonEncode(<Map<String, dynamic>>[
            HistoryItem(
              path: localFile.path,
              timestamp: 10,
              size: 5,
              origin: 'scanned',
              serverId: 'shared-item',
              isSynced: true,
            ).toJson(),
            HistoryItem(
              path: duplicateLocalFile.path,
              timestamp: 11,
              size: 9,
              origin: 'generated',
              serverId: 'shared-item',
              isSynced: true,
            ).toJson(),
            HistoryItem(
              path: localOnlyFile.path,
              timestamp: 12,
              size: 10,
              origin: 'scanned',
              isLocalOnly: true,
            ).toJson(),
          ]),
        });
        SyncService.clearCache();
        SyncService.setHttpClientForTesting(
          MockClient((request) async {
            if (request.url.path == '/api/scan/history') {
              return http.Response('[]', 200);
            }
            expect(request.url.path, '/api/history');
            expect(request.url.queryParameters['limit'], '500');
            return http.Response(
              jsonEncode(<Map<String, Object?>>[
                <String, Object?>{
                  'id': 'shared-item',
                  'origin': 'scanned',
                  'filename': 'remote-note.txt',
                  'mimeType': 'text/plain',
                  'size': 99,
                  'completed': true,
                  'createdAt': '2026-07-01T10:00:00Z',
                },
                <String, Object?>{
                  'id': 'remote-only',
                  'origin': 'generated',
                  'filename': r'C:\Users\victim\secret.txt',
                  'mimeType': 'image/gif',
                  'size': 12,
                  'totalFrames': 8,
                  'minFrames': 5,
                  'completed': true,
                  'createdAt': '2026-07-02T11:00:00Z',
                  'completedAt': '2026-07-02T12:00:00Z',
                  'updatedAt': '2026-07-02T13:00:00Z',
                },
                <String, Object?>{
                  'id': 'still-scanning',
                  'origin': 'scanned',
                  'filename': 'partial.bin',
                  'completed': false,
                  'receivedCount': 7,
                  'decodeThreshold': 10,
                  'completionPercent': 70,
                  'createdAt': '2026-07-02T09:00:00Z',
                  'updatedAt': '2026-07-02T10:00:00Z',
                },
                <String, Object?>{
                  'id': 'still-scanning',
                  'origin': 'scanned',
                  'filename': 'partial.bin',
                  'completed': false,
                  'receivedPackets': 6,
                  'expectedPackets': 10,
                },
                <String, Object?>{
                  'id': 'malformed-progress',
                  'origin': 'scanned',
                  'filename': ' Scanning... ',
                  'completed': false,
                  'receivedPackets': 'bad',
                  'packetCount': 4,
                  'expectedPackets': <String, Object?>{},
                  'totalPackets': 8,
                  'completionPercent': 'bad',
                  'progress': 0.5,
                },
                <String, Object?>{
                  'id': 'capped-progress',
                  'origin': 'scanned',
                  'completed': false,
                  'progress': 100,
                },
                <String, Object?>{
                  'id': 'nested-threshold',
                  'origin': 'scanned',
                  'completed': false,
                  'receivedPackets': 1,
                  'totalPackets': 1374,
                  'scanState': <String, Object?>{'decodeThreshold': 12753},
                },
                <String, Object?>{
                  'id': 'cross-origin',
                  'origin': 'scanned',
                  'filename': 'same.txt',
                  'completed': true,
                  'createdAt': '2026-07-03T10:00:00Z',
                },
                <String, Object?>{
                  'id': 'cross-origin',
                  'origin': 'generated',
                  'filename': 'same.txt',
                  'completed': true,
                  'createdAt': '2026-07-03T10:00:00Z',
                },
              ]),
              200,
            );
          }),
        );

        final snapshot = await HistoryPageRefreshController(
          loadIncompleteScans: () async => <IncompleteScan>[
            IncompleteScan(
              id: 'still-scanning',
              startTimestamp: 1,
              lastUpdateTimestamp: 2,
              progress: 0.9,
              receivedPackets: 9,
              expectedPackets: 10,
              filename: 'service-first.bin',
            ),
            IncompleteScan(
              id: 'still-scanning',
              startTimestamp: 3,
              lastUpdateTimestamp: 4,
              progress: 0.5,
              receivedPackets: 10,
              expectedPackets: 20,
            ),
          ],
        ).refresh();

        expect(snapshot.items, hasLength(6));
        final shared = snapshot.items
            .where((item) => item.serverId == 'shared-item')
            .toList();
        expect(shared, hasLength(2));
        expect(shared.map((item) => item.path), <String>[
          localFile.path,
          duplicateLocalFile.path,
        ]);
        expect(
          snapshot.items.singleWhere((item) => item.serverId == null).path,
          localOnlyFile.path,
        );
        final remote = snapshot.items.singleWhere(
          (item) => item.serverId == 'remote-only',
        );
        expect(remote.path, 'airqr-remote://generated/remote-only/secret.txt');
        expect(p.basename(remote.path), 'secret.txt');
        expect(p.isAbsolute(remote.path), isFalse);
        expect(remote.origin, 'generated');
        expect(remote.size, 12);
        expect(remote.totalFrames, 8);
        expect(remote.minFrames, 5);
        expect(remote.isSynced, isTrue);
        expect(
          remote.timestamp,
          DateTime.parse('2026-07-02T13:00:00Z').millisecondsSinceEpoch,
        );
        expect(
          snapshot.items.where((item) => item.serverId == 'still-scanning'),
          isEmpty,
        );
        expect(snapshot.incompleteScans, hasLength(4));
        final incomplete = snapshot.incompleteScans.singleWhere(
          (scan) => scan.id == 'still-scanning',
        );
        expect(incomplete.isRemote, isTrue);
        expect(incomplete.receivedPackets, 10);
        expect(incomplete.expectedPackets, 20);
        expect(incomplete.progress, 0.5);
        expect(incomplete.filename, 'service-first.bin');
        final malformed = snapshot.incompleteScans.singleWhere(
          (scan) => scan.id == 'malformed-progress',
        );
        expect(malformed.receivedPackets, 4);
        expect(malformed.expectedPackets, 8);
        expect(malformed.progress, 0.5);
        expect(malformed.filename, isNull);
        expect(
          snapshot.incompleteScans
              .singleWhere((scan) => scan.id == 'capped-progress')
              .progress,
          0.999,
        );
        expect(
          snapshot.incompleteScans
              .singleWhere((scan) => scan.id == 'nested-threshold')
              .expectedPackets,
          12753,
        );
        expect(
          snapshot.items
              .where((item) => item.serverId == 'cross-origin')
              .map((item) => item.path),
          <String>[
            'airqr-remote://scanned/cross-origin/same.txt',
            'airqr-remote://generated/cross-origin/same.txt',
          ],
        );
      },
    );

    test(
      'configured refresh falls back to local items on history failure',
      () async {
        final localFile = File('${tempDir.path}/local.gif');
        await localFile.writeAsBytes(const <int>[1]);
        SharedPreferences.setMockInitialValues(<String, Object>{
          'airqr_sync_settings': jsonEncode(<String, dynamic>{
            'enabled': true,
            'serverUrl': 'https://airqr.test',
            'syncScanned': true,
          }),
          'airqr_history': jsonEncode(<Map<String, dynamic>>[
            HistoryItem(
              path: localFile.path,
              timestamp: 7,
              size: 1,
              origin: 'generated',
            ).toJson(),
          ]),
        });
        SyncService.clearCache();
        SyncService.setHttpClientForTesting(
          MockClient((request) async {
            if (request.url.path == '/api/scan/history') {
              return http.Response('[]', 200);
            }
            return http.Response('unavailable', 503);
          }),
        );

        final snapshot = await HistoryPageRefreshController().refresh();

        expect(snapshot.items, hasLength(1));
        expect(snapshot.items.single.path, localFile.path);
      },
    );

    test(
      'configured refresh keeps an older incomplete scan outside the unified page',
      () async {
        SharedPreferences.setMockInitialValues(<String, Object>{
          'airqr_sync_settings': jsonEncode(<String, dynamic>{
            'enabled': true,
            'serverUrl': 'https://airqr.test',
            'syncScanned': true,
            'syncGenerated': true,
          }),
        });
        SyncService.clearCache();
        SyncService.setHttpClientForTesting(
          MockClient((request) async {
            if (request.url.path == '/api/history') {
              expect(request.url.queryParameters['limit'], '500');
              return http.Response(
                jsonEncode(
                  List<Map<String, Object?>>.generate(
                    500,
                    (index) => <String, Object?>{
                      'id': 'generated-newer-$index',
                      'origin': 'generated',
                      'completed': true,
                      'createdAt': '2026-07-02T12:00:00Z',
                    },
                  ),
                ),
                200,
              );
            }
            expect(request.url.path, '/api/scan/history');
            if (request.url.queryParameters['completed'] == 'false') {
              return http.Response(
                jsonEncode(<Map<String, Object?>>[
                  <String, Object?>{
                    'sessionId': 'scan-older-incomplete',
                    'completed': false,
                    'receivedCount': 7,
                    'expectedPackets': 10,
                    'updatedAt': '2026-06-24T13:11:46Z',
                  },
                ]),
                200,
              );
            }
            return http.Response(
              jsonEncode(<Map<String, Object?>>[
                <String, Object?>{
                  'sessionId': 'scan-older-incomplete',
                  'completed': false,
                  'receivedCount': 7,
                  'expectedPackets': 10,
                },
                const <String, Object?>{
                  'sessionId': '../malformed-completed',
                  'completed': true,
                },
              ]),
              200,
            );
          }),
        );

        final snapshot = await HistoryPageRefreshController().refresh();

        expect(snapshot.items, hasLength(500));
        expect(snapshot.incompleteScans, hasLength(1));
        final incomplete = snapshot.incompleteScans.single;
        expect(incomplete.id, 'scan-older-incomplete');
        expect(incomplete.isRemote, isTrue);
        expect(incomplete.receivedPackets, 7);
        expect(incomplete.expectedPackets, 10);
      },
    );

    test(
      'configured refresh falls back to local items when history fetch throws',
      () async {
        final localFile = File('${tempDir.path}/local-after-exception.gif');
        await localFile.writeAsBytes(const <int>[1]);
        SharedPreferences.setMockInitialValues(<String, Object>{
          'airqr_sync_settings': jsonEncode(<String, dynamic>{
            'enabled': true,
            'serverUrl': 'https://airqr.test',
            'syncScanned': true,
          }),
          'airqr_history': jsonEncode(<Map<String, dynamic>>[
            HistoryItem(
              path: localFile.path,
              timestamp: 8,
              size: 1,
              origin: 'generated',
            ).toJson(),
          ]),
        });
        SyncService.clearCache();
        SyncService.setHttpClientForTesting(
          MockClient((request) async {
            expect(request.url.path, '/api/scan/history');
            return http.Response('[]', 200);
          }),
        );

        final controller = HistoryPageRefreshController(
          fetchServerHistory: () async => throw StateError('network exploded'),
        );

        await expectLater(
          controller.refresh(),
          completion(
            isA<HistoryPageSnapshot>().having(
              (snapshot) => snapshot.items.single.path,
              'local item path',
              localFile.path,
            ),
          ),
        );
      },
    );

    for (final origin in const <String>['scanned', 'generated']) {
      test('materializes a remote-only $origin item safely', () async {
        String? downloadedId;
        String? downloadedOrigin;
        final controller = HistoryPageRefreshController(
          downloadFile: ({required id, required origin}) async {
            downloadedId = id;
            downloadedOrigin = origin;
            return const <int>[1, 2, 3];
          },
          documentsDirectory: () async => tempDir,
        );
        final remote = HistoryItem(
          path: 'airqr-remote://remote-$origin/secret.txt',
          timestamp: 123,
          size: 3,
          origin: origin,
          mimeType: 'text/plain',
          totalFrames: 8,
          minFrames: 5,
          isSynced: true,
          serverId: 'remote-$origin',
        );

        final result = await controller.materializeRemoteItem(remote);

        expect(result.status, HistoryMaterializationStatus.materialized);
        expect(downloadedId, 'remote-$origin');
        expect(downloadedOrigin, origin);
        final local = result.item!;
        expect(local.path, p.join(tempDir.path, origin, 'secret.txt'));
        expect(await File(local.path).readAsBytes(), const <int>[1, 2, 3]);
        expect(local.serverId, remote.serverId);
        expect(local.timestamp, remote.timestamp);
        expect(local.mimeType, remote.mimeType);
        expect(local.totalFrames, remote.totalFrames);
        expect(local.minFrames, remote.minFrames);
        final stored = await HistoryService.getHistory();
        expect(stored.single.path, local.path);
        expect(stored.single.serverId, remote.serverId);
      });
    }

    test('coalesces concurrent materialization by server id', () async {
      final download = Completer<List<int>?>();
      var downloadCalls = 0;
      final controller = HistoryPageRefreshController(
        downloadFile: ({required id, required origin}) {
          downloadCalls++;
          return download.future;
        },
        documentsDirectory: () async => tempDir,
      );
      final remote = HistoryItem(
        path: 'airqr-remote://shared-id/shared.txt',
        timestamp: 123,
        size: 3,
        origin: 'generated',
        serverId: 'shared-id',
      );

      final first = controller.materializeRemoteItem(remote);
      final second = controller.materializeRemoteItem(remote);
      final sameFuture = identical(first, second);
      download.complete(const <int>[1, 2, 3]);
      final results = await Future.wait(<Future<HistoryMaterializationResult>>[
        first,
        second,
      ]);

      expect(sameFuture, isTrue);
      expect(downloadCalls, 1);
      expect(results[0].item!.path, results[1].item!.path);
      expect(await HistoryService.getHistory(), hasLength(1));
    });

    test('materializes the same server id independently by origin', () async {
      final origins = <String>[];
      final controller = HistoryPageRefreshController(
        downloadFile: ({required id, required origin}) async {
          origins.add(origin);
          return origin == 'scanned' ? const <int>[1] : const <int>[2];
        },
        documentsDirectory: () async => tempDir,
      );
      HistoryItem remote(String origin) => HistoryItem(
        path: 'airqr-remote://same-id/$origin.txt',
        timestamp: 1,
        size: 1,
        origin: origin,
        serverId: 'same-id',
      );

      final scanned = controller.materializeRemoteItem(remote('scanned'));
      final generated = controller.materializeRemoteItem(remote('generated'));
      final results = await Future.wait(<Future<HistoryMaterializationResult>>[
        scanned,
        generated,
      ]);

      expect(origins, containsAll(<String>['scanned', 'generated']));
      expect(origins, hasLength(2));
      expect(results[0].item!.path, contains('scanned'));
      expect(results[1].item!.path, contains('generated'));
      expect(await HistoryService.getHistory(), hasLength(2));
    });

    test('clear-all invalidation prevents in-flight materialization', () async {
      final firstDownload = Completer<List<int>?>();
      var calls = 0;
      final controller = HistoryPageRefreshController(
        downloadFile: ({required id, required origin}) {
          calls++;
          return calls == 1
              ? firstDownload.future
              : Future<List<int>?>.value(const <int>[4]);
        },
        documentsDirectory: () async => tempDir,
      );
      final remote = HistoryItem(
        path: 'airqr-remote://cancel-id/cancel.txt',
        timestamp: 1,
        size: 1,
        origin: 'generated',
        serverId: 'cancel-id',
      );

      final pending = controller.materializeRemoteItem(remote);
      await Future<void>.delayed(Duration.zero);
      controller.invalidateRemoteMaterializations(<HistoryItem>[remote]);
      firstDownload.complete(const <int>[3]);
      final cancelled = await pending;

      expect(cancelled.status, HistoryMaterializationStatus.failed);
      expect(await HistoryService.getHistory(), isEmpty);
      expect(
        await Directory(p.join(tempDir.path, 'generated')).exists(),
        isFalse,
      );

      final retried = await controller.materializeRemoteItem(remote);
      expect(retried.status, HistoryMaterializationStatus.materialized);
      expect(calls, 2);
      expect(await HistoryService.getHistory(), hasLength(1));
    });

    test('reuses an existing local file with the same server id', () async {
      final existingFile = File('${tempDir.path}/existing-local.txt');
      await existingFile.writeAsString('existing');
      final existing = HistoryItem(
        path: existingFile.path,
        timestamp: 10,
        size: 8,
        origin: 'generated',
        serverId: 'existing-id',
        isSynced: true,
      );
      SharedPreferences.setMockInitialValues(<String, Object>{
        'airqr_history': jsonEncode(<Map<String, dynamic>>[existing.toJson()]),
      });
      var downloadCalls = 0;
      final controller = HistoryPageRefreshController(
        downloadFile: ({required id, required origin}) async {
          downloadCalls++;
          return const <int>[9];
        },
        documentsDirectory: () async => tempDir,
      );
      final remote = HistoryItem(
        path: 'airqr-remote://existing-id/remote.txt',
        timestamp: 20,
        size: 1,
        origin: 'generated',
        serverId: 'existing-id',
      );

      final result = await controller.materializeRemoteItem(remote);

      expect(result.status, HistoryMaterializationStatus.alreadyLocal);
      expect(result.item!.path, existingFile.path);
      expect(downloadCalls, 0);
      expect(await HistoryService.getHistory(), hasLength(1));
    });

    test(
      'failed remote materialization leaves local history unchanged',
      () async {
        final localFile = File('${tempDir.path}/existing.txt');
        await localFile.writeAsString('existing');
        SharedPreferences.setMockInitialValues(<String, Object>{
          'airqr_history': jsonEncode(<Map<String, dynamic>>[
            HistoryItem(
              path: localFile.path,
              timestamp: 1,
              size: 8,
              origin: 'scanned',
            ).toJson(),
          ]),
        });
        final before = await HistoryService.getHistory();
        final controller = HistoryPageRefreshController(
          downloadFile: ({required id, required origin}) async => null,
          documentsDirectory: () async => tempDir,
        );
        final remote = HistoryItem(
          path: 'airqr-remote://missing-id/missing.txt',
          timestamp: 2,
          size: 10,
          origin: 'generated',
          serverId: 'missing-id',
        );

        final result = await controller.materializeRemoteItem(remote);

        expect(result.status, HistoryMaterializationStatus.failed);
        expect(
          (await HistoryService.getHistory()).map((item) => item.toJson()),
          before.map((item) => item.toJson()),
        );
        expect(
          await Directory(p.join(tempDir.path, 'generated')).exists(),
          isFalse,
        );
      },
    );

    test('downloadCompletedScan reports missing session id cleanly', () async {
      final controller = HistoryPageRefreshController();

      final result = await controller.downloadCompletedScan(<String, dynamic>{
        'filename': 'done.bin',
      });

      expect(
        result.status,
        HistoryCompletedScanDownloadStatus.missingSessionId,
      );
    });

    test('refresh only runs global sync when forceSync is requested', () async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'airqr_sync_settings': jsonEncode(<String, dynamic>{
          'enabled': true,
          'serverUrl': 'https://airqr.test',
          'username': null,
          'password': null,
          'syncScanned': true,
          'syncGenerated': true,
          'autoSync': true,
        }),
      });

      var syncCalls = 0;
      final controller = HistoryPageRefreshController(
        syncAll: () async {
          syncCalls++;
          return SyncResult.ok();
        },
      );

      final normalSnapshot = await controller.refresh();
      expect(normalSnapshot.syncEnabled, isTrue);
      expect(syncCalls, 0);

      await controller.refresh(forceSync: true);
      expect(syncCalls, 1);
    });
  });
}
