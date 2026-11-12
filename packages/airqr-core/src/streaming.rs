use crate::CoreDecodeError;
#[cfg(not(target_arch = "wasm32"))]
use anyhow::Result;
#[cfg(not(target_arch = "wasm32"))]
use image::codecs::gif::GifEncoder;
#[cfg(not(target_arch = "wasm32"))]
use image::{Delay, Frame, Rgba, RgbaImage};
#[cfg(not(target_arch = "wasm32"))]
use qrcodegen::QrCode;
use qrcodegen::QrCodeEcc;
#[cfg(not(target_arch = "wasm32"))]
use raptorq::Encoder;
use raptorq::{Decoder, EncodingPacket, ObjectTransmissionInformation, PayloadId};
use std::collections::{HashMap, HashSet};
#[cfg(not(target_arch = "wasm32"))]
use std::fs::File;
#[cfg(not(target_arch = "wasm32"))]
use std::io::Read;
#[cfg(not(target_arch = "wasm32"))]
use std::io::Seek;
use std::ops::Range;
#[cfg(not(target_arch = "wasm32"))]
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

fn read_u16_be(
    data: &[u8],
    range: Range<usize>,
    field: &'static str,
) -> Result<u16, CoreDecodeError> {
    let bytes = data
        .get(range)
        .ok_or(CoreDecodeError::PacketTooShort { field })?;
    let bytes: [u8; 2] = bytes
        .try_into()
        .map_err(|_| CoreDecodeError::PacketTooShort { field })?;
    Ok(u16::from_be_bytes(bytes))
}

fn read_u32_be(
    data: &[u8],
    range: Range<usize>,
    field: &'static str,
) -> Result<u32, CoreDecodeError> {
    let bytes = data
        .get(range)
        .ok_or(CoreDecodeError::PacketTooShort { field })?;
    let bytes: [u8; 4] = bytes
        .try_into()
        .map_err(|_| CoreDecodeError::PacketTooShort { field })?;
    Ok(u32::from_be_bytes(bytes))
}

fn read_u64_be(
    data: &[u8],
    range: Range<usize>,
    field: &'static str,
) -> Result<u64, CoreDecodeError> {
    let bytes = data
        .get(range)
        .ok_or(CoreDecodeError::PacketTooShort { field })?;
    let bytes: [u8; 8] = bytes
        .try_into()
        .map_err(|_| CoreDecodeError::PacketTooShort { field })?;
    Ok(u64::from_be_bytes(bytes))
}

fn read_u32_bytes(
    data: &[u8],
    range: Range<usize>,
    field: &'static str,
) -> Result<[u8; 4], CoreDecodeError> {
    let bytes = data
        .get(range)
        .ok_or(CoreDecodeError::PacketTooShort { field })?;
    bytes
        .try_into()
        .map_err(|_| CoreDecodeError::PacketTooShort { field })
}

// ==================== Configuration ====================

#[derive(Debug, Clone)]
pub struct StreamingConfig {
    pub qr_version_min: i16,
    pub qr_version_max: i16,
    pub ecc: QrCodeEcc,
    pub frame_delay_ms: u64,
    pub packet_size: u16,
    pub chunk_size_mb: usize,
    pub compression_enabled: bool,
    pub raptorq_overhead: f32,
}

impl Default for StreamingConfig {
    fn default() -> Self {
        Self {
            qr_version_min: 1,
            qr_version_max: 40,
            ecc: QrCodeEcc::Medium,
            frame_delay_ms: 100,
            packet_size: 250,
            chunk_size_mb: 10, // 10MB chunks by default
            compression_enabled: true,
            raptorq_overhead: 1.5,
        }
    }
}

// ==================== Progress Reporting ====================

#[derive(Debug, Clone)]
pub enum StreamEncodeProgress {
    Starting {
        total_chunks: u32,
    },
    ReadingChunk {
        chunk_id: u32,
        total_chunks: u32,
    },
    CompressingChunk {
        chunk_id: u32,
        total_chunks: u32,
        progress: f32,
    },
    GeneratingPackets {
        chunk_id: u32,
        total_chunks: u32,
        current: usize,
        total: usize,
    },
    RenderingFrames {
        chunk_id: u32,
        total_chunks: u32,
        current: usize,
        total: usize,
    },
    EncodingGif {
        chunk_id: u32,
        total_chunks: u32,
        current: usize,
        total: usize,
    },
    ChunkComplete {
        chunk_id: u32,
        total_chunks: u32,
        gif_size: usize,
    },
    AllComplete {
        total_chunks: u32,
    },
    Info(String),
}

