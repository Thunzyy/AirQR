use crate::{
    streaming::{StreamDecodeResult, StreamingConfig, StreamingDecoder},
    AirqrDecoder, DecodeResult, EncoderConfig,
};
use gif::{Encoder as GifEncoder, Frame as GifFrame, Repeat};
use qrcodegen::{QrCode, QrCodeEcc};
use raptorq::Encoder;
use std::sync::{Mutex, MutexGuard};
use wasm_bindgen::prelude::*;

const MAX_WASM_INPUT_SIZE: usize = 100 * 1024 * 1024; // 100 MB

#[cfg(feature = "wasm-threads")]
pub use wasm_bindgen_rayon::init_thread_pool;

#[derive(Debug, thiserror::Error)]
enum WasmEncodeError {
    #[error("Input too large: {actual} bytes exceeds maximum of {maximum} bytes")]
    InputTooLarge { actual: usize, maximum: usize },
    #[error("Chunk ID {chunk_id} out of range for full file mode (file length: {file_len} bytes)")]
    ChunkIdOutOfRangeFullFileMode { chunk_id: u32, file_len: usize },
    #[error("GIF encoder error: {message}")]
    GifEncoder { message: String },
    #[error("Set repeat error: {message}")]
    GifRepeat { message: String },
    #[error("QR encode error: {message}")]
    QrEncode { message: String },
    #[error("Failed to encode QR packet {packet_index}: {message}")]
    QrEncodePacket {
        packet_index: usize,
        message: String,
    },
    #[error("Write frame error: {message}")]
    WriteFrame { message: String },
    #[error("Image size too large: {width}x{height}")]
    ImageSizeTooLarge { width: u32, height: u32 },
}

fn validate_wasm_input_size(len: usize) -> Result<(), WasmEncodeError> {
    if len > MAX_WASM_INPUT_SIZE {
        return Err(WasmEncodeError::InputTooLarge {
            actual: len,
            maximum: MAX_WASM_INPUT_SIZE,
        });
    }
    Ok(())
}

fn encode_error_to_js_value(error: WasmEncodeError) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn select_streaming_chunk(
    file_data: &[u8],
    chunk_id: u32,
    chunk_size_bytes: usize,
) -> Result<&[u8], WasmEncodeError> {
    let chunk_offset = chunk_id as usize * chunk_size_bytes;

    if file_data.len() > chunk_size_bytes {
        if chunk_offset >= file_data.len() {
            return Err(WasmEncodeError::ChunkIdOutOfRangeFullFileMode {
                chunk_id,
                file_len: file_data.len(),
            });
        }
        let chunk_end = (chunk_offset + chunk_size_bytes).min(file_data.len());
        Ok(&file_data[chunk_offset..chunk_end])
    } else {
        Ok(file_data)
    }
}

fn encode_aux_qr_buffer(
    qr_data: Vec<u8>,
    ecc: QrCodeEcc,
    target_size: u32,
    scale: u32,
    packet_index: Option<usize>,
) -> Result<Vec<u8>, WasmEncodeError> {
    let qr = QrCode::encode_binary(&qr_data, ecc).map_err(|e| match packet_index {
        Some(index) => WasmEncodeError::QrEncodePacket {
            packet_index: index,
            message: format!("{:?}", e),
        },
        None => WasmEncodeError::QrEncode {
            message: format!("{:?}", e),
        },
    })?;

    let (buffer, _width, _height) = render_qr_1bit(&qr, target_size, scale)?;
    Ok(buffer)
}

fn measure_aux_qr_buffer(
    qr_data: Vec<u8>,
    ecc: QrCodeEcc,
    target_size: u32,
    scale: u32,
    packet_index: Option<usize>,
) -> Result<u32, WasmEncodeError> {
    let qr = QrCode::encode_binary(&qr_data, ecc).map_err(|e| match packet_index {
        Some(index) => WasmEncodeError::QrEncodePacket {
            packet_index: index,
            message: format!("{:?}", e),
        },
        None => WasmEncodeError::QrEncode {
            message: format!("{:?}", e),
        },
    })?;

    measure_qr_1bit_len(&qr, target_size, scale)
}

fn parse_qr_ecc_level(ecc_level: &str) -> QrCodeEcc {
    match ecc_level.to_uppercase().as_str() {
        "LOW" => QrCodeEcc::Low,
        "MEDIUM" => QrCodeEcc::Medium,
        "QUARTILE" => QrCodeEcc::Quartile,
        "HIGH" => QrCodeEcc::High,
        _ => QrCodeEcc::Medium,
    }
}

fn build_normal_qr_data(packet_data: &[u8], total_size: u32, packet_id: &[u8]) -> Vec<u8> {
    let actual_packet_size = packet_data.len() as u16;
    let mut qr_data = Vec::with_capacity(10 + packet_data.len());
    qr_data.extend_from_slice(&total_size.to_be_bytes());
    qr_data.extend_from_slice(&actual_packet_size.to_be_bytes());
    qr_data.extend_from_slice(packet_id);
    qr_data.extend_from_slice(packet_data);
    qr_data
}

struct StreamingQrPacketHeader<'a> {
    packet_data: &'a [u8],
    packet_id: &'a [u8],
    session_id: u32,
    chunk_id: u32,
    total_chunks: u32,
    chunk_offset: u64,
    total_size: u32,
    exact_chunk_packets: u32,
}

