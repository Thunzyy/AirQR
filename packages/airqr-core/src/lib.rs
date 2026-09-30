#[cfg(not(feature = "wasm"))]
use anyhow::Result;
#[cfg(not(feature = "wasm"))]
use gif::{Encoder as Gif1bitEncoder, Frame as Gif1bitFrame, Repeat};
#[cfg(not(feature = "wasm"))]
use image::codecs::gif::GifEncoder;
#[cfg(not(feature = "wasm"))]
use image::{Delay, Frame, Rgba, RgbaImage};
#[cfg(not(feature = "wasm"))]
use qrcodegen::QrCode;
use qrcodegen::QrCodeEcc;
#[cfg(not(feature = "wasm"))]
use raptorq::Encoder;
use raptorq::{Decoder, EncodingPacket, ObjectTransmissionInformation};
#[cfg(not(feature = "wasm"))]
use rayon::prelude::*;
#[cfg(not(feature = "wasm"))]
use std::fs::File;
#[cfg(not(feature = "wasm"))]
use std::io::Read;
use std::ops::Range;
use std::time::{Duration, Instant};

#[cfg(target_os = "android")]
use android_logger::Config;
#[cfg(target_os = "android")]
use log::LevelFilter;

#[cfg(feature = "flutter_rust_bridge")]
pub mod api;

pub fn init_logger() {
    #[cfg(target_os = "android")]
    android_logger::init_once(
        Config::default()
            .with_max_level(LevelFilter::Debug)
            .with_tag("RustCore"),
    );
}

#[cfg(feature = "wasm")]
pub mod wasm;

pub mod streaming;

#[cfg(not(target_arch = "wasm32"))]
pub mod webp;

#[cfg(not(target_arch = "wasm32"))]
pub mod svg;

#[cfg(not(target_arch = "wasm32"))]
pub mod mp4;