// ==================== Streaming Encoder ====================

#[cfg(not(target_arch = "wasm32"))]
pub struct StreamingEncoder {
    config: StreamingConfig,
    session_id: u32,
    file_path: PathBuf,
    file_size: u64,
    total_chunks: u32,
}

#[cfg(not(target_arch = "wasm32"))]
impl StreamingEncoder {
    pub fn new(config: StreamingConfig, file_path: impl AsRef<Path>) -> Result<Self> {
        let path = file_path.as_ref().to_path_buf();

        // Get file size
        let metadata = std::fs::metadata(&path)?;
        let file_size = metadata.len();

        // Calculate total chunks
        let chunk_size_bytes = (config.chunk_size_mb * 1024 * 1024) as u64;
        let total_chunks = file_size.div_ceil(chunk_size_bytes) as u32;

        // Generate a session id from OS entropy; no predictable fallback.
        let session_id = Self::generate_session_id()?;

        Ok(Self {
            config,
            session_id,
            file_path: path,
            file_size,
            total_chunks,
        })
    }

    pub fn get_session_id(&self) -> u32 {
        self.session_id
    }

    pub fn get_total_chunks(&self) -> u32 {
        self.total_chunks
    }

    pub fn get_file_size(&self) -> u64 {
        self.file_size
    }

    fn generate_session_id() -> Result<u32> {
        Self::generate_session_id_with_entropy(|bytes| {
            getrandom::getrandom(bytes).map_err(|error| {
                anyhow::anyhow!("Failed to generate streaming session id: {}", error)
            })
        })
    }

    fn generate_session_id_with_entropy<F>(mut fill: F) -> Result<u32>
    where
        F: FnMut(&mut [u8; 4]) -> Result<()>,
    {
        let mut bytes = [0u8; 4];
        fill(&mut bytes)?;
        Ok(u32::from_be_bytes(bytes))
    }

