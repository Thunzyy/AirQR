use airqr_core::api as core_api;
use gif::{Encoder as GifEncoder, Frame as GifFrame, Repeat};
use qrcodegen::{QrCode, QrCodeEcc};
use rand::Rng;
use raptorq::Encoder;
use rayon::prelude::*;
use std::io::{Cursor, Write};
use zip::{write::FileOptions, ZipWriter};

pub struct DecodeStatus {
    pub status: String,
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

pub struct EncodeProgress {
    pub phase: String,
    pub current: u32,
    pub total: u32,
    pub percent: f32,
}

pub struct EncodeResult {
    pub success: bool,
    pub gif_data: Option<Vec<u8>>,
    pub total_frames: u32,
    pub min_frames: u32,
    pub error_msg: Option<String>,
}

pub struct ChunkedEncodeResult {
    pub success: bool,
    pub zip_data: Option<Vec<u8>>,
    pub chunk_gifs: Vec<Vec<u8>>,     // Individual GIFs for preview
    pub chunk_frame_counts: Vec<u32>, // Frame count per chunk
    pub chunk_min_frames: Vec<u32>,   // Minimum frames required per chunk
    pub total_chunks: u32,
    pub total_frames: u32,
    pub min_frames: u32, // Minimum frames for successful decode
    pub error_msg: Option<String>,
}

#[flutter_rust_bridge::frb(init)]
pub fn init_app() {
    core_api::init_app();
}

pub fn reset_decoder() {
    core_api::reset_decoder();
}

pub fn process_chunk(data: Vec<u8>) -> DecodeStatus {
    let core_status = core_api::process_chunk(data);
    DecodeStatus {
        status: core_status.status,
        percent: core_status.percent,
        received_packets: core_status.received_packets,
        expected_packets: core_status.expected_packets,
        duration_ms: core_status.duration_ms,
        total_packets: core_status.total_packets,
        filename: core_status.filename,
        file_data: core_status.file_data,
        error_msg: core_status.error_msg,
        session_id: core_status.session_id,
    }
}

fn render_qr_1bit(qr: &QrCode, target_size: u32) -> (Vec<u8>, u16) {
    let size = qr.size() as u32;
    let border = 4;
    let module_count = size + border * 2;
    let scale = if target_size > 0 {
        (target_size / module_count).max(1)
    } else {
        (177 / module_count).max(1)
    };
    let img_size = module_count * scale;

    let mut buffer = vec![0u8; (img_size * img_size) as usize];

    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x as i32, y as i32) {
                let start_x = (x + border) * scale;
                let start_y = (y + border) * scale;
                for py in 0..scale {
                    let row_offset = ((start_y + py) * img_size) as usize;
                    for px in 0..scale {
                        buffer[row_offset + (start_x + px) as usize] = 1;
                    }
                }
            }
        }
    }

    (buffer, img_size as u16)
}