#[cfg(not(target_arch = "wasm32"))]
pub mod binary;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CoreDecodeError {
    #[error("Packet too short for {field}")]
    PacketTooShort { field: &'static str },
    #[error("Packet too short (len={len}), expected {expected}+")]
    PacketTooShortWithLength { len: usize, expected: usize },
    #[error("Data SUPER short")]
    DataTooShort,
    #[error("Not a streaming mode packet")]
    NotStreamingModePacket,
    #[error("Invalid packet: {field} is 0")]
    ZeroField { field: &'static str },
    #[error("Invalid packet: chunk_id {chunk_id} out of range for total_chunks {total_chunks}")]
    ChunkIdOutOfRange { chunk_id: u32, total_chunks: u32 },
    #[error("Payload size mismatch. Expected {expected}, got {actual}")]
    PayloadSizeMismatch { expected: u16, actual: usize },
    #[error("Decoded payload too short")]
    DecodedPayloadTooShort,
    #[error("Payload too short for metadata")]
    PayloadTooShortForMetadata,
    #[error("Filename too long")]
    FilenameTooLong,
    #[error("Invalid metadata length")]
    InvalidMetadataLength,
    #[error("Payload too short for filename")]
    PayloadTooShortForFilename,
    #[error("Internal decoder state missing for chunk {chunk_id}")]
    InternalDecoderStateMissing { chunk_id: u32 },
    #[error("Missing chunk {chunk_id}")]
    MissingChunk { chunk_id: u32 },
    #[error("Decompression failed: {message}")]
    DecompressionFailed { message: String },
    #[error("Decoder initialization failed")]
    DecoderInitializationFailed,
}

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

#[derive(Clone, Debug)]
pub struct EncoderConfig {
    pub qr_version_min: i16,
    pub qr_version_max: i16,
    pub ecc: QrCodeEcc,
    pub frame_delay_ms: u64,
    pub packet_size: u16,
    pub compression_enabled: bool,
    pub raptorq_overhead: f32,
}

impl Default for EncoderConfig {
    fn default() -> Self {
        Self {
            qr_version_min: 1,
            qr_version_max: 40,
            ecc: QrCodeEcc::Medium,
            frame_delay_ms: 100,
            packet_size: 250,          // Smaller packets for more readable QR codes
            compression_enabled: true, // Enable compression by default
            raptorq_overhead: 1.5,     // 50% overhead by default
        }
    }
}

pub enum EncodeProgress {
    Starting,
    Reading,
    Archiving,
    Compressing {
        current: usize,
        total: usize,
    },
    InitializingRaptorQ,
    GeneratingPackets {
        current: usize,
        total: usize,
    },
    RenderingFrames {
        current: usize,
        total: usize,
    },
    EncodingGif {
        current: usize,
        total: usize,
    },
    Info(String),
    QrPreview(String),
    QrFrame {
        current: usize,
        total: usize,
        frame: String,
    },
    Done,
}

#[cfg(not(feature = "wasm"))]
pub struct AirqrEncoder {
    config: EncoderConfig,
}

#[cfg(not(feature = "wasm"))]
impl AirqrEncoder {
    pub fn new(config: EncoderConfig) -> Self {
        Self { config }
    }

    #[cfg(not(feature = "wasm"))]
    pub fn encode_file(&self, path: &str) -> Result<Vec<u8>> {
        self.encode_file_with_progress(path, |_| {})
    }

    #[cfg(not(feature = "wasm"))]
    pub fn encode_file_with_progress<F>(&self, path: &str, progress_cb: F) -> Result<Vec<u8>>
    where
        F: FnMut(EncodeProgress),
    {
        self.encode_file_with_progress_internal(path, false, false, 1, progress_cb)
    }

    #[cfg(not(feature = "wasm"))]
    pub fn encode_file_with_progress_and_preview<F>(
        &self,
        path: &str,
        show_qr_preview: bool,
        progress_cb: F,
    ) -> Result<Vec<u8>>
    where
        F: FnMut(EncodeProgress),
    {
        self.encode_file_with_progress_internal(path, show_qr_preview, false, 1, progress_cb)
    }

    #[cfg(not(feature = "wasm"))]
    pub fn encode_file_with_progress_and_terminal_frames<F>(
        &self,
        path: &str,
        show_qr_preview: bool,
        collect_terminal_frames: bool,
        terminal_scale: u8,
        progress_cb: F,
    ) -> Result<Vec<u8>>
    where
        F: FnMut(EncodeProgress),
    {
        self.encode_file_with_progress_internal(
            path,
            show_qr_preview,
            collect_terminal_frames,
            terminal_scale,
            progress_cb,
        )
    }

    #[cfg(not(feature = "wasm"))]
    fn encode_file_with_progress_internal<F>(
        &self,
        path: &str,
        show_qr_preview: bool,
        collect_terminal_frames: bool,
        terminal_scale: u8,
        mut progress_cb: F,
    ) -> Result<Vec<u8>>
    where
        F: FnMut(EncodeProgress),
    {
        progress_cb(EncodeProgress::Starting);

        // 1. Read file or directory
        let path_obj = std::path::Path::new(path);
        let (file_data, filename_str) = if path_obj.is_dir() {
            #[cfg(feature = "zip")]
            {
                progress_cb(EncodeProgress::Archiving);
                use std::path::Path;
                use zip::write::{SimpleFileOptions, ZipWriter};

                // It's a directory, create a ZIP archive
                let mut zip_buffer = Vec::new();
                let mut zip = ZipWriter::new(std::io::Cursor::new(&mut zip_buffer));

                // Choose compression method based on config
                let compression_method = if self.config.compression_enabled {
                    zip::CompressionMethod::Deflated
                } else {
                    zip::CompressionMethod::Stored // No compression, just archive
                };

                let options = SimpleFileOptions::default()
                    .compression_method(compression_method)
                    .compression_level(if self.config.compression_enabled {
                        Some(6)
                    } else {
                        None
                    });

                // Walk the directory and add all files
                fn add_directory_to_zip(
                    zip: &mut ZipWriter<std::io::Cursor<&mut Vec<u8>>>,
                    path: &Path,
                    prefix: &Path,
                    options: SimpleFileOptions,
                ) -> anyhow::Result<()> {
                    for entry in std::fs::read_dir(path)? {
                        let entry = entry?;
                        let entry_path = entry.path();
                        let relative_path = entry_path.strip_prefix(prefix)?;

                        if entry_path.is_dir() {
                            zip.add_directory(
                                relative_path.to_string_lossy().into_owned() + "/",
                                options,
                            )?;
                            add_directory_to_zip(zip, &entry_path, prefix, options)?;
                        } else {
                            zip.start_file(relative_path.to_string_lossy().into_owned(), options)?;
                            let mut file = File::open(&entry_path)?;
                            std::io::copy(&mut file, zip)?;
                        }
                    }
                    Ok(())
                }

                add_directory_to_zip(&mut zip, path_obj, path_obj, options)?;
                zip.finish()?;

                let dir_name = path_obj
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("archive");
                (zip_buffer, format!("{}.zip", dir_name))
            }
            #[cfg(not(feature = "zip"))]
            {
                return Err(anyhow::anyhow!("Directory support requires 'zip' feature"));
            }
        } else {
            progress_cb(EncodeProgress::Reading);
            // It's a file
            let mut file = File::open(path)?;
            let mut data = Vec::new();
            file.read_to_end(&mut data)?;

            let name = path_obj
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.bin")
                .to_string();
            (data, name)
        };

        // 2. Prepare Payload WITHOUT compression flag: [NameLen(4b)][NameBytes][FileData]
        let filename_bytes = filename_str.as_bytes();
        let filename_len = filename_bytes.len() as u32;

        let mut payload = Vec::with_capacity(4 + filename_bytes.len() + file_data.len());
        payload.extend_from_slice(&filename_len.to_be_bytes());
        payload.extend_from_slice(filename_bytes);
        payload.extend_from_slice(&file_data);

        // 3. Compress and prepend flag: [CompressionFlag:1][CompressedData]
        // Terminal playback/preview must stay web-compatible: prefer deflate (flag 2).
        let terminal_mode = show_qr_preview || collect_terminal_frames;
        let (compressed_data, compression_flag) = if self.config.compression_enabled {
            use std::io::Write;
            let total_bytes = payload.len();
            let chunk_size = 1024 * 1024; // 1MB chunks

            if terminal_mode {
                use flate2::{write::DeflateEncoder, Compression};
                if total_bytes > 1024 {
                    let mut output = Vec::new();
                    let mut encoder = DeflateEncoder::new(&mut output, Compression::new(6));

                    for (i, chunk) in payload.chunks(chunk_size).enumerate() {
                        encoder.write_all(chunk)?;
                        let current = std::cmp::min((i + 1) * chunk_size, total_bytes);
                        progress_cb(EncodeProgress::Compressing {
                            current,
                            total: total_bytes,
                        });
                    }

                    encoder.finish()?;

                    // Match web behavior: keep deflate only if gain is >= 10%.
                    if output.len() * 10 < total_bytes * 9 {
                        (output, 2u8) // 2 = deflate (supported by wasm/web decoder)
                    } else {
                        (payload, 0u8)
                    }
                } else {
                    (payload, 0u8)
                }
            } else {
                #[cfg(feature = "zstd")]
                {
                    let mut output = Vec::new();
                    let mut encoder = zstd::stream::write::Encoder::new(&mut output, 3)?;

                    for (i, chunk) in payload.chunks(chunk_size).enumerate() {
                        encoder.write_all(chunk)?;
                        let current = std::cmp::min((i + 1) * chunk_size, total_bytes);
                        progress_cb(EncodeProgress::Compressing {
                            current,
                            total: total_bytes,
                        });
                    }

                    encoder.finish()?;
                    (output, 1u8) // 1 = zstd compression
                }
                #[cfg(not(feature = "zstd"))]
                {
                    // Fallback if zstd is not enabled but compression was requested
                    (payload, 0u8)
                }
            }
        } else {
            (payload, 0u8) // 0 = no compression (user choice)
        };

        let mut compressed = Vec::with_capacity(1 + compressed_data.len());
        compressed.push(compression_flag);
        compressed.extend_from_slice(&compressed_data);

        // Dynamic Packet Size Adjustment
        // RaptorQ works best when number of symbols is reasonable.
        // Default packet size 250 is good for small files, but for large files it creates too many symbols.
        // We'll increase packet size for larger files, up to a safe limit for QR codes.
        let mut packet_size = self.config.packet_size;
        let data_len = compressed.len();

        // Check for Debug mode and warn
        #[cfg(debug_assertions)]
        {
            if data_len > 500_000 {
                // Warn for > 500KB in debug
                progress_cb(EncodeProgress::Info(
                    "⚠️  WARNING: Running in DEBUG mode. Large file encoding will be VERY SLOW."
                        .to_string(),
                ));
                progress_cb(EncodeProgress::Info(
                    "👉  Recommendation: Run with `cargo run --release --example encode ...`"
                        .to_string(),
                ));
            }
        }

        // Match web behavior: dynamic bump only from legacy default packet size (250).
        if data_len > 1_000_000 && packet_size == 250 {
            // > 1MB
            // Target roughly 2000 packets and clamp to web-compatible range.
            let target_packet_size = (data_len / 2000) as u16;
            packet_size = target_packet_size.clamp(250, 1500);

            progress_cb(EncodeProgress::Info(format!(
                "Large file detected ({:.2} MB). Increased packet size to {} bytes to optimize encoding.",
                data_len as f64 / 1024.0 / 1024.0,
                packet_size
            )));
        }

        // Keep symbol size aligned to 4 bytes for parity with the WASM/web path.
        let aligned_packet_size = (packet_size / 4).max(1) * 4;
        if aligned_packet_size != packet_size {
            progress_cb(EncodeProgress::Info(format!(
                "Adjusted packet size from {} to {} for web-compatible decoding.",
                packet_size, aligned_packet_size
            )));
            packet_size = aligned_packet_size;
        }

        // 4. RaptorQ Encoding
        progress_cb(EncodeProgress::InitializingRaptorQ);
        let encoder = Encoder::with_defaults(&compressed, packet_size);

        // Generate packets.
        let packets_to_generate = (compressed.len() as f64 / packet_size as f64
            * self.config.raptorq_overhead as f64)
            .ceil() as u32;
        let packets_to_generate = packets_to_generate.max(10); // Min 10 frames

        // We iterate through packets. RaptorQ `get_encoded_packets` returns source packets then repair packets.
        progress_cb(EncodeProgress::GeneratingPackets {
            current: 0,
            total: packets_to_generate as usize,
        });
        let packets: Vec<EncodingPacket> = encoder.get_encoded_packets(packets_to_generate);
        progress_cb(EncodeProgress::GeneratingPackets {
            current: packets_to_generate as usize,
            total: packets_to_generate as usize,
        });

        let total_frames = packets.len();

        if show_qr_preview {
            if let Some(packet) = packets.first() {
                let payload = packet.data();
                let total_size = compressed.len() as u32;
                let actual_payload_size = payload.len() as u16;

                let mut qr_data = Vec::with_capacity(10 + payload.len());
                qr_data.extend_from_slice(&total_size.to_be_bytes());
                qr_data.extend_from_slice(&actual_payload_size.to_be_bytes());
                qr_data.extend_from_slice(&packet.payload_id().serialize());
                qr_data.extend_from_slice(payload);

                match QrCode::encode_binary(&qr_data, self.config.ecc) {
                    Ok(qr) => {
                        let preview = Self::render_qr_terminal(&qr, 0, terminal_scale);
                        progress_cb(EncodeProgress::QrPreview(preview));
                    }
                    Err(err) => {
                        progress_cb(EncodeProgress::Info(format!(
                            "Failed to generate terminal QR preview: {}",
                            err
                        )));
                    }
                }
            }
        }

        // Parallel rendering with progress reporting
        let (tx, rx) = std::sync::mpsc::channel();

        // We use scoped threads to allow the worker thread to borrow `self` and `packets`
        // and to allow the main thread to report progress via the callback.
        let frames_with_terminal: Vec<(Frame, Option<String>)> =
            std::thread::scope(|s| -> Result<Vec<_>> {
                let handle = s.spawn(|| {
                    packets
                        .par_iter()
                        .map_with(tx, |tx, packet| {
                            let payload = packet.data();
                            // packet is &EncodingPacket

                            // Header: TotalSize(4b) | PacketSize(2b) | SymbolID(4b) | Data(...)
                            let total_size = compressed.len() as u32;
                            let actual_payload_size = payload.len() as u16;

                            let mut qr_data = Vec::with_capacity(10 + payload.len());
                            qr_data.extend_from_slice(&total_size.to_be_bytes());
                            qr_data.extend_from_slice(&actual_payload_size.to_be_bytes());
                            qr_data.extend_from_slice(&packet.payload_id().serialize());
                            qr_data.extend_from_slice(payload);

                            // Encode to QR
                            let qr = QrCode::encode_binary(&qr_data, self.config.ecc)
                                .map_err(|e| anyhow::anyhow!("Failed to encode QR: {}", e))?;

                            let terminal_frame = if collect_terminal_frames {
                                Some(Self::render_qr_terminal(&qr, 0, terminal_scale))
                            } else {
                                None
                            };

                            // Render to Image
                            let img = self.render_qr(&qr)?;
                            let frame = Frame::from_parts(
                                img,
                                0,
                                0,
                                Delay::from_saturating_duration(Duration::from_millis(
                                    self.config.frame_delay_ms,
                                )),
                            );

                            let _ = tx.send(()); // Notify progress
                            Ok((frame, terminal_frame))
                        })
                        .collect::<Result<Vec<_>>>()
                });

                // Monitor progress in main thread
                let mut count = 0;
                while count < total_frames {
                    if rx.recv().is_ok() {
                        count += 1;
                        progress_cb(EncodeProgress::RenderingFrames {
                            current: count,
                            total: total_frames,
                        });
                    } else {
                        break;
                    }
                }

                handle
                    .join()
                    .map_err(|_| anyhow::anyhow!("QR rendering thread panicked"))?
            })?;

        let mut frames = Vec::with_capacity(frames_with_terminal.len());
        if collect_terminal_frames {
            let total_terminal_frames = frames_with_terminal.len();
            for (i, (frame, terminal_frame)) in frames_with_terminal.into_iter().enumerate() {
                if let Some(frame_text) = terminal_frame {
                    progress_cb(EncodeProgress::QrFrame {
                        current: i + 1,
                        total: total_terminal_frames,
                        frame: frame_text,
                    });
                }
                frames.push(frame);
            }
        } else {
            for (frame, _) in frames_with_terminal {
                frames.push(frame);
            }
        }

        // 5. Create GIF
        let mut gif_out = Vec::new();
        {
            let mut encoder = GifEncoder::new(&mut gif_out);
            encoder.set_repeat(image::codecs::gif::Repeat::Infinite)?;

            let total_frames = frames.len();
            let frames_iter = frames.into_iter().enumerate().map(|(i, frame)| {
                progress_cb(EncodeProgress::EncodingGif {
                    current: i + 1,
                    total: total_frames,
                });
                frame
            });

            encoder.encode_frames(frames_iter)?;
        }

        progress_cb(EncodeProgress::Done);
        Ok(gif_out)
    }

    #[cfg(not(feature = "wasm"))]
    pub fn encode_bytes_with_progress<F>(
        &self,
        filename: &str,
        data: &[u8],
        mut progress_cb: F,
    ) -> Result<Vec<u8>>
    where
        F: FnMut(EncodeProgress),
    {
        progress_cb(EncodeProgress::Starting);

        // Prepare Payload: [NameLen(4b)][NameBytes][FileData]
        let filename_bytes = filename.as_bytes();
        let filename_len = filename_bytes.len() as u32;

        let mut payload = Vec::with_capacity(4 + filename_bytes.len() + data.len());
        payload.extend_from_slice(&filename_len.to_be_bytes());
        payload.extend_from_slice(filename_bytes);
        payload.extend_from_slice(data);

        // Compress if enabled
        let (compressed_data, compression_flag) = if self.config.compression_enabled {
            #[cfg(feature = "zstd")]
            {
                use std::io::Write;
                let mut output = Vec::new();
                let mut encoder = zstd::stream::write::Encoder::new(&mut output, 3)?;

                let total_bytes = payload.len();
                let chunk_size = 1024 * 1024;

                for (i, chunk) in payload.chunks(chunk_size).enumerate() {
                    encoder.write_all(chunk)?;
                    let current = std::cmp::min((i + 1) * chunk_size, total_bytes);
                    progress_cb(EncodeProgress::Compressing {
                        current,
                        total: total_bytes,
                    });
                }

                encoder.finish()?;
                (output, 1u8)
            }
            #[cfg(not(feature = "zstd"))]
            {
                (payload, 0u8)
            }
        } else {
            (payload, 0u8)
        };

        let mut compressed = Vec::with_capacity(1 + compressed_data.len());
        compressed.push(compression_flag);
        compressed.extend_from_slice(&compressed_data);

        let packet_size = (self.config.packet_size / 4).max(1) * 4;

        // RaptorQ Encoding
        progress_cb(EncodeProgress::InitializingRaptorQ);
        let encoder = Encoder::with_defaults(&compressed, packet_size);

        let packets_to_generate = (compressed.len() as f64 / packet_size as f64
            * self.config.raptorq_overhead as f64)
            .ceil() as u32;
        let packets_to_generate = packets_to_generate.max(10);

        progress_cb(EncodeProgress::GeneratingPackets {
            current: 0,
            total: packets_to_generate as usize,
        });
        let packets: Vec<EncodingPacket> = encoder.get_encoded_packets(packets_to_generate);
        progress_cb(EncodeProgress::GeneratingPackets {
            current: packets_to_generate as usize,
            total: packets_to_generate as usize,
        });

        let total_frames = packets.len();
        let total_size = compressed.len() as u32;
        let ecc = self.config.ecc;
        let frame_delay_ms = self.config.frame_delay_ms;
        let (tx, rx) = std::sync::mpsc::channel();

        // Render QR codes to indexed buffers (1-bit per pixel)
        let indexed_frames: Vec<(Vec<u8>, u16)> = std::thread::scope(|s| -> Result<Vec<_>> {
            let handle = s.spawn(|| {
                packets
                    .par_iter()
                    .map_with(tx, |tx, packet| {
                        let payload = packet.data();

                        let mut qr_data = Vec::with_capacity(10 + payload.len());
                        qr_data.extend_from_slice(&total_size.to_be_bytes());
                        qr_data.extend_from_slice(&(payload.len() as u16).to_be_bytes());
                        qr_data.extend_from_slice(&packet.payload_id().serialize());
                        qr_data.extend_from_slice(payload);

                        let qr = QrCode::encode_binary(&qr_data, ecc)
                            .map_err(|e| anyhow::anyhow!("Failed to encode QR: {}", e))?;

                        let (buffer, size) = Self::render_qr_indexed(&qr, 177)?;

                        let _ = tx.send(());
                        Ok((buffer, size))
                    })
                    .collect::<Result<Vec<_>>>()
            });

            let mut count = 0;
            while count < total_frames {
                if rx.recv().is_ok() {
                    count += 1;
                    progress_cb(EncodeProgress::RenderingFrames {
                        current: count,
                        total: total_frames,
                    });
                } else {
                    break;
                }
            }

            handle
                .join()
                .map_err(|_| anyhow::anyhow!("QR rendering thread panicked"))?
        })?;

        // Create GIF with 2-color palette (White, Black) - 1-bit encoding
        let mut gif_out = Vec::new();
        {
            let first_size = indexed_frames.first().map(|(_, s)| *s).unwrap_or(177);
            let color_map = &[0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00]; // RGB: White, Black
            let mut encoder = Gif1bitEncoder::new(&mut gif_out, first_size, first_size, color_map)
                .map_err(|e| anyhow::anyhow!("Failed to create GIF encoder: {}", e))?;

            encoder
                .set_repeat(Repeat::Infinite)
                .map_err(|e| anyhow::anyhow!("Failed to set repeat: {}", e))?;

            let total_frames = indexed_frames.len();
            for (i, (buffer, size)) in indexed_frames.into_iter().enumerate() {
                progress_cb(EncodeProgress::EncodingGif {
                    current: i + 1,
                    total: total_frames,
                });

                let mut frame = Gif1bitFrame::from_indexed_pixels(size, size, buffer, None);
                frame.delay = (frame_delay_ms / 10) as u16; // GIF delay is in 10ms units

                encoder
                    .write_frame(&frame)
                    .map_err(|e| anyhow::anyhow!("Failed to write frame: {}", e))?;
            }
        }

        progress_cb(EncodeProgress::Done);
        Ok(gif_out)
    }

    #[cfg(not(feature = "wasm"))]
    fn render_qr_indexed(qr: &QrCode, target_size: u32) -> Result<(Vec<u8>, u16)> {
        let size = qr.size() as u32;
        let border = 4;

        let raw_size = size + border * 2;
        let scale = (target_size / raw_size).clamp(1, 16);
        let img_size = raw_size * scale;

        // Guard against image buffer overflow: img_size * img_size must not overflow u32.
        if img_size > 10000 {
            return Err(anyhow::anyhow!(
                "Image size too large: {}x{}",
                img_size,
                img_size
            ));
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

                    for py in 0..scale {
                        let row_offset = ((start_y + py) * img_size) as usize;
                        for px in 0..scale {
                            buffer[row_offset + (start_x + px) as usize] = 1;
                        }
                    }
                }
            }
        }

        Ok((buffer, img_size as u16))
    }

