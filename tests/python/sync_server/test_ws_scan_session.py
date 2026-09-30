"""Tests for WebSocket scan session state manager."""

import pytest
from datetime import datetime, timezone
from sync_server.ws_scan_session import (
    ScanSessionState,
    ScanSessionStore,
    reconstruct_packets_by_chunk_from_chunk_states,
)


class TestScanSessionState:
    """Test scan session state management."""

    def test_initial_state(self) -> None:
        """Should initialize with empty state."""
        state = ScanSessionState("session-123")
        assert state.session_id == "session-123"
        assert state.received_count == 0
        assert state.last_contiguous == -1
        assert state.get_missing_ranges() == []
        assert state.producer_device_id is None

    def test_record_packet(self) -> None:
        """Should record received packet."""
        state = ScanSessionState("session-123")
        state.record_packet(0)
        state.record_packet(1)
        state.record_packet(2)

        assert state.received_count == 3
        assert state.last_contiguous == 2
        assert state.get_missing_ranges() == []

    def test_state_version_starts_at_zero_and_increments_only_for_new_packets(self) -> None:
        """Should advance live state version only when a unique packet is recorded."""
        state = ScanSessionState("session-123")

        assert state.state_version == 0
        assert state.record_packet(0) is True
        assert state.state_version == 1
        assert state.record_packet(0) is False
        assert state.state_version == 1
        assert state.record_packet(0, chunk_id=1) is True
        assert state.state_version == 2

    def test_assembly_gate_blocks_retry_after_failure_until_new_packet(self) -> None:
        """Should prevent concurrent and stale assembly attempts."""
        state = ScanSessionState("session-123")
        state.record_packet(0)
        version_after_packet = state.state_version

        assert state.begin_assembly_attempt() is True
        assert state.state_version == version_after_packet + 1
        snapshot = state.get_assembly_snapshot()
        assert snapshot["inProgress"] is True
        assert snapshot["attempts"] == 1
        assert snapshot["lastAttemptAt"].endswith("Z")
        datetime.fromisoformat(snapshot["lastAttemptAt"].replace("Z", "+00:00"))
        assert snapshot["lastError"] is None
        state_dict = state.get_state_dict()
        assert state_dict["stateVersion"] == state.state_version
        assert state_dict["assembly"] == snapshot

        assert state.begin_assembly_attempt() is False
        failed_attempt_version = state.state_version
        state.finish_assembly_attempt(success=False, error="not enough packets")
        assert state.state_version == failed_attempt_version + 1
        assert state.get_assembly_snapshot()["lastError"] == "not enough packets"

        assert state.begin_assembly_attempt() is False
        assert state.record_packet(0) is False
        assert state.begin_assembly_attempt() is False

        assert state.record_packet(1) is True
        assert state.begin_assembly_attempt() is True
        assert state.get_assembly_snapshot()["attempts"] == 2

    def test_failed_assembly_retry_unblocked_by_hydrated_packet_identity_change(self) -> None:
        """Should retry assembly when hydrated packet identities change with same count."""
        state = ScanSessionState("session-123")
        state.hydrate_chunk_packets({0: {0, 2}})

        assert state.received_count == 2
        assert state.begin_assembly_attempt() is True
        state.finish_assembly_attempt(success=False, error="missing packet")
        assert state.begin_assembly_attempt() is False

        state.hydrate_chunk_packets({0: {0, 1}})

        assert state.received_count == 2
        assert state.begin_assembly_attempt() is True

    def test_failed_assembly_can_retry_after_stale_retry_cooldown(self) -> None:
        """Should allow a bounded retry when no packet arrived after a failed decode."""
        state = ScanSessionState("session-123")
        state.record_packet(0)

        assert state.begin_assembly_attempt() is True
        state.finish_assembly_attempt(success=False, error="decoder was not ready")

        assert state.begin_assembly_attempt() is False
        assert (
            state.begin_assembly_attempt(
                allow_stale_retry=True,
                stale_retry_after_seconds=0,
            )
            is True
        )
        assert state.get_assembly_snapshot()["attempts"] == 2

    def test_successful_assembly_attempt_clears_in_progress_and_error(self) -> None:
        """Should clear assembly status and stale errors after a successful attempt."""
        state = ScanSessionState("session-123")
        state.record_packet(0)

        assert state.begin_assembly_attempt() is True
        state.finish_assembly_attempt(success=False, error="decoder failed")
        assert state.get_assembly_snapshot()["lastError"] == "decoder failed"

        state.record_packet(1)
        assert state.begin_assembly_attempt() is True
        attempt_version = state.state_version
        state.finish_assembly_attempt(success=True, error=None)

        snapshot = state.get_assembly_snapshot()
        assert state.state_version == attempt_version + 1
        assert snapshot["inProgress"] is False
        assert snapshot["lastError"] is None

    def test_record_out_of_order(self) -> None:
        """Should handle out-of-order packets."""
        state = ScanSessionState("session-123")
        state.record_packet(0)
        state.record_packet(2)  # Skip 1
        state.record_packet(4)  # Skip 3

        assert state.received_count == 3
        assert state.last_contiguous == 0
        assert state.get_missing_ranges() == [[1, 1], [3, 3]]

    def test_fill_gap(self) -> None:
        """Should update contiguous when gap is filled."""
        state = ScanSessionState("session-123")
        state.record_packet(0)
        state.record_packet(2)

        assert state.last_contiguous == 0

        state.record_packet(1)  # Fill gap
        assert state.last_contiguous == 2

    def test_claim_producer(self) -> None:
        """Should claim producer role."""
        state = ScanSessionState("session-123")
        claim = state.claim_producer("device-A")

        assert state.producer_device_id == "device-A"
        assert claim.lease is not None
        assert state.is_producer("device-A")
        assert not state.is_producer("device-B")

    def test_revoke_producer(self) -> None:
        """Should revoke producer role."""
        state = ScanSessionState("session-123")
        state.claim_producer("device-A")
        state.revoke_producer("device-A")

        assert state.producer_device_id is None
        assert not state.is_producer("device-A")

    def test_multiple_producers_can_claim_same_session(self) -> None:
        """Should allow multiple active producers on the same session."""
        state = ScanSessionState("session-123")

        state.claim_producer("device-A")
        state.claim_producer("device-B")

        assert state.is_producer("device-A")
        assert state.is_producer("device-B")
        assert state.producer_device_id == "device-B"

    def test_revoke_producer_only_removes_that_device(self) -> None:
        """Should keep the other producer active when one device disconnects."""
        state = ScanSessionState("session-123")
        state.claim_producer("device-A")
        state.claim_producer("device-B")

        state.revoke_producer("device-B")

        assert state.is_producer("device-A")
        assert not state.is_producer("device-B")
        assert state.producer_device_id == "device-A"

    def test_stale_connection_cannot_revoke_newer_claim_for_same_device(self) -> None:
        """Should keep a resumed producer active when the previous socket closes late."""
        state = ScanSessionState("session-123")
        old_socket = object()
        new_socket = object()

        state.claim_producer("device-A", old_socket)
        state.claim_producer("device-A", new_socket)

        removed = state.revoke_producer("device-A", old_socket)

        assert removed is None
        assert state.is_producer("device-A", new_socket)
        assert not state.is_producer("device-A", old_socket)
        assert state.producer_device_id == "device-A"

    def test_set_metadata(self) -> None:
        """Should store session metadata."""
        state = ScanSessionState("session-123")
        state.set_metadata(
            filename="test.pdf",
            mime_type="application/pdf",
            total_packets=100,
            total_chunks=5,
        )

        assert state.filename == "test.pdf"
        assert state.mime_type == "application/pdf"
        assert state.total_packets == 100
        assert state.total_chunks == 5

    def test_set_metadata_state_version_changes_only_when_effective_state_changes(self) -> None:
        """Should version effective flat metadata changes and ignore no-op writes."""
        state = ScanSessionState("session-123")

        assert state.state_version == 0

        state.set_metadata(expected_packets=5)

        assert state.total_packets == 5
        assert state.state_version == 1

        state.set_metadata(expected_packets=5)

        assert state.state_version == 1

        state.set_metadata(expected_packets=6)

        assert state.total_packets == 6
        assert state.state_version == 2

    def test_observe_chunk_transport_metadata_versions_actual_changes_only(self) -> None:
        """Should version effective chunk metadata changes and ignore no-op writes."""
        state = ScanSessionState("session-123")

        assert state.state_version == 0

        state.observe_chunk_transport_metadata(
            0,
            total_chunks=2,
            expected_packets=3,
            total_packets=4,
        )

        assert state.state_version == 1

        state.observe_chunk_transport_metadata(
            0,
            total_chunks=2,
            expected_packets=3,
            total_packets=4,
        )

        assert state.state_version == 1

        state.observe_chunk_transport_metadata(
            0,
            total_chunks=1,
            expected_packets=2,
            total_packets=3,
        )

        assert state.state_version == 1

        state.observe_chunk_transport_metadata(0, expected_packets=4)

        assert state.state_version == 2

    def test_observed_chunk_packet_profiles_override_heterogeneous_meta_fallback(self) -> None:
        """Should prefer chunk-aware thresholds over flat fallback metadata."""
        state = ScanSessionState("session-123")
        state.set_metadata(
            expected_packets=6,
            total_packets=5,
            total_packets_exact=False,
            total_chunks=3,
        )

        state.observe_chunk_transport_metadata(
            0,
            total_chunks=3,
            expected_packets=2,
            total_packets=5,
        )
        state.observe_chunk_transport_metadata(
            1,
            total_chunks=3,
            expected_packets=2,
            total_packets=5,
        )
        state.observe_chunk_transport_metadata(
            2,
            total_chunks=3,
            expected_packets=1,
            total_packets=3,
        )

        assert state.total_packets == 5
        assert state.reported_total_packets == 13
        assert state.total_packets_exact is True
        assert state.get_state_dict()["totalExpected"] == 5
        assert state.get_state_dict()["totalPackets"] == 13

    def test_chunk_states_include_minimum_unseen_frame_target(self) -> None:
        """Should expose the next unseen frame IDs needed to hit the decode threshold."""
        state = ScanSessionState("session-123")
        state.observe_chunk_transport_metadata(
            0,
            total_chunks=1,
            expected_packets=5,
            total_packets=12,
        )

        assert state.record_packet(1, 0) is True
        assert state.record_packet(5, 0) is True

        chunk = state.get_state_dict()["chunkStates"][0]

        assert chunk["receivedCount"] == 2
        assert chunk["expectedPackets"] == 5
        assert chunk["totalPackets"] == 12
        assert chunk["missing"] == [[0, 0], [2, 4]]
        assert chunk["targetFrameCount"] == 3
        assert chunk["unseenFrameCount"] == 10
        assert chunk["targetFrameRanges"] == [[0, 0], [2, 3]]
        assert chunk["unseenFrameRanges"] == [[0, 0], [2, 4], [6, 11]]

    def test_get_progress(self) -> None:
        """Should calculate progress percentage."""
        state = ScanSessionState("session-123")
        state.set_metadata(total_packets=100)

        for i in range(50):
            state.record_packet(i)

        progress = state.get_progress()
        assert progress["percent"] == 50
        assert progress["packetsReceived"] == 50
        assert progress["packetsExpected"] == 100


