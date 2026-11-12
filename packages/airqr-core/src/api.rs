use crate::streaming::{StreamDecodeResult, StreamingDecoder};
use crate::AirqrDecoder;
use crate::DecodeResult;
use lazy_static::lazy_static;
use std::sync::Mutex;

pub enum DecoderState {
    Legacy(AirqrDecoder),
    Streaming(StreamingDecoder),
    None,
}

lazy_static! {
    static ref DECODER_STATE: Mutex<DecoderState> = Mutex::new(DecoderState::None);
}

pub fn init_app() {
    crate::init_logger(); // Initialize logger
    flutter_rust_bridge::setup_default_user_utils();
}

pub fn reset_decoder() {
    let mut state = DECODER_STATE.lock().unwrap_or_else(|e| e.into_inner());
    *state = DecoderState::None;
}

pub fn decode_chunk(data: Vec<u8>) -> String {
    // Deprecated string-only API, mapped to struct API for convenience
    let status = process_chunk(data);
    match status.status.as_str() {
        "Progress" => format!(
            "Progress:{:.1}% ({}/{})",
            status.percent, status.received_packets, status.expected_packets
        ),
        "Completed" => format!(
            "Completed:{} bytes",
            status.file_data.map(|d| d.len()).unwrap_or(0)
        ),
        "Error" => format!("Error:{}", status.error_msg.unwrap_or_default()),
        _ => "Error:Unknown status".to_string(),
    }
}

pub struct DecodeStatus {
    pub status: String, // "Progress", "Completed", "Error"
    pub percent: f32,
    pub received_packets: u32,
    pub expected_packets: u32,
    pub duration_ms: u64,
    pub total_packets: u32,
    pub filename: Option<String>,
    pub file_data: Option<Vec<u8>>,
    pub error_msg: Option<String>,
    pub session_id: Option<u32>, // Session ID from QR packet (for cross-device sync)
}

pub fn process_chunk(data: Vec<u8>) -> DecodeStatus {
    #[cfg(target_os = "android")]
    {
        if data.len() > 0 {
            log::info!(
                "RustCore: processing chunk. Len: {}, Header Byte: {}",
                data.len(),
                data[0]
            );
        } else {
            log::info!("RustCore: processing empty chunk");
        }
    }

    let mut state = DECODER_STATE.lock().unwrap_or_else(|e| e.into_inner());

    // Auto-detect mode if None
    if let DecoderState::None = *state {
        // Simple heuristic: If data[0] == 1, assume Streaming (unless >16MB legacy file, which is rare/unsupported on this transport usually)
        if !data.is_empty() && (data[0] == 1 || data[0] == 2) {
            #[cfg(target_os = "android")]
            log::info!("RustCore: Detecting STREAMING mode (byte 0 is {})", data[0]);
            *state = DecoderState::Streaming(StreamingDecoder::new());
        } else {
            #[cfg(target_os = "android")]
            log::info!(
                "RustCore: Detecting LEGACY mode (byte 0 is {})",
                if data.is_empty() { 0 } else { data[0] }
            );
            *state = DecoderState::Legacy(AirqrDecoder::new());
        }
    }

    match *state {
        DecoderState::Legacy(ref mut decoder) => {
            match decoder.add_chunk(&data) {
                DecodeResult::Progress {
                    percent,
                    received,
                    expected,
                } => DecodeStatus {
                    status: "Progress".to_string(),
                    percent,
                    received_packets: received,
                    expected_packets: expected,
                    duration_ms: 0,
                    total_packets: 0,
                    filename: None,
                    file_data: None,
                    error_msg: None,
                    session_id: None, // Legacy mode doesn't have session_id
                },
                DecodeResult::Completed {
                    filename,
                    data,
                    duration,
                    total_packets,
                } => DecodeStatus {
                    status: "Completed".to_string(),
                    percent: 100.0,
                    received_packets: 0,
                    expected_packets: 0,
                    duration_ms: duration.as_millis() as u64,
                    total_packets,
                    filename: Some(filename),
                    file_data: Some(data),
                    error_msg: None,
                    session_id: None, // Legacy mode doesn't have session_id
                },
                DecodeResult::Error(e) => DecodeStatus {
                    status: "Error".to_string(),
                    percent: 0.0,
                    received_packets: 0,
                    expected_packets: 0,
                    duration_ms: 0,
                    total_packets: 0,
                    filename: None,
                    file_data: None,
                    error_msg: Some(e),
                    session_id: None,
                },
            }
        }
        DecoderState::Streaming(ref mut decoder) => {
            match decoder.add_packet(&data) {
                StreamDecodeResult::Progress {
                    chunk_percent: _,
                    overall_percent,
                    packets_received_chunk: _,
                    packets_expected_chunk,
                    packets_total_chunk,
                    packets_received_total,
                    total_chunks,
                    filename,
                    session_id,
                    ..
                } => {
                    // Estimate total expected packets based on chunks
                    // Each chunk is roughly same size, so packets_expected_chunk * total_chunks
                    let estimated_total = if total_chunks > 0 {
                        packets_expected_chunk * total_chunks
                    } else {
                        packets_expected_chunk * 5 // Fallback estimate
                    };
                    let exact_total = if total_chunks == 1 {
                        packets_total_chunk.unwrap_or(estimated_total)
                    } else {
                        estimated_total
                    };

                    DecodeStatus {
                        status: "Progress".to_string(),
                        percent: overall_percent,
                        received_packets: packets_received_total,
                        expected_packets: estimated_total,
                        duration_ms: 0,
                        total_packets: exact_total,
                        filename,
                        file_data: None,
                        error_msg: None,
                        session_id: Some(session_id),
                    }
                }
                StreamDecodeResult::ChunkCompleted {
                    overall_percent,
                    packets_received_total,
                    filename,
                    total_chunks,
                    chunks_completed,
                    session_id,
                    ..
                } => {
                    // Estimate based on completed chunks
                    let estimated_total = if chunks_completed > 0 {
                        (packets_received_total as f32
                            / (chunks_completed as f32 / total_chunks as f32))
                            as u32
                    } else {
                        packets_received_total * total_chunks // Rough fallback
                    };

                    DecodeStatus {
                        // CRITICAL: ChunkCompleted is reported as PROGRESS to the app
                        status: "Progress".to_string(),
                        percent: overall_percent,
                        received_packets: packets_received_total,
                        expected_packets: estimated_total,
                        duration_ms: 0,
                        total_packets: estimated_total,
                        filename,
                        file_data: None,
                        error_msg: None,
                        session_id: Some(session_id),
                    }
                }
                StreamDecodeResult::AllCompleted {
                    filename,
                    data,
                    duration,
                    total_packets,
                    session_id,
                    ..
                } => DecodeStatus {
                    status: "Completed".to_string(),
                    percent: 100.0,
                    received_packets: total_packets, // Set received matches total
                    expected_packets: total_packets,
                    duration_ms: duration.as_millis() as u64,
                    total_packets,
                    filename: Some(filename),
                    file_data: Some(data),
                    error_msg: None,
                    session_id: Some(session_id),
                },
                StreamDecodeResult::Error(e) => DecodeStatus {
                    status: "Error".to_string(),
                    percent: 0.0,
                    received_packets: 0,
                    expected_packets: 0,
                    duration_ms: 0,
                    total_packets: 0,
                    filename: None,
                    file_data: None,
                    error_msg: Some(e),
                    session_id: None,
                },
            }
        }
        DecoderState::None => unreachable!(),
    }
}
