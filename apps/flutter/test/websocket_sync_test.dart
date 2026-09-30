import 'package:airqr_mobile/websocket_sync.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('server sync reconnect delay backs off and remains bounded', () {
    expect(webSocketReconnectDelay(1), const Duration(seconds: 2));
    expect(webSocketReconnectDelay(2), const Duration(seconds: 4));
    expect(webSocketReconnectDelay(4), const Duration(seconds: 16));
    expect(webSocketReconnectDelay(5), const Duration(seconds: 30));
    expect(webSocketReconnectDelay(100), const Duration(seconds: 30));
  });
}
