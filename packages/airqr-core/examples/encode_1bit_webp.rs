use airqr_core::webp::{
    encode_frames_to_webp_with_tool, estimate_webp_size, is_img2webp_available, render_qr_1bit,
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
        eprintln!("Example: {} CLAUDE.md", args[0]);
        eprintln!("\nThis encoder uses 1-bit (black/white) QR codes at 177x177px");
        eprintln!("Output: Animated WebP (20-30% smaller than GIF)");
        eprintln!("\nRequires: img2webp tool (from libwebp package)");
        std::process::exit(1);
    }

    // Check img2webp availability
    if !is_img2webp_available() {
        eprintln!("Error: img2webp not found!");
        eprintln!("\nInstall instructions:");
        eprintln!("  Windows: Download from https://developers.google.com/speed/webp/download");
        eprintln!("           Extract and add to PATH, or place in project directory");
        eprintln!("  Ubuntu/Debian: apt-get install webp");
        eprintln!("  macOS: brew install webp");
        std::process::exit(1);
    }

    let file_path = &args[1];

    println!("🎯 AirQR 1-Bit WebP Encoder");
    println!("==========================");
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
    println!("📄 File size: {:.2} KB", file_data.len() as f64 / 1024.0);

    // Prepare payload
    let filename_bytes = filename.as_bytes();
    let filename_len = filename_bytes.len() as u32;

    let mut payload = Vec::with_capacity(4 + filename_bytes.len() + file_data.len());
    payload.extend_from_slice(&filename_len.to_be_bytes());
    payload.extend_from_slice(filename_bytes);
    payload.extend_from_slice(&file_data);

    // No compression for already compressed files
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

    // Estimate WebP size
    let estimated_size = estimate_webp_size(total_frames, 177);
    println!(
        "📊 Estimated WebP size: {:.2} KB",
        estimated_size as f64 / 1024.0
    );
    println!(
        "📊 Compression ratio: {:.1}x",
        estimated_size as f64 / file_data.len() as f64
    );
    println!("📊 Image size: 177x177 px (1-bit black/white)");
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

            // Create QR header (normal mode: 10 bytes)
            let mut qr_data = Vec::with_capacity(10 + payload_data.len());
            qr_data.extend_from_slice(&total_size.to_be_bytes());
            qr_data.extend_from_slice(&packet_size.to_be_bytes());
            qr_data.extend_from_slice(&packet.payload_id().serialize());
            qr_data.extend_from_slice(payload_data);

            // Encode to QR
            let qr = QrCode::encode_binary(&qr_data, config.ecc).unwrap();

            // Render as 1-bit (177x177 px, black/white only)
            let img = render_qr_1bit(&qr)?;
            pb.inc(1);
            Ok(img)
        })
        .collect::<Result<Vec<_>>>()?;
    pb.finish_with_message("Done");

    // Encode to WebP with img2webp
    println!("\n🎬 Encoding to WebP (using img2webp)...");
    let output_path = format!("{}_1bit.webp", path_obj.display());

    encode_frames_to_webp_with_tool(
        frames,
        Path::new(&output_path),
        100, // Quality: 100 = lossless (best for QR codes)
        10,  // FPS
    )?;

    // Get final size
    let webp_size = fs::metadata(&output_path)?.len();
    println!("\n✨ Success!");
    println!("📁 Output: {}", output_path);
    println!("📊 WebP size: {:.2} KB", webp_size as f64 / 1024.0);
    println!(
        "📊 Actual compression ratio: {:.1}x",
        webp_size as f64 / file_data.len() as f64
    );
    println!("📊 Total frames: {}", total_frames);
    println!(
        "📊 Avg size per frame: {:.2} bytes",
        webp_size as f64 / total_frames as f64
    );
    println!(
        "📊 Duration at 10 FPS: {:.1} seconds",
        total_frames as f64 / 10.0
    );

    // Compare with GIF estimate
    let gif_size_estimate = airqr_core::webp::estimate_1bit_size(total_frames, 177);
    println!("\n📉 Comparison:");
    println!(
        "   1-bit GIF (estimated): {:.2} KB",
        gif_size_estimate as f64 / 1024.0
    );
    println!(
        "   1-bit WebP (actual): {:.2} KB",
        webp_size as f64 / 1024.0
    );
    if webp_size < gif_size_estimate {
        println!(
            "   Space saved vs GIF: {:.2} KB ({:.0}%)",
            (gif_size_estimate - webp_size) as f64 / 1024.0,
            ((gif_size_estimate - webp_size) as f64 / gif_size_estimate as f64) * 100.0
        );
    }

    Ok(())
}
