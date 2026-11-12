import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:airqr_mobile/history_item.dart';
import 'package:airqr_mobile/history_service.dart';
import 'package:airqr_mobile/sync_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const pathProviderChannel = MethodChannel('plugins.flutter.io/path_provider');

  group('SyncService data safety', () {
    late Directory tempDir;
    late File localFile;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('airqr-sync-safety');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(pathProviderChannel, (call) async {
            if (call.method == 'getApplicationDocumentsDirectory') {
              return tempDir.path;
            }
            return null;
          });
      localFile = File('${tempDir.path}/synced.bin');
      await localFile.writeAsBytes(const <int>[1, 2, 3]);
    });

    tearDown(() async {
      SyncService.setHttpClientForTesting(null);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(pathProviderChannel, null);
      SyncService.clearCache();
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    Future<void> configure(Uri serverUri) async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'airqr_sync_settings': jsonEncode(<String, dynamic>{
          'enabled': true,
          'serverUrl': serverUri.toString(),
          'syncScanned': true,
          'syncGenerated': true,
          'autoSync': true,
        }),
        'airqr_history': jsonEncode(<Map<String, dynamic>>[
          HistoryItem(
            path: localFile.path,
            timestamp: 7,
            size: 3,
            origin: 'scanned',
            isSynced: true,
            serverId: 'server-1',
          ).toJson(),
        ]),
      });
      SyncService.clearCache();
    }

    Future<void> expectLocalItemPreserved() async {
      expect(await localFile.exists(), isTrue);
      final history = await HistoryService.getHistory();
      expect(history, hasLength(1));
      expect(history.single.serverId, 'server-1');
    }

    test(
      'HTTP 500 history response never deletes local synced items',
      () async {
        SyncService.setHttpClientForTesting(
          MockClient((request) async => http.Response('failure', 500)),
        );
        await configure(Uri.parse('https://airqr.test'));

        final result = await SyncService.syncAll();

        expect(result.success, isFalse);
        await expectLocalItemPreserved();
      },
    );

    test('network exception never deletes local synced items', () async {
      SyncService.setHttpClientForTesting(
        MockClient((request) async => throw const SocketException('offline')),
      );
      await configure(Uri.parse('https://airqr.test'));

      final result = await SyncService.syncAll();

      expect(result.success, isFalse);
      await expectLocalItemPreserved();
    });

    test('HTTP 200 empty snapshot remains authoritative', () async {
      SyncService.setHttpClientForTesting(
        MockClient((request) async => http.Response('[]', 200)),
      );
      await configure(Uri.parse('https://airqr.test'));

      final result = await SyncService.syncAll();

      expect(result.success, isTrue);
      expect(await localFile.exists(), isFalse);
      expect(await HistoryService.getHistory(), isEmpty);
    });

    test(
      'malformed HTTP 200 snapshot never deletes local synced items',
      () async {
        SyncService.setHttpClientForTesting(
          MockClient((request) async => http.Response('[{}]', 200)),
        );
        await configure(Uri.parse('https://airqr.test'));

        final result = await SyncService.syncAll();

        expect(result.success, isFalse);
        await expectLocalItemPreserved();
      },
    );

    final malformedIds = <String, Object?>{
      'object': <String, dynamic>{'nested': true},
      'array': <Object>['server-1'],
      'boolean': true,
      'number': 1,
      'null': null,
      'empty': '',
      'whitespace': '   ',
      'padded': ' server-1 ',
      'unsafe characters': '../server-1',
      'too long': List<String>.filled(129, 'a').join(),
    };

    for (final alias in const <String>['id', 'sessionId', 'historyId']) {
      for (final entry in malformedIds.entries) {
        test('HTTP 200 snapshot rejects ${entry.key} $alias alias', () async {
          SyncService.setHttpClientForTesting(
            MockClient(
              (request) async => http.Response(
                jsonEncode(<Map<String, Object?>>[
                  <String, Object?>{alias: entry.value},
                ]),
                200,
              ),
            ),
          );
          await configure(Uri.parse('https://airqr.test'));

          final result = await SyncService.syncAll();

          expect(result.success, isFalse);
          await expectLocalItemPreserved();
        });
      }
    }

    final conflictingAliasPairs = <List<String>>[
      <String>['id', 'sessionId'],
      <String>['id', 'historyId'],
      <String>['sessionId', 'historyId'],
    ];
    for (final aliases in conflictingAliasPairs) {
      test(
        'HTTP 200 snapshot rejects conflicting ${aliases.join('/')}',
        () async {
          SyncService.setHttpClientForTesting(
            MockClient(
              (request) async => http.Response(
                jsonEncode(<Map<String, Object?>>[
                  <String, Object?>{
                    aliases[0]: 'server-1',
                    aliases[1]: 'server-2',
                  },
                ]),
                200,
              ),
            ),
          );
          await configure(Uri.parse('https://airqr.test'));

          final result = await SyncService.syncAll();

          expect(result.success, isFalse);
          await expectLocalItemPreserved();
        },
      );
    }

    test('HTTP 200 snapshot accepts exact consistent ID aliases', () async {
      SyncService.setHttpClientForTesting(
        MockClient(
          (request) async => http.Response(
            jsonEncode(<Map<String, Object?>>[
              <String, Object?>{
                'id': 'server-1',
                'sessionId': 'server-1',
                'historyId': 'server-1',
                'completed': false,
              },
            ]),
            200,
          ),
        ),
      );
      await configure(Uri.parse('https://airqr.test'));

      final result = await SyncService.syncAll();

      expect(result.success, isTrue);
      await expectLocalItemPreserved();
    });

    final malformedIncompleteIds = <Object?>[
      <String, Object?>{'nested': true},
      true,
      '../outside',
      '..',
      '/tmp/outside',
      r'C:\outside',
      r'\\server\share',
      ' scan-1 ',
    ];
    for (final malformedId in malformedIncompleteIds) {
      test('incomplete scan response rejects ID $malformedId', () async {
        SyncService.setHttpClientForTesting(
          MockClient(
            (request) async => http.Response(
              jsonEncode(<Map<String, Object?>>[
                <String, Object?>{'sessionId': malformedId, 'completed': false},
              ]),
              200,
            ),
          ),
        );
        await configure(Uri.parse('https://airqr.test'));

        expect(await SyncService.fetchIncompleteScans(), isEmpty);
      });
    }

    test(
      'incomplete scan fetch requests the dedicated server filter',
      () async {
        Uri? requestedUrl;
        SyncService.setHttpClientForTesting(
          MockClient((request) async {
            requestedUrl = request.url;
            return http.Response(
              jsonEncode(<Map<String, Object?>>[
                const <String, Object?>{
                  'sessionId': 'scan-older-incomplete',
                  'completed': false,
                },
              ]),
              200,
            );
          }),
        );
        await configure(Uri.parse('https://airqr.test'));

        final result = await SyncService.fetchIncompleteScans();

        expect(result.single['sessionId'], 'scan-older-incomplete');
        expect(requestedUrl?.path, '/api/scan/history');
        expect(requestedUrl?.queryParameters['completed'], 'false');
      },
    );

    test(
      'incomplete scan response rejects the whole conflicting payload',
      () async {
        SyncService.setHttpClientForTesting(
          MockClient(
            (request) async => http.Response(
              jsonEncode(<Map<String, Object?>>[
                const <String, Object?>{
                  'sessionId': 'scan-valid',
                  'completed': false,
                },
                const <String, Object?>{
                  'id': 'scan-one',
                  'sessionId': 'scan-two',
                  'completed': false,
                },
              ]),
              200,
            ),
          ),
        );
        await configure(Uri.parse('https://airqr.test'));

        expect(await SyncService.fetchIncompleteScans(), isEmpty);
      },
    );

    final malformedFields = <String, Object?>{
      'origin type': 7,
      'origin value': 'other',
      'filename type': 7,
      'mimeType type': 7,
      'completed type': 'yes',
      'size type': '3',
      'size range': -1,
      'totalFrames type': 1.5,
      'totalFrames range': -1,
      'minFrames type': '1',
      'minFrames range': -1,
      'createdAt type': 7,
      'createdAt value': 'not-a-timestamp',
      'completedAt type': false,
      'completedAt value': 'not-a-timestamp',
      'updatedAt type': <Object>[],
      'updatedAt value': 'not-a-timestamp',
    };

    for (final entry in malformedFields.entries) {
      test('HTTP 200 snapshot rejects malformed ${entry.key}', () async {
        final field = entry.key.split(' ').first;
        var requests = 0;
        SyncService.setHttpClientForTesting(
          MockClient((request) async {
            requests++;
            return http.Response(
              jsonEncode(<Map<String, Object?>>[
                <String, Object?>{
                  'id': 'server-1',
                  'origin': 'scanned',
                  'filename': null,
                  'completed': false,
                  field: entry.value,
                },
              ]),
              200,
            );
          }),
        );
        await configure(Uri.parse('https://airqr.test'));

        final result = await SyncService.syncAll();

        expect(result.success, isFalse);
        expect(requests, 1);
        await expectLocalItemPreserved();
      });
    }

    test(
      'HTTP 200 snapshot rejects minFrames greater than totalFrames',
      () async {
        SyncService.setHttpClientForTesting(
          MockClient(
            (request) async => http.Response(
              jsonEncode(<Map<String, Object?>>[
                <String, Object?>{
                  'id': 'server-1',
                  'origin': 'generated',
                  'filename': 'payload.gif',
                  'completed': true,
                  'totalFrames': 2,
                  'minFrames': 3,
                },
              ]),
              200,
            ),
          ),
        );
        await configure(Uri.parse('https://airqr.test'));

        final result = await SyncService.syncAll();

        expect(result.success, isFalse);
        await expectLocalItemPreserved();
      },
    );

    test(
      'hanging history request times out without losing local data',
      () async {
        final neverResponds = Completer<http.Response>();
        SyncService.setHttpClientForTesting(
          MockClient((request) => neverResponds.future),
        );
        await configure(Uri.parse('https://airqr.test'));

        final result = await SyncService.syncAll(
          requestTimeout: const Duration(milliseconds: 1),
        );

        expect(result.success, isFalse);
        await expectLocalItemPreserved();
      },
    );

    test('failed remote file download makes the sync fail', () async {
      SyncService.setHttpClientForTesting(
        MockClient((request) async {
          if (request.url.path == '/api/history') {
            return http.Response(
              jsonEncode(<Map<String, Object?>>[
                <String, Object?>{
                  'id': 'server-1',
                  'origin': 'scanned',
                  'completed': false,
                },
                <String, Object?>{
                  'id': 'server-2',
                  'origin': 'generated',
                  'filename': 'remote.gif',
                  'completed': true,
                },
              ]),
              200,
            );
          }
          return http.Response('download failed', 500);
        }),
      );
      await configure(Uri.parse('https://airqr.test'));

      final result = await SyncService.syncAll();

      expect(result.success, isFalse);
      expect(result.error, contains('remote.gif'));
      await expectLocalItemPreserved();
    });

    test('failed local file upload makes the sync fail', () async {
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
            timestamp: 7,
            size: 3,
            origin: 'generated',
            isSynced: false,
          ).toJson(),
        ]),
      });
      SyncService.clearCache();
      SyncService.setHttpClientForTesting(
        MockClient((request) async {
          if (request.url.path == '/api/history') {
            return http.Response('[]', 200);
          }
          return http.Response('upload failed', 500);
        }),
      );

      final result = await SyncService.syncAll();

      expect(result.success, isFalse);
      expect(result.error, contains('synced.bin'));
      expect(await localFile.exists(), isTrue);
    });

    test('sync downloads only one bounded batch of remote files', () async {
      var downloadRequests = 0;
      SyncService.setHttpClientForTesting(
        MockClient((request) async {
          if (request.url.path == '/api/history') {
            return http.Response(
              jsonEncode(<Map<String, Object?>>[
                <String, Object?>{
                  'id': 'server-1',
                  'origin': 'scanned',
                  'completed': false,
                },
                for (var i = 2; i <= 4; i++)
                  <String, Object?>{
                    'id': 'server-$i',
                    'origin': 'generated',
                    'filename': 'remote-$i.gif',
                    'completed': true,
                  },
              ]),
              200,
            );
          }
          downloadRequests++;
          return http.Response.bytes(const <int>[7, 8, 9], 200);
        }),
      );
      await configure(Uri.parse('https://airqr.test'));

      final result = await SyncService.syncAll(maxDownloads: 2);

      expect(result.success, isTrue);
      expect(result.downloadedCount, 2);
      expect(downloadRequests, 2);
      expect(await HistoryService.getHistory(), hasLength(3));
    });
  });
}
