use airqr_core::mp4::{
    encode_frames_to_mp4, estimate_mp4_size, is_ffmpeg_available, render_qr_1bit,
};
use airqr_core::EncoderConfig;
use anyhow::Result;
use indicatif::{ProgressBar, ProgressStyle};
use qrcodegen::{QrCode, QrCodeEcc};
use raptorq::Encoder;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: {} <file_path>", args[0]);
        eprintln!("Example: {} test_5mb.json", args[0]);
        eprintln!("\nThis encoder uses H.264 video compression");
        eprintln!("Expected: ~3-4x compression (vs 5.5x for GIF)!");
        eprintln!("\nRequires: ffmpeg");
        std::process::exit(1);
    }

    // Check ffmpeg availability
    if !is_ffmpeg_available() {
        eprintln!("❌ Error: ffmpeg not found!");
        eprintln!("\nInstall instructions:");
        eprintln!("  Windows: Download from https://ffmpeg.org/download.html");
        eprintln!("           Add to PATH or place ffmpeg.exe in project directory");
        eprintln!("  Ubuntu/Debian: apt-get install ffmpeg");
        eprintln!("  macOS: brew install ffmpeg");
        std::process::exit(1);
    }

    let file_path = &args[1];

    println!("🎯 AirQR MP4 Encoder (H.264)");
    println!("===========================");
    println!("File: {}\n", file_path);

    // Configure encoder
    let config = EncoderConfig {
        compression_enabled: false,
        packet_size: 800,
        raptorq_overhead: 1.2,
        ecc: QrCodeEcc::Medium,
        ..EncoderConfig::default()
    };

    // Read file
    let path_obj = Path::new(file_path);
    let mut file = File::open(path_obj)?;
    let mut file_data = Vec::new();
    file.read_to_end(&mut file_data)?;

    let filename = path_obj.file_name().unwrap().to_str().unwrap();
    println!(
        "📄 File size: {:.2} MB",
        file_data.len() as f64 / 1024.0 / 1024.0
    );

    // Prepare payload
    let filename_bytes = filename.as_bytes();
    let filename_len = filename_bytes.len() as u32;

    let mut payload = Vec::with_capacity(4 + filename_bytes.len() + file_data.len());
    payload.extend_from_slice(&filename_len.to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(&file_data);

    // No compression
    let mut compressed = Vec::with_capacity(1 + payload.len());
    compressed.push(0u8);
    compressed.extend_from_slice(&payload);

    // RaptorQ encoding
    println!("⏳ Generating RaptorQ packets...");
    let packet_size = config.packet_size;
    let raptorq_encoder = Encoder::with_defaults(&compressed, packet_size);
    let packets_to_generate = (compressed.len() as f64 / packet_size as f64
        * config.raptorq_overhead as f64)
        .ceil() as u32;
    let packets_to_generate = packets_to_generate.max(10);

    let packets = raptorq_encoder.get_encoded_packets(packets_to_generate);
    let total_frames = packets.len();

    println!("✅ Generated {} packets\n", total_frames);

    // Estimate MP4 size
    let estimated_size = estimate_mp4_size(total_frames, 177);
    println!(
        "📊 Estimated MP4 size: {:.2} MB",
        estimated_size as f64 / 1024.0 / 1024.0
    );
    println!(
        "📊 Estimated ratio: {:.1}x",
        estimated_size as f64 / file_data.len() as f64
    );
    println!();

    // Render QR frames
    println!("🖼️  Rendering {} QR frames (1-bit)...", total_frames);
    let pb = ProgressBar::new(total_frames as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template(
                "{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta})",
            )
            .unwrap()
            .progress_chars("#>-"),
    );

    let total_size = compressed.len() as u32;

    use rayon::prelude::*;
    let frames = packets
        .par_iter()
        .map(|packet| -> Result<_> {
            let payload_data = packet.data();

            // Create QR header
            let mut qr_data = Vec::with_capacity(10 + payload_data.len());
            qr_data.extend_from_slice(&total_size.to_be_bytes());
            qr_data.extend_from_slice(&packet_size.to_be_bytes());
            qr_data.extend_from_slice(&packet.payload_id().serialize());
            qr_data.extend_from_slice(payload_data);

            // Encode to QR
            let qr = QrCode::encode_binary(&qr_data, config.ecc).unwrap();

            // Render as 1-bit image
            let img = render_qr_1bit(&qr)?;
            pb.inc(1);
            Ok(img)
        })
        .collect::<Result<Vec<_>>>()?;
    pb.finish_with_message("Done");

    // Encode to MP4
    println!("\n🎬 Encoding to MP4 with H.264...");
    let output_path = format!("{}.mp4", path_obj.display());

    encode_frames_to_mp4(
        frames,
        Path::new(&output_path),
        10, // 10 FPS
    )?;

    // Get final size
    let mp4_size = fs::metadata(&output_path)?.len();
    println!("\n✨ Success!");
    println!("📁 Output: {}", output_path);
    println!("📊 MP4 size: {:.2} MB", mp4_size as f64 / 1024.0 / 1024.0);
    println!(
        "📊 Actual compression ratio: {:.1}x",
        mp4_size as f64 / file_data.len() as f64
    );
    println!("📊 Total frames: {}", total_frames);
    println!(
        "📊 Avg size per frame: {:.2} bytes",
        mp4_size as f64 / total_frames as f64
    );
    println!(
        "📊 Duration at 10 FPS: {:.1} seconds",
        total_frames as f64 / 10.0
    );

    // Compare with GIF
    let gif_size_estimate = airqr_core::webp::estimate_1bit_size(total_frames, 177);
    println!("\n📉 Comparison:");
    println!(
        "   1-bit GIF (estimated): {:.2} MB",
        gif_size_estimate as f64 / 1024.0 / 1024.0
    );
    println!(
        "   MP4 H.264 (actual): {:.2} MB",
        mp4_size as f64 / 1024.0 / 1024.0
    );
    if mp4_size < gif_size_estimate {
        println!(
            "   ✅ MP4 is {:.2} MB smaller ({:.0}% reduction)",
            (gif_size_estimate - mp4_size) as f64 / 1024.0 / 1024.0,
            ((gif_size_estimate - mp4_size) as f64 / gif_size_estimate as f64) * 100.0
        );
    }

    Ok(())
}
