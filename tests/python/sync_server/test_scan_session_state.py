"""Tests for canonical scan session state payload construction."""

from sync_server.scan_session_state import build_scan_session_state


def test_build_state_caps_incomplete_threshold_reached_at_99_9() -> None:
    state = build_scan_session_state(
        "scan-1",
        {
            "sessionId": "scan-1",
            "status": "active",
            "filename": "archive.zip",
            "receivedCount": 8982,
            "expectedPackets": 8954,
            "totalPacketsExact": False,
            "completed": False,
            "filePath": None,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 4779,
                    "lastContiguous": 4778,
                    "missing": [],
                    "expectedPackets": 3983,
                    "totalPackets": 4779,
                    "totalPacketsExact": True,
                },
                {
                    "chunkId": 1,
                    "receivedCount": 4203,
                    "lastContiguous": 4202,
                    "missing": [],
                    "expectedPackets": 3971,
                    "totalPackets": None,
                    "totalPacketsExact": False,
                },
            ],
            "totalChunks": 3,
        },
    )

    assert state["type"] == "scan-session-state"
    assert state["sessionId"] == "scan-1"
    assert state["receivedUnique"] == 8982
    assert state["decodeThreshold"] == 8954
    assert state["decodeState"] == "threshold_reached"
    assert state["completionPercent"] == 99.9
    assert state["isComplete"] is False
    assert state["fileAvailable"] is False
    assert state["chunksTotal"] == 3
    assert state["chunksComplete"] == 1
    assert state["chunksMissing"] == 2
    assert state["chunks"][0]["state"] == "complete"
    assert state["chunks"][1]["state"] == "threshold_reached"
    assert state["chunks"][2]["state"] == "missing"


def test_build_state_returns_100_only_when_file_available() -> None:
    state = build_scan_session_state(
        "scan-2",
        {
            "sessionId": "scan-2",
            "status": "complete",
            "completed": True,
            "filePath": "sessions/scan-2/files/archive.zip",
            "receivedCount": 9120,
            "expectedPackets": 8954,
            "totalPackets": 9120,
            "totalPacketsExact": True,
            "totalChunks": 1,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 9120,
                    "lastContiguous": 9119,
                    "missing": [],
                    "expectedPackets": 8954,
                    "totalPackets": 9120,
                    "totalPacketsExact": True,
                }
            ],
        },
    )

    assert state["decodeState"] == "complete"
    assert state["completionPercent"] == 100
    assert state["isComplete"] is True
    assert state["fileAvailable"] is True
    assert state["chunksComplete"] == 1
    assert state["chunksMissing"] == 0


def test_build_state_infers_single_chunk_threshold_from_session_expected_packets() -> None:
    state = build_scan_session_state(
        "scan-single-threshold",
        {
            "sessionId": "scan-single-threshold",
            "status": "active",
            "completed": False,
            "filePath": None,
            "receivedCount": 12,
            "expectedPackets": 12,
            "totalPacketsExact": False,
            "totalChunks": 1,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 12,
                    "lastContiguous": 11,
                    "missing": [],
                }
            ],
        },
    )

    assert state["fileAvailable"] is False
    assert state["chunks"][0]["decodeThreshold"] == 12
    assert state["chunks"][0]["state"] == "threshold_reached"
    assert state["chunksComplete"] == 0
    assert state["chunksMissing"] == 1