fn prepare_payload(filename: &str, data: &[u8], compress: bool) -> Vec<u8> {
    let filename_bytes = filename.as_bytes();
    let mut payload = Vec::with_capacity(4 + filename_bytes.len() + data.len());
    payload.extend_from_slice(&(filename_bytes.len() as u32).to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(data);

    if compress {
        use flate2::write::DeflateEncoder;
        use flate2::Compression;

        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        if encoder.write_all(&payload).is_ok() {
            if let Ok(deflated) = encoder.finish() {
                let mut encoded = Vec::with_capacity(1 + deflated.len());
                encoded.push(2u8);
                encoded.extend_from_slice(&deflated);
                return encoded;
            }
        }
    }

    let mut encoded = Vec::with_capacity(1 + payload.len());
    encoded.push(0u8);
    encoded.extend_from_slice(&payload);
    encoded
}

pub fn encode_to_gif(
    filename: String,
    data: Vec<u8>,
    fps: u32,
    ecc_level: String,
    packet_size: u16,
    raptorq_overhead: f32,
    compress: bool,
) -> EncodeResult {
    let ecc = match ecc_level.to_uppercase().as_str() {
        "LOW" => QrCodeEcc::Low,
        "MEDIUM" => QrCodeEcc::Medium,
        "QUARTILE" => QrCodeEcc::Quartile,
        "HIGH" => QrCodeEcc::High,
        _ => QrCodeEcc::Medium,
    };

    let frame_delay_ms = if fps > 0 { 1000 / fps } else { 100 };
    let target_size: u32 = 177;

    // Payload contract shared with streaming chunks: mode 0 for plain bytes,
    // mode 2 for raw Deflate, followed by filename metadata and file data.
    let compressed = prepare_payload(&filename, &data, compress);

    // RaptorQ encoding - EXACTLY like wasm.rs
    let raptorq_encoder = Encoder::with_defaults(&compressed, packet_size);
    // with_defaults aligns the requested maximum down. Advertise and count
    // the actual symbol size, not the UI maximum (1500 becomes 1496).
    let packet_size = raptorq_encoder.get_config().symbol_size();
    let packets_to_generate =
        (compressed.len() as f64 / packet_size as f64 * raptorq_overhead as f64).ceil() as u32;
    let packets_to_generate = packets_to_generate.max(10);

    let mut packets = raptorq_encoder.get_encoded_packets(packets_to_generate);
    // CRITICAL: Truncate to requested amount (RaptorQ can return more!)
    packets.truncate(packets_to_generate as usize);

    let total_frames = packets.len() as u32;
    let min_frames = (compressed.len() as f64 / packet_size as f64).ceil() as u32;
    let total_size = compressed.len() as u32;

    // PARALLEL QR rendering using rayon
    let indexed_frames: Vec<(Vec<u8>, u16)> = packets
        .par_iter()
        .map(|packet| {
            let payload_data = packet.data();

            let mut qr_data = Vec::with_capacity(10 + payload_data.len());
            qr_data.extend_from_slice(&total_size.to_be_bytes());
            qr_data.extend_from_slice(&packet_size.to_be_bytes());
            qr_data.extend_from_slice(&packet.payload_id().serialize());
            qr_data.extend_from_slice(payload_data);

            let qr = QrCode::encode_binary(&qr_data, ecc).expect("QR encode failed");
            render_qr_1bit(&qr, target_size)
        })
        .collect();

    // Get GIF dimensions from first frame
    let gif_size = indexed_frames.first().map(|(_, s)| *s).unwrap_or(177);

    // Sequential GIF encoding (gif crate requires sequential writes)
    let mut gif_out = Vec::new();
    {
        let color_map = &[0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00]; // White, Black

        let mut encoder = match GifEncoder::new(&mut gif_out, gif_size, gif_size, color_map) {
            Ok(e) => e,
            Err(e) => {
                return EncodeResult {
                    success: false,
                    gif_data: None,
                    total_frames: 0,
                    min_frames: 0,
                    error_msg: Some(format!("GIF encoder error: {}", e)),
                }
            }
        };

        let _ = encoder.set_repeat(Repeat::Infinite);

        for (buffer, size) in indexed_frames {
            let mut frame = GifFrame::from_indexed_pixels(size, size, buffer, None);
            frame.delay = (frame_delay_ms / 10) as u16;
            let _ = encoder.write_frame(&frame);
        }
    }

    EncodeResult {
        success: true,
        gif_data: Some(gif_out),
        total_frames,
        min_frames,
        error_msg: None,
    }
}

#[derive(Clone, Copy)]
struct StreamingPacketHeader {
    session_id: u32,
    chunk_id: u32,
    total_chunks: u32,
    chunk_offset: u64,
    total_size: u32,
    packet_size: u16,
    payload_id: [u8; 4],
}

// Helper to render QR for streaming mode (mode=1 header)
fn build_streaming_packet(payload_data: &[u8], header: StreamingPacketHeader) -> Vec<u8> {
    // Streaming header (31 bytes): mode + session/chunk metadata + RaptorQ symbol.
    let mode: u8 = 1;
    let mut qr_data = Vec::with_capacity(31 + payload_data.len());
    qr_data.push(mode);
    qr_data.extend_from_slice(&header.session_id.to_be_bytes());
    qr_data.extend_from_slice(&header.chunk_id.to_be_bytes());
    qr_data.extend_from_slice(&header.total_chunks.to_be_bytes());
    qr_data.extend_from_slice(&header.chunk_offset.to_be_bytes());
    qr_data.extend_from_slice(&header.total_size.to_be_bytes());
    qr_data.extend_from_slice(&header.packet_size.to_be_bytes());
    qr_data.extend_from_slice(&header.payload_id);
    qr_data.extend_from_slice(payload_data);
    qr_data
}

// Helper to render QR for streaming mode (mode=1 header)
fn render_streaming_qr(
    payload_data: &[u8],
    header: StreamingPacketHeader,
    ecc: QrCodeEcc,
    target_size: u32,
) -> Option<(Vec<u8>, u16)> {
    let qr_data = build_streaming_packet(payload_data, header);
    let qr = QrCode::encode_binary(&qr_data, ecc).ok()?;
    Some(render_qr_1bit(&qr, target_size))
}

// flutter_rust_bridge exposes this stable API directly to Dart.
#[allow(clippy::too_many_arguments)]
pub fn encode_chunked_to_zip(
    filename: String,
    data: Vec<u8>,
    chunk_size_kb: u32,
    fps: u32,
    ecc_level: String,
    packet_size: u16,
    raptorq_overhead: f32,
    compress: bool,
) -> ChunkedEncodeResult {
    let ecc = match ecc_level.to_uppercase().as_str() {
        "LOW" => QrCodeEcc::Low,
        "MEDIUM" => QrCodeEcc::Medium,
        "QUARTILE" => QrCodeEcc::Quartile,
        "HIGH" => QrCodeEcc::High,
        _ => QrCodeEcc::Medium,
    };

    let frame_delay_ms = if fps > 0 { 1000 / fps } else { 100 };
    let target_size: u32 = 177;
    let chunk_size_bytes = (chunk_size_kb as usize) * 1024;

    // Calculate number of chunks
    let total_chunks = data.len().div_ceil(chunk_size_bytes) as u32;
    let session_id: u32 = rand::thread_rng().gen();

    // Create ZIP archive in memory
    let mut zip_buffer = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(&mut zip_buffer);
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let base_name = filename.split('.').next().unwrap_or(&filename);

    let mut grand_total_frames: u32 = 0;
    let mut min_frames: u32 = 0;
    let mut chunk_gifs: Vec<Vec<u8>> = Vec::with_capacity(total_chunks as usize);
    let mut chunk_frame_counts: Vec<u32> = Vec::with_capacity(total_chunks as usize);
    let mut chunk_min_frames: Vec<u32> = Vec::with_capacity(total_chunks as usize);

    for chunk_id in 0..total_chunks {
        let chunk_offset = (chunk_id as usize) * chunk_size_bytes;
        let chunk_end = ((chunk_id as usize + 1) * chunk_size_bytes).min(data.len());
        let chunk_data = &data[chunk_offset..chunk_end];

        let compressed = prepare_payload(&filename, chunk_data, compress);
        let raptorq_encoder = Encoder::with_defaults(&compressed, packet_size);
        let packet_size = raptorq_encoder.get_config().symbol_size();
        let chunk_minimum = compressed.len().div_ceil(packet_size as usize) as u32;
        min_frames = min_frames.max(chunk_minimum);
        chunk_min_frames.push(chunk_minimum);

        // RaptorQ encoding
        let packets_to_generate =
            (compressed.len() as f64 / packet_size as f64 * raptorq_overhead as f64).ceil() as u32;
        let packets_to_generate = packets_to_generate.max(10);

        let mut packets = raptorq_encoder.get_encoded_packets(packets_to_generate);
        packets.truncate(packets_to_generate as usize);

        let total_size = compressed.len() as u32;

        // Parallel QR rendering for this chunk
        let indexed_frames: Vec<(Vec<u8>, u16)> = packets
            .par_iter()
            .map(|packet| {
                let payload_data = packet.data();
                render_streaming_qr(
                    payload_data,
                    StreamingPacketHeader {
                        session_id,
                        chunk_id,
                        total_chunks,
                        chunk_offset: chunk_offset as u64,
                        total_size,
                        packet_size,
                        payload_id: packet.payload_id().serialize(),
                    },
                    ecc,
                    target_size,
                )
                .unwrap_or_else(|| (vec![], 0))
            })
            .collect();

        grand_total_frames += indexed_frames.len() as u32;

        // Get GIF dimensions from first frame
        let gif_size = indexed_frames.first().map(|(_, s)| *s).unwrap_or(177);

        // Create GIF for this chunk
        // Store frame count for this chunk (before we consume indexed_frames)
        let chunk_frames = indexed_frames.len() as u32;
        chunk_frame_counts.push(chunk_frames);

        let mut gif_out = Vec::new();
        {
            let color_map = &[0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00];

            if let Ok(mut encoder) = GifEncoder::new(&mut gif_out, gif_size, gif_size, color_map) {
                let _ = encoder.set_repeat(Repeat::Infinite);

                for (buffer, size) in indexed_frames {
                    if size > 0 {
                        let mut frame = GifFrame::from_indexed_pixels(size, size, buffer, None);
                        frame.delay = (frame_delay_ms / 10) as u16;
                        let _ = encoder.write_frame(&frame);
                    }
                }
            }
        }

        // Store GIF for preview
        chunk_gifs.push(gif_out.clone());

        // Add GIF to ZIP
        let gif_name = format!("{}_chunk_{}.gif", base_name, chunk_id + 1);
        if zip.start_file(&gif_name, options).is_ok() {
            let _ = zip.write_all(&gif_out);
        }
    }

    // Finish ZIP and get the buffer back
    if let Err(e) = zip.finish() {
        return ChunkedEncodeResult {
            success: false,
            zip_data: None,
            chunk_gifs: vec![],
            chunk_frame_counts: vec![],
            chunk_min_frames: vec![],
            total_chunks: 0,
            total_frames: 0,
            min_frames: 0,
            error_msg: Some(format!("ZIP finalize error: {}", e)),
        };
    }
    drop(zip); // Explicitly drop to release the borrow

    ChunkedEncodeResult {
        success: true,
        zip_data: Some(zip_buffer.into_inner()),
        chunk_gifs,
        chunk_frame_counts,
        chunk_min_frames,
        total_chunks,
        total_frames: grand_total_frames,
        min_frames,
        error_msg: None,
    }
}

pub struct GifDecodeResult {
    pub success: bool,
    pub filename: Option<String>,
    pub file_data: Option<Vec<u8>>,
    pub frames_processed: u32,
    pub qr_detected: u32,
    pub error_msg: Option<String>,
}

pub fn decode_gif_file(gif_data: Vec<u8>) -> GifDecodeResult {
    use image::codecs::gif::GifDecoder as ImageGifDecoder;
    use image::AnimationDecoder;
    use rxing::{BarcodeFormat, DecodeHintType, DecodeHintValue, DecodingHintDictionary};

    // Reset decoder first
    core_api::reset_decoder();

    // Use image crate's GifDecoder with AnimationDecoder for proper frame compositing
    let decoder = match ImageGifDecoder::new(Cursor::new(&gif_data)) {
        Ok(d) => d,
        Err(e) => {
            return GifDecodeResult {
                success: false,
                filename: None,
                file_data: None,
                frames_processed: 0,
                qr_detected: 0,
                error_msg: Some(format!("GIF decode error: {}", e)),
            };
        }
    };

    // Collect all frames with proper compositing
    let frames = match decoder.into_frames().collect_frames() {
        Ok(f) => f,
        Err(e) => {
            return GifDecodeResult {
                success: false,
                filename: None,
                file_data: None,
                frames_processed: 0,
                qr_detected: 0,
                error_msg: Some(format!("Frame extract error: {}", e)),
            };
        }
    };

    let total_frames = frames.len();
    let mut frames_processed = 0u32;
    let mut qr_detected = 0u32;
    let mut first_frame_dims = String::new();
    let mut decode_errors = 0u32;

    // Setup hints for rxing QR detection
    let mut hints: DecodingHintDictionary = std::collections::HashMap::new();
    hints.insert(DecodeHintType::TRY_HARDER, DecodeHintValue::TryHarder(true));
    hints.insert(
        DecodeHintType::POSSIBLE_FORMATS,
        DecodeHintValue::PossibleFormats(std::collections::HashSet::from([BarcodeFormat::QR_CODE])),
    );

    for frame in frames {
        frames_processed += 1;

        // Get the properly composited RGBA buffer
        let rgba_img = frame.into_buffer();
        let (width, height) = rgba_img.dimensions();

        if frames_processed == 1 {
            first_frame_dims = format!("{}x{}", width, height);
        }

        // Convert to Luma for rxing
        let gray_img = image::imageops::grayscale(&rgba_img);

        // Decode using rxing
        let detect_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            rxing::helpers::detect_in_luma_with_hints(
                gray_img.as_raw().clone(),
                width,
                height,
                None,
                &mut hints.clone(),
            )
        }));

        match detect_result {
            Ok(Ok(result)) => {
                qr_detected += 1;
                // Use raw bytes to preserve binary data (getText corrupts non-ASCII)
                let binary_data = result.getRawBytes().to_vec();

                // Process through decoder
                let status = core_api::process_chunk(binary_data);
                if status.status == "Completed" {
                    return GifDecodeResult {
                        success: true,
                        filename: status.filename,
                        file_data: status.file_data,
                        frames_processed,
                        qr_detected,
                        error_msg: None,
                    };
                }
            }
            Ok(Err(_)) => {
                decode_errors += 1;
            }
            Err(_) => {
                decode_errors += 1;
            }
        }
    }

    // Return detailed debug info in error message
    GifDecodeResult {
        success: false,
        filename: None,
        file_data: None,
        frames_processed,
        qr_detected,
        error_msg: Some(format!(
            "Incomplete: {} frames (first: {}), {} QR, {} errors, data={} bytes",
            total_frames,
            first_frame_dims,
            qr_detected,
            decode_errors,
            gif_data.len()
        )),
    }
}