    pub fn encode_chunk<F>(&self, chunk_id: u32, mut progress_cb: F) -> Result<Vec<u8>>
    where
        F: FnMut(StreamEncodeProgress),
    {
        if chunk_id >= self.total_chunks {
            return Err(anyhow::anyhow!(
                "Chunk ID {} out of range (total: {})",
                chunk_id,
                self.total_chunks
            ));
        }

        progress_cb(StreamEncodeProgress::ReadingChunk {
            chunk_id,
            total_chunks: self.total_chunks,
        });

        // Calculate chunk offset and size
        let chunk_size_bytes = (self.config.chunk_size_mb * 1024 * 1024) as u64;
        let chunk_offset = chunk_id as u64 * chunk_size_bytes;
        let remaining = self.file_size - chunk_offset;
        let this_chunk_size = remaining.min(chunk_size_bytes) as usize;

        // Read chunk from file
        let mut file = File::open(&self.file_path)?;
        file.seek(std::io::SeekFrom::Start(chunk_offset))?;

        let mut chunk_data = vec![0u8; this_chunk_size];
        file.read_exact(&mut chunk_data)?;

        // Get filename for metadata (only needed for first chunk, but include in all for simplicity)
        let filename = self
            .file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown.bin");

        // Prepare payload: [FilenameLen(4b)][Filename][ChunkData]
        let filename_bytes = filename.as_bytes();
        let filename_len = filename_bytes.len() as u32;

        let mut payload = Vec::with_capacity(4 + filename_bytes.len() + chunk_data.len());
        payload.extend_from_slice(&filename_len.to_be_bytes());
        payload.extend_from_slice(filename_bytes);
        payload.extend_from_slice(&chunk_data);

        // Compress chunk (skip for WASM)
        let (compressed_data, compression_flag) = if self.config.compression_enabled {
            #[cfg(all(feature = "zstd", not(target_arch = "wasm32")))]
            {
                progress_cb(StreamEncodeProgress::CompressingChunk {
                    chunk_id,
                    total_chunks: self.total_chunks,
                    progress: 0.0,
                });

                use std::io::Write;
                let mut output = Vec::new();
                let mut encoder = zstd::stream::write::Encoder::new(&mut output, 3)?;
                encoder.write_all(&payload)?;
                encoder.finish()?;

                progress_cb(StreamEncodeProgress::CompressingChunk {
                    chunk_id,
                    total_chunks: self.total_chunks,
                    progress: 100.0,
                });

                (output, 1u8)
            }
            #[cfg(any(not(feature = "zstd"), target_arch = "wasm32"))]
            {
                (payload, 0u8)
            }
        } else {
            (payload, 0u8)
        };

        // Prepend compression flag
        let mut compressed = Vec::with_capacity(1 + compressed_data.len());
        compressed.push(compression_flag);
        compressed.extend_from_slice(&compressed_data);

        // RaptorQ encoding
        let packet_size = self.config.packet_size;
        let encoder = Encoder::with_defaults(&compressed, packet_size);

        let packets_to_generate = (compressed.len() as f64 / packet_size as f64
            * self.config.raptorq_overhead as f64)
            .ceil() as u32;
        let packets_to_generate = packets_to_generate.max(10);

        progress_cb(StreamEncodeProgress::Info(format!(
            "Generating {} RaptorQ packets (this may take 1-2 minutes)...",
            packets_to_generate
        )));

        let packets: Vec<EncodingPacket> = encoder.get_encoded_packets(packets_to_generate);

        progress_cb(StreamEncodeProgress::Info(format!(
            "Generated {} packets, now encoding to GIF...",
            packets.len()
        )));

        // Encode GIF frame-by-frame to avoid memory bloat AND enable progress reporting
        let total_frames = packets.len();
        let total_size = compressed.len() as u32;
        let report_interval = (total_frames / 100).clamp(10, 100);

        let mut gif_out = Vec::new();
        {
            let mut gif_encoder = GifEncoder::new(&mut gif_out);
            gif_encoder.set_repeat(image::codecs::gif::Repeat::Infinite)?;

            for (i, packet) in packets.into_iter().enumerate() {
                // Report progress at intervals
                if i % report_interval == 0 || i == total_frames - 1 {
                    progress_cb(StreamEncodeProgress::RenderingFrames {
                        chunk_id,
                        total_chunks: self.total_chunks,
                        current: i + 1,
                        total: total_frames,
                    });
                }

                let payload = packet.data();

                // Streaming Header with exact chunk packet count
                let mode = 2u8;
                let mut qr_data = Vec::with_capacity(35 + payload.len());
                qr_data.push(mode);
                qr_data.extend_from_slice(&self.session_id.to_be_bytes());
                qr_data.extend_from_slice(&chunk_id.to_be_bytes());
                qr_data.extend_from_slice(&self.total_chunks.to_be_bytes());
                qr_data.extend_from_slice(&chunk_offset.to_be_bytes());
                qr_data.extend_from_slice(&total_size.to_be_bytes());
                qr_data.extend_from_slice(&packet_size.to_be_bytes());
                qr_data.extend_from_slice(&(total_frames as u32).to_be_bytes());
                qr_data.extend_from_slice(&packet.payload_id().serialize());
                qr_data.extend_from_slice(payload);

                // Encode to QR
                let qr = QrCode::encode_binary(&qr_data, self.config.ecc)?;
                let img = render_qr_image(&qr)?;

                // Encode frame directly (no storage in memory)
                let frame = Frame::from_parts(
                    img,
                    0,
                    0,
                    Delay::from_saturating_duration(Duration::from_millis(
                        self.config.frame_delay_ms,
                    )),
                );
                gif_encoder.encode_frame(frame)?;
            }
        }

        progress_cb(StreamEncodeProgress::ChunkComplete {
            chunk_id,
            total_chunks: self.total_chunks,
            gif_size: gif_out.len(),
        });

        Ok(gif_out)
    }

    pub fn encode_all_chunks<F>(&self, mut progress_cb: F) -> Result<Vec<Vec<u8>>>
    where
        F: FnMut(StreamEncodeProgress),
    {
        progress_cb(StreamEncodeProgress::Starting {
            total_chunks: self.total_chunks,
        });

        let mut gifs = Vec::with_capacity(self.total_chunks as usize);

        for chunk_id in 0..self.total_chunks {
            let gif = self.encode_chunk(chunk_id, &mut progress_cb)?;
            gifs.push(gif);
        }

        progress_cb(StreamEncodeProgress::AllComplete {
            total_chunks: self.total_chunks,
        });

        Ok(gifs)
    }
}

