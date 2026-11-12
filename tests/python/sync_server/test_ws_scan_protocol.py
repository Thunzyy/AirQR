"""Tests for WebSocket scan protocol utilities."""

import pytest
from sync_server.ws_scan_protocol import (
    PROTOCOL_VERSION,
    FLAG_LAST_OF_CHUNK,
    FLAG_RETRANSMIT,
    FLAG_FINAL_HINT,
    parse_binary_header,
    build_binary_header,
    compute_crc32,
)


class TestBinaryHeader:
    """Test binary header parsing and building."""

    def test_parse_valid_header(self) -> None:
        """Should parse a valid 12-byte header."""
        # version=1, flags=0x01, chunk_id=5, pkt_index=100, crc32=0x12345678
        header = bytes([
            0x01,  # version
            0x01,  # flags (LAST_OF_CHUNK)
            0x00, 0x05,  # chunk_id BE
            0x00, 0x00, 0x00, 0x64,  # pkt_index BE (100)
            0x12, 0x34, 0x56, 0x78,  # crc32 BE
        ])
        result = parse_binary_header(header)
        assert result["version"] == 1
        assert result["flags"] == 0x01
        assert result["chunk_id"] == 5
        assert result["pkt_index"] == 100
        assert result["crc32"] == 0x12345678

    def test_parse_header_too_short(self) -> None:
        """Should raise ValueError for header < 12 bytes."""
        with pytest.raises(ValueError, match="at least 12 bytes"):
            parse_binary_header(bytes(10))

    def test_build_header(self) -> None:
        """Should build a valid 12-byte header."""
        header = build_binary_header(
            version=1,
            flags=FLAG_LAST_OF_CHUNK | FLAG_RETRANSMIT,
            chunk_id=256,
            pkt_index=65536,
            crc32=0xDEADBEEF,
        )
        assert len(header) == 12
        # Parse it back
        result = parse_binary_header(header)
        assert result["version"] == 1
        assert result["flags"] == 0x03
        assert result["chunk_id"] == 256
        assert result["pkt_index"] == 65536
        assert result["crc32"] == 0xDEADBEEF

    def test_compute_crc32(self) -> None:
        """Should compute CRC32 of payload."""
        payload = b"Hello, World!"
        crc = compute_crc32(payload)
        assert isinstance(crc, int)
        assert crc == compute_crc32(payload)  # Deterministic


class TestProtocolConstants:
    """Test protocol constants are defined."""

    def test_version(self) -> None:
        assert PROTOCOL_VERSION == 1

    def test_flags(self) -> None:
        assert FLAG_LAST_OF_CHUNK == 0x01
        assert FLAG_RETRANSMIT == 0x02
        assert FLAG_FINAL_HINT == 0x04
