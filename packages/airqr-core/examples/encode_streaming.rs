use airqr_core::streaming::{StreamEncodeProgress, StreamingConfig, StreamingEncoder};
use std::fs::File;
use std::io::Write;

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: {} <file_path> [chunk_size_mb]", args[0]);
        eprintln!("Example: {} video.mp4 10", args[0]);
        std::process::exit(1);
    }

    let file_path = &args[1];
    let chunk_size_mb = if args.len() > 2 {
        args[2].parse().unwrap_or(10)
    } else {
        10
    };

    println!("🚀 AirQR Streaming Encoder");
    println!("========================");
    println!("File: {}", file_path);
    println!("Chunk size: {} MB\n", chunk_size_mb);

    // Configure streaming
    let config = StreamingConfig {
        chunk_size_mb,
        compression_enabled: true,
        packet_size: 250,
        frame_delay_ms: 100,
        ..StreamingConfig::default()
    };

    // Create encoder
    let encoder = StreamingEncoder::new(config, file_path)?;

    let session_id = encoder.get_session_id();
    let total_chunks = encoder.get_total_chunks();
    let file_size = encoder.get_file_size();

    println!("📊 Session Info:");
    println!("  Session ID: {}", session_id);
    println!("  Total chunks: {}", total_chunks);
    println!("  File size: {:.2} MB", file_size as f64 / 1024.0 / 1024.0);
    println!();

    // Encode all chunks
    for chunk_id in 0..total_chunks {
        println!("📦 Encoding chunk {}/{}...", chunk_id + 1, total_chunks);

        let gif_data = encoder.encode_chunk(chunk_id, |progress| match progress {
            StreamEncodeProgress::ReadingChunk { .. } => {
                print!("  📖 Reading chunk... ");
                std::io::stdout().flush().unwrap();
            }
            StreamEncodeProgress::CompressingChunk { progress, .. } => {
                print!("\r  🗜️  Compressing: {:.0}%", progress);
                std::io::stdout().flush().unwrap();
            }
            StreamEncodeProgress::Info(msg) => {
                println!("\r  ℹ️  {}", msg);
            }
            StreamEncodeProgress::RenderingFrames { current, total, .. } => {
                print!("\r  🖼️  Rendering frames: {}/{}", current, total);
                std::io::stdout().flush().unwrap();
            }
            StreamEncodeProgress::EncodingGif { current, total, .. } => {
                if current % 50 == 0 || current == total {
                    print!("\r  🎬 Encoding GIF: {}/{}", current, total);
                    std::io::stdout().flush().unwrap();
                }
            }
            StreamEncodeProgress::ChunkComplete { gif_size, .. } => {
                println!(
                    "\r  ✅ Complete! GIF size: {:.2} MB",
                    gif_size as f64 / 1024.0 / 1024.0
                );
            }
            _ => {}
        })?;

        // Save GIF
        let output_filename = format!("chunk_{}_{}.gif", session_id, chunk_id);
        let mut file = File::create(&output_filename)?;
        file.write_all(&gif_data)?;
        println!("  💾 Saved: {}\n", output_filename);
    }

    println!("✨ All chunks encoded successfully!");
    println!("📁 Created {} GIF files", total_chunks);
    println!("\n💡 To decode:");
    println!("   Scan each GIF in sequence with the mobile app");
    println!("   The decoder will automatically reassemble the file");

    Ok(())
}