    #[cfg(not(feature = "wasm"))]
    fn render_qr_terminal(qr: &QrCode, quiet_zone: i32, scale: u8) -> String {
        let scale = scale.max(1) as usize;
        let size = qr.size();
        let start = -quiet_zone;
        let end = size + quiet_zone;
        let total_rows = (end - start) as usize * scale;
        let mut current_row = 0usize;
        let mut out = String::new();

        for y in start..end {
            for _ in 0..scale {
                for x in start..end {
                    let is_black = x >= 0 && y >= 0 && x < size && y < size && qr.get_module(x, y);
                    if is_black {
                        for _ in 0..scale {
                            out.push_str("██");
                        }
                    } else {
                        for _ in 0..scale {
                            out.push_str("  ");
                        }
                    }
                }
                current_row += 1;
                if current_row < total_rows {
                    out.push('\n');
                }
            }
        }

        out
    }

    #[cfg(not(target_arch = "wasm32"))]
    fn render_qr(&self, qr: &QrCode) -> Result<RgbaImage> {
        let size = qr.size() as u32;
        let border = 4;

        // Target 177x177 pixels (same as 1-bit encoder for fair comparison)
        let target_size = 177;
        let raw_size = size + border * 2;
        let scale = (target_size / raw_size).clamp(1, 16);

        let img_size = raw_size * scale;

        // Guard against image buffer overflow: img_size * img_size must not overflow u32.
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
                    for py in 0..scale {
                        for px in 0..scale {
                            img.put_pixel(start_x + px, start_y + py, Rgba([0, 0, 0, 255]));
                        }
                    }
                }
            }
        }
        Ok(img)
    }
}