fn build_streaming_qr_data(header: StreamingQrPacketHeader<'_>) -> Vec<u8> {
    let mode = 2u8;
    let actual_packet_size = header.packet_data.len() as u16;

    let mut qr_data = Vec::with_capacity(35 + header.packet_data.len());
    qr_data.push(mode);
    qr_data.extend_from_slice(&header.session_id.to_be_bytes());
    qr_data.extend_from_slice(&header.chunk_id.to_be_bytes());
    qr_data.extend_from_slice(&header.total_chunks.to_be_bytes());
    qr_data.extend_from_slice(&header.chunk_offset.to_be_bytes());
    qr_data.extend_from_slice(&header.total_size.to_be_bytes());
    qr_data.extend_from_slice(&actual_packet_size.to_be_bytes());
    qr_data.extend_from_slice(&header.exact_chunk_packets.to_be_bytes());
    qr_data.extend_from_slice(header.packet_id);
    qr_data.extend_from_slice(header.packet_data);
    qr_data
}

// Generate RaptorQ packets from raw pre-compressed data (for JS-side compression like zstd)
#[wasm_bindgen]
pub fn generate_raptorq_packets_raw(
    raw_data: Vec<u8>,
    packet_size: u16,
    raptorq_overhead: f32,
) -> Result<js_sys::Array, JsValue> {
    // raw_data should already be: [compression_flag][filename_len][filename][data]
    // We just pass it directly to RaptorQ

    let raptorq_encoder = Encoder::with_defaults(&raw_data, packet_size);
    let packet_size = raptorq_encoder.get_config().symbol_size();
    let packets_to_generate =
        (raw_data.len() as f64 / packet_size as f64 * raptorq_overhead as f64).ceil() as u32;
    let packets_to_generate = packets_to_generate.max(10);

    let mut packets = raptorq_encoder.get_encoded_packets(packets_to_generate);
    packets.truncate(packets_to_generate as usize);

    let js_array = js_sys::Array::new();
    let total_size = raw_data.len() as u32;

    for packet in packets.iter() {
        let obj = js_sys::Object::new();
        let data_array = js_sys::Uint8Array::from(packet.data());
        js_sys::Reflect::set(&obj, &"data".into(), &data_array)?;
        let id_array = js_sys::Uint8Array::from(&packet.payload_id().serialize()[..]);
        js_sys::Reflect::set(&obj, &"packetId".into(), &id_array)?;
        js_array.push(&obj);
    }

    let metadata = js_sys::Object::new();
    js_sys::Reflect::set(&metadata, &"totalSize".into(), &total_size.into())?;
    js_sys::Reflect::set(&metadata, &"packetSize".into(), &packet_size.into())?;
    js_sys::Reflect::set(
        &metadata,
        &"totalPackets".into(),
        &(packets.len() as u32).into(),
    )?;

    let result = js_sys::Array::new();
    result.push(&metadata);
    result.push(&js_array);

    Ok(result)
}

#[wasm_bindgen]
pub fn generate_raptorq_packets_raw_packed(
    raw_data: Vec<u8>,
    packet_size: u16,
    raptorq_overhead: f32,
) -> Result<js_sys::Array, JsValue> {
    let raptorq_encoder = Encoder::with_defaults(&raw_data, packet_size);
    let packet_size = raptorq_encoder.get_config().symbol_size();
    let packets_to_generate =
        (raw_data.len() as f64 / packet_size as f64 * raptorq_overhead as f64).ceil() as u32;
    let packets_to_generate = packets_to_generate.max(10);

    let mut packets = raptorq_encoder.get_encoded_packets(packets_to_generate);
    packets.truncate(packets_to_generate as usize);

    let total_size = raw_data.len() as u32;
    let packet_count = packets.len();
    let mut packet_data = Vec::with_capacity(packet_count * packet_size as usize);
    let mut packet_offsets = Vec::with_capacity(packet_count + 1);
    let mut packet_ids = Vec::with_capacity(packet_count * 4);
    let mut packet_id_offsets = Vec::with_capacity(packet_count + 1);
    packet_offsets.push(0u32);
    packet_id_offsets.push(0u32);

    for packet in packets.iter() {
        packet_data.extend_from_slice(packet.data());
        packet_offsets.push(packet_data.len() as u32);

        let serialized_id = packet.payload_id().serialize();
        packet_ids.extend_from_slice(&serialized_id);
        packet_id_offsets.push(packet_ids.len() as u32);
    }

    let packed = js_sys::Object::new();
    js_sys::Reflect::set(
        &packed,
        &"packetData".into(),
        &js_sys::Uint8Array::from(packet_data.as_slice()),
    )?;
    js_sys::Reflect::set(
        &packed,
        &"packetOffsets".into(),
        &js_sys::Uint32Array::from(packet_offsets.as_slice()),
    )?;
    js_sys::Reflect::set(
        &packed,
        &"packetIds".into(),
        &js_sys::Uint8Array::from(packet_ids.as_slice()),
    )?;
    js_sys::Reflect::set(
        &packed,
        &"packetIdOffsets".into(),
        &js_sys::Uint32Array::from(packet_id_offsets.as_slice()),
    )?;

    let metadata = js_sys::Object::new();
    js_sys::Reflect::set(&metadata, &"totalSize".into(), &total_size.into())?;
    js_sys::Reflect::set(&metadata, &"packetSize".into(), &packet_size.into())?;
    js_sys::Reflect::set(
        &metadata,
        &"totalPackets".into(),
        &(packets.len() as u32).into(),
    )?;

    let result = js_sys::Array::new();
    result.push(&metadata);
    result.push(&packed);

    Ok(result)
}

// Single packet QR encoding for parallel processing
#[wasm_bindgen]
pub fn encode_qr_packet(
    packet_data: Vec<u8>,
    total_size: u32,
    _packet_size: u16,
    packet_id: Vec<u8>,
    ecc_level: String,
    target_size: u32,
    scale: u32,
) -> Result<Vec<u8>, JsValue> {
    let ecc = parse_qr_ecc_level(&ecc_level);
    let qr_data = build_normal_qr_data(&packet_data, total_size, &packet_id);
    encode_aux_qr_buffer(qr_data, ecc, target_size, scale, None).map_err(encode_error_to_js_value)
}