def test_build_state_preserves_chunk_target_frame_ranges() -> None:
    state = build_scan_session_state(
        "scan-targets",
        {
            "sessionId": "scan-targets",
            "receivedCount": 2,
            "expectedPackets": 5,
            "totalPackets": 12,
            "totalPacketsExact": True,
            "totalChunks": 1,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 2,
                    "lastContiguous": -1,
                    "missing": [[0, 0], [2, 4]],
                    "expectedPackets": 5,
                    "totalPackets": 12,
                    "totalPacketsExact": True,
                    "targetFrameCount": 3,
                    "unseenFrameCount": 10,
                    "targetFrameRanges": [[0, 0], [2, 3]],
                    "unseenFrameRanges": [[0, 0], [2, 4], [6, 11]],
                }
            ],
        },
    )

    chunk = state["chunks"][0]
    assert chunk["receivedUnique"] == 2
    assert chunk["decodeThreshold"] == 5
    assert chunk["totalPackets"] == 12
    assert chunk["missingRanges"] == [[0, 0], [2, 4]]
    assert chunk["targetFrameCount"] == 3
    assert chunk["unseenFrameCount"] == 10
    assert chunk["targetFrameRanges"] == [[0, 0], [2, 3]]
    assert chunk["unseenFrameRanges"] == [[0, 0], [2, 4], [6, 11]]


def test_build_state_does_not_count_surplus_chunk_packets_toward_other_chunks() -> None:
    state = build_scan_session_state(
        "scan-chunk-surplus",
        {
            "sessionId": "scan-chunk-surplus",
            "status": "active",
            "completed": False,
            "filePath": None,
            "receivedCount": 200,
            "expectedPackets": 200,
            "totalChunks": 2,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 150,
                    "lastContiguous": 149,
                    "missing": [],
                    "expectedPackets": 100,
                    "totalPackets": 200,
                    "totalPacketsExact": True,
                    "targetFrameCount": 0,
                },
                {
                    "chunkId": 1,
                    "receivedCount": 50,
                    "lastContiguous": 49,
                    "missing": [],
                    "expectedPackets": 100,
                    "totalPackets": 200,
                    "totalPacketsExact": True,
                    "targetFrameCount": 50,
                },
            ],
        },
    )

    assert state["receivedUnique"] == 200
    assert state["decodeThreshold"] == 200
    assert state["decodeState"] == "scanning"
    assert state["completionPercent"] == 75
    assert state["chunks"][0]["state"] == "threshold_reached"
    assert state["chunks"][1]["state"] == "scanning"


def test_build_state_preserves_decimal_completion_percent_near_threshold() -> None:
    state = build_scan_session_state(
        "scan-decimal-progress",
        {
            "sessionId": "scan-decimal-progress",
            "status": "active",
            "completed": False,
            "filePath": None,
            "receivedCount": 199,
            "expectedPackets": 200,
        },
    )

    assert state["completionPercent"] == 99.5


def test_build_state_caps_incomplete_completion_at_99_9() -> None:
    state = build_scan_session_state(
        "scan-nearly-complete",
        {
            "sessionId": "scan-nearly-complete",
            "status": "active",
            "completed": False,
            "filePath": None,
            "receivedCount": 200,
            "expectedPackets": 200,
        },
    )

    assert state["completionPercent"] == 99.9


def test_build_state_infers_single_chunk_complete_from_session_exact_total() -> None:
    state = build_scan_session_state(
        "scan-single-complete",
        {
            "sessionId": "scan-single-complete",
            "status": "complete",
            "completed": True,
            "filePath": "sessions/scan-single-complete/files/archive.zip",
            "receivedCount": 15,
            "totalPackets": 15,
            "totalPacketsExact": True,
            "totalChunks": 1,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 15,
                    "lastContiguous": 14,
                    "missing": [],
                }
            ],
        },
    )

    assert state["fileAvailable"] is True
    assert state["chunks"][0]["totalPackets"] == 15
    assert state["chunks"][0]["totalPacketsExact"] is True
    assert state["chunks"][0]["state"] == "complete"
    assert state["chunksComplete"] == 1
    assert state["chunksMissing"] == 0