// Static helper function for rendering QR codes (can be used in closures)
#[cfg(not(target_arch = "wasm32"))]
fn render_qr_image(qr: &QrCode) -> Result<RgbaImage> {
    let size = qr.size() as u32;
    let border = 4;
    let target_size = 700;
    let raw_size = size + border * 2;
    let scale = (target_size / raw_size).clamp(2, 16);
    let img_size = raw_size * scale;

    // Guard against image buffer overflow: img_size * img_size must not overflow u32.
    // In practice QR codes never exceed ~3000px, so 10000 is a generous safety limit.
    if img_size > 10000 {
        return Err(anyhow::anyhow!(
            "Image size too large: {}x{}",
            img_size,
            img_size
        ));
    }

    let mut img = RgbaImage::new(img_size, img_size);

    // Fill with white (255 for all RGBA channels) using bulk memset
    img.as_flat_samples_mut().samples.fill(255);

    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x as i32, y as i32) {
                let start_x = (x + border) * scale;
                let start_y = (y + border) * scale;
                for px in 0..scale {
                    for py in 0..scale {
                        img.put_pixel(start_x + px, start_y + py, Rgba([0, 0, 0, 255]));
                    }
                }
            }
        }
    }

    Ok(img)
}

// ==================== Streaming Decoder ====================

#[derive(Debug, Clone)]
pub enum StreamDecodeResult {
    Progress {
        session_id: u32,
        chunk_id: u32,
        total_chunks: u32,
        chunk_percent: f32,
        overall_percent: f32,
        chunks_completed: u32,
        filename: Option<String>,
        packets_received_chunk: u32,
        packets_expected_chunk: u32,
        packets_total_chunk: Option<u32>,
        packets_received_total: u32,
    },
    ChunkCompleted {
        session_id: u32,
        chunk_id: u32,
        total_chunks: u32,
        chunks_completed: u32,
        overall_percent: f32,
        chunk_data: Vec<u8>,
        filename: Option<String>,
        packets_received_chunk: u32,
        packets_expected_chunk: u32,
        packets_total_chunk: Option<u32>,
        packets_received_total: u32,
    },
    AllCompleted {
        session_id: u32,
        filename: String,
        data: Vec<u8>,
        duration: Duration,
        total_packets: u32,
    },
    Error(String),
}

struct ChunkDecoder {
    decoder: Decoder,
    total_size: u32,
    packet_size: u16,
    exact_packets_total: Option<u32>,
    packets_received: u32,
    seen_packets: HashSet<u32>,
}

pub struct StreamingDecoder {
    session_id: Option<u32>,
    total_chunks: u32,
    chunk_decoders: HashMap<u32, ChunkDecoder>,
    completed_chunks: HashSet<u32>,
    filename: Option<String>,
    file_size: u64,
    temp_chunks: HashMap<u32, Vec<u8>>,
    start_time: Option<Instant>,
}

impl StreamingDecoder {
    pub fn new() -> Self {
        Self {
            session_id: None,
            total_chunks: 0,
            chunk_decoders: HashMap::new(),
            completed_chunks: HashSet::new(),
            filename: None,
            file_size: 0,
            temp_chunks: HashMap::new(),
            start_time: None,
        }
    }

