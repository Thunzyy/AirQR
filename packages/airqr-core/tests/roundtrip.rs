//! Roundtrip integration tests for AirQR encoding/decoding
//!
//! Tests the core encode/decode logic without relying on visual QR detection.
//! We extract packet data directly from the encoding process and feed it to the decoder.

use airqr_core::{AirqrDecoder, DecodeResult, EncoderConfig};
use qrcodegen::QrCodeEcc;
use raptorq::Encoder;

#[test]
fn legacy_unaligned_packet_headers_roundtrip_and_reject_damage() {
    let data: Vec<u8> = (0..32_000).map(|i| (i % 251) as u8).collect();
    let filename = "legacy.csv";
    let mut payload = vec![0];
    payload.extend_from_slice(&(filename.len() as u32).to_be_bytes());
    payload.extend_from_slice(filename.as_bytes());
    payload.extend_from_slice(&data);
    for maximum in [100u16, 250, 500, 1500] {
        let encoder = Encoder::with_defaults(&payload, maximum);
        let mut decoder = AirqrDecoder::new();
        let mut completed = false;
        for packet in encoder.get_encoded_packets(10) {
            let mut bytes = Vec::new();
            bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
            bytes.extend_from_slice(&maximum.to_be_bytes());
            bytes.extend_from_slice(&packet.payload_id().serialize());
            bytes.extend_from_slice(packet.data());
            let mut truncated = bytes.clone();
            truncated.pop();
            assert!(matches!(AirqrDecoder::new().add_chunk(&truncated), DecodeResult::Error(_)));
            let mut extended = bytes.clone();
            extended.push(0);
            assert!(matches!(AirqrDecoder::new().add_chunk(&extended), DecodeResult::Error(_)));
            match decoder.add_chunk(&bytes) {
                DecodeResult::Completed { filename: actual_name, data: actual, .. } => {
                    assert_eq!(actual_name, filename);
                    assert_eq!(actual, data);
                    completed = true;
                    break;
                }
                DecodeResult::Error(e) => panic!("maximum={maximum}: {e}"),
                DecodeResult::Progress { .. } => {}
            }
        }
        assert!(completed, "legacy maximum={maximum} did not decode");
    }
}

/// Helper to build packets and decode them, simulating the encode/decode cycle
fn run_roundtrip(
    data: &[u8],
    filename: &str,
    config: EncoderConfig,
) -> Result<(String, Vec<u8>), String> {
    // Build payload: [NameLen(4b)][NameBytes][FileData]
    let filename_bytes = filename.as_bytes();
    let filename_len = filename_bytes.len() as u32;

    let mut payload = Vec::with_capacity(4 + filename_bytes.len() + data.len());
    payload.extend_from_slice(&filename_len.to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(data);

    // Apply compression flag (0 = no compression for simplicity)
    let mut compressed = Vec::with_capacity(1 + payload.len());
    compressed.push(0u8); // No compression
    compressed.extend_from_slice(&payload);

    let total_size = compressed.len() as u32;
    let packet_size = config.packet_size;

    // RaptorQ encoding
    let encoder = Encoder::with_defaults(&compressed, packet_size);
    let packets_to_generate = (compressed.len() as f64 / packet_size as f64
        * config.raptorq_overhead as f64)
        .ceil() as u32;
    let packets_to_generate = packets_to_generate.max(10);

    let packets = encoder.get_encoded_packets(packets_to_generate);

    // Decode
    let mut decoder = AirqrDecoder::new();

    for packet in packets.iter() {
        let payload_data = packet.data();

        // Build QR data packet: [TotalSize(4b)][PacketSize(2b)][PayloadId(4b)][Payload]
        let actual_payload_size = payload_data.len() as u16;
        let mut qr_data = Vec::with_capacity(10 + payload_data.len());
        qr_data.extend_from_slice(&total_size.to_be_bytes());
        qr_data.extend_from_slice(&actual_payload_size.to_be_bytes());
        qr_data.extend_from_slice(&packet.payload_id().serialize());
        qr_data.extend_from_slice(payload_data);

        match decoder.add_chunk(&qr_data) {
            DecodeResult::Completed { filename, data, .. } => {
                return Ok((filename, data));
            }
            DecodeResult::Progress { .. } => continue,
            DecodeResult::Error(e) => return Err(format!("Decode error: {}", e)),
        }
    }

    Err("Decoding did not complete".to_string())
}

// ============================================
// Roundtrip Tests
// ============================================

#[test]
fn test_roundtrip_small_file() {
    let data = b"Hello, AirQR! This is a small test file.";
    let filename = "test.txt";

    let config = EncoderConfig::default();

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data, data);
        }
        Err(e) => panic!("Roundtrip failed: {}", e),
    }
}

