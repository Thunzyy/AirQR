import 'package:open_filex/open_filex.dart';

typedef PlatformFileOpen = Future<OpenResult> Function(String path);

Future<bool> openLocalFile(
  String path, {
  PlatformFileOpen platformOpen = OpenFilex.open,
}) async {
  final result = await platformOpen(path);
  return result.type == ResultType.done;
}