    pub fn add_packet(&mut self, data: &[u8]) -> StreamDecodeResult {
        // Parse streaming header.
        if data.len() < 31 {
            return StreamDecodeResult::Error(
                CoreDecodeError::PacketTooShortWithLength {
                    len: data.len(),
                    expected: 31,
                }
                .to_string(),
            );
        }

        let mode = data[0];
        if mode != 1 && mode != 2 {
            return StreamDecodeResult::Error(CoreDecodeError::NotStreamingModePacket.to_string());
        }

        let has_exact_chunk_total = mode == 2;
        let header_size = if has_exact_chunk_total { 35 } else { 31 };
        if data.len() < header_size {
            return StreamDecodeResult::Error(
                CoreDecodeError::PacketTooShortWithLength {
                    len: data.len(),
                    expected: header_size,
                }
                .to_string(),
            );
        }

        let session_id = match read_u32_be(data, 1..5, "session_id") {
            Ok(value) => value,
            Err(err) => return StreamDecodeResult::Error(err.to_string()),
        };
        let chunk_id = match read_u32_be(data, 5..9, "chunk_id") {
            Ok(value) => value,
            Err(err) => return StreamDecodeResult::Error(err.to_string()),
        };
        let total_chunks = match read_u32_be(data, 9..13, "total_chunks") {
            Ok(value) => value,
            Err(err) => return StreamDecodeResult::Error(err.to_string()),
        };
        if total_chunks == 0 {
            return StreamDecodeResult::Error(
                CoreDecodeError::ZeroField {
                    field: "total_chunks",
                }
                .to_string(),
            );
        }
        if chunk_id >= total_chunks {
            return StreamDecodeResult::Error(
                CoreDecodeError::ChunkIdOutOfRange {
                    chunk_id,
                    total_chunks,
                }
                .to_string(),
            );
        }
        let _chunk_offset = match read_u64_be(data, 13..21, "chunk_offset") {
            Ok(value) => value,
            Err(err) => return StreamDecodeResult::Error(err.to_string()),
        };
        let total_size = match read_u32_be(data, 21..25, "total_size") {
            Ok(value) => value,
            Err(err) => return StreamDecodeResult::Error(err.to_string()),
        };
        if total_size == 0 {
            return StreamDecodeResult::Error(
                CoreDecodeError::ZeroField {
                    field: "total_size",
                }
                .to_string(),
            );
        }
        let packet_size = match read_u16_be(data, 25..27, "packet_size") {
            Ok(value) => value,
            Err(err) => return StreamDecodeResult::Error(err.to_string()),
        };
        if packet_size == 0 {
            return StreamDecodeResult::Error(
                CoreDecodeError::ZeroField {
                    field: "packet_size",
                }
                .to_string(),
            );
        }
        let exact_packets_total = if has_exact_chunk_total {
            match read_u32_be(data, 27..31, "exact_packets_total") {
                Ok(value) => Some(value),
                Err(err) => return StreamDecodeResult::Error(err.to_string()),
            }
        } else {
            None
        };
        let symbol_offset = if has_exact_chunk_total { 31 } else { 27 };
        let payload_offset = if has_exact_chunk_total { 35 } else { 31 };
        let symbol_id_bytes =
            match read_u32_bytes(data, symbol_offset..symbol_offset + 4, "symbol_id") {
                Ok(value) => value,
                Err(err) => return StreamDecodeResult::Error(err.to_string()),
            };
        let symbol_id = u32::from_be_bytes(symbol_id_bytes);
        let payload = &data[payload_offset..];

        // Auto-reset if new session detected
        if let Some(current_session) = self.session_id {
            if current_session != session_id {
                self.reset();
            }
        }

        // Initialize session
        if self.session_id.is_none() {
            self.session_id = Some(session_id);
            self.total_chunks = total_chunks;
            #[cfg(not(target_arch = "wasm32"))]
            {
                self.start_time = Some(Instant::now());
            }
        }

        // Get or create chunk decoder
        self.chunk_decoders.entry(chunk_id).or_insert_with(|| {
            let config =
                ObjectTransmissionInformation::with_defaults(total_size as u64, packet_size);

            ChunkDecoder {
                decoder: Decoder::new(config),
                total_size,
                packet_size,
                exact_packets_total,
                packets_received: 0,
                seen_packets: HashSet::new(),
            }
        });

        // Process packet
        // Process packet and capture logic
        let (
            decode_result,
            packets_received_chunk,
            packets_expected_chunk,
            chunk_percent,
            _total_size,
            _packet_size,
        ) = {
            let Some(chunk_decoder) = self.chunk_decoders.get_mut(&chunk_id) else {
                return StreamDecodeResult::Error(
                    CoreDecodeError::InternalDecoderStateMissing { chunk_id }.to_string(),
                );
            };
            if chunk_decoder.exact_packets_total.is_none() && exact_packets_total.is_some() {
                chunk_decoder.exact_packets_total = exact_packets_total;
            }

            // Track unique packets
            if !chunk_decoder.seen_packets.contains(&symbol_id) {
                chunk_decoder.seen_packets.insert(symbol_id);
                chunk_decoder.packets_received += 1;
            }

            let payload_id = PayloadId::deserialize(&symbol_id_bytes);
            let packet = EncodingPacket::new(payload_id, payload.to_vec());

            let result = chunk_decoder.decoder.decode(packet);

            // Calculate chunk stats
            let expected_packets =
                (chunk_decoder.total_size as f32 / chunk_decoder.packet_size as f32).ceil();

            #[cfg(target_os = "android")]
            log::info!(
                "RustCore: Chunk {} packet +1. Total: {}/{}. SymbolID: {}",
                chunk_id,
                chunk_decoder.packets_received,
                expected_packets,
                symbol_id
            );

            let mut chunk_percent =
                (chunk_decoder.packets_received as f32 / expected_packets) * 100.0;
            if chunk_percent >= 100.0 {
                chunk_percent = 99.9;
            }

            (
                result,
                chunk_decoder.packets_received,
                expected_packets as u32,
                chunk_percent,
                chunk_decoder.total_size,
                chunk_decoder.packet_size,
            )
        };

        // Calculate global stats (now safe)
        let packets_received_total: u32 = self
            .chunk_decoders
            .values()
            .map(|d| d.packets_received)
            .sum();

        match decode_result {
            Some(result) => {
                // Chunk completed! Decompress and store
                if result.is_empty() {
                    return StreamDecodeResult::Error(
                        CoreDecodeError::DecodedPayloadTooShort.to_string(),
                    );
                }

                let compression_flag = result[0];
                let compressed_data = &result[1..];

                // 0 = no compression, 1 = zstd, 2 = deflate
                const MAX_DECOMPRESSED_SIZE: usize = 256 * 1024 * 1024; // 256 MB

                let decompression_result: std::io::Result<Vec<u8>> = match compression_flag {
                    0 => Ok(compressed_data.to_vec()),
                    1 => {
                        #[cfg(all(feature = "zstd", not(target_arch = "wasm32")))]
                        {
                            use std::io::Read;
                            (|| -> std::io::Result<Vec<u8>> {
                                let mut decoder = zstd::Decoder::new(compressed_data)?;
                                let mut decompressed = Vec::new();
                                decoder
                                    .by_ref()
                                    .take(MAX_DECOMPRESSED_SIZE as u64 + 1)
                                    .read_to_end(&mut decompressed)?;
                                if decompressed.len() > MAX_DECOMPRESSED_SIZE {
                                    Err(std::io::Error::other(
                                        "Decompressed data exceeds size limit",
                                    ))
                                } else {
                                    Ok(decompressed)
                                }
                            })()
                        }
                        #[cfg(any(not(feature = "zstd"), target_arch = "wasm32"))]
                        {
                            Err(std::io::Error::new(
                                std::io::ErrorKind::Unsupported,
                                "Compression flag 1 (zstd) set but zstd feature not enabled or WASM target"
                            ))
                        }
                    }
                    2 => {
                        use flate2::read::DeflateDecoder;
                        use std::io::Read;
                        let mut decoder = DeflateDecoder::new(compressed_data);
                        let mut decompressed = Vec::new();
                        match decoder
                            .by_ref()
                            .take(MAX_DECOMPRESSED_SIZE as u64 + 1)
                            .read_to_end(&mut decompressed)
                        {
                            Ok(_) if decompressed.len() > MAX_DECOMPRESSED_SIZE => Err(
                                std::io::Error::other("Decompressed data exceeds size limit"),
                            ),
                            Ok(_) => Ok(decompressed),
                            Err(e) => Err(e),
                        }
                    }
                    _ => Err(std::io::Error::new(
                        std::io::ErrorKind::Unsupported,
                        format!("Unknown compression flag: {}", compression_flag),
                    )),
                };

                match decompression_result {
                    Ok(decompressed) => {
                        // Parse metadata: [FilenameLen(4b)][Filename][ChunkData]
                        if decompressed.len() < 4 {
                            return StreamDecodeResult::Error(
                                CoreDecodeError::PayloadTooShortForMetadata.to_string(),
                            );
                        }

                        let name_len =
                            match read_u32_be(&decompressed, 0..4, "metadata filename length") {
                                Ok(value) => value as usize,
                                Err(err) => return StreamDecodeResult::Error(err.to_string()),
                            };
                        if name_len > 1024 {
                            return StreamDecodeResult::Error(
                                CoreDecodeError::FilenameTooLong.to_string(),
                            );
                        }
                        let total_header = match 4usize.checked_add(name_len) {
                            Some(v) => v,
                            None => {
                                return StreamDecodeResult::Error(
                                    CoreDecodeError::InvalidMetadataLength.to_string(),
                                )
                            }
                        };
                        if decompressed.len() < total_header {
                            return StreamDecodeResult::Error(
                                CoreDecodeError::PayloadTooShortForFilename.to_string(),
                            );
                        }

                        let filename_bytes = &decompressed[4..total_header];
                        let filename = String::from_utf8_lossy(filename_bytes).to_string();
                        let chunk_data = decompressed[total_header..].to_vec();

                        // Store filename (from any chunk, they should all match)
                        if self.filename.is_none() {
                            self.filename = Some(filename);
                        }

                        // Store chunk data
                        self.temp_chunks.insert(chunk_id, chunk_data);
                        self.completed_chunks.insert(chunk_id);

                        // Check if all chunks are complete
                        if self.completed_chunks.len() == self.total_chunks as usize {
                            // Reassemble all chunks
                            let mut final_data = Vec::new();
                            for i in 0..self.total_chunks {
                                if let Some(chunk_data) = self.temp_chunks.get(&i) {
                                    final_data.extend_from_slice(chunk_data);
                                } else {
                                    return StreamDecodeResult::Error(
                                        CoreDecodeError::MissingChunk { chunk_id: i }.to_string(),
                                    );
                                }
                            }

                            let duration = match self.start_time {
                                Some(start) => start.elapsed(),
                                None => Duration::default(),
                            };

                            StreamDecodeResult::AllCompleted {
                                session_id,
                                filename: self
                                    .filename
                                    .clone()
                                    .unwrap_or_else(|| "unknown.bin".to_string()),
                                data: final_data,
                                duration,
                                total_packets: packets_received_total,
                            }
                        } else {
                            // Chunk completed but more to go
                            let chunks_completed = self.completed_chunks.len() as u32;
                            let overall_percent =
                                (chunks_completed as f32 / self.total_chunks as f32) * 100.0;

                            StreamDecodeResult::ChunkCompleted {
                                session_id,
                                chunk_id,
                                total_chunks: self.total_chunks,
                                chunks_completed,
                                overall_percent,
                                chunk_data: match self.temp_chunks.get(&chunk_id) {
                                    Some(d) => d.clone(),
                                    None => Vec::new(),
                                },
                                filename: self.filename.clone(),
                                packets_received_chunk,
                                packets_expected_chunk,
                                packets_total_chunk: self
                                    .chunk_decoders
                                    .get(&chunk_id)
                                    .and_then(|decoder| decoder.exact_packets_total),
                                packets_received_total,
                            }
                        }
                    }
                    Err(e) => StreamDecodeResult::Error(
                        CoreDecodeError::DecompressionFailed {
                            message: e.to_string(),
                        }
                        .to_string(),
                    ),
                }
            }
            None => {
                // Still decoding chunk

                // Calculate overall progress
                let chunks_completed = self.completed_chunks.len() as u32;
                let current_chunk_contribution = chunk_percent / 100.0;
                let overall_percent = ((chunks_completed as f32 + current_chunk_contribution)
                    / self.total_chunks as f32)
                    * 100.0;

                StreamDecodeResult::Progress {
                    session_id,
                    chunk_id,
                    total_chunks: self.total_chunks,
                    chunk_percent,
                    overall_percent,
                    chunks_completed,
                    filename: self.filename.clone(),
                    packets_received_chunk,
                    packets_expected_chunk,
                    packets_total_chunk: self
                        .chunk_decoders
                        .get(&chunk_id)
                        .and_then(|decoder| decoder.exact_packets_total),
                    packets_received_total,
                }
            }
        }
    }