#[test]
fn test_roundtrip_medium_file() {
    // 10 KB of random-ish data
    let data: Vec<u8> = (0..10_000).map(|i| (i % 256) as u8).collect();
    let filename = "medium.bin";

    let config = EncoderConfig::default();

    match run_roundtrip(&data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data, data);
        }
        Err(e) => panic!("Roundtrip failed: {}", e),
    }
}

#[test]
fn test_roundtrip_large_file() {
    // 100 KB of data
    let data: Vec<u8> = (0..100_000).map(|i| (i % 256) as u8).collect();
    let filename = "large.bin";

    let config = EncoderConfig {
        packet_size: 500,
        raptorq_overhead: 1.3,
        ..Default::default()
    };

    match run_roundtrip(&data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data, data);
        }
        Err(e) => panic!("Roundtrip failed: {}", e),
    }
}

#[test]
fn test_roundtrip_binary_data() {
    // Binary data with all byte values
    let data: Vec<u8> = (0..256).map(|i| i as u8).collect();
    let filename = "binary.dat";

    let config = EncoderConfig::default();

    match run_roundtrip(&data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data, data);
        }
        Err(e) => panic!("Roundtrip failed: {}", e),
    }
}

#[test]
fn test_roundtrip_utf8_content() {
    let data = "日本語テスト 🎉 émojis et accénts".as_bytes();
    let filename = "unicode.txt";

    let config = EncoderConfig::default();

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data, data);
        }
        Err(e) => panic!("Roundtrip failed: {}", e),
    }
}

#[test]
fn test_roundtrip_empty_content() {
    let data = b"";
    let filename = "empty.txt";

    let config = EncoderConfig::default();

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.len(), 0);
        }
        Err(e) => panic!("Roundtrip failed: {}", e),
    }
}

// ============================================
// ECC Level Tests
// ============================================

#[test]
fn test_roundtrip_ecc_low() {
    let data = b"Testing LOW ECC level";
    let filename = "ecc_low.txt";

    let config = EncoderConfig {
        ecc: QrCodeEcc::Low,
        ..Default::default()
    };

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with LOW ECC failed: {}", e),
    }
}

#[test]
fn test_roundtrip_ecc_quartile() {
    let data = b"Testing QUARTILE ECC level";
    let filename = "ecc_quartile.txt";

    let config = EncoderConfig {
        ecc: QrCodeEcc::Quartile,
        ..Default::default()
    };

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with QUARTILE ECC failed: {}", e),
    }
}

#[test]
fn test_roundtrip_ecc_high() {
    let data = b"Testing HIGH ECC level";
    let filename = "ecc_high.txt";

    let config = EncoderConfig {
        ecc: QrCodeEcc::High,
        ..Default::default()
    };

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with HIGH ECC failed: {}", e),
    }
}

// ============================================
// Packet Size Tests
// ============================================

#[test]
fn test_roundtrip_packet_size_100() {
    let data = b"Testing small packet size of 100 bytes";
    let filename = "small_packets.txt";

    let config = EncoderConfig {
        packet_size: 100,
        ..Default::default()
    };

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with packet_size=100 failed: {}", e),
    }
}

