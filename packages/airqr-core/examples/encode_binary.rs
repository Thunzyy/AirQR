use airqr_core::binary::{encode_frames_to_binary_html, estimate_binary_size};
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
        eprintln!("\nThis encoder uses BINARY format (no base64 overhead)");
        eprintln!("Expected: Best compression possible (~1.8-2.0x ratio)!");
        std::process::exit(1);
    }

    let file_path = &args[1];

    println!("🎯 AirQR Binary Encoder (Ultimate Compression)");
    println!("==============================================");
    println!("File: {}\n", file_path);

    // Configure encoder
    let config = EncoderConfig {
        compression_enabled: false,
        packet_size: 2800, // Optimized for Version 40-L (Max Capacity)
        raptorq_overhead: 1.2,
        ecc: QrCodeEcc::Low,
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

    // Estimate binary size
    let estimated_size = estimate_binary_size(total_frames, 65);
    println!(
        "📊 Estimated binary.br size: {:.2} MB",
        estimated_size as f64 / 1024.0 / 1024.0
    );
    println!(
        "📊 Estimated ratio: {:.1}x",
        estimated_size as f64 / file_data.len() as f64
    );
    println!();

    // Generate QR codes
    println!("🖼️  Generating {} QR codes...", total_frames);
    let pb = ProgressBar::new(total_frames as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template(
                "{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta})",
            )
            .unwrap()
            .progress_chars("#>-"),
    );

    use rayon::prelude::*;

    let total_size = compressed.len() as u32;
    // Pre-calculate common data to avoid cloning in loop if possible,
    // but here we just need to be thread-safe.

    let qr_codes: Vec<QrCode> = packets
        .par_iter()
        .map(|packet| {
            let payload_data = packet.data();

            // Create QR header
            let mut qr_data = Vec::with_capacity(10 + payload_data.len());
            qr_data.extend_from_slice(&total_size.to_be_bytes());
            qr_data.extend_from_slice(&packet_size.to_be_bytes());
            qr_data.extend_from_slice(&packet.payload_id().serialize());
            qr_data.extend_from_slice(payload_data);

            // Encode to QR
            let qr = QrCode::encode_binary(&qr_data, config.ecc).unwrap();
            pb.inc(1);
            qr
        })
        .collect();
    pb.finish_with_message("Done");

    // Encode to Binary HTML
    println!("\n🎬 Encoding to Binary HTML + Brotli...");
    let output_path = format!("{}.binary.html", path_obj.display());

    encode_frames_to_binary_html(qr_codes, Path::new(&output_path), config.frame_delay_ms)?;

    // Get final sizes
    let html_size = fs::metadata(&output_path)?.len();
    let br_path = format!("{}.br", output_path);
    let br_size = fs::metadata(&br_path)?.len();

    println!("\n✨ Success!");
    println!("📁 Output: {}", output_path);
    println!("📁 Brotli: {}", br_path);
    println!();
    println!(
        "📊 Binary HTML size: {:.2} MB",
        html_size as f64 / 1024.0 / 1024.0
    );
    println!(
        "📊 Binary HTML.br size: {:.2} MB ({:.0}% of original)",
        br_size as f64 / 1024.0 / 1024.0,
        (br_size as f64 / html_size as f64) * 100.0
    );
    println!();
    println!(
        "📊 Compression ratio (uncompressed): {:.1}x",
        html_size as f64 / file_data.len() as f64
    );
    println!(
        "📊 Compression ratio (brotli): {:.1}x",
        br_size as f64 / file_data.len() as f64
    );
    println!("📊 Total frames: {}", total_frames);
    println!(
        "📊 Avg size per frame (br): {:.2} bytes",
        br_size as f64 / total_frames as f64
    );
    println!(
        "📊 Duration at 10 FPS: {:.1} seconds",
        total_frames as f64 / 10.0
    );

    // Compare with all formats
    let gif_size_estimate = airqr_core::webp::estimate_1bit_size(total_frames, 177);
    let svg_br_estimate = (gif_size_estimate as f64 * 0.5) as u64; // Approximation from tests

    println!("\n📉 Comparison:");
    println!(
        "   1-bit GIF (estimated): {:.2} MB",
        gif_size_estimate as f64 / 1024.0 / 1024.0
    );
    println!(
        "   SVG HTML.br (previous best): {:.2} MB",
        svg_br_estimate as f64 / 1024.0 / 1024.0
    );
    println!(
        "   Binary HTML.br (this): {:.2} MB",
        br_size as f64 / 1024.0 / 1024.0
    );

    if br_size < svg_br_estimate {
        println!(
            "   ✅ Binary is {:.2} MB smaller than SVG.br ({:.0}% reduction)",
            (svg_br_estimate - br_size) as f64 / 1024.0 / 1024.0,
            ((svg_br_estimate - br_size) as f64 / svg_br_estimate as f64) * 100.0
        );
    }

    if br_size < gif_size_estimate {
        println!(
            "   🏆 Binary is {:.2} MB smaller than GIF ({:.0}% reduction)",
            (gif_size_estimate - br_size) as f64 / 1024.0 / 1024.0,
            ((gif_size_estimate - br_size) as f64 / gif_size_estimate as f64) * 100.0
        );
    }

    println!("\n💡 To view in browser:");
    println!("   Run 'python serve_gz.py' and open http://localhost:8000");
    println!("   The server will automatically serve the .br file");

    Ok(())
}
