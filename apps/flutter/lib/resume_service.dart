class ResumeService {
  static final ResumeService _instance = ResumeService._internal();
  factory ResumeService() => _instance;
  ResumeService._internal();

  String? _pendingResumeId;

  void requestResume(String scanId) {
    _pendingResumeId = scanId;
  }

  String? consumePendingResume() {
    final id = _pendingResumeId;
    _pendingResumeId = null;
    return id;
  }

  bool get hasPendingResume => _pendingResumeId != null;
}