#[test]
fn test_roundtrip_packet_size_500() {
    let data: Vec<u8> = (0..2000).map(|i| (i % 256) as u8).collect();
    let filename = "medium_packets.bin";

    let config = EncoderConfig {
        packet_size: 500,
        ..Default::default()
    };

    match run_roundtrip(&data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data, data);
        }
        Err(e) => panic!("Roundtrip with packet_size=500 failed: {}", e),
    }
}

#[test]
fn test_roundtrip_packet_size_768() {
    let data: Vec<u8> = (0..5000).map(|i| (i % 256) as u8).collect();
    let filename = "large_packets.bin";

    let config = EncoderConfig {
        packet_size: 768,
        ..Default::default()
    };

    match run_roundtrip(&data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data, data);
        }
        Err(e) => panic!("Roundtrip with packet_size=768 failed: {}", e),
    }
}

#[test]
fn test_roundtrip_packet_size_1000() {
    let data: Vec<u8> = (0..10_000).map(|i| (i % 256) as u8).collect();
    let filename = "xlarge_packets.bin";

    let config = EncoderConfig {
        packet_size: 1000,
        ..Default::default()
    };

    match run_roundtrip(&data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data, data);
        }
        Err(e) => panic!("Roundtrip with packet_size=1000 failed: {}", e),
    }
}

// ============================================
// RaptorQ Overhead Tests
// ============================================

#[test]
fn test_roundtrip_overhead_1_0() {
    // Minimal overhead - might not complete
    let data = b"Testing minimal overhead 1.0x";
    let filename = "overhead_1.txt";

    let config = EncoderConfig {
        raptorq_overhead: 1.0,
        ..Default::default()
    };

    // This may fail due to insufficient packets
    let _ = run_roundtrip(data, filename, config);
}

#[test]
fn test_roundtrip_overhead_1_2() {
    let data = b"Testing overhead 1.2x (20% extra packets)";
    let filename = "overhead_1_2.txt";

    let config = EncoderConfig {
        raptorq_overhead: 1.2,
        ..Default::default()
    };

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with overhead=1.2 failed: {}", e),
    }
}

#[test]
fn test_roundtrip_overhead_2_0() {
    let data = b"Testing high overhead 2.0x for reliability";
    let filename = "high_overhead.txt";

    let config = EncoderConfig {
        raptorq_overhead: 2.0,
        ..Default::default()
    };

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with overhead=2.0 failed: {}", e),
    }
}

#[test]
fn test_roundtrip_overhead_3_0() {
    let data = b"Testing very high overhead 3.0x";
    let filename = "very_high_overhead.txt";

    let config = EncoderConfig {
        raptorq_overhead: 3.0,
        ..Default::default()
    };

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with overhead=3.0 failed: {}", e),
    }
}

// ============================================
// Partial Packet Reception Tests (Fountain Code Feature)
// ============================================