    pub fn reset(&mut self) {
        self.session_id = None;
        self.total_chunks = 0;
        self.chunk_decoders.clear();
        self.completed_chunks.clear();
        self.filename = None;
        self.file_size = 0;
        self.temp_chunks.clear();
        self.start_time = None;
    }
}

impl Default for StreamingDecoder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use raptorq::{Encoder, ObjectTransmissionInformation};

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn test_streaming_encoder_session_id_uses_entropy_bytes() {
        let session_id = StreamingEncoder::generate_session_id_with_entropy(|bytes| {
            bytes.copy_from_slice(&[0x12, 0x34, 0x56, 0x78]);
            Ok(())
        })
        .expect("session id should be generated");

        assert_eq!(session_id, 0x1234_5678);
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn test_streaming_encoder_session_id_propagates_entropy_failure() {
        let result = StreamingEncoder::generate_session_id_with_entropy(|_| {
            anyhow::bail!("entropy source unavailable")
        });

        assert!(result.is_err());
    }

    #[test]
    fn test_streaming_decoder_panic() {
        let chunk0_data = vec![0u8; 100];
        let chunk1_data = vec![1u8; 100];
        let packet_size = 250u16;

        let make_packets = |data: &Vec<u8>, chunk_id: u32, total_chunks: u32| -> Vec<Vec<u8>> {
            // Prepend metadata matching wasm.rs logic
            let mut payload = Vec::new();
            let filename = "test.txt";
            let name_bytes = filename.as_bytes();
            payload.extend_from_slice(&(name_bytes.len() as u32).to_be_bytes());
            payload.extend_from_slice(name_bytes);
            payload.extend_from_slice(data);

            let mut compressed = Vec::new();
            compressed.push(0u8); // Compression flag 0
            compressed.extend_from_slice(&payload);

            let total_size = compressed.len() as u32;

            let config =
                ObjectTransmissionInformation::with_defaults(total_size as u64, packet_size);
            let encoder = Encoder::new(&compressed, config);
            let source_packets = encoder.get_encoded_packets(10);

            source_packets
                .into_iter()
                .map(|packet| {
                    let mut qr_data = Vec::with_capacity(31 + packet.data().len());
                    qr_data.push(1u8); // mode
                    qr_data.extend_from_slice(&12345u32.to_be_bytes()); // session_id
                    qr_data.extend_from_slice(&chunk_id.to_be_bytes()); // chunk_id
                    qr_data.extend_from_slice(&total_chunks.to_be_bytes()); // total_chunks
                    qr_data.extend_from_slice(&0u64.to_be_bytes()); // chunk_offset (dummy)
                    qr_data.extend_from_slice(&total_size.to_be_bytes()); // total_size matches ENCODED data size
                    qr_data.extend_from_slice(&packet_size.to_be_bytes()); // packet_size
                    qr_data.extend_from_slice(&packet.payload_id().serialize()); // payload_id
                    qr_data.extend_from_slice(packet.data());
                    qr_data
                })
                .collect()
        };

        let chunk0_packets = make_packets(&chunk0_data, 0, 2);
        let chunk1_packets = make_packets(&chunk1_data, 1, 2);

        println!("Chunk 0 packets: {}", chunk0_packets.len());
        println!("Chunk 1 packets: {}", chunk1_packets.len());

        let mut decoder = StreamingDecoder::new();

        // Decode Chunk 1
        println!("Decoding Chunk 1...");
        for pkt in chunk1_packets {
            let result = decoder.add_packet(&pkt);
            match result {
                StreamDecodeResult::ChunkCompleted { chunk_id, .. } => {
                    println!("Chunk {} Completed", chunk_id)
                }
                StreamDecodeResult::Error(e) => panic!("Decoder error on Chunk 1: {}", e),
                _ => {}
            }
        }

        // Decode Chunk 0
        println!("Decoding Chunk 0...");
        let mut all_completed = false;
        for pkt in chunk0_packets {
            let result = decoder.add_packet(&pkt);
            match result {
                StreamDecodeResult::ChunkCompleted { chunk_id, .. } => {
                    println!("Chunk {} Completed", chunk_id)
                }
                StreamDecodeResult::AllCompleted { .. } => {
                    println!("All Completed");
                    all_completed = true;
                }
                StreamDecodeResult::Error(e) => panic!("Decoder error on Chunk 0: {}", e),
                _ => {}
            }
        }

        assert!(all_completed, "Should be all completed");
    }
}