def test_build_state_marks_chunks_complete_when_file_is_available() -> None:
    state = build_scan_session_state(
        "scan-multi-guard",
        {
            "sessionId": "scan-multi-guard",
            "status": "complete",
            "completed": True,
            "filePath": "sessions/scan-multi-guard/files/archive.zip",
            "receivedCount": 20,
            "expectedPackets": 10,
            "totalPackets": 10,
            "totalPacketsExact": True,
            "totalChunks": 2,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 10,
                    "lastContiguous": 9,
                    "missing": [],
                },
                {
                    "chunkId": 1,
                    "receivedCount": 0,
                    "lastContiguous": 0,
                    "missing": [],
                },
            ],
        },
    )

    assert state["fileAvailable"] is True
    assert state["chunks"][0]["decodeThreshold"] is None
    assert state["chunks"][0]["totalPackets"] is None
    assert state["chunks"][0]["state"] == "complete"
    assert state["chunks"][0]["missingCount"] == 0
    assert state["chunks"][0]["missingRanges"] == []
    assert state["chunks"][1]["state"] == "complete"
    assert state["chunks"][1]["missingCount"] == 0
    assert state["chunks"][1]["missingRanges"] == []
    assert state["chunksComplete"] == 2
    assert state["chunksMissing"] == 0


def test_build_state_ignores_stale_single_chunk_fallback_for_multiple_raw_chunks() -> None:
    state = build_scan_session_state(
        "scan-stale-single-total",
        {
            "sessionId": "scan-stale-single-total",
            "status": "active",
            "completed": False,
            "filePath": None,
            "receivedCount": 4,
            "expectedPackets": 2,
            "totalChunks": 1,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 2,
                    "lastContiguous": 1,
                    "missing": [],
                },
                {
                    "chunkId": 1,
                    "receivedCount": 2,
                    "lastContiguous": 1,
                    "missing": [],
                },
            ],
        },
    )

    assert state["chunks"][0]["decodeThreshold"] is None
    assert state["chunks"][0]["totalPackets"] is None
    assert state["chunks"][0]["state"] == "scanning"
    assert state["chunks"][1]["decodeThreshold"] is None
    assert state["chunks"][1]["totalPackets"] is None
    assert state["chunks"][1]["state"] == "scanning"
    assert state["chunksComplete"] == 0


def test_build_state_counts_observed_chunks_when_total_chunks_is_stale() -> None:
    state = build_scan_session_state(
        "scan-stale-total-observed",
        {
            "sessionId": "scan-stale-total-observed",
            "status": "active",
            "completed": False,
            "filePath": None,
            "receivedCount": 6,
            "totalChunks": 1,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 5,
                    "lastContiguous": 4,
                    "missing": [],
                    "totalPackets": 5,
                    "totalPacketsExact": True,
                },
                {
                    "chunkId": 1,
                    "receivedCount": 1,
                    "lastContiguous": 0,
                    "missing": [],
                },
            ],
        },
    )

    assert state["chunksTotal"] == 2
    assert state["chunksComplete"] == 1
    assert state["chunksMissing"] == 1


def test_build_state_fills_sparse_observed_chunk_placeholders() -> None:
    state = build_scan_session_state(
        "scan-sparse-observed",
        {
            "sessionId": "scan-sparse-observed",
            "status": "active",
            "completed": False,
            "filePath": None,
            "receivedCount": 8,
            "totalChunks": 1,
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 5,
                    "lastContiguous": 4,
                    "missing": [],
                },
                {
                    "chunkId": 2,
                    "receivedCount": 3,
                    "lastContiguous": 2,
                    "missing": [],
                },
            ],
        },
    )

    assert state["chunksTotal"] == 3
    assert [chunk["chunkId"] for chunk in state["chunks"]] == [0, 1, 2]
    assert state["chunks"][1]["state"] == "missing"
    assert state["chunksMissing"] == 3


def test_build_state_prefers_monotonic_received_fields() -> None:
    state = build_scan_session_state(
        "scan-3",
        {
            "sessionId": "scan-3",
            "receivedCount": 100,
            "receivedPackets": 130,
            "packetCount": 120,
            "expectedPackets": 200,
        },
    )

    assert state["receivedUnique"] == 130
    assert state["decodeState"] == "scanning"
    assert state["completionPercent"] == 65
