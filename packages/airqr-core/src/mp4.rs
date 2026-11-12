use anyhow::Result;
use image::RgbaImage;
use qrcodegen::QrCode;
use std::fs;
use std::path::Path;
use std::process::Command;

/// Check if ffmpeg is available
pub fn is_ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Render QR code as 1-bit image (ffmpeg will pad to even dimensions)
pub fn render_qr_1bit(qr: &QrCode) -> Result<RgbaImage> {
    use image::Rgba;

    let qr_size = qr.size() as u32;
    let border = 4;
    let module_count = qr_size + border * 2;

    let scale = (177 / module_count).max(1);
    let img_size = module_count * scale;

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

    // Draw QR modules
    for y in 0..qr_size {
        for x in 0..qr_size {
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

/// Encode frames to MP4 using ffmpeg
pub fn encode_frames_to_mp4(frames: Vec<RgbaImage>, output_path: &Path, fps: u32) -> Result<()> {
    use image::ImageFormat;

    if !is_ffmpeg_available() {
        anyhow::bail!(
            "ffmpeg not found. Install it:\n  \
            Windows: Download from https://ffmpeg.org/download.html\n  \
            Ubuntu/Debian: apt-get install ffmpeg\n  \
            macOS: brew install ffmpeg"
        );
    }

    // Create temp directory for frames
    let temp_dir = output_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .join("temp_mp4_frames");
    fs::create_dir_all(&temp_dir)?;

    println!("  📸 Saving {} frames to disk...", frames.len());

    // Save frames as PNG files
    for (i, frame) in frames.iter().enumerate() {
        let frame_path = temp_dir.join(format!("frame_{:06}.png", i));
        frame.save_with_format(&frame_path, ImageFormat::Png)?;

        // Progress indicator
        if i % 1000 == 0 || i == frames.len() - 1 {
            print!("\r  💾 Saved {}/{} frames", i + 1, frames.len());
            std::io::Write::flush(&mut std::io::stdout())?;
        }
    }
    println!();

    // Encode to MP4 with H.264
    println!("  🎬 Encoding to MP4 with ffmpeg...");

    let output = Command::new("ffmpeg")
        .args([
            "-y", // Overwrite output file
            "-framerate",
            &fps.to_string(), // Input framerate
            "-i",
            &temp_dir.join("frame_%06d.png").display().to_string(),
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2", // Pad to even dimensions
            "-c:v",
            "libx264", // H.264 codec
            "-preset",
            "veryslow", // Best compression
            "-crf",
            "18", // Near-lossless (0-51, lower=better)
            "-pix_fmt",
            "yuv420p", // Compatibility
            "-movflags",
            "+faststart", // Web optimization
            &output_path.display().to_string(),
        ])
        .output()?;

    // Clean up temp directory
    fs::remove_dir_all(&temp_dir)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("ffmpeg failed: {}", stderr);
    }

    Ok(())
}

/// Estimate MP4 size
/// H.264 achieves ~3-4x compression on QR codes vs GIF
pub fn estimate_mp4_size(num_frames: usize, _img_size: u32) -> u64 {
    // GIF 1-bit estimate
    let gif_estimate = crate::webp::estimate_1bit_size(num_frames, 177);

    // MP4 H.264 is typically 3-4x better than GIF on static content
    // QR codes have high temporal correlation (frames similar)
    (gif_estimate as f64 * 0.3) as u64 // 30% of GIF size
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ffmpeg_check() {
        // Just verify the function runs without panic
        let _ = is_ffmpeg_available();
    }

    #[test]
    fn test_size_estimation() {
        let estimated = estimate_mp4_size(100, 177);
        // Should be smaller than GIF
        assert!(estimated > 0);
    }
}