pub enum DecodeResult {
    Progress {
        percent: f32,
        received: u32,
        expected: u32,
    }, // Changed to percentage as we don't know exact packet count needed
    Completed {
        filename: String,
        data: Vec<u8>,
        duration: Duration,
        total_packets: u32,
    },
    Error(String),
}

use std::collections::HashSet;

pub struct AirqrDecoder {
    decoder: Option<Decoder>,
    total_size: u32,
    packet_size: u16,
    packets_received: u32,
    seen_packets: HashSet<u32>,
    start_time: Option<Instant>,
}

impl Default for AirqrDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl AirqrDecoder {
    pub fn new() -> Self {
        Self {
            decoder: None,
            total_size: 0,
            packet_size: 0,
            packets_received: 0,
            seen_packets: HashSet::new(),
            start_time: None,
        }
    }

    pub fn add_chunk(&mut self, data: &[u8]) -> DecodeResult {
        // Header: TotalSize(4b) | PacketSize(2b) | SymbolID(4b) | Data(...)
        // Compression flag is in the payload, not header
        if data.len() < 10 {
            return DecodeResult::Error(CoreDecodeError::DataTooShort.to_string());
        }

        let total_size = match read_u32_be(data, 0..4, "total_size") {
            Ok(value) => value,
            Err(err) => return DecodeResult::Error(err.to_string()),
        };
        if total_size == 0 {
            return DecodeResult::Error(
                CoreDecodeError::ZeroField {
                    field: "total_size",
                }
                .to_string(),
            );
        }

        let packet_size = match read_u16_be(data, 4..6, "packet_size") {
            Ok(value) => value,
            Err(err) => return DecodeResult::Error(err.to_string()),
        };
        if packet_size == 0 {
            return DecodeResult::Error(
                CoreDecodeError::ZeroField {
                    field: "packet_size",
                }
                .to_string(),
            );
        }
        let symbol_id_bytes = match read_u32_bytes(data, 6..10, "symbol_id") {
            Ok(value) => value,
            Err(err) => return DecodeResult::Error(err.to_string()),
        };
        let symbol_id = u32::from_be_bytes(symbol_id_bytes);
        let payload = &data[10..];

        // Older GIFs wrote the requested maximum size in the header, but
        // RaptorQ aligns the actual symbol down (e.g. 1500 -> 1496 bytes).
        // Accept exactly that OTI size, never arbitrary truncated packets.
        let config = ObjectTransmissionInformation::with_defaults(total_size as u64, packet_size);
        let symbol_size = config.symbol_size();
        if payload.len() != symbol_size as usize {
            return DecodeResult::Error(
                CoreDecodeError::PayloadSizeMismatch {
                    expected: symbol_size,
                    actual: payload.len(),
                }
                .to_string(),
            );
        }

        // Auto-reset if stream parameters change (seamless transition between files)
        if self.decoder.is_some()
            && (self.total_size != total_size || self.packet_size != packet_size)
        {
            self.reset();
        }

        // Initialize decoder if needed
        if self.decoder.is_none() {
            self.total_size = total_size;
            self.packet_size = packet_size;
            self.packets_received = 0;
            self.seen_packets.clear();
            // self.start_time = Some(Instant::now()); // Disabled to prevent panics in some WASM envs

            // RaptorQ config
            self.decoder = Some(Decoder::new(config));
        }

        if let Some(decoder) = &mut self.decoder {
            // Check for duplicates
            if self.seen_packets.contains(&symbol_id) {
                // Duplicate packet, ignore for progress but maybe pass to decoder just in case?
                // RaptorQ decoder handles duplicates, but for progress tracking we skip incrementing.
                // We'll still pass it to decoder to be safe, but won't increment count.
            } else {
                self.seen_packets.insert(symbol_id);
                self.packets_received += 1;
            }

            let payload_id = raptorq::PayloadId::deserialize(&symbol_id_bytes);
            let packet = EncodingPacket::new(payload_id, payload.to_vec());

            // decode returns Option<Vec<u8>> if complete
            match decoder.decode(packet) {
                Some(result) => {
                    // Payload structure: [CompressionFlag:1][CompressedData]
                    if result.is_empty() {
                        return DecodeResult::Error(
                            CoreDecodeError::DecodedPayloadTooShort.to_string(),
                        );
                    }

                    let compression_flag = result[0];
                    let compressed_data = &result[1..];

                    // Decompress based on flag
                    // 0 = no compression, 1 = zstd, 2 = deflate
                    const MAX_DECOMPRESSED_SIZE: usize = 256 * 1024 * 1024; // 256 MB

                    let decompression_result: std::io::Result<Vec<u8>> = match compression_flag {
                        0 => Ok(compressed_data.to_vec()),
                        1 => {
                            #[cfg(feature = "zstd")]
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
                            #[cfg(not(feature = "zstd"))]
                            {
                                Err(std::io::Error::new(
                                    std::io::ErrorKind::Unsupported,
                                    "Compression flag 1 (zstd) set but zstd feature not enabled",
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
                            // Parse Payload: [NameLen(4b)][NameBytes][FileData]
                            if decompressed.len() < 4 {
                                return DecodeResult::Error(
                                    CoreDecodeError::PayloadTooShortForMetadata.to_string(),
                                );
                            }
                            let name_len = match read_u32_be(
                                &decompressed,
                                0..4,
                                "metadata filename length",
                            ) {
                                Ok(value) => value as usize,
                                Err(err) => return DecodeResult::Error(err.to_string()),
                            };
                            if name_len > 1024 {
                                return DecodeResult::Error(
                                    CoreDecodeError::FilenameTooLong.to_string(),
                                );
                            }
                            let total_header = match 4usize.checked_add(name_len) {
                                Some(v) => v,
                                None => {
                                    return DecodeResult::Error(
                                        CoreDecodeError::InvalidMetadataLength.to_string(),
                                    )
                                }
                            };
                            if decompressed.len() < total_header {
                                return DecodeResult::Error(
                                    CoreDecodeError::PayloadTooShortForFilename.to_string(),
                                );
                            }

                            let filename_bytes = &decompressed[4..total_header];
                            let filename = String::from_utf8_lossy(filename_bytes).to_string();
                            let file_data = decompressed[total_header..].to_vec();
                            let duration = Duration::from_secs(0); // self.start_time.unwrap_or_else(Instant::now).elapsed();

                            DecodeResult::Completed {
                                filename,
                                data: file_data,
                                duration,
                                total_packets: self.packets_received,
                            }
                        }
                        Err(e) => DecodeResult::Error(
                            CoreDecodeError::DecompressionFailed {
                                message: e.to_string(),
                            }
                            .to_string(),
                        ),
                    }
                }
                None => {
                    // Estimate progress
                    // We need roughly total_size / packet_size packets.
                    // RaptorQ usually needs slightly more (overhead), but for progress bar,
                    // raw count vs expected source packets is a good enough proxy.
                    let expected_packets =
                        (self.total_size as f32 / self.packet_size as f32).ceil();
                    let mut percent = (self.packets_received as f32 / expected_packets) * 100.0;

                    // Cap at 99.9% until it's actually done to avoid confusion
                    if percent >= 100.0 {
                        percent = 99.9;
                    }

                    DecodeResult::Progress {
                        percent,
                        received: self.packets_received,
                        expected: expected_packets as u32,
                    }
                }
            }
        } else {
            DecodeResult::Error(CoreDecodeError::DecoderInitializationFailed.to_string())
        }
    }

    pub fn reset(&mut self) {
        self.decoder = None;
        self.total_size = 0;
        self.packet_size = 0;
        self.packets_received = 0;
        self.seen_packets.clear();
        self.start_time = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================
    // EncoderConfig Tests
    // ============================================

    #[test]
    fn test_encoder_config_defaults() {
        let config = EncoderConfig::default();

        assert_eq!(config.qr_version_min, 1);
        assert_eq!(config.qr_version_max, 40);
        assert_eq!(config.frame_delay_ms, 100);
        assert_eq!(config.packet_size, 250);
        assert!(config.compression_enabled);
        assert!((config.raptorq_overhead - 1.5).abs() < 0.001);
    }

    #[test]
    fn test_encoder_config_custom() {
        let config = EncoderConfig {
            qr_version_min: 10,
            qr_version_max: 30,
            ecc: QrCodeEcc::High,
            frame_delay_ms: 50,
            packet_size: 768,
            compression_enabled: false,
            raptorq_overhead: 2.0,
        };

        assert_eq!(config.qr_version_min, 10);
        assert_eq!(config.qr_version_max, 30);
        assert_eq!(config.packet_size, 768);
        assert!(!config.compression_enabled);
    }

    // ============================================
    // AirqrDecoder Tests
    // ============================================

    #[test]
    fn test_decoder_new() {
        let decoder = AirqrDecoder::new();

        assert!(decoder.decoder.is_none());
        assert_eq!(decoder.total_size, 0);
        assert_eq!(decoder.packet_size, 0);
        assert_eq!(decoder.packets_received, 0);
        assert!(decoder.seen_packets.is_empty());
    }

    #[test]
    fn test_decoder_reset() {
        let mut decoder = AirqrDecoder::new();

        // Simulate some state
        decoder.total_size = 1000;
        decoder.packet_size = 250;
        decoder.packets_received = 5;
        decoder.seen_packets.insert(1);
        decoder.seen_packets.insert(2);

        decoder.reset();

        assert!(decoder.decoder.is_none());
        assert_eq!(decoder.total_size, 0);
        assert_eq!(decoder.packet_size, 0);
        assert_eq!(decoder.packets_received, 0);
        assert!(decoder.seen_packets.is_empty());
    }

    #[test]
    fn test_decoder_data_too_short() {
        let mut decoder = AirqrDecoder::new();

        // Less than 10 bytes header
        let short_data = vec![0u8; 5];
        let result = decoder.add_chunk(&short_data);

        match result {
            DecodeResult::Error(msg) => {
                assert!(
                    msg.contains("short"),
                    "Error should mention data being short"
                );
            }
            _ => panic!("Expected Error for short data"),
        }
    }

    #[test]
    fn test_decoder_payload_size_mismatch() {
        let mut decoder = AirqrDecoder::new();

        // Create header claiming packet_size=100 but provide only 50 bytes payload
        let total_size: u32 = 1000;
        let packet_size: u16 = 100;
        let symbol_id: u32 = 0;

        let mut data = Vec::new();
        data.extend_from_slice(&total_size.to_be_bytes()); // 4 bytes
        data.extend_from_slice(&packet_size.to_be_bytes()); // 2 bytes
        data.extend_from_slice(&symbol_id.to_be_bytes()); // 4 bytes
        data.extend_from_slice(&[0u8; 50]); // 50 bytes payload (mismatch!)

        let result = decoder.add_chunk(&data);

        match result {
            DecodeResult::Error(msg) => {
                assert!(
                    msg.contains("mismatch"),
                    "Error should mention payload mismatch"
                );
                assert!(msg.contains("96"), "Error should mention aligned expected size");
                assert!(msg.contains("50"), "Error should mention actual size");
            }
            _ => panic!("Expected Error for payload size mismatch"),
        }
    }

    #[test]
    fn test_decoder_rejects_zero_packet_size() {
        let mut decoder = AirqrDecoder::new();

        let total_size: u32 = 1000;
        let packet_size: u16 = 0;
        let symbol_id: u32 = 0;

        let mut data = Vec::new();
        data.extend_from_slice(&total_size.to_be_bytes());
        data.extend_from_slice(&packet_size.to_be_bytes());
        data.extend_from_slice(&symbol_id.to_be_bytes());

        let result = decoder.add_chunk(&data);

        match result {
            DecodeResult::Error(msg) => {
                assert!(
                    msg.contains("packet_size"),
                    "Error should mention packet_size"
                );
            }
            _ => panic!("Expected Error for zero packet_size"),
        }
    }

    #[test]
    fn test_read_u16_be_returns_typed_packet_too_short_error() {
        let err = read_u16_be(&[0u8], 0..2, "packet_size").unwrap_err();

        assert_eq!(
            err,
            CoreDecodeError::PacketTooShort {
                field: "packet_size"
            }
        );
    }

    #[test]
    fn test_decoder_rejects_zero_total_size() {
        let mut decoder = AirqrDecoder::new();

        let total_size: u32 = 0;
        let packet_size: u16 = 100;
        let symbol_id: u32 = 0;

        let mut data = Vec::new();
        data.extend_from_slice(&total_size.to_be_bytes());
        data.extend_from_slice(&packet_size.to_be_bytes());
        data.extend_from_slice(&symbol_id.to_be_bytes());
        data.extend_from_slice(&[0u8; 100]);

        let result = decoder.add_chunk(&data);

        match result {
            DecodeResult::Error(msg) => {
                assert!(
                    msg.contains("total_size"),
                    "Error should mention total_size"
                );
            }
            _ => panic!("Expected Error for zero total_size"),
        }
    }

    #[test]
    fn test_decoder_initializes_on_first_valid_chunk() {
        let mut decoder = AirqrDecoder::new();

        // Create valid header with matching payload
        let total_size: u32 = 500;
        let packet_size: u16 = 100;
        let symbol_id: u32 = 0;

        let mut data = Vec::new();
        data.extend_from_slice(&total_size.to_be_bytes());
        data.extend_from_slice(&packet_size.to_be_bytes());
        data.extend_from_slice(&symbol_id.to_be_bytes());
        data.extend_from_slice(&[0u8; 96]); // RaptorQ aligns maximum 100 to 96

        let result = decoder.add_chunk(&data);

        // Should return Progress (not Error) and initialize decoder
        match result {
            DecodeResult::Progress { received, .. } => {
                assert_eq!(received, 1);
                assert!(decoder.decoder.is_some());
                assert_eq!(decoder.total_size, 500);
                assert_eq!(decoder.packet_size, 100);
            }
            DecodeResult::Error(msg) => panic!("Unexpected error: {}", msg),
            _ => panic!("Expected Progress result"),
        }
    }

    #[test]
    fn test_decoder_auto_reset_on_stream_change() {
        let mut decoder = AirqrDecoder::new();

        // First chunk with total_size=500
        let mut data1 = Vec::new();
        data1.extend_from_slice(&500u32.to_be_bytes());
        data1.extend_from_slice(&100u16.to_be_bytes());
        data1.extend_from_slice(&0u32.to_be_bytes());
        data1.extend_from_slice(&[0u8; 96]);

        let _ = decoder.add_chunk(&data1);
        assert_eq!(decoder.total_size, 500);
        assert_eq!(decoder.packets_received, 1);

        // Second chunk with different total_size=1000 (new stream)
        let mut data2 = Vec::new();
        data2.extend_from_slice(&1000u32.to_be_bytes());
        data2.extend_from_slice(&100u16.to_be_bytes());
        data2.extend_from_slice(&0u32.to_be_bytes());
        data2.extend_from_slice(&[0u8; 96]);

        let _ = decoder.add_chunk(&data2);

        // Should have reset and started new stream
        assert_eq!(decoder.total_size, 1000);
        assert_eq!(decoder.packets_received, 1); // Reset to 1, not 2
    }

    #[test]
    fn test_decoder_duplicate_packet_handling() {
        let mut decoder = AirqrDecoder::new();

        // Create packet
        let mut data = Vec::new();
        data.extend_from_slice(&500u32.to_be_bytes());
        data.extend_from_slice(&100u16.to_be_bytes());
        data.extend_from_slice(&42u32.to_be_bytes()); // symbol_id = 42
        data.extend_from_slice(&[0u8; 96]);

        // First time
        let _ = decoder.add_chunk(&data);
        assert_eq!(decoder.packets_received, 1);
        assert!(decoder.seen_packets.contains(&42));

        // Same packet again (duplicate)
        let _ = decoder.add_chunk(&data);
        assert_eq!(decoder.packets_received, 1); // Should NOT increment

        // Different packet
        let mut data2 = Vec::new();
        data2.extend_from_slice(&500u32.to_be_bytes());
        data2.extend_from_slice(&100u16.to_be_bytes());
        data2.extend_from_slice(&43u32.to_be_bytes()); // symbol_id = 43
        data2.extend_from_slice(&[0u8; 96]);

        let _ = decoder.add_chunk(&data2);
        assert_eq!(decoder.packets_received, 2); // Should increment
    }

    #[test]
    fn test_decoder_progress_calculation() {
        let mut decoder = AirqrDecoder::new();

        // total_size=500, packet_size=100 => ~5 packets expected
        let total_size: u32 = 500;
        let packet_size: u16 = 100;

        // Add first packet
        let mut data = Vec::new();
        data.extend_from_slice(&total_size.to_be_bytes());
        data.extend_from_slice(&packet_size.to_be_bytes());
        data.extend_from_slice(&0u32.to_be_bytes());
        data.extend_from_slice(&[0u8; 96]);

        let result = decoder.add_chunk(&data);

        match result {
            DecodeResult::Progress {
                percent,
                received,
                expected,
            } => {
                assert_eq!(received, 1);
                assert_eq!(expected, 5); // ceil(500/100)
                assert!((percent - 20.0).abs() < 0.1); // 1/5 = 20%
            }
            _ => panic!("Expected Progress result"),
        }
    }

    // ============================================
    // Header Structure Tests
    // ============================================

    #[test]
    fn test_header_parsing_big_endian() {
        let mut decoder = AirqrDecoder::new();

        // Create header with specific values (use realistic sizes)
        let total_size: u32 = 2560; // 2560 bytes total
        let packet_size: u16 = 256;
        let symbol_id: u32 = 0;

        let mut data = Vec::new();
        data.extend_from_slice(&total_size.to_be_bytes());
        data.extend_from_slice(&packet_size.to_be_bytes());
        data.extend_from_slice(&symbol_id.to_be_bytes());
        data.extend_from_slice(&[0xAA; 256]); // 256 bytes payload

        let result = decoder.add_chunk(&data);

        match result {
            DecodeResult::Progress { .. } => {
                assert_eq!(decoder.total_size, 2560);
                assert_eq!(decoder.packet_size, 256);
            }
            DecodeResult::Error(msg) => panic!("Unexpected error: {}", msg),
            _ => {}
        }
    }

    // ============================================
    // Packet Size Boundary Tests
    // ============================================

    #[test]
    fn test_various_packet_sizes() {
        let sizes = [100u16, 250, 500, 768, 1000, 1500, 2000];

        for &size in &sizes {
            let mut decoder = AirqrDecoder::new();

            let mut data = Vec::new();
            data.extend_from_slice(&(size as u32 * 10).to_be_bytes()); // total_size
            data.extend_from_slice(&size.to_be_bytes()); // packet_size
            data.extend_from_slice(&0u32.to_be_bytes()); // symbol_id
            let actual_size = ObjectTransmissionInformation::with_defaults(size as u64 * 10, size).symbol_size();
            data.extend_from_slice(&vec![0u8; actual_size as usize]); // aligned payload

            let result = decoder.add_chunk(&data);

            match result {
                DecodeResult::Progress { .. } => {
                    assert_eq!(decoder.packet_size, size, "Failed for packet_size={}", size);
                }
                DecodeResult::Error(msg) => {
                    panic!("Error for packet_size={}: {}", size, msg);
                }
                _ => {}
            }
        }
    }

    // ============================================
    // DecodeResult Enum Tests
    // ============================================

    #[test]
    fn test_decode_result_progress_fields() {
        let result = DecodeResult::Progress {
            percent: 50.0,
            received: 5,
            expected: 10,
        };

        match result {
            DecodeResult::Progress {
                percent,
                received,
                expected,
            } => {
                assert!((percent - 50.0).abs() < 0.001);
                assert_eq!(received, 5);
                assert_eq!(expected, 10);
            }
            _ => panic!("Expected Progress variant"),
        }
    }

    #[test]
    fn test_decode_result_completed_fields() {
        let result = DecodeResult::Completed {
            filename: "test.txt".to_string(),
            data: vec![1, 2, 3, 4],
            duration: Duration::from_secs(5),
            total_packets: 100,
        };

        match result {
            DecodeResult::Completed {
                filename,
                data,
                duration,
                total_packets,
            } => {
                assert_eq!(filename, "test.txt");
                assert_eq!(data, vec![1, 2, 3, 4]);
                assert_eq!(duration.as_secs(), 5);
                assert_eq!(total_packets, 100);
            }
            _ => panic!("Expected Completed variant"),
        }
    }

    #[test]
    fn test_decode_result_error() {
        let result = DecodeResult::Error("Test error message".to_string());

        match result {
            DecodeResult::Error(msg) => {
                assert_eq!(msg, "Test error message");
            }
            _ => panic!("Expected Error variant"),
        }
    }
}