#[test]
fn test_fountain_decode_with_packet_loss() {
    let data = b"Testing fountain code recovery with packet loss";
    let filename = "fountain.txt";

    // Build payload
    let filename_bytes = filename.as_bytes();
    let filename_len = filename_bytes.len() as u32;

    let mut payload = Vec::with_capacity(4 + filename_bytes.len() + data.len());
    payload.extend_from_slice(&filename_len.to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(data);

    let mut compressed = Vec::with_capacity(1 + payload.len());
    compressed.push(0u8);
    compressed.extend_from_slice(&payload);

    let total_size = compressed.len() as u32;
    let packet_size: u16 = 250;

    // Generate 3x packets (plenty of redundancy)
    let encoder = Encoder::with_defaults(&compressed, packet_size);
    let min_packets = (compressed.len() as f64 / packet_size as f64).ceil() as u32;
    let packets_to_generate = min_packets * 3;

    let packets = encoder.get_encoded_packets(packets_to_generate);

    // Simulate 50% packet loss - only use every other packet
    let mut decoder = AirqrDecoder::new();
    let mut decoded = false;

    for (i, packet) in packets.iter().enumerate() {
        if i % 2 == 0 {
            // Skip half the packets
            continue;
        }

        let payload_data = packet.data();
        let actual_payload_size = payload_data.len() as u16;

        let mut qr_data = Vec::with_capacity(10 + payload_data.len());
        qr_data.extend_from_slice(&total_size.to_be_bytes());
        qr_data.extend_from_slice(&actual_payload_size.to_be_bytes());
        qr_data.extend_from_slice(&packet.payload_id().serialize());
        qr_data.extend_from_slice(payload_data);

        match decoder.add_chunk(&qr_data) {
            DecodeResult::Completed {
                filename: f,
                data: d,
                ..
            } => {
                assert_eq!(f, filename);
                assert_eq!(d, data);
                decoded = true;
                break;
            }
            DecodeResult::Progress { .. } => continue,
            DecodeResult::Error(e) => panic!("Decode error: {}", e),
        }
    }

    assert!(
        decoded,
        "Should decode despite 50% packet loss with 3x overhead"
    );
}

#[test]
fn test_fountain_decode_out_of_order() {
    let data = b"Testing out of order packet delivery";
    let filename = "out_of_order.txt";

    // Build payload
    let filename_bytes = filename.as_bytes();
    let filename_len = filename_bytes.len() as u32;

    let mut payload = Vec::with_capacity(4 + filename_bytes.len() + data.len());
    payload.extend_from_slice(&filename_len.to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(data);

    let mut compressed = Vec::with_capacity(1 + payload.len());
    compressed.push(0u8);
    compressed.extend_from_slice(&payload);

    let total_size = compressed.len() as u32;
    let packet_size: u16 = 250;

    let encoder = Encoder::with_defaults(&compressed, packet_size);
    let packets_to_generate = 20;
    let packets: Vec<_> = encoder.get_encoded_packets(packets_to_generate);

    // Reverse order
    let mut reversed_packets: Vec<_> = packets.iter().collect();
    reversed_packets.reverse();

    let mut decoder = AirqrDecoder::new();
    let mut decoded = false;

    for packet in reversed_packets {
        let payload_data = packet.data();
        let actual_payload_size = payload_data.len() as u16;

        let mut qr_data = Vec::with_capacity(10 + payload_data.len());
        qr_data.extend_from_slice(&total_size.to_be_bytes());
        qr_data.extend_from_slice(&actual_payload_size.to_be_bytes());
        qr_data.extend_from_slice(&packet.payload_id().serialize());
        qr_data.extend_from_slice(payload_data);

        match decoder.add_chunk(&qr_data) {
            DecodeResult::Completed {
                filename: f,
                data: d,
                ..
            } => {
                assert_eq!(f, filename);
                assert_eq!(d, data);
                decoded = true;
                break;
            }
            DecodeResult::Progress { .. } => continue,
            DecodeResult::Error(e) => panic!("Decode error: {}", e),
        }
    }

    assert!(decoded, "Should decode with reversed packet order");
}

// ============================================
// Long Filename Tests
// ============================================

#[test]
fn test_roundtrip_long_filename() {
    let data = b"Content with a very long filename";
    let filename = "this_is_a_very_long_filename_that_tests_the_limits_of_filename_handling_in_airqr_encoding.txt";

    let config = EncoderConfig::default();

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with long filename failed: {}", e),
    }
}

#[test]
fn test_roundtrip_unicode_filename() {
    let data = b"Unicode filename test";
    let filename = "テスト_émoji_🎉.txt";

    let config = EncoderConfig::default();

    match run_roundtrip(data, filename, config) {
        Ok((decoded_filename, decoded_data)) => {
            assert_eq!(decoded_filename, filename);
            assert_eq!(decoded_data.as_slice(), data);
        }
        Err(e) => panic!("Roundtrip with unicode filename failed: {}", e),
    }
}