pub fn decode_zip_file(zip_data: Vec<u8>) -> GifDecodeResult {
    use zip::ZipArchive;

    // Reset decoder first
    core_api::reset_decoder();

    let cursor = Cursor::new(zip_data);
    let mut archive = match ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(e) => {
            return GifDecodeResult {
                success: false,
                filename: None,
                file_data: None,
                frames_processed: 0,
                qr_detected: 0,
                error_msg: Some(format!("Failed to open ZIP: {}", e)),
            };
        }
    };

    // Collect GIF files and sort by name
    let mut gif_names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            archive.by_index(i).ok().and_then(|f| {
                let name = f.name().to_string();
                if name.to_lowercase().ends_with(".gif") {
                    Some(name)
                } else {
                    None
                }
            })
        })
        .collect();
    gif_names.sort();

    let mut total_frames = 0u32;
    let mut total_qr = 0u32;

    for gif_name in gif_names {
        let gif_data: Vec<u8> = {
            let mut file = match archive.by_name(&gif_name) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let mut buf = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut buf).ok();
            buf
        };

        // Don't reset decoder between chunks - they form one stream
        let result = decode_gif_internal(&gif_data, false);
        total_frames += result.frames_processed;
        total_qr += result.qr_detected;

        if result.success {
            return GifDecodeResult {
                success: true,
                filename: result.filename,
                file_data: result.file_data,
                frames_processed: total_frames,
                qr_detected: total_qr,
                error_msg: None,
            };
        }
    }

    GifDecodeResult {
        success: false,
        filename: None,
        file_data: None,
        frames_processed: total_frames,
        qr_detected: total_qr,
        error_msg: Some("Incomplete: not all chunks decoded".to_string()),
    }
}

