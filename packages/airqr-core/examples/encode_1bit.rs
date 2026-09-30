use airqr_core::webp::{estimate_1bit_size, render_qr_1bit};
use airqr_core::EncoderConfig;
use anyhow::Result;
use image::{codecs::gif::GifEncoder, Delay, Frame};
use indicatif::{ProgressBar, ProgressStyle};
use qrcodegen::{QrCode, QrCodeEcc};
use raptorq::Encoder;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use std::time::Duration;

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: {} <file_path> [output_path]", args[0]);
        eprintln!("Example: {} video.mkv output.gif", args[0]);
        eprintln!("\nThis encoder uses 1-bit (black/white) QR codes at 177x177px");
        eprintln!("Result: ~23x smaller than standard RGB GIF!");
        std::process::exit(1);
    }

    let file_path = &args[1];

    let output_path = if args.len() > 2 {
        args[2].clone()
    } else {
        "output.gif".to_string()
    };

    println!("🎯 AirQR 1-Bit Encoder");
    println!("====================");
    println!("File: {}", file_path);
    println!("Output: {}\n", output_path);

    // Configure encoder
    let config = EncoderConfig {
        compression_enabled: false, // Don't compress videos (already compressed)
        packet_size: 800,           // Larger packets for efficiency
        raptorq_overhead: 1.2,      // Less overhead
        ecc: QrCodeEcc::Medium,
        ..EncoderConfig::default()
    };

    // Read file
    let path_obj = Path::new(file_path);

    let (file_data, filename_string) = if path_obj.is_dir() {
        println!("📂 Detected directory input. Creating ZIP archive...");
        use zip::write::{SimpleFileOptions, ZipWriter};

        let mut zip_buffer = Vec::new();
        // Scope for ZipWriter to ensure it finishes before we use the buffer
        {
            let mut zip = ZipWriter::new(std::io::Cursor::new(&mut zip_buffer));

            let options = SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .unix_permissions(0o755);

            fn add_dir<W: std::io::Write + std::io::Seek>(
                dir: &Path,
                root: &Path,
                zip: &mut ZipWriter<W>,
                options: SimpleFileOptions,
            ) -> Result<()> {
                for entry in fs::read_dir(dir)? {
                    let entry = entry?;
                    let path = entry.path();

                    // Get relative path from root
                    let name = path
                        .strip_prefix(root)?
                        .to_str()
                        .unwrap()
                        .replace("\\", "/");

                    if path.is_dir() {
                        zip.add_directory(name.clone() + "/", options)?;
                        add_dir(&path, root, zip, options)?;
                    } else {
                        zip.start_file(name, options)?;
                        let mut f = File::open(path)?;
                        std::io::copy(&mut f, zip)?;
                    }
                }
                Ok(())
            }

            add_dir(path_obj, path_obj, &mut zip, options)?;
            zip.finish()?;
        }

        let dir_name = path_obj.file_name().unwrap().to_str().unwrap();
        (zip_buffer, format!("{}.zip", dir_name))
    } else {
        let mut file = File::open(path_obj)?;
        let mut file_data = Vec::new();
        file.read_to_end(&mut file_data)?;
        (
            file_data,
            path_obj.file_name().unwrap().to_str().unwrap().to_string(),
        )
    };

    let filename = filename_string.as_str();
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

    // Estimate 1-bit size
    let estimated_size = estimate_1bit_size(total_frames, 177);
    println!(
        "📊 Estimated 1-bit GIF size: {:.2} MB",
        estimated_size as f64 / 1024.0 / 1024.0
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

            // Convert to Frame
            let frame = Frame::from_parts(
                img,
                0,
                0,
                Delay::from_saturating_duration(Duration::from_millis(config.frame_delay_ms)),
            );

            pb.inc(1);
            Ok(frame)
        })
        .collect::<Result<Vec<_>>>()?;
    pb.finish_with_message("Done");

    // Encode to GIF with indexed palette
    println!("\n🎬 Encoding to 1-bit GIF...");
    // output_path is already defined at the top
    let mut gif_file = File::create(&output_path)?;

    {
        let mut encoder = GifEncoder::new(&mut gif_file);
        encoder.set_repeat(image::codecs::gif::Repeat::Infinite)?;

        // The GIF encoder will automatically detect that we only have 2 colors
        // and create an indexed palette (1-bit per pixel effectively)
        encoder.encode_frames(frames.into_iter())?;
    }

    // Get final size
    let gif_size = fs::metadata(&output_path)?.len();
    println!("\n✨ Success!");
    println!("📁 Output: {}", output_path);
    println!("📊 GIF size: {:.2} MB", gif_size as f64 / 1024.0 / 1024.0);
    println!(
        "📊 Actual compression ratio: {:.1}x",
        gif_size as f64 / file_data.len() as f64
    );
    println!("📊 Total frames: {}", total_frames);
    println!(
        "📊 Avg size per frame: {:.2} KB",
        gif_size as f64 / total_frames as f64 / 1024.0
    );
    println!(
        "📊 Duration at 10 FPS: {:.1} seconds",
        total_frames as f64 / 10.0
    );

    // Compare with theoretical RGB size
    let rgb_size_estimate = total_frames as u64 * 16 * 1024; // Estimate 16 KB per RGB frame
    println!("\n📉 Comparison:");
    println!(
        "   RGB GIF (estimated): {:.2} MB",
        rgb_size_estimate as f64 / 1024.0 / 1024.0
    );
    println!(
        "   1-bit GIF (actual): {:.2} MB",
        gif_size as f64 / 1024.0 / 1024.0
    );
    println!(
        "   Space saved: {:.2} MB ({:.0}%)",
        (rgb_size_estimate - gif_size) as f64 / 1024.0 / 1024.0,
        ((rgb_size_estimate - gif_size) as f64 / rgb_size_estimate as f64) * 100.0
    );

    Ok(())
}