#[wasm_bindgen]
pub fn measure_qr_packet_frame_size(
    packet_data: Vec<u8>,
    total_size: u32,
    _packet_size: u16,
    packet_id: Vec<u8>,
    ecc_level: String,
    target_size: u32,
    scale: u32,
) -> Result<u32, JsValue> {
    let ecc = parse_qr_ecc_level(&ecc_level);
    let qr_data = build_normal_qr_data(&packet_data, total_size, &packet_id);
    measure_aux_qr_buffer(qr_data, ecc, target_size, scale, None).map_err(encode_error_to_js_value)
}

// Single streaming packet QR encoding for parallel processing
#[wasm_bindgen]
// JavaScript worker ABI: keep positional arguments stable for existing callers.
#[allow(clippy::too_many_arguments)]
pub fn encode_streaming_qr_packet(
    packet_data: Vec<u8>,
    packet_id: Vec<u8>,
    session_id: u32,
    chunk_id: u32,
    total_chunks: u32,
    chunk_offset: f64, // JS numbers are f64
    total_size: u32,
    _packet_size: u16,
    exact_chunk_packets: u32,
    ecc_level: String,
    target_size: u32,
    scale: u32,
) -> Result<Vec<u8>, JsValue> {
    let ecc = parse_qr_ecc_level(&ecc_level);
    let chunk_offset_u64 = chunk_offset as u64;
    let qr_data = build_streaming_qr_data(StreamingQrPacketHeader {
        packet_data: &packet_data,
        packet_id: &packet_id,
        session_id,
        chunk_id,
        total_chunks,
        chunk_offset: chunk_offset_u64,
        total_size,
        exact_chunk_packets,
    });
    encode_aux_qr_buffer(qr_data, ecc, target_size, scale, None).map_err(encode_error_to_js_value)
}

#[wasm_bindgen]
// JavaScript worker ABI: mirrors `encode_streaming_qr_packet` for size prediction.
#[allow(clippy::too_many_arguments)]
pub fn measure_streaming_qr_packet_frame_size(
    packet_data: Vec<u8>,
    packet_id: Vec<u8>,
    session_id: u32,
    chunk_id: u32,
    total_chunks: u32,
    chunk_offset: f64,
    total_size: u32,
    _packet_size: u16,
    exact_chunk_packets: u32,
    ecc_level: String,
    target_size: u32,
    scale: u32,
) -> Result<u32, JsValue> {
    let ecc = parse_qr_ecc_level(&ecc_level);
    let qr_data = build_streaming_qr_data(StreamingQrPacketHeader {
        packet_data: &packet_data,
        packet_id: &packet_id,
        session_id,
        chunk_id,
        total_chunks,
        chunk_offset: chunk_offset as u64,
        total_size,
        exact_chunk_packets,
    });
    measure_aux_qr_buffer(qr_data, ecc, target_size, scale, None).map_err(encode_error_to_js_value)
}

fn calculate_qr_image_size(
    qr: &QrCode,
    target_size: u32,
    fixed_scale: u32,
) -> Result<u32, WasmEncodeError> {
    let size = qr.size() as u32;
    let border = 4;
    let module_count = size + border * 2;

    let scale = if fixed_scale > 0 {
        fixed_scale
    } else if target_size > 0 {
        (target_size / module_count).max(1)
    } else {
        (177 / module_count).max(1)
    };

    let img_size = module_count * scale;
    if img_size > 10000 {
        return Err(WasmEncodeError::ImageSizeTooLarge {
            width: img_size,
            height: img_size,
        });
    }
    Ok(img_size)
}

fn measure_qr_1bit_len(
    qr: &QrCode,
    target_size: u32,
    fixed_scale: u32,
) -> Result<u32, WasmEncodeError> {
    let img_size = calculate_qr_image_size(qr, target_size, fixed_scale)?;
    Ok(img_size * img_size)
}

fn render_qr_1bit(
    qr: &QrCode,
    target_size: u32,
    fixed_scale: u32,
) -> Result<(Vec<u8>, u16, u16), WasmEncodeError> {
    let size = qr.size() as u32;
    let border = 4;
    let img_size = calculate_qr_image_size(qr, target_size, fixed_scale)?;
    let module_count = size + border * 2;
    let scale = (img_size / module_count).max(1);

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

    Ok((buffer, img_size as u16, img_size as u16))
}

#[wasm_bindgen]
// Public WASM ABI consumed positionally by the Web encoder workers.
#[allow(clippy::too_many_arguments)]
pub fn encode_to_gif(
    filename: String,
    data: Vec<u8>,
    compression_enabled: bool,
    frame_delay_ms: u32,
    ecc_level: String,
    packet_size: u16,
    target_size: u32,
    scale: u32,
    raptorq_overhead: f32,
    callback: &js_sys::Function,
) -> Result<Vec<u8>, JsValue> {
    validate_wasm_input_size(data.len())
        .map_err(|e| JsValue::from_str(&format!("Encoding failed: {}", e)))?;

    let callback_clone = callback.clone();
    let progress_fn = move |phase: &str, current: usize, total: usize| {
        let _ = callback_clone.call3(
            &JsValue::NULL,
            &JsValue::from_str(phase),
            &JsValue::from(current as u32),
            &JsValue::from(total as u32),
        );
    };

    let result = encode_data_to_gif(
        &filename,
        &data,
        GifEncodeOptions {
            compression_enabled,
            frame_delay_ms: frame_delay_ms as u64,
            ecc_level: &ecc_level,
            packet_size,
            target_size,
            scale,
            raptorq_overhead,
        },
        progress_fn,
    )
    .map_err(|e| JsValue::from_str(&format!("Encoding failed: {}", e)))?;

    // Report completion
    let _ = callback.call3(
        &JsValue::NULL,
        &JsValue::from_str("Complete"),
        &JsValue::from(100),
        &JsValue::from(100),
    );

    Ok(result)
}

