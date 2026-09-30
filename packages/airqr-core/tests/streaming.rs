//! Streaming mode integration tests for AirQR
//!
//! Tests the streaming encoder/decoder for large files that are split into chunks.

use airqr_core::streaming::{StreamDecodeResult, StreamingConfig, StreamingDecoder};
use qrcodegen::QrCodeEcc;
use raptorq::Encoder;

struct StreamingPacketHeader {
    session_id: u32,
    chunk_id: u32,
    total_chunks: u32,
    chunk_offset: u64,
    total_size: u32,
    exact_chunk_packets: Option<u32>,
}

/// Build a streaming packet with the proper header structure
fn build_streaming_packet(
    header: StreamingPacketHeader,
    packet_id: &[u8],
    payload: &[u8],
) -> Vec<u8> {
    let mode = if header.exact_chunk_packets.is_some() {
        2u8
    } else {
        1u8
    };
    let header_size = if header.exact_chunk_packets.is_some() {
        35
    } else {
        31
    };

    let mut data = Vec::with_capacity(header_size + payload.len());
    data.push(mode);
    data.extend_from_slice(&header.session_id.to_be_bytes());
    data.extend_from_slice(&header.chunk_id.to_be_bytes());
    data.extend_from_slice(&header.total_chunks.to_be_bytes());
    data.extend_from_slice(&header.chunk_offset.to_be_bytes());
    data.extend_from_slice(&header.total_size.to_be_bytes());
    data.extend_from_slice(&(payload.len() as u16).to_be_bytes()); // Use actual payload length
    if let Some(total_packets) = header.exact_chunk_packets {
        data.extend_from_slice(&total_packets.to_be_bytes());
    }
    data.extend_from_slice(packet_id);
    data.extend_from_slice(payload);

    data
}

