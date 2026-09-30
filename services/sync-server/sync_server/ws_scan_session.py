"""WebSocket scan session state manager."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set

from .ws_scan_protocol import PRODUCER_LEASE_DURATION


@dataclass
class ProducerLease:
    """Producer lease information."""
    device_id: str
    expires_at: datetime
    duration_ms: int = PRODUCER_LEASE_DURATION * 1000


@dataclass
class ProducerClaimResult:
    """Result of claiming producer ownership."""

    lease: ProducerLease


def _coerce_optional_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def reconstruct_packets_by_chunk_from_chunk_states(
    chunk_states: Any,
) -> Optional[Dict[int, Set[int]]]:
    if not isinstance(chunk_states, list):
        return None

    packets_by_chunk: Dict[int, Set[int]] = {}
    for raw_state in chunk_states:
        if not isinstance(raw_state, dict):
            return None

        chunk_id = _coerce_optional_int(raw_state.get("chunkId"))
        received_count = _coerce_optional_int(raw_state.get("receivedCount"))
        last_contiguous = _coerce_optional_int(raw_state.get("lastContiguous"))
        if chunk_id is None or received_count is None:
            return None
        if received_count < 0:
            return None
        last_contiguous = last_contiguous if last_contiguous is not None else -1
        if last_contiguous < -1:
            return None

        missing_ranges_raw = raw_state.get("missing") or []
        if not isinstance(missing_ranges_raw, list):
            return None

        missing_ranges: list[tuple[int, int]] = []
        for missing_range in missing_ranges_raw:
            if not isinstance(missing_range, (list, tuple)) or len(missing_range) != 2:
                return None
            start = _coerce_optional_int(missing_range[0])
            end = _coerce_optional_int(missing_range[1])
            if start is None or end is None or start < 0 or end < start:
                return None
            missing_ranges.append((start, end))

        contiguous_count = max(last_contiguous + 1, 0)
        missing_total = sum((end - start + 1) for start, end in missing_ranges)
        highest_seen_index = contiguous_count - 1
        if received_count > contiguous_count or missing_ranges:
            highest_seen_index = max(
                highest_seen_index,
                (received_count + missing_total) - 1,
            )

        if highest_seen_index < 0:
            packets_by_chunk[chunk_id] = set()
            if received_count != 0:
                return None
            continue

        received = set(range(highest_seen_index + 1))
        for start, end in missing_ranges:
            received.difference_update(range(start, end + 1))

        if len(received) != received_count:
            return None

        packets_by_chunk[chunk_id] = received

    return packets_by_chunk


class ScanSessionState:
    """Manages state for a single scan session.

    Thread-safe state management for packet tracking,
    producer coordination, and progress reporting.
    """

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self._lock = threading.Lock()

        # Packet tracking
        self._received_by_chunk: Dict[int, Set[int]] = {}
        self._last_contiguous_by_chunk: Dict[int, int] = {}
        self._expected_packets_by_chunk: Dict[int, int] = {}
        self._reported_total_packets_by_chunk: Dict[int, int] = {}

        # Live session state
        self._state_version = 0
        self._packet_state_version = 0
        self._assembly_in_progress = False
        self._assembly_attempts = 0
        self._last_assembly_attempt_at: Optional[datetime] = None
        self._last_assembly_error: Optional[str] = None
        self._last_assembly_received_count = -1
        self._last_assembly_packet_state_version = -1
        self._durable_state_hydrated = False

        # Producer tracking
        self._producer_device_id: Optional[str] = None
        self._producer_lease: Optional[ProducerLease] = None
        self._producer_connections: Dict[str, Any] = {}

        # Metadata
        self._filename: Optional[str] = None
        self._mime_type: Optional[str] = None
        self._file_size: Optional[int] = None
        self._total_packets: Optional[int] = None
        self._reported_total_packets: Optional[int] = None
        self._total_packets_exact: bool = False
        self._total_chunks: Optional[int] = None
        self._packet_size: Optional[int] = None

        # Timing
        self._created_at = datetime.now(timezone.utc)
        self._updated_at = self._created_at

    @property
    def received_count(self) -> int:
        with self._lock:
            return sum(len(packet_indices) for packet_indices in self._received_by_chunk.values())

    def is_durable_state_hydrated(self) -> bool:
        with self._lock:
            return self._durable_state_hydrated

    def mark_durable_state_hydrated(self) -> None:
        with self._lock:
            self._durable_state_hydrated = True

    def reset_after_delete(self) -> None:
        """Clear live state before this session ID may be reused."""
        with self._lock:
            self._received_by_chunk.clear()
            self._last_contiguous_by_chunk.clear()
            self._expected_packets_by_chunk.clear()
            self._reported_total_packets_by_chunk.clear()
            self._state_version = 0
            self._packet_state_version = 0
            self._assembly_in_progress = False
            self._assembly_attempts = 0
            self._last_assembly_attempt_at = None
            self._last_assembly_error = None
            self._last_assembly_received_count = -1
            self._last_assembly_packet_state_version = -1
            self._durable_state_hydrated = False
            self._producer_device_id = None
            self._producer_lease = None
            self._producer_connections.clear()
            self._filename = None
            self._mime_type = None
            self._file_size = None
            self._total_packets = None
            self._reported_total_packets = None
            self._total_packets_exact = False
            self._total_chunks = None
            self._packet_size = None
            self._created_at = datetime.now(timezone.utc)
            self._updated_at = self._created_at

    @property
    def last_contiguous(self) -> int:
        with self._lock:
            if 0 in self._last_contiguous_by_chunk:
                return self._last_contiguous_by_chunk[0]
            if len(self._last_contiguous_by_chunk) == 1:
                return next(iter(self._last_contiguous_by_chunk.values()))
            return -1

    @property
    def producer_device_id(self) -> Optional[str]:
        with self._lock:
            return self._producer_device_id

    @property
    def filename(self) -> Optional[str]:
        return self._filename

    @property
    def mime_type(self) -> Optional[str]:
        return self._mime_type

    @property
    def file_size(self) -> Optional[int]:
        return self._file_size

    @property
    def total_packets(self) -> Optional[int]:
        with self._lock:
            return self._effective_total_packets_unlocked()

    @property
    def reported_total_packets(self) -> Optional[int]:
        with self._lock:
            return self._effective_reported_total_packets_unlocked()

    @property
    def total_chunks(self) -> Optional[int]:
        return self._total_chunks

    @property
    def total_packets_exact(self) -> bool:
        with self._lock:
            return self._effective_total_packets_exact_unlocked()

    def is_decode_threshold_reached(self) -> bool:
        with self._lock:
            threshold = self._effective_total_packets_unlocked()
            if threshold is None:
                return False

            if (
                self._total_chunks is not None
                and self._total_chunks > 1
                and len(self._expected_packets_by_chunk) >= self._total_chunks
            ):
                for chunk_id in range(self._total_chunks):
                    chunk_threshold = self._expected_packets_by_chunk.get(chunk_id)
                    if chunk_threshold is None:
                        return False
                    if len(self._received_by_chunk.get(chunk_id, set())) < chunk_threshold:
                        return False
                return True

            received = sum(
                len(packet_indices)
                for packet_indices in self._received_by_chunk.values()
            )
            return received >= threshold

    @property
    def packet_size(self) -> Optional[int]:
        return self._packet_size

    @property
    def state_version(self) -> int:
        with self._lock:
            return self._state_version

    def record_packet(self, pkt_index: int, chunk_id: int = 0) -> bool:
        """Record a received packet.

        Returns:
            True if packet was new, False if duplicate
        """
        with self._lock:
            received = self._received_by_chunk.setdefault(chunk_id, set())
            if pkt_index in received:
                return False

            received.add(pkt_index)
            self._last_contiguous_by_chunk.setdefault(chunk_id, -1)
            self._updated_at = datetime.now(timezone.utc)

            # Update contiguous counter
            self._update_contiguous(chunk_id)
            self._packet_state_version += 1
            self._state_version += 1
            return True

    def begin_assembly_attempt(
        self,
        *,
        allow_stale_retry: bool = False,
        stale_retry_after_seconds: float = 60.0,
    ) -> bool:
        """Start an assembly attempt if the session is ready for one."""
        with self._lock:
            if self._assembly_in_progress:
                return False

            now = datetime.now(timezone.utc)
            received_count = sum(
                len(packet_indices)
                for packet_indices in self._received_by_chunk.values()
            )
            received_count_advanced = received_count > self._last_assembly_received_count
            packet_state_advanced = (
                self._packet_state_version
                > self._last_assembly_packet_state_version
            )
            stale_retry_due = False
            if (
                allow_stale_retry
                and self._last_assembly_error is not None
                and self._last_assembly_attempt_at is not None
            ):
                retry_after = max(float(stale_retry_after_seconds), 0.0)
                stale_retry_due = (
                    now - self._last_assembly_attempt_at
                ).total_seconds() >= retry_after
            if (
                self._last_assembly_error is not None
                and not received_count_advanced
                and not packet_state_advanced
                and not stale_retry_due
            ):
                return False

            self._assembly_in_progress = True
            self._assembly_attempts += 1
            self._last_assembly_attempt_at = now
            self._last_assembly_received_count = received_count
            self._last_assembly_packet_state_version = self._packet_state_version
            self._last_assembly_error = None
            self._state_version += 1
            return True

    def finish_assembly_attempt(self, success: bool, error: Optional[str]) -> None:
        """Finish the active assembly attempt and record its outcome."""
        with self._lock:
            previous_in_progress = self._assembly_in_progress
            previous_error = self._last_assembly_error
            next_error = None if success else error or "assembly_failed"

            self._assembly_in_progress = False
            self._last_assembly_error = next_error
            if previous_in_progress or previous_error != next_error:
                self._state_version += 1

    def get_assembly_snapshot(self) -> Dict[str, Any]:
        """Return the current assembly status for progress payloads."""
        with self._lock:
            return self._get_assembly_snapshot_unlocked()

    def _get_assembly_snapshot_unlocked(self) -> Dict[str, Any]:
        return {
            "inProgress": self._assembly_in_progress,
            "attempts": self._assembly_attempts,
            "lastAttemptAt": self._format_optional_datetime_z(
                self._last_assembly_attempt_at
            ),
            "lastError": self._last_assembly_error,
        }

    @staticmethod
    def _format_optional_datetime_z(value: Optional[datetime]) -> Optional[str]:
        if value is None:
            return None
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    def _update_contiguous(self, chunk_id: int) -> None:
        """Update per-chunk last_contiguous based on received packets."""
        received = self._received_by_chunk.get(chunk_id, set())
        next_expected = self._last_contiguous_by_chunk.get(chunk_id, -1) + 1
        while next_expected in received:
            self._last_contiguous_by_chunk[chunk_id] = next_expected
            next_expected += 1

    def _replace_packet_state_unlocked(
        self,
        received_by_chunk: Dict[int, Set[int]],
    ) -> None:
        if self._received_by_chunk == received_by_chunk:
            return

        self._received_by_chunk = {
            int(chunk_id): set(packet_indices)
            for chunk_id, packet_indices in received_by_chunk.items()
        }
        self._last_contiguous_by_chunk = {
            int(chunk_id): -1 for chunk_id in self._received_by_chunk.keys()
        }
        for chunk_id in sorted(self._received_by_chunk.keys()):
            self._update_contiguous(chunk_id)
        self._packet_state_version += 1
        self._state_version += 1
        self._updated_at = datetime.now(timezone.utc)

    def _effective_total_packets_unlocked(self) -> Optional[int]:
        if (
            self._total_chunks is not None
            and self._total_chunks > 0
            and len(self._expected_packets_by_chunk) >= self._total_chunks
        ):
            aggregate = sum(self._expected_packets_by_chunk.values())
            if aggregate > 0:
                return aggregate
        return self._total_packets

    def _effective_reported_total_packets_unlocked(self) -> Optional[int]:
        if (
            self._total_chunks is not None
            and self._total_chunks > 0
            and len(self._reported_total_packets_by_chunk) >= self._total_chunks
        ):
            aggregate = sum(self._reported_total_packets_by_chunk.values())
            if aggregate > 0:
                return aggregate
        if self._reported_total_packets is not None:
            return self._reported_total_packets
        return self._effective_total_packets_unlocked()

    def _effective_total_packets_exact_unlocked(self) -> bool:
        if (
            self._total_chunks is not None
            and self._total_chunks > 0
            and len(self._reported_total_packets_by_chunk) >= self._total_chunks
        ):
            return True
        return self._total_packets_exact

    def observe_chunk_transport_metadata(
        self,
        chunk_id: int,
        *,
        expected_packets: Optional[int] = None,
        total_packets: Optional[int] = None,
        total_chunks: Optional[int] = None,
    ) -> None:
        with self._lock:
            changed = False
            chunk_id = int(chunk_id)
            if total_chunks is not None and total_chunks > 0:
                next_total_chunks = max(self._total_chunks or 0, int(total_chunks))
                if self._total_chunks != next_total_chunks:
                    self._total_chunks = next_total_chunks
                    changed = True
            if expected_packets is not None and int(expected_packets) > 0:
                next_expected_packets = max(
                    self._expected_packets_by_chunk.get(chunk_id, 0),
                    int(expected_packets),
                )
                if self._expected_packets_by_chunk.get(chunk_id) != next_expected_packets:
                    self._expected_packets_by_chunk[chunk_id] = next_expected_packets
                    changed = True
            if total_packets is not None and int(total_packets) > 0:
                next_total_packets = max(
                    self._reported_total_packets_by_chunk.get(chunk_id, 0),
                    int(total_packets),
                )
                if (
                    self._reported_total_packets_by_chunk.get(chunk_id)
                    != next_total_packets
                ):
                    self._reported_total_packets_by_chunk[chunk_id] = next_total_packets
                    changed = True
            if changed:
                self._state_version += 1
                self._updated_at = datetime.now(timezone.utc)

    def observe_chunk_packet_profile(
        self,
        chunk_id: int,
        *,
        total_chunks: Optional[int] = None,
        expected_packets: Optional[int] = None,
        total_packets: Optional[int] = None,
        total_packets_exact: Optional[bool] = None,
    ) -> None:
        self.observe_chunk_transport_metadata(
            chunk_id,
            expected_packets=expected_packets,
            total_packets=total_packets if total_packets_exact is not False else None,
            total_chunks=total_chunks,
        )

    def get_missing_ranges(self, from_index: int = 0, chunk_id: int = 0) -> List[List[int]]:
        """Get list of missing packet ranges.

        Returns:
            List of [start, end] ranges (inclusive)
        """
        with self._lock:
            return self._get_missing_ranges_for_chunk_unlocked(chunk_id, from_index)

    def _get_missing_ranges_for_chunk_unlocked(
        self,
        chunk_id: int,
        from_index: int = 0,
    ) -> List[List[int]]:
        """Get missing ranges for a single chunk without acquiring lock."""
        received = self._received_by_chunk.get(chunk_id)
        if not received:
            return []

        max_received = max(received)
        ranges = []
        start = None

        for i in range(from_index, max_received + 1):
            if i not in received:
                if start is None:
                    start = i
            else:
                if start is not None:
                    ranges.append([start, i - 1])
                    start = None

        if start is not None:
            ranges.append([start, max_received])

        return ranges

    @staticmethod
    def _append_range(ranges: List[List[int]], frame_id: int) -> None:
        if ranges and ranges[-1][1] + 1 == frame_id:
            ranges[-1][1] = frame_id
            return
        ranges.append([frame_id, frame_id])

    def _get_target_frame_summary_for_chunk_unlocked(
        self,
        chunk_id: int,
    ) -> Optional[Dict[str, Any]]:
        """Return the minimum unseen frame IDs still useful for this chunk.

        Fountain decoding does not require specific missing sequence gaps. Any unseen
        unique frame can help, so this exposes the first N unseen frame IDs needed to
        reach the decode threshold while keeping legacy gap diagnostics separate.
        """
        expected_packets = self._expected_packets_by_chunk.get(chunk_id)
        total_packets = self._reported_total_packets_by_chunk.get(chunk_id)
        if expected_packets is None or total_packets is None:
            return None

        expected_packets = max(0, int(expected_packets))
        total_packets = max(0, int(total_packets))
        received = self._received_by_chunk.get(chunk_id, set())
        remaining_to_threshold = max(0, expected_packets - len(received))

        unseen_ranges: List[List[int]] = []
        target_ranges: List[List[int]] = []
        unseen_frame_count = 0
        target_frame_count = 0
        if total_packets > 0:
            for frame_id in range(total_packets):
                if frame_id in received:
                    continue
                self._append_range(unseen_ranges, frame_id)
                unseen_frame_count += 1
                if target_frame_count < remaining_to_threshold:
                    self._append_range(target_ranges, frame_id)
                    target_frame_count += 1

        return {
            "targetFrameCount": target_frame_count,
            "targetFrameRanges": target_ranges,
            "unseenFrameCount": unseen_frame_count,
            "unseenFrameRanges": unseen_ranges,
        }

    def get_chunk_states(self, from_index: int = 0) -> List[Dict[str, Any]]:
        """Get chunk-aware resume state."""
        with self._lock:
            return self._get_chunk_states_unlocked(from_index)

    def _get_chunk_states_unlocked(self, from_index: int = 0) -> List[Dict[str, Any]]:
        chunk_states: List[Dict[str, Any]] = []
        for chunk_id in sorted(self._received_by_chunk.keys()):
            received = self._received_by_chunk.get(chunk_id, set())
            expected_packets = self._expected_packets_by_chunk.get(chunk_id)
            total_packets = self._reported_total_packets_by_chunk.get(chunk_id)
            chunk_state = {
                "chunkId": chunk_id,
                "receivedCount": len(received),
                "lastContiguous": self._last_contiguous_by_chunk.get(chunk_id, -1),
                "missing": self._get_missing_ranges_for_chunk_unlocked(
                    chunk_id,
                    from_index,
                ),
            }
            if expected_packets is not None:
                chunk_state["expectedPackets"] = expected_packets
            if total_packets is not None:
                chunk_state["totalPackets"] = total_packets
                chunk_state["totalPacketsExact"] = True
            target_frame_summary = self._get_target_frame_summary_for_chunk_unlocked(
                chunk_id
            )
            if target_frame_summary is not None:
                chunk_state.update(target_frame_summary)
            chunk_states.append(chunk_state)
        return chunk_states

    def claim_producer(
        self,
        device_id: str,
        websocket: Optional[Any] = None,
    ) -> ProducerClaimResult:
        """Claim producer role for a device.

        Returns:
            Producer claim result for this device
        """
        with self._lock:
            expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=PRODUCER_LEASE_DURATION
            )
            self._producer_device_id = device_id
            self._producer_connections[device_id] = websocket
            self._producer_lease = ProducerLease(
                device_id=device_id,
                expires_at=expires_at,
            )
            return ProducerClaimResult(lease=self._producer_lease)

    def revoke_producer(
        self,
        device_id: Optional[str] = None,
        websocket: Optional[Any] = None,
    ) -> Optional[str]:
        """Revoke one producer or all producers.

        Returns:
            Removed producer device_id or the previous primary producer id
        """
        with self._lock:
            if device_id is not None:
                if device_id not in self._producer_connections and device_id != self._producer_device_id:
                    return None
                if websocket is not None and self._producer_connections.get(device_id) is not websocket:
                    return None
                self._producer_connections.pop(device_id, None)
                removed = device_id
                if self._producer_device_id == device_id:
                    self._producer_device_id = next(iter(self._producer_connections), None)
                if self._producer_device_id is None:
                    self._producer_lease = None
                elif self._producer_lease is None or self._producer_lease.device_id != self._producer_device_id:
                    self._producer_lease = ProducerLease(
                        device_id=self._producer_device_id,
                        expires_at=datetime.now(timezone.utc) + timedelta(
                            seconds=PRODUCER_LEASE_DURATION
                        ),
                    )
                return removed

            prev = self._producer_device_id
            self._producer_device_id = None
            self._producer_lease = None
            self._producer_connections.clear()
            return prev

    def is_producer(self, device_id: str, websocket: Optional[Any] = None) -> bool:
        """Check if device is an active producer."""
        with self._lock:
            if device_id not in self._producer_connections:
                return False
            if websocket is None:
                return True
            return self._producer_connections.get(device_id) is websocket

    def renew_lease(self) -> Optional[ProducerLease]:
        """Renew producer lease."""
        with self._lock:
            if self._producer_lease is None:
                return None

            self._producer_lease.expires_at = datetime.now(timezone.utc) + timedelta(
                seconds=PRODUCER_LEASE_DURATION
            )
            return self._producer_lease

    def set_metadata(
        self,
        filename: Optional[str] = None,
        mime_type: Optional[str] = None,
        file_size: Optional[int] = None,
        expected_packets: Optional[int] = None,
        total_packets: Optional[int] = None,
        total_packets_exact: Optional[bool] = None,
        total_chunks: Optional[int] = None,
        packet_size: Optional[int] = None,
    ) -> None:
        """Update session metadata."""
        with self._lock:
            changed = False
            if filename is not None and self._filename != filename:
                self._filename = filename
                changed = True
            if mime_type is not None and self._mime_type != mime_type:
                self._mime_type = mime_type
                changed = True
            if file_size is not None and self._file_size != file_size:
                self._file_size = file_size
                changed = True
            if expected_packets is not None:
                if self._total_packets != expected_packets:
                    self._total_packets = expected_packets
                    changed = True
            elif total_packets is not None and self._total_packets is None:
                if self._total_packets != total_packets:
                    self._total_packets = total_packets
                    changed = True
            if total_packets is not None:
                if self._reported_total_packets != total_packets:
                    self._reported_total_packets = total_packets
                    changed = True
            elif expected_packets is not None and self._reported_total_packets is None:
                if self._reported_total_packets != expected_packets:
                    self._reported_total_packets = expected_packets
                    changed = True
            if (
                total_packets_exact is not None
                and self._total_packets_exact != bool(total_packets_exact)
            ):
                self._total_packets_exact = bool(total_packets_exact)
                changed = True
            if total_chunks is not None and self._total_chunks != total_chunks:
                self._total_chunks = total_chunks
                changed = True
            if packet_size is not None and self._packet_size != packet_size:
                self._packet_size = packet_size
                changed = True
            if changed:
                self._state_version += 1
                self._updated_at = datetime.now(timezone.utc)

    def hydrate_packet_ranges(self, ranges: List[tuple[int, int]]) -> None:
        """Restore packet receipt state from persisted packet ranges."""
        with self._lock:
            received_by_chunk: Dict[int, Set[int]] = {0: set()}
            received = received_by_chunk[0]
            for start, end in ranges:
                received.update(range(start, end + 1))
            self._replace_packet_state_unlocked(received_by_chunk)

    def hydrate_chunk_packets(self, packets_by_chunk: Dict[int, Set[int]]) -> None:
        """Restore packet receipt state from chunk-aware packet identities."""
        with self._lock:
            received_by_chunk = {
                int(chunk_id): set(packet_indices)
                for chunk_id, packet_indices in packets_by_chunk.items()
                if packet_indices
            }
            self._replace_packet_state_unlocked(received_by_chunk)

    def get_progress(self) -> Dict[str, Any]:
        """Get current progress info."""
        with self._lock:
            received = sum(len(packet_indices) for packet_indices in self._received_by_chunk.values())
            expected = self._effective_total_packets_unlocked()

            percent = 0
            if expected and expected > 0:
                percent = int((received / expected) * 100)

            return {
                "percent": percent,
                "packetsReceived": received,
                "packetsExpected": expected,
                "chunksComplete": None,
                "chunksTotal": self._total_chunks,
            }

    def get_state_dict(self, from_index: int = 0) -> Dict[str, Any]:
        """Get session state as dictionary."""
        with self._lock:
            chunk_states = self._get_chunk_states_unlocked(from_index)
            total_expected = self._effective_total_packets_unlocked()
            total_packets = self._effective_reported_total_packets_unlocked()
            if 0 in self._last_contiguous_by_chunk:
                last_contiguous = self._last_contiguous_by_chunk[0]
            elif len(self._last_contiguous_by_chunk) == 1:
                last_contiguous = next(iter(self._last_contiguous_by_chunk.values()))
            else:
                last_contiguous = -1
            return {
                "receivedCount": sum(
                    len(packet_indices) for packet_indices in self._received_by_chunk.values()
                ),
                "lastContiguous": last_contiguous,
                "missing": self._get_missing_ranges_for_chunk_unlocked(0, from_index),
                "chunkStates": chunk_states,
                "totalExpected": total_expected,
                "totalPackets": total_packets,
                "totalPacketsExact": self._effective_total_packets_exact_unlocked(),
                "stateVersion": self._state_version,
                "assembly": self._get_assembly_snapshot_unlocked(),
            }


class ScanSessionStore:
    """Thread-safe store for multiple scan sessions."""

    def __init__(self) -> None:
        self._sessions: Dict[str, ScanSessionState] = {}
        self._lock = threading.Lock()

    def get(self, session_id: str) -> Optional[ScanSessionState]:
        """Get session by ID."""
        with self._lock:
            return self._sessions.get(session_id)

    def get_or_create(self, session_id: str) -> ScanSessionState:
        """Get or create session by ID."""
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = ScanSessionState(session_id)
            return self._sessions[session_id]

    def remove(self, session_id: str) -> bool:
        """Remove session from store. Returns True if removed."""
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
            return False

    def list_sessions(self) -> List[str]:
        """List all session IDs."""
        with self._lock:
            return list(self._sessions.keys())