fn decode_gif_internal(gif_data: &[u8], reset: bool) -> GifDecodeResult {
    use image::codecs::gif::GifDecoder as ImageGifDecoder;
    use image::AnimationDecoder;
    use rxing::{BarcodeFormat, DecodeHintType, DecodeHintValue, DecodingHintDictionary};

    if reset {
        core_api::reset_decoder();
    }

    // Use image crate's GifDecoder with AnimationDecoder for proper frame compositing
    let decoder = match ImageGifDecoder::new(Cursor::new(gif_data)) {
        Ok(d) => d,
        Err(e) => {
            return GifDecodeResult {
                success: false,
                filename: None,
                file_data: None,
                frames_processed: 0,
                qr_detected: 0,
                error_msg: Some(format!("Failed to decode GIF: {}", e)),
            };
        }
    };

    let frames = match decoder.into_frames().collect_frames() {
        Ok(f) => f,
        Err(e) => {
            return GifDecodeResult {
                success: false,
                filename: None,
                file_data: None,
                frames_processed: 0,
                qr_detected: 0,
                error_msg: Some(format!("Failed to extract frames: {}", e)),
            };
        }
    };

    let mut frames_processed = 0u32;
    let mut qr_detected = 0u32;

    // Setup hints for rxing QR detection
    let mut hints: DecodingHintDictionary = std::collections::HashMap::new();
    hints.insert(DecodeHintType::TRY_HARDER, DecodeHintValue::TryHarder(true));
    hints.insert(
        DecodeHintType::POSSIBLE_FORMATS,
        DecodeHintValue::PossibleFormats(std::collections::HashSet::from([BarcodeFormat::QR_CODE])),
    );

    for frame in frames {
        frames_processed += 1;

        let rgba_img = frame.into_buffer();
        let (width, height) = rgba_img.dimensions();
        let gray_img = image::imageops::grayscale(&rgba_img);

        // Decode using rxing
        let detect_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            rxing::helpers::detect_in_luma_with_hints(
                gray_img.as_raw().clone(),
                width,
                height,
                None,
                &mut hints.clone(),
            )
        }));

        if let Ok(Ok(result)) = detect_result {
            qr_detected += 1;
            // Use raw bytes to preserve binary data
            let binary_data = result.getRawBytes().to_vec();

            let status = core_api::process_chunk(binary_data);
            if status.status == "Completed" {
                return GifDecodeResult {
                    success: true,
                    filename: status.filename,
                    file_data: status.file_data,
                    frames_processed,
                    qr_detected,
                    error_msg: None,
                };
            }
        }
    }

    GifDecodeResult {
        success: false,
        filename: None,
        file_data: None,
        frames_processed,
        qr_detected,
        error_msg: Some("Incomplete".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_streaming_packet, decode_gif_file, decode_zip_file, encode_chunked_to_zip,
        encode_to_gif, prepare_payload, StreamingPacketHeader,
    };
    use airqr_core::streaming::{StreamDecodeResult, StreamingDecoder};
    use flate2::read::DeflateDecoder;
    use raptorq::Encoder;
    use std::io::Read;

    // The FFI API deliberately exposes one global scanner/decoder session.
    static DECODE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn raw_payload(filename: &str, data: &[u8]) -> Vec<u8> {
        let mut payload = Vec::with_capacity(4 + filename.len() + data.len());
        payload.extend_from_slice(&(filename.len() as u32).to_be_bytes());
        payload.extend_from_slice(filename.as_bytes());
        payload.extend_from_slice(data);
        payload
    }

    fn assert_streaming_roundtrip(compress: bool) {
        let filename = "chunked-roundtrip.bin";
        let chunks = [vec![b'A'; 2048], vec![b'B'; 1536]];
        let packet_size = 256u16;
        let session_id = 0x1234_5678;
        let mut decoder = StreamingDecoder::new();
        let mut first_chunk_metadata = None;
        let mut completed = None;

        for (chunk_id, chunk) in chunks.iter().enumerate() {
            let encoded_payload = prepare_payload(filename, chunk, compress);
            let total_size = encoded_payload.len() as u32;
            let encoder = Encoder::with_defaults(&encoded_payload, packet_size);
            let source_packets = encoded_payload.len().div_ceil(packet_size as usize) as u32;

            for packet in encoder.get_encoded_packets(source_packets.max(10)) {
                let packet_data = build_streaming_packet(
                    packet.data(),
                    StreamingPacketHeader {
                        session_id,
                        chunk_id: chunk_id as u32,
                        total_chunks: chunks.len() as u32,
                        chunk_offset: chunks[..chunk_id].iter().map(Vec::len).sum::<usize>() as u64,
                        total_size,
                        packet_size,
                        payload_id: packet.payload_id().serialize(),
                    },
                );

                match decoder.add_packet(&packet_data) {
                    StreamDecodeResult::ChunkCompleted {
                        chunk_id,
                        total_chunks,
                        chunk_data,
                        filename,
                        ..
                    } => {
                        first_chunk_metadata = Some((chunk_id, total_chunks, chunk_data, filename));
                    }
                    StreamDecodeResult::AllCompleted { filename, data, .. } => {
                        completed = Some((filename, data));
                    }
                    StreamDecodeResult::Error(error) => panic!("decode error: {error}"),
                    StreamDecodeResult::Progress { .. } => {}
                }
            }
        }

        let (chunk_id, total_chunks, chunk_data, decoded_filename) =
            first_chunk_metadata.expect("first chunk should complete before the stream");
        assert_eq!(chunk_id, 0);
        assert_eq!(total_chunks, 2);
        assert_eq!(chunk_data, chunks[0]);
        assert_eq!(decoded_filename.as_deref(), Some(filename));

        let (decoded_filename, decoded_data) = completed.expect("stream should complete");
        assert_eq!(decoded_filename, filename);
        assert_eq!(
            decoded_data,
            [chunks[0].as_slice(), chunks[1].as_slice()].concat()
        );
    }

    #[test]
    fn chunk_payload_uses_normal_gif_compression_contract() {
        let filename = "compressible.bin";
        let data = vec![b'A'; 4096];
        let expected = raw_payload(filename, &data);

        let plain = prepare_payload(filename, &data, false);
        assert_eq!(plain[0], 0, "plain payload must use mode 0");
        assert_eq!(&plain[1..], expected.as_slice());

        let compressed = prepare_payload(filename, &data, true);
        assert_eq!(
            compressed[0], 2,
            "compressed payload must use deflate mode 2"
        );
        assert_ne!(&compressed[1..], expected.as_slice());
        let mut inflated = Vec::new();
        DeflateDecoder::new(&compressed[1..])
            .read_to_end(&mut inflated)
            .expect("deflate payload should inflate");
        assert_eq!(inflated, expected);
    }

    #[test]
    fn chunk_stream_roundtrips_plain_and_deflate_with_metadata() {
        assert_streaming_roundtrip(false);
        assert_streaming_roundtrip(true);
    }

    #[test]
    fn chunked_encode_reports_consistent_chunk_metadata_in_both_modes() {
        let mut minimum_frames = Vec::new();
        for compress in [false, true] {
            let result = encode_chunked_to_zip(
                "metadata.bin".to_string(),
                vec![b'Z'; 2048],
                1,
                10,
                "LOW".to_string(),
                500,
                1.3,
                compress,
            );

            assert!(result.success, "encode failed: {:?}", result.error_msg);
            assert_eq!(result.total_chunks, 2);
            assert_eq!(result.chunk_gifs.len(), 2);
            assert_eq!(result.chunk_frame_counts.len(), 2);
            assert_eq!(
                result.chunk_frame_counts.iter().sum::<u32>(),
                result.total_frames
            );
            assert!(result.chunk_frame_counts.iter().all(|count| *count > 0));
            assert!(result.min_frames > 0);
            minimum_frames.push(result.min_frames);
        }
        assert!(
            minimum_frames[1] < minimum_frames[0],
            "deflate should lower the decode threshold for compressible chunks"
        );
    }

    #[test]
    fn gif_and_zip_roundtrip_unaligned_packet_sizes() {
        let _guard = DECODE_TEST_LOCK.lock().unwrap();
        let data: Vec<u8> = (0..8192).map(|n| (n % 251) as u8).collect();
        for size in [100u16, 250, 500, 1500] {
            for compress in [false, true] {
                let encoded = encode_to_gif(
                    "bytes.bin".into(),
                    data.clone(),
                    10,
                    "LOW".into(),
                    size,
                    1.3,
                    compress,
                );
                assert!(encoded.success, "{:?}", encoded.error_msg);
                let result = decode_gif_file(encoded.gif_data.unwrap());
                assert!(
                    result.success,
                    "GIF size={size} compress={compress}: {:?}",
                    result.error_msg
                );
                assert_eq!(result.filename.as_deref(), Some("bytes.bin"));
                assert_eq!(result.file_data.unwrap(), data);
                let encoded = encode_chunked_to_zip(
                    "bytes.bin".into(),
                    data.clone(),
                    4,
                    10,
                    "LOW".into(),
                    size,
                    1.3,
                    compress,
                );
                assert!(encoded.success, "{:?}", encoded.error_msg);
                let result = decode_zip_file(encoded.zip_data.unwrap());
                assert!(
                    result.success,
                    "ZIP size={size} compress={compress}: {:?}",
                    result.error_msg
                );
                assert_eq!(result.filename.as_deref(), Some("bytes.bin"));
                assert_eq!(result.file_data.unwrap(), data);
            }
        }
    }

    #[test]
    fn decode_gif_file_default_settings_roundtrip() {
        let _guard = DECODE_TEST_LOCK.lock().unwrap();
        let data: Vec<u8> = (0..40_000u32)
            .flat_map(|n| format!("{n},row-{n},{}\n", n.wrapping_mul(7919)).into_bytes())
            .collect();
        let encoded = encode_to_gif(
            "csv.csv".into(),
            data.clone(),
            10,
            "LOW".into(),
            1500,
            1.3,
            true,
        );
        assert!(encoded.success, "{:?}", encoded.error_msg);
        let decoded = decode_gif_file(encoded.gif_data.unwrap());
        assert!(decoded.success, "{:?}", decoded.error_msg);
        assert_eq!(decoded.filename.as_deref(), Some("csv.csv"));
        assert_eq!(decoded.file_data.unwrap(), data);
    }

    #[test]
    fn decode_gif_file_roundtrip() {
        let _guard = DECODE_TEST_LOCK.lock().unwrap();
        let filename = "roundtrip.bin".to_string();
        let data: Vec<u8> = (0u8..=255u8).collect();

        let encoded = encode_to_gif(
            filename.clone(),
            data.clone(),
            10,
            "MEDIUM".to_string(),
            200,
            1.5,
            false,
        );

        assert!(encoded.success, "encode failed: {:?}", encoded.error_msg);
        let gif = encoded.gif_data.expect("missing gif_data");

        let decoded = decode_gif_file(gif);
        assert!(decoded.success, "decode failed: {:?}", decoded.error_msg);
        assert_eq!(decoded.filename.as_deref(), Some(filename.as_str()));
        assert_eq!(decoded.file_data.expect("missing file_data"), data);
    }
}
