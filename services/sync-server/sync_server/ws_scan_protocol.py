"""WebSocket scan protocol constants and utilities."""

from __future__ import annotations

import struct
import zlib
from typing import Dict

# Protocol version
PROTOCOL_VERSION = 1

# Flags
FLAG_LAST_OF_CHUNK = 0x01
FLAG_RETRANSMIT = 0x02
FLAG_FINAL_HINT = 0x04

# Header format: version(1) + flags(1) + chunk_id(2) + pkt_index(4) + crc32(4) = 12 bytes
HEADER_FORMAT = ">BBHII"  # Big-endian: uint8, uint8, uint16, uint32, uint32
HEADER_SIZE = 12

# Limits
MAX_CHUNKS = 65535
MAX_PACKET_INDEX = 4294967295
MAX_CHUNK_SIZE = 10 * 1024 * 1024  # 10MB

# Window defaults
DEFAULT_WINDOW_SIZE = 32
MIN_WINDOW_SIZE = 8
MAX_WINDOW_SIZE = 256

# Timeouts (seconds)
PRODUCER_LEASE_DURATION = 30
ACK_INTERVAL_MS = 500
ACK_PACKET_COUNT = 16


def parse_binary_header(data: bytes) -> Dict[str, int]:
    """Parse a 12-byte binary header from packet data.

    Args:
        data: Raw bytes (at least 12 bytes)

    Returns:
        Dict with version, flags, chunk_id, pkt_index, crc32

    Raises:
        ValueError: If data is less than 12 bytes
    """
    if len(data) < HEADER_SIZE:
        raise ValueError(f"Header must be at least 12 bytes, got {len(data)}")

    version, flags, chunk_id, pkt_index, crc32 = struct.unpack(
        HEADER_FORMAT, data[:HEADER_SIZE]
    )

    return {
        "version": version,
        "flags": flags,
        "chunk_id": chunk_id,
        "pkt_index": pkt_index,
        "crc32": crc32,
    }


def build_binary_header(
    version: int,
    flags: int,
    chunk_id: int,
    pkt_index: int,
    crc32: int,
) -> bytes:
    """Build a 12-byte binary header.

    Args:
        version: Protocol version (uint8)
        flags: Packet flags (uint8)
        chunk_id: Chunk index (uint16)
        pkt_index: Global packet index (uint32)
        crc32: CRC32 checksum of payload (uint32)

    Returns:
        12-byte header
    """
    return struct.pack(HEADER_FORMAT, version, flags, chunk_id, pkt_index, crc32)


def compute_crc32(payload: bytes) -> int:
    """Compute CRC32 checksum of payload.

    Args:
        payload: Raw payload bytes

    Returns:
        CRC32 as unsigned 32-bit integer
    """
    return zlib.crc32(payload) & 0xFFFFFFFF