struct GifEncodeOptions<'a> {
    compression_enabled: bool,
    frame_delay_ms: u64,
    ecc_level: &'a str,
    packet_size: u16,
    target_size: u32,
    scale: u32,
    raptorq_overhead: f32,
}

fn encode_data_to_gif<F>(
    filename: &str,
    file_data: &[u8],
    options: GifEncodeOptions<'_>,
    progress_cb: F,
) -> Result<Vec<u8>, WasmEncodeError>
where
    F: Fn(&str, usize, usize),
{
    let config = EncoderConfig {
        compression_enabled: options.compression_enabled,
        frame_delay_ms: options.frame_delay_ms,
        packet_size: options.packet_size,
        raptorq_overhead: options.raptorq_overhead,
        ecc: match options.ecc_level.to_uppercase().as_str() {
            "LOW" => QrCodeEcc::Low,
            "MEDIUM" => QrCodeEcc::Medium,
            "QUARTILE" => QrCodeEcc::Quartile,
            "HIGH" => QrCodeEcc::High,
            _ => QrCodeEcc::Medium,
        },
        ..EncoderConfig::default()
    };

    let target_size = options.target_size;
    let scale = options.scale;

    #[cfg(target_arch = "wasm32")]
    {
        web_sys::console::log_1(
            &format!(
                "🦀 WASM Config: packet_size={}, raptorq_overhead={}, ecc={:?}, file_size={}",
                config.packet_size,
                config.raptorq_overhead,
                config.ecc,
                file_data.len()
            )
            .into(),
        );
    }

    progress_cb("Preparing data", 1, 3);

    // Prepare Payload WITHOUT compression flag: [NameLen(4b)][NameBytes][FileData]
    let filename_bytes = filename.as_bytes();
    let filename_len = filename_bytes.len() as u32;

    let mut payload = Vec::with_capacity(4 + filename_bytes.len() + file_data.len());
    payload.extend_from_slice(&filename_len.to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(file_data);

    progress_cb("Preparing data", 2, 3);

    // For WASM, skip compression to avoid native dependencies
    // Prepend compression flag: [CompressionFlag:1][Data]
    let compression_flag: u8 = 0; // 0 = no compression
    let mut compressed = Vec::with_capacity(1 + payload.len());
    compressed.push(compression_flag);
    compressed.extend_from_slice(&payload);

    progress_cb("Preparing data", 3, 3);

    // Dynamic Packet Size Adjustment
    let mut final_packet_size = config.packet_size;
    let data_len = compressed.len();

    if data_len > 1_000_000 && final_packet_size == 250 {
        let target_packet_size = (data_len / 2000) as u16;
        final_packet_size = target_packet_size.clamp(250, 1500);
    }

    // Align packet size to 4 bytes (RaptorQ requirement) to match payload
    final_packet_size = (final_packet_size / 4) * 4;

    #[cfg(target_arch = "wasm32")]
    {
        web_sys::console::log_1(
            &format!(
                "🦀 Final packet_size={} (after adjustment), data_len={}",
                final_packet_size, data_len
            )
            .into(),
        );
    }

    progress_cb("Generating packets", 0, 100);

    // RaptorQ Encoding
    #[cfg(target_arch = "wasm32")]
    {
        web_sys::console::log_1(
            &format!(
                "🦀 Creating RaptorQ encoder with packet_size={}, data_len={}",
                final_packet_size,
                compressed.len()
            )
            .into(),
        );
    }

    let encoder = Encoder::with_defaults(&compressed, final_packet_size);
    let final_packet_size = encoder.get_config().symbol_size();

    let min_packets = (compressed.len() as f64 / final_packet_size as f64).ceil() as u32;
    let packets_to_generate = (compressed.len() as f64 / final_packet_size as f64
        * config.raptorq_overhead as f64)
        .ceil() as u32;
    let packets_to_generate = packets_to_generate.max(10);

    #[cfg(target_arch = "wasm32")]
    {
        web_sys::console::log_1(
            &format!(
                "🦀 RaptorQ: min_packets={}, packets_to_generate={}, overhead={}",
                min_packets, packets_to_generate, config.raptorq_overhead
            )
            .into(),
        );
    }

    progress_cb("Generating packets", 50, 100);

    // WORKAROUND: get_encoded_packets() generates too many packets in WASM
    // Manually limit to the requested amount
    let mut all_packets = encoder.get_encoded_packets(packets_to_generate);
    let _packets_len_before = all_packets.len();

    all_packets.truncate(packets_to_generate as usize);
    let packets = all_packets;

    #[cfg(target_arch = "wasm32")]
    {
        web_sys::console::log_1(
            &format!(
                "🦀 ACTUAL packets: {} before truncate, {} after (requested {})",
                _packets_len_before,
                packets.len(),
                packets_to_generate
            )
            .into(),
        );
    }

    // Report metadata based on ACTUAL generated packets
    progress_cb("Metadata", min_packets as usize, packets.len());

    progress_cb("Generating packets", 100, 100);

    // Capture values for closure
    let total_size = compressed.len() as u32;
    let ecc = config.ecc;
    // frame_delay_ms is already in config
    let total_packets = packets.len();

    progress_cb("Encoding QR codes", 0, total_packets);

    // Create GIF with 2-color palette (White, Black)
    let mut gif_out = Vec::new();
    {
        let color_map = &[0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00]; // RGB: White, Black
        let mut encoder = GifEncoder::new(
            &mut gif_out,
            target_size as u16,
            target_size as u16,
            color_map,
        )
        .map_err(|e| WasmEncodeError::GifEncoder {
            message: e.to_string(),
        })?;

        encoder
            .set_repeat(Repeat::Infinite)
            .map_err(|e| WasmEncodeError::GifRepeat {
                message: e.to_string(),
            })?;

        // Calculate progress report interval
        let report_interval = (total_packets / 100).clamp(10, 50);

        for (i, packet) in packets.into_iter().enumerate() {
            // Report progress
            if i % report_interval == 0 || i == total_packets - 1 {
                progress_cb("Encoding QR codes", i + 1, total_packets);
            }

            let payload = packet.data();

            // Header: TotalSize(4b) | PacketSize(2b) | SymbolID(4b) | Data(...)
            // IMPORTANT: Use actual payload length, not the configured packet_size
            // RaptorQ may produce payloads of varying sizes
            let actual_payload_size = payload.len() as u16;
            let mut qr_data = Vec::with_capacity(10 + payload.len());
            qr_data.extend_from_slice(&total_size.to_be_bytes());
            qr_data.extend_from_slice(&actual_payload_size.to_be_bytes());
            qr_data.extend_from_slice(&packet.payload_id().serialize());
            qr_data.extend_from_slice(payload);

            let qr = QrCode::encode_binary(&qr_data, ecc).map_err(|e| {
                WasmEncodeError::QrEncodePacket {
                    packet_index: i + 1,
                    message: format!("{:?}", e),
                }
            })?;

            // Render directly to indexed buffer (0=White, 1=Black)
            let (buffer, width, height) = render_qr_indexed(&qr, target_size, scale)?;

            // Create frame
            let mut frame = GifFrame::from_indexed_pixels(width, height, buffer, None);
            frame.delay = (config.frame_delay_ms / 10) as u16; // GIF delay is in 10ms units

            encoder
                .write_frame(&frame)
                .map_err(|e| WasmEncodeError::WriteFrame {
                    message: e.to_string(),
                })?;
        }
    }

    Ok(gif_out)
}

#[cfg(test)]
mod tests {
    use super::{
        build_normal_qr_data, build_streaming_qr_data, encode_aux_qr_buffer, encode_data_to_gif,
        measure_aux_qr_buffer, select_streaming_chunk, GifEncodeOptions, StreamingQrPacketHeader,
        WasmEncodeError,
    };
    use qrcodegen::QrCodeEcc;

    #[test]
    fn encode_data_to_gif_returns_error_when_qr_payload_exceeds_capacity() {
        let result = encode_data_to_gif(
            "oversized.bin",
            &[0u8; 2048],
            GifEncodeOptions {
                compression_enabled: false,
                frame_delay_ms: 100,
                ecc_level: "LOW",
                packet_size: 4000,
                target_size: 177,
                scale: 1,
                raptorq_overhead: 1.0,
            },
            |_phase, _current, _total| {},
        );

        let err = result.expect_err("oversized QR payload should return an error");
        match err {
            WasmEncodeError::QrEncodePacket { packet_index, .. } => {
                assert_eq!(packet_index, 1);
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[test]
    fn select_streaming_chunk_returns_typed_out_of_range_error_for_full_file_mode() {
        let err = select_streaming_chunk(&[1, 2, 3], 4, 1).unwrap_err();

        match err {
            WasmEncodeError::ChunkIdOutOfRangeFullFileMode { chunk_id, file_len } => {
                assert_eq!(chunk_id, 4);
                assert_eq!(file_len, 3);
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[test]
    fn encode_aux_qr_buffer_returns_typed_qr_error_when_payload_exceeds_capacity() {
        let err = encode_aux_qr_buffer(vec![0u8; 4096], QrCodeEcc::Low, 177, 1, None).unwrap_err();

        match err {
            WasmEncodeError::QrEncode { .. } => {}
            other => panic!("unexpected error variant: {other:?}"),
        }
    }

    #[test]
    fn measure_aux_qr_buffer_matches_rendered_normal_qr_frame_length() {
        let qr_data = build_normal_qr_data(&[1, 2, 3], 42, &[4, 5, 6, 7]);
        let measured = measure_aux_qr_buffer(qr_data.clone(), QrCodeEcc::Medium, 177, 1, None)
            .expect("frame size measurement should succeed");
        let encoded = encode_aux_qr_buffer(qr_data, QrCodeEcc::Medium, 177, 1, None)
            .expect("frame render should succeed");

        assert_eq!(measured as usize, encoded.len());
    }

    #[test]
    fn measure_aux_qr_buffer_matches_rendered_streaming_qr_frame_length() {
        let qr_data = build_streaming_qr_data(StreamingQrPacketHeader {
            packet_data: &[1, 2, 3],
            packet_id: &[4, 5, 6, 7],
            session_id: 123,
            chunk_id: 1,
            total_chunks: 4,
            chunk_offset: 1024,
            total_size: 42,
            exact_chunk_packets: 17,
        });
        let measured = measure_aux_qr_buffer(qr_data.clone(), QrCodeEcc::Low, 177, 1, None)
            .expect("streaming frame size measurement should succeed");
        let encoded = encode_aux_qr_buffer(qr_data, QrCodeEcc::Low, 177, 1, None)
            .expect("streaming frame render should succeed");

        assert_eq!(measured as usize, encoded.len());
    }
}

fn render_qr_indexed(
    qr: &QrCode,
    target_size: u32,
    fixed_scale: u32,
) -> Result<(Vec<u8>, u16, u16), WasmEncodeError> {
    let size = qr.size() as u32;
    let border = 4;

    // Dynamic scaling logic
    let scale = if fixed_scale > 0 {
        fixed_scale
    } else {
        let raw_size = size + border * 2;
        // Use provided target_size (default 700 if passed as such)
        (target_size / raw_size).clamp(1, 16)
    };

    let raw_size = size + border * 2;
    let img_size = raw_size * scale;

    // Guard against image buffer overflow: img_size * img_size must not overflow u32.
    if img_size > 10000 {
        return Err(WasmEncodeError::ImageSizeTooLarge {
            width: img_size,
            height: img_size,
        });
    }

    // Allocate buffer for indexed pixels (1 byte per pixel)
    // 0 = White (Index 0 in palette), 1 = Black (Index 1 in palette)
    let mut buffer = vec![0u8; (img_size * img_size) as usize];

    // Fill with black pixels where needed (default is 0/White)
    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x as i32, y as i32) {
                let start_x = (x + border) * scale;
                let start_y = (y + border) * scale;

                // Fill the scaled block
                for py in 0..scale {
                    let row_offset = ((start_y + py) * img_size) as usize;
                    for px in 0..scale {
                        buffer[row_offset + (start_x + px) as usize] = 1; // Index 1 = Black
                    }
                }
            }
        }
    }

    Ok((buffer, img_size as u16, img_size as u16))
}

// ==================== Streaming Mode WASM API ====================
// Note: WasmStreamingEncoder class removed because StreamingEncoder uses filesystem
// which is not available in WASM. Use encode_streaming_from_bytes() instead.

// Direct bytes encoding approach (better for WASM)
#[wasm_bindgen]
// Public WASM ABI consumed positionally by the Web streaming encoder.
#[allow(clippy::too_many_arguments)]
pub fn encode_streaming_from_bytes(
    file_data: Vec<u8>,
    filename: String,
    chunk_id: u32,
    total_chunks: u32,
    session_id: u32,
    chunk_size_mb: usize,
    compression_enabled: bool,
    frame_delay_ms: u32,
    ecc_level: String,
    packet_size: u16,
    raptorq_overhead: f32,
    callback: &js_sys::Function,
) -> Result<Vec<u8>, JsValue> {
    validate_wasm_input_size(file_data.len()).map_err(encode_error_to_js_value)?;

    let config = StreamingConfig {
        chunk_size_mb,
        compression_enabled,
        frame_delay_ms: frame_delay_ms as u64,
        packet_size,
        raptorq_overhead,
        ecc: match ecc_level.to_uppercase().as_str() {
            "LOW" => QrCodeEcc::Low,
            "MEDIUM" => QrCodeEcc::Medium,
            "QUARTILE" => QrCodeEcc::Quartile,
            "HIGH" => QrCodeEcc::High,
            _ => QrCodeEcc::Medium,
        },
        ..StreamingConfig::default()
    };

    // Calculate chunk boundaries
    let chunk_size_bytes = chunk_size_mb * 1024 * 1024;
    let chunk_offset = chunk_id as usize * chunk_size_bytes;

    let chunk_data = select_streaming_chunk(&file_data, chunk_id, chunk_size_bytes)
        .map_err(encode_error_to_js_value)?;

    // Prepare payload with filename
    let filename_bytes = filename.as_bytes();
    let filename_len = filename_bytes.len() as u32;

    let mut payload = Vec::with_capacity(4 + filename_bytes.len() + chunk_data.len());
    payload.extend_from_slice(&filename_len.to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(chunk_data);

    // For WASM, skip compression (no zstd)
    let compression_flag: u8 = 0;
    let mut compressed = Vec::with_capacity(1 + payload.len());
    compressed.push(compression_flag);
    compressed.extend_from_slice(&payload);

    // Dynamic Packet Size Adjustment
    let mut final_packet_size = config.packet_size;
    let data_len = compressed.len();

    if data_len > 500_000 && final_packet_size == 250 {
        let target_packet_size = (data_len / 2000) as u16;
        final_packet_size = target_packet_size.clamp(250, 1500);
    }

    // Align packet size to 4 bytes (RaptorQ requirement)
    final_packet_size = (final_packet_size / 4) * 4;

    // RaptorQ encoding
    let encoder = Encoder::with_defaults(&compressed, final_packet_size);
    let final_packet_size = encoder.get_config().symbol_size();
    let packets_to_generate = (compressed.len() as f64 / final_packet_size as f64
        * raptorq_overhead as f64)
        .ceil() as u32;
    let packets_to_generate = packets_to_generate.max(10);

    let packets = encoder.get_encoded_packets(packets_to_generate);
    let exact_chunk_packets = packets.len() as u32;

    // Create QR frames with streaming header
    let total_frames = packets.len();

    // Encode GIF
    let mut gif_out = Vec::new();
    {
        let color_map = &[0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00];

        if !packets.is_empty() {
            // Process first packet to initialize encoder
            let first_packet = &packets[0];
            let payload = first_packet.data();

            // Streaming Header with exact chunk packet count
            let mode = 2u8;
            let total_size = compressed.len() as u32;
            let chunk_offset_u64 = chunk_offset as u64;
            // Use actual payload length in header
            let actual_payload_size = payload.len() as u16;

            let mut qr_data = Vec::with_capacity(35 + payload.len());
            qr_data.push(mode);
            qr_data.extend_from_slice(&session_id.to_be_bytes());
            qr_data.extend_from_slice(&chunk_id.to_be_bytes());
            qr_data.extend_from_slice(&total_chunks.to_be_bytes());
            qr_data.extend_from_slice(&chunk_offset_u64.to_be_bytes());
            qr_data.extend_from_slice(&total_size.to_be_bytes());
            qr_data.extend_from_slice(&actual_payload_size.to_be_bytes());
            qr_data.extend_from_slice(&exact_chunk_packets.to_be_bytes());
            qr_data.extend_from_slice(&first_packet.payload_id().serialize());
            qr_data.extend_from_slice(payload);

            let qr = QrCode::encode_binary(&qr_data, config.ecc).map_err(|e| {
                encode_error_to_js_value(WasmEncodeError::QrEncodePacket {
                    packet_index: 1,
                    message: e.to_string(),
                })
            })?;

            // Render indexed
            let (buffer, width, height) =
                render_qr_indexed(&qr, 177, 0).map_err(encode_error_to_js_value)?;

            let mut encoder =
                GifEncoder::new(&mut gif_out, width, height, color_map).map_err(|e| {
                    encode_error_to_js_value(WasmEncodeError::GifEncoder {
                        message: e.to_string(),
                    })
                })?;

            encoder.set_repeat(Repeat::Infinite).map_err(|e| {
                encode_error_to_js_value(WasmEncodeError::GifRepeat {
                    message: e.to_string(),
                })
            })?;

            // Write first frame
            let mut frame = GifFrame::from_indexed_pixels(width, height, buffer, None);
            frame.delay = (frame_delay_ms / 10) as u16;
            encoder.write_frame(&frame).map_err(|e| {
                encode_error_to_js_value(WasmEncodeError::WriteFrame {
                    message: e.to_string(),
                })
            })?;

            // Process remaining packets
            for (i, packet) in packets.iter().enumerate().skip(1) {
                if i % 50 == 0 {
                    let _ = callback.call3(
                        &JsValue::NULL,
                        &JsValue::from_str(&format!(
                            "Encoding chunk {}/{}",
                            chunk_id + 1,
                            total_chunks
                        )),
                        &JsValue::from(i as u32),
                        &JsValue::from(total_frames as u32),
                    );
                }

                let payload = packet.data();
                // Use actual payload length in header
                let actual_payload_size = payload.len() as u16;

                let mut qr_data = Vec::with_capacity(35 + payload.len());
                qr_data.push(mode);
                qr_data.extend_from_slice(&session_id.to_be_bytes());
                qr_data.extend_from_slice(&chunk_id.to_be_bytes());
                qr_data.extend_from_slice(&total_chunks.to_be_bytes());
                qr_data.extend_from_slice(&chunk_offset_u64.to_be_bytes());
                qr_data.extend_from_slice(&total_size.to_be_bytes());
                qr_data.extend_from_slice(&actual_payload_size.to_be_bytes());
                qr_data.extend_from_slice(&exact_chunk_packets.to_be_bytes());
                qr_data.extend_from_slice(&packet.payload_id().serialize());
                qr_data.extend_from_slice(payload);

                let qr = QrCode::encode_binary(&qr_data, config.ecc).map_err(|e| {
                    encode_error_to_js_value(WasmEncodeError::QrEncodePacket {
                        packet_index: i + 1,
                        message: e.to_string(),
                    })
                })?;

                // Render indexed
                let (buffer, width, height) =
                    render_qr_indexed(&qr, 177, 0).map_err(encode_error_to_js_value)?;

                let mut frame = GifFrame::from_indexed_pixels(width, height, buffer, None);
                frame.delay = (frame_delay_ms / 10) as u16;
                encoder.write_frame(&frame).map_err(|e| {
                    encode_error_to_js_value(WasmEncodeError::WriteFrame {
                        message: e.to_string(),
                    })
                })?;
            }
        }
    }

    let _ = callback.call3(
        &JsValue::NULL,
        &JsValue::from_str(&format!("Chunk {}/{} complete", chunk_id + 1, total_chunks)),
        &JsValue::from(100),
        &JsValue::from(100),
    );

    Ok(gif_out)
}

fn log_decoder_error(message: &str) {
    #[cfg(target_arch = "wasm32")]
    web_sys::console::error_1(&JsValue::from_str(message));

    #[cfg(not(target_arch = "wasm32"))]
    eprintln!("{message}");
}

fn lock_optional_decoder<'a, T>(
    mutex: &'a Mutex<Option<T>>,
    name: &'static str,
) -> Result<MutexGuard<'a, Option<T>>, String> {
    mutex.lock().map_err(|_| format!("{name} mutex poisoned"))
}

fn set_js_property<V: Into<JsValue>>(
    object: &js_sys::Object,
    key: &str,
    value: V,
) -> Result<(), JsValue> {
    js_sys::Reflect::set(object, &JsValue::from_str(key), &value.into()).map(|_| ())
}

// Global decoder for streaming mode
static STREAMING_DECODER: Mutex<Option<StreamingDecoder>> = Mutex::new(None);

#[wasm_bindgen]
pub fn init_streaming_decoder() {
    match lock_optional_decoder(&STREAMING_DECODER, "streaming decoder") {
        Ok(mut decoder) => *decoder = Some(StreamingDecoder::new()),
        Err(message) => log_decoder_error(&message),
    }
}

#[wasm_bindgen]
pub fn reset_streaming_decoder() {
    match lock_optional_decoder(&STREAMING_DECODER, "streaming decoder") {
        Ok(mut decoder) => {
            if let Some(ref mut inner) = *decoder {
                inner.reset();
            }
        }
        Err(message) => log_decoder_error(&message),
    }
}

#[wasm_bindgen]
pub fn decode_streaming_packet(data: Vec<u8>) -> Result<JsValue, JsValue> {
    // web_sys::console::log_1(&JsValue::from_str(&format!("WASM: Decoding packet len: {}", data.len())));

    let mut decoder_guard = lock_optional_decoder(&STREAMING_DECODER, "streaming decoder")
        .map_err(|message| JsValue::from_str(&message))?;
    let decoder = decoder_guard.get_or_insert_with(StreamingDecoder::new);
    let result = decoder.add_packet(&data);

    match result {
        StreamDecodeResult::Progress {
            session_id,
            chunk_id,
            total_chunks,
            chunk_percent,
            overall_percent,
            chunks_completed,
            filename,
            packets_received_chunk,
            packets_expected_chunk,
            packets_total_chunk,
            packets_received_total,
        } => {
            let obj = js_sys::Object::new();
            set_js_property(&obj, "type", "progress")?;
            set_js_property(&obj, "sessionId", session_id)?;
            set_js_property(&obj, "chunkId", chunk_id)?;
            set_js_property(&obj, "totalChunks", total_chunks)?;
            set_js_property(&obj, "chunkPercent", chunk_percent)?;
            set_js_property(&obj, "overallPercent", overall_percent)?;
            set_js_property(&obj, "chunksCompleted", chunks_completed)?;
            if let Some(f) = filename {
                set_js_property(&obj, "filename", f)?;
            }
            set_js_property(&obj, "packetsReceivedChunk", packets_received_chunk)?;
            set_js_property(&obj, "packetsExpectedChunk", packets_expected_chunk)?;
            if total_chunks == 1 {
                set_js_property(&obj, "expectedPackets", packets_expected_chunk)?;
            }
            if let Some(total_packets_chunk) = packets_total_chunk {
                set_js_property(&obj, "packetsTotalChunk", total_packets_chunk)?;
                if total_chunks == 1 {
                    set_js_property(&obj, "totalPackets", total_packets_chunk)?;
                }
            }
            set_js_property(&obj, "packetsReceivedTotal", packets_received_total)?;
            Ok(obj.into())
        }
        StreamDecodeResult::ChunkCompleted {
            session_id,
            chunk_id,
            total_chunks,
            chunks_completed,
            overall_percent,
            chunk_data,
            filename,
            packets_received_chunk,
            packets_expected_chunk,
            packets_total_chunk,
            packets_received_total,
        } => {
            let obj = js_sys::Object::new();
            set_js_property(&obj, "type", "chunk_completed")?;
            set_js_property(&obj, "sessionId", session_id)?;
            set_js_property(&obj, "chunkId", chunk_id)?;
            set_js_property(&obj, "totalChunks", total_chunks)?;
            set_js_property(&obj, "chunksCompleted", chunks_completed)?;
            set_js_property(&obj, "overallPercent", overall_percent)?;
            set_js_property(&obj, "chunkData", js_sys::Uint8Array::from(&chunk_data[..]))?;
            if let Some(f) = filename {
                set_js_property(&obj, "filename", f)?;
            }
            set_js_property(&obj, "packetsReceivedChunk", packets_received_chunk)?;
            set_js_property(&obj, "packetsExpectedChunk", packets_expected_chunk)?;
            if total_chunks == 1 {
                set_js_property(&obj, "expectedPackets", packets_expected_chunk)?;
            }
            if let Some(total_packets_chunk) = packets_total_chunk {
                set_js_property(&obj, "packetsTotalChunk", total_packets_chunk)?;
                if total_chunks == 1 {
                    set_js_property(&obj, "totalPackets", total_packets_chunk)?;
                }
            }
            set_js_property(&obj, "packetsReceivedTotal", packets_received_total)?;
            Ok(obj.into())
        }
        StreamDecodeResult::AllCompleted {
            session_id,
            filename,
            data,
            duration,
            total_packets,
        } => {
            let obj = js_sys::Object::new();
            set_js_property(&obj, "type", "completed")?;
            set_js_property(&obj, "sessionId", session_id)?;
            set_js_property(&obj, "filename", filename)?;
            set_js_property(&obj, "data", js_sys::Uint8Array::from(&data[..]))?;
            set_js_property(&obj, "duration", duration.as_secs_f64())?;
            set_js_property(&obj, "totalPackets", total_packets)?;
            Ok(obj.into())
        }
        StreamDecodeResult::Error(msg) => {
            // web_sys::console::error_1(&JsValue::from_str(&format!("WASM Decode Error: {}", msg)));
            Err(JsValue::from_str(&msg))
        }
    }
}

// Global decoder for normal mode
static NORMAL_DECODER: Mutex<Option<AirqrDecoder>> = Mutex::new(None);

#[wasm_bindgen]
pub fn init_normal_decoder() {
    match lock_optional_decoder(&NORMAL_DECODER, "normal decoder") {
        Ok(mut decoder) => *decoder = Some(AirqrDecoder::new()),
        Err(message) => log_decoder_error(&message),
    }
}

#[wasm_bindgen]
pub fn reset_normal_decoder() {
    match lock_optional_decoder(&NORMAL_DECODER, "normal decoder") {
        Ok(mut decoder) => {
            if let Some(ref mut inner) = *decoder {
                inner.reset();
            }
        }
        Err(message) => log_decoder_error(&message),
    }
}

#[wasm_bindgen]
pub fn decode_normal_packet(data: Vec<u8>) -> Result<JsValue, JsValue> {
    let mut decoder = lock_optional_decoder(&NORMAL_DECODER, "normal decoder")
        .map_err(|message| JsValue::from_str(&message))?;
    let result = decoder
        .get_or_insert_with(AirqrDecoder::new)
        .add_chunk(&data);

    match result {
        DecodeResult::Progress {
            percent,
            received,
            expected,
        } => {
            let obj = js_sys::Object::new();
            set_js_property(&obj, "type", "progress")?;
            set_js_property(&obj, "percent", percent)?;
            set_js_property(&obj, "receivedPackets", received)?;
            set_js_property(&obj, "expectedPackets", expected)?;
            Ok(obj.into())
        }
        DecodeResult::Completed {
            filename,
            data,
            duration,
            total_packets,
        } => {
            let obj = js_sys::Object::new();
            set_js_property(&obj, "type", "completed")?;
            set_js_property(&obj, "filename", filename)?;
            set_js_property(&obj, "data", js_sys::Uint8Array::from(&data[..]))?;
            set_js_property(&obj, "duration", duration.as_secs_f64())?;
            set_js_property(&obj, "totalPackets", total_packets)?;
            Ok(obj.into())
        }
        DecodeResult::Error(msg) => Err(JsValue::from_str(&msg)),
    }
}