class TestScanSessionStore:
    """Test multi-session store."""

    def test_get_or_create_session(self) -> None:
        """Should create session if not exists."""
        store = ScanSessionStore()
        session = store.get_or_create("session-1")

        assert session.session_id == "session-1"

        # Same session on second call
        session2 = store.get_or_create("session-1")
        assert session is session2

    def test_get_nonexistent_returns_none(self) -> None:
        """Should return None for nonexistent session."""
        store = ScanSessionStore()
        assert store.get("nonexistent") is None

    def test_remove_session(self) -> None:
        """Should remove session from store."""
        store = ScanSessionStore()
        store.get_or_create("session-1")

        assert store.remove("session-1") is True
        assert store.get("session-1") is None
        assert store.remove("session-1") is False


class TestChunkStateReconstruction:
    def test_reconstructs_contiguous_chunk_packets(self) -> None:
        assert reconstruct_packets_by_chunk_from_chunk_states(
            [
                {
                    "chunkId": 0,
                    "receivedCount": 3,
                    "lastContiguous": 2,
                    "missing": [],
                }
            ]
        ) == {0: {0, 1, 2}}

    def test_reconstructs_sparse_chunk_packets_from_missing_ranges(self) -> None:
        assert reconstruct_packets_by_chunk_from_chunk_states(
            [
                {
                    "chunkId": 2,
                    "receivedCount": 2,
                    "lastContiguous": 0,
                    "missing": [[1, 1]],
                }
            ]
        ) == {2: {0, 2}}