/// Helper to encode a chunk and decode it
fn encode_chunk_to_packets(
    chunk_data: &[u8],
    filename: &str,
    session_id: u32,
    chunk_id: u32,
    total_chunks: u32,
    chunk_offset: u64,
    config: &StreamingConfig,
) -> Vec<Vec<u8>> {
    // Build payload: [CompressionFlag(1b)][NameLen(4b)][NameBytes][ChunkData]
    let filename_bytes = filename.as_bytes();
    let filename_len = filename_bytes.len() as u32;

    let mut payload = Vec::with_capacity(1 + 4 + filename_bytes.len() + chunk_data.len());
    payload.push(0u8); // No compression
    payload.extend_from_slice(&filename_len.to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(chunk_data);

    let total_size = payload.len() as u32;

    // RaptorQ encoding
    let encoder = Encoder::with_defaults(&payload, config.packet_size);
    let packets_to_generate = (payload.len() as f64 / config.packet_size as f64
        * config.raptorq_overhead as f64)
        .ceil() as u32;
    let packets_to_generate = packets_to_generate.max(10);

    let rq_packets = encoder.get_encoded_packets(packets_to_generate);

    // Convert to streaming packets
    rq_packets
        .iter()
        .map(|packet| {
            let packet_data = packet.data();
            let packet_id = packet.payload_id().serialize();

            build_streaming_packet(
                StreamingPacketHeader {
                    session_id,
                    chunk_id,
                    total_chunks,
                    chunk_offset,
                    total_size,
                    exact_chunk_packets: Some(rq_packets.len() as u32),
                },
                &packet_id,
                packet_data,
            )
        })
        .collect()
}

// ============================================
// StreamingConfig Tests
// ============================================

#[test]
fn test_streaming_config_defaults() {
    let config = StreamingConfig::default();

    assert_eq!(config.qr_version_min, 1);
    assert_eq!(config.qr_version_max, 40);
    assert_eq!(config.frame_delay_ms, 100);
    assert_eq!(config.packet_size, 250);
    assert_eq!(config.chunk_size_mb, 10);
    assert!(config.compression_enabled);
    assert!((config.raptorq_overhead - 1.5).abs() < 0.001);
}

#[test]
fn test_streaming_config_custom() {
    let config = StreamingConfig {
        qr_version_min: 5,
        qr_version_max: 30,
        ecc: QrCodeEcc::High,
        frame_delay_ms: 50,
        packet_size: 500,
        chunk_size_mb: 5,
        compression_enabled: false,
        raptorq_overhead: 2.0,
    };

    assert_eq!(config.qr_version_min, 5);
    assert_eq!(config.packet_size, 500);
    assert_eq!(config.chunk_size_mb, 5);
    assert!(!config.compression_enabled);
}

// ============================================
// StreamingDecoder Tests
// ============================================

#[test]
fn test_streaming_decoder_new() {
    let _decoder = StreamingDecoder::new();
}

#[test]
fn test_streaming_decoder_reset() {
    let mut decoder = StreamingDecoder::new();
    decoder.reset();
}

#[test]
fn test_streaming_packet_too_short() {
    let mut decoder = StreamingDecoder::new();

    // Less than 31 bytes header
    let short_data = vec![1u8; 20]; // mode=1, but too short
    let result = decoder.add_packet(&short_data);

    match result {
        StreamDecodeResult::Error(msg) => {
            assert!(
                msg.contains("short") || msg.contains("31"),
                "Error should mention packet being too short"
            );
        }
        _ => panic!("Expected Error for short packet"),
    }
}

#[test]
fn test_streaming_wrong_mode() {
    let mut decoder = StreamingDecoder::new();

    // Create packet with mode=0 (normal mode, not streaming)
    let mut data = vec![0u8; 50]; // mode=0
    data[0] = 0; // Not streaming mode

    let result = decoder.add_packet(&data);

    match result {
        StreamDecodeResult::Error(msg) => {
            assert!(
                msg.contains("streaming") || msg.contains("mode"),
                "Error should mention streaming mode"
            );
        }
        _ => panic!("Expected Error for wrong mode"),
    }
}

#[test]
fn test_streaming_rejects_chunk_id_out_of_range() {
    let data = b"Chunk bounds test";
    let filename = "bounds.txt";
    let session_id = 4242u32;

    let config = StreamingConfig {
        packet_size: 100,
        raptorq_overhead: 1.5,
        ..Default::default()
    };

    let mut packets = encode_chunk_to_packets(data, filename, session_id, 0, 2, 0, &config);
    let mut packet = packets.remove(0);
    packet[5..9].copy_from_slice(&2u32.to_be_bytes());

    let mut decoder = StreamingDecoder::new();
    let result = decoder.add_packet(&packet);

    match result {
        StreamDecodeResult::Error(msg) => {
            assert!(
                msg.contains("chunk_id") || msg.contains("chunk"),
                "Error should mention invalid chunk bounds"
            );
        }
        _ => panic!("Expected Error for out-of-range chunk_id"),
    }
}

#[test]
fn test_streaming_rejects_zero_total_size() {
    let data = b"Zero total size";
    let filename = "zero-total.txt";
    let session_id = 9090u32;

    let config = StreamingConfig {
        packet_size: 100,
        raptorq_overhead: 1.5,
        ..Default::default()
    };

    let mut packets = encode_chunk_to_packets(data, filename, session_id, 0, 1, 0, &config);
    let mut packet = packets.remove(0);
    packet[21..25].copy_from_slice(&0u32.to_be_bytes());

    let mut decoder = StreamingDecoder::new();
    let result = decoder.add_packet(&packet);

    match result {
        StreamDecodeResult::Error(msg) => {
            assert!(
                msg.contains("total_size") || msg.contains("total"),
                "Error should mention invalid total_size"
            );
        }
        _ => panic!("Expected Error for zero total_size"),
    }
}

#[test]
fn test_streaming_single_chunk_decode() {
    let data = b"Single chunk test data for streaming mode";
    let filename = "single_chunk.txt";
    let session_id = 12345u32;
    let chunk_id = 0u32;
    let total_chunks = 1u32;
    let chunk_offset = 0u64;

    let config = StreamingConfig {
        packet_size: 100,
        raptorq_overhead: 1.5,
        ..Default::default()
    };

    let packets = encode_chunk_to_packets(
        data,
        filename,
        session_id,
        chunk_id,
        total_chunks,
        chunk_offset,
        &config,
    );

    let mut decoder = StreamingDecoder::new();
    let mut completed = false;

    for packet in packets {
        match decoder.add_packet(&packet) {
            StreamDecodeResult::AllCompleted {
                filename: f,
                data: d,
                ..
            } => {
                assert_eq!(f, filename);
                assert_eq!(d, data);
                completed = true;
                break;
            }
            StreamDecodeResult::Progress { .. } => continue,
            StreamDecodeResult::ChunkCompleted { .. } => {
                // For single chunk, this might transition to AllCompleted
                continue;
            }
            StreamDecodeResult::Error(e) => panic!("Decode error: {}", e),
        }
    }

    assert!(completed, "Single chunk should decode completely");
}

#[test]
fn test_streaming_multi_chunk_decode() {
    let filename = "multi_chunk.bin";
    let session_id = 99999u32;

    // Create 3 chunks of data
    let chunk1 = b"First chunk of data for streaming test";
    let chunk2 = b"Second chunk with different content";
    let chunk3 = b"Third and final chunk";

    let config = StreamingConfig {
        packet_size: 100,
        raptorq_overhead: 1.5,
        ..Default::default()
    };

    // Encode each chunk
    let packets1 = encode_chunk_to_packets(chunk1, filename, session_id, 0, 3, 0, &config);

    let packets2 = encode_chunk_to_packets(
        chunk2,
        filename,
        session_id,
        1,
        3,
        chunk1.len() as u64,
        &config,
    );

    let packets3 = encode_chunk_to_packets(
        chunk3,
        filename,
        session_id,
        2,
        3,
        (chunk1.len() + chunk2.len()) as u64,
        &config,
    );

    let mut decoder = StreamingDecoder::new();
    let mut chunks_completed = 0;

    // Process all packets from all chunks
    for packet in packets1
        .iter()
        .chain(packets2.iter())
        .chain(packets3.iter())
    {
        match decoder.add_packet(packet) {
            StreamDecodeResult::AllCompleted { filename: f, .. } => {
                assert_eq!(f, filename);
                return; // Success
            }
            StreamDecodeResult::ChunkCompleted { .. } => {
                chunks_completed += 1;
            }
            StreamDecodeResult::Progress { .. } => continue,
            StreamDecodeResult::Error(e) => panic!("Decode error: {}", e),
        }
    }

    // If we get here, check that at least some chunks completed
    assert!(
        chunks_completed >= 2,
        "Should have completed at least 2 chunks"
    );
}

#[test]
fn test_streaming_session_auto_reset() {
    let filename = "session_test.txt";
    let config = StreamingConfig {
        packet_size: 100,
        raptorq_overhead: 1.5,
        ..Default::default()
    };

    // First session
    let session1_packets =
        encode_chunk_to_packets(b"Session 1 data", filename, 11111, 0, 1, 0, &config);

    // Second session (different session_id)
    let session2_packets =
        encode_chunk_to_packets(b"Session 2 data", filename, 22222, 0, 1, 0, &config);

    let mut decoder = StreamingDecoder::new();

    // Feed first packet from session 1
    let _ = decoder.add_packet(&session1_packets[0]);

    // Feed first packet from session 2 - should auto-reset
    let result = decoder.add_packet(&session2_packets[0]);

    // Should return Progress for new session, not error
    match result {
        StreamDecodeResult::Progress { session_id, .. } => {
            assert_eq!(session_id, 22222, "Should be processing session 2");
        }
        StreamDecodeResult::Error(e) => panic!("Should not error on session change: {}", e),
        _ => {} // ChunkCompleted or AllCompleted also acceptable
    }
}

#[test]
fn test_streaming_out_of_order_chunks() {
    let filename = "out_of_order.bin";
    let session_id = 77777u32;

    let chunk1 = b"First chunk data";
    let chunk2 = b"Second chunk data";

    let config = StreamingConfig {
        packet_size: 100,
        raptorq_overhead: 1.5,
        ..Default::default()
    };

    // Encode chunks
    let packets1 = encode_chunk_to_packets(chunk1, filename, session_id, 0, 2, 0, &config);

    let packets2 = encode_chunk_to_packets(
        chunk2,
        filename,
        session_id,
        1,
        2,
        chunk1.len() as u64,
        &config,
    );

    let mut decoder = StreamingDecoder::new();

    // Send chunk 2 first, then chunk 1 (out of order)
    for packet in packets2.iter().chain(packets1.iter()) {
        match decoder.add_packet(packet) {
            StreamDecodeResult::AllCompleted { .. } => {
                return; // Success - decoded despite out of order
            }
            StreamDecodeResult::Error(e) => panic!("Decode error: {}", e),
            _ => continue,
        }
    }
}

#[test]
fn test_streaming_duplicate_packets() {
    let data = b"Test data for duplicate packet handling";
    let filename = "duplicates.txt";
    let session_id = 55555u32;

    let config = StreamingConfig {
        packet_size: 100,
        raptorq_overhead: 1.5,
        ..Default::default()
    };

    let packets = encode_chunk_to_packets(data, filename, session_id, 0, 1, 0, &config);

    let mut decoder = StreamingDecoder::new();

    // Send each packet twice
    for packet in &packets {
        let _ = decoder.add_packet(packet); // First time
        let _ = decoder.add_packet(packet); // Duplicate - should be ignored
    }

    // Should still be able to decode
    // (test passes if no panic)
}

// ============================================
// StreamDecodeResult Tests
// ============================================

#[test]
fn test_stream_decode_result_progress_fields() {
    let result = StreamDecodeResult::Progress {
        session_id: 123,
        chunk_id: 0,
        total_chunks: 3,
        chunk_percent: 50.0,
        overall_percent: 16.67,
        chunks_completed: 0,
        filename: Some("test.txt".to_string()),
        packets_received_chunk: 5,
        packets_expected_chunk: 10,
        packets_total_chunk: Some(10),
        packets_received_total: 5,
    };

    match result {
        StreamDecodeResult::Progress {
            session_id,
            chunk_id,
            total_chunks,
            chunk_percent,
            ..
        } => {
            assert_eq!(session_id, 123);
            assert_eq!(chunk_id, 0);
            assert_eq!(total_chunks, 3);
            assert!((chunk_percent - 50.0).abs() < 0.01);
        }
        _ => panic!("Expected Progress variant"),
    }
}

#[test]
fn test_streaming_decoder_keeps_decode_threshold_distinct_from_exact_chunk_packet_count() {
    let chunk_data = b"hello exact packet count";
    let filename = "exact.bin";
    let session_id = 999u32;
    let total_chunks = 1u32;
    let config = StreamingConfig {
        packet_size: 8,
        ..StreamingConfig::default()
    };

    let packets = encode_chunk_to_packets(
        chunk_data,
        filename,
        session_id,
        0,
        total_chunks,
        0,
        &config,
    );
    let exact_packet_count = packets.len() as u32;
    let payload_len = 1 + 4 + filename.len() + chunk_data.len();
    let decode_threshold = (payload_len as f32 / config.packet_size as f32).ceil() as u32;

    assert!(
        exact_packet_count > decode_threshold,
        "test requires RaptorQ overhead to produce more packets than the decode threshold"
    );

    let mut decoder = StreamingDecoder::new();
    let result = decoder.add_packet(&packets[0]);

    match result {
        StreamDecodeResult::Progress {
            packets_expected_chunk,
            packets_total_chunk,
            ..
        } => {
            assert_eq!(packets_expected_chunk, decode_threshold);
            assert_eq!(packets_total_chunk, Some(exact_packet_count));
        }
        other => panic!("Expected Progress variant, got {other:?}"),
    }
}

#[test]
fn test_stream_decode_result_chunk_completed() {
    let result = StreamDecodeResult::ChunkCompleted {
        session_id: 456,
        chunk_id: 1,
        total_chunks: 3,
        chunks_completed: 2,
        overall_percent: 66.67,
        chunk_data: vec![1, 2, 3],
        filename: Some("chunk.bin".to_string()),
        packets_received_chunk: 10,
        packets_expected_chunk: 10,
        packets_total_chunk: Some(10),
        packets_received_total: 20,
    };

    match result {
        StreamDecodeResult::ChunkCompleted {
            chunk_id,
            chunks_completed,
            chunk_data,
            ..
        } => {
            assert_eq!(chunk_id, 1);
            assert_eq!(chunks_completed, 2);
            assert_eq!(chunk_data, vec![1, 2, 3]);
        }
        _ => panic!("Expected ChunkCompleted variant"),
    }
}

#[test]
fn test_stream_decode_result_all_completed() {
    let result = StreamDecodeResult::AllCompleted {
        session_id: 789,
        filename: "complete.txt".to_string(),
        data: vec![4, 5, 6, 7],
        duration: std::time::Duration::from_secs(10),
        total_packets: 50,
    };

    match result {
        StreamDecodeResult::AllCompleted {
            session_id,
            filename,
            data,
            total_packets,
            ..
        } => {
            assert_eq!(session_id, 789);
            assert_eq!(filename, "complete.txt");
            assert_eq!(data, vec![4, 5, 6, 7]);
            assert_eq!(total_packets, 50);
        }
        _ => panic!("Expected AllCompleted variant"),
    }
}

#[test]
fn test_stream_decode_result_error() {
    let result = StreamDecodeResult::Error("Test streaming error".to_string());

    match result {
        StreamDecodeResult::Error(msg) => {
            assert_eq!(msg, "Test streaming error");
        }
        _ => panic!("Expected Error variant"),
    }
}
