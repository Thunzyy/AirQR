use airqr_core::svg::{encode_frames_to_svg_html, estimate_svg_size};
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
        eprintln!("\nThis encoder creates an animated SVG HTML file");
        eprintln!("Result: ~65% smaller than GIF 1-bit!");
        std::process::exit(1);
    }

    let file_path = &args[1];

    println!("🎯 AirQR SVG Animated Encoder");
    println!("============================");
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

    // Estimate SVG size
    let estimated_size = estimate_svg_size(total_frames, 65);
    println!(
        "📊 Estimated SVG size: {:.2} KB",
        estimated_size as f64 / 1024.0
    );
    println!(
        "📊 Compression ratio: {:.1}x",
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

    let total_size = compressed.len() as u32;

    use rayon::prelude::*;
    let qr_codes: Vec<_> = packets
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

    // Encode to SVG HTML
    println!("\n🎬 Encoding to SVG HTML...");
    let output_path = format!("{}.html", path_obj.display());

    encode_frames_to_svg_html(qr_codes, Path::new(&output_path), config.frame_delay_ms)?;

    // Get final sizes
    let svg_size = fs::metadata(&output_path)?.len();
    let gz_path = format!("{}.gz", output_path);
    let gz_size = fs::metadata(&gz_path)?.len();
    let br_path = format!("{}.br", output_path);
    let br_size = fs::metadata(&br_path)?.len();

    println!("\n✨ Success!");
    println!("📁 Output: {}", output_path);
    println!("📁 Gzipped: {}", gz_path);
    println!("📁 Brotli: {}", br_path);
    println!();
    println!("📊 SVG HTML size: {:.2} KB", svg_size as f64 / 1024.0);
    println!(
        "📊 SVG HTML.gz size: {:.2} KB ({:.0}% of original)",
        gz_size as f64 / 1024.0,
        (gz_size as f64 / svg_size as f64) * 100.0
    );
    println!(
        "📊 SVG HTML.br size: {:.2} KB ({:.0}% of original)",
        br_size as f64 / 1024.0,
        (br_size as f64 / svg_size as f64) * 100.0
    );
    println!();
    println!(
        "📊 Compression ratio (uncompressed): {:.1}x",
        svg_size as f64 / file_data.len() as f64
    );
    println!(
        "📊 Compression ratio (gzip): {:.1}x",
        gz_size as f64 / file_data.len() as f64
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

    // Compare with GIF estimate
    let gif_size_estimate = airqr_core::webp::estimate_1bit_size(total_frames, 177);
    println!("\n📉 Comparison:");
    println!(
        "   1-bit GIF (estimated): {:.2} KB",
        gif_size_estimate as f64 / 1024.0
    );
    println!(
        "   SVG HTML (uncompressed): {:.2} KB",
        svg_size as f64 / 1024.0
    );
    println!("   SVG HTML.gz (gzip): {:.2} KB", gz_size as f64 / 1024.0);
    println!("   SVG HTML.br (brotli): {:.2} KB", br_size as f64 / 1024.0);

    if br_size < gif_size_estimate {
        println!(
            "   ✅ SVG.br is {:.2} KB smaller than GIF ({:.0}% reduction)",
            (gif_size_estimate - br_size) as f64 / 1024.0,
            ((gif_size_estimate - br_size) as f64 / gif_size_estimate as f64) * 100.0
        );

        if br_size < gz_size {
            println!(
                "   🎯 Brotli is {:.2} KB smaller than gzip ({:.0}% better)",
                (gz_size - br_size) as f64 / 1024.0,
                ((gz_size - br_size) as f64 / gz_size as f64) * 100.0
            );
        }
    }

    println!("\n💡 To view in browser:");
    println!("   Direct: Open {}", output_path);
    println!("   Compressed: Run 'python serve_gz.py' and open http://localhost:8000");

    Ok(())
}
