use anyhow::Result;
use image::{Rgba, RgbaImage};
use qrcodegen::QrCode;
#[cfg(feature = "webp")]
use std::path::Path;

/// Render QR code as 1-bit indexed image (black/white only)
/// Size: 177x177 pixels (optimal for QR codes)
pub fn render_qr_1bit(qr: &QrCode) -> Result<RgbaImage> {
    let qr_size = qr.size() as u32;
    let border = 4; // 4 module border as per QR spec
    let module_count = qr_size + border * 2;

    // Calculate scale to fit in 177x177
    // 177 / module_count should give us the pixel size per module
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

    // Create RGBA image (will be converted to indexed 1-bit by GIF encoder)
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

/// Find img2webp executable in multiple locations
#[cfg(feature = "webp")]
fn find_img2webp() -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    // Try locations in order
    let locations = vec![
        "img2webp.exe",          // Current directory
        "img2webp",              // Unix-style in PATH
        "./img2webp.exe",        // Explicit current dir
        "../img2webp.exe",       // Parent directory
        "../../img2webp.exe",    // Two levels up (for examples)
        "../../../img2webp.exe", // Three levels up (for target/release/examples)
    ];

    for location in locations {
        let path = PathBuf::from(location);
        if std::process::Command::new(&path)
            .arg("-version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
        {
            return Some(path);
        }
    }

    None
}

/// Check if img2webp tool is available
#[cfg(feature = "webp")]
pub fn is_img2webp_available() -> bool {
    find_img2webp().is_some()
}

/// Encode frames to animated WebP using img2webp external tool
/// This is the recommended approach for production use
#[cfg(feature = "webp")]
pub fn encode_frames_to_webp_with_tool(
    frames: Vec<RgbaImage>,
    output_path: &Path,
    quality: u32,
    fps: u32,
) -> anyhow::Result<()> {
    use image::ImageFormat;
    use std::fs;
    use std::process::Command;

    let img2webp_path = find_img2webp().ok_or_else(|| {
        anyhow::anyhow!(
            "img2webp not found. Install it with:\n  \
            Ubuntu/Debian: apt-get install webp\n  \
            macOS: brew install webp\n  \
            Windows: Download from https://developers.google.com/speed/webp/download"
        )
    })?;

    // Create temp directory for frames
    let temp_dir = output_path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .join("temp_webp_frames");
    fs::create_dir_all(&temp_dir)?;

    // Save frames as PNG files and collect paths
    let mut frame_paths = Vec::new();
    for (i, frame) in frames.iter().enumerate() {
        let frame_path = temp_dir.join(format!("frame_{:06}.png", i));
        frame.save_with_format(&frame_path, ImageFormat::Png)?;
        frame_paths.push(frame_path);
    }

    // Build img2webp command
    let frame_delay = 1000 / fps;

    // For large number of frames, use a file list to avoid command line length limits
    let output = if frame_paths.len() > 1000 {
        use std::io::Write;

        // Create file list
        let file_list_path = temp_dir.join("file_list.txt");
        let mut file_list = fs::File::create(&file_list_path)?;
        for path in &frame_paths {
            writeln!(file_list, "{}", path.display())?;
        }
        drop(file_list);

        Command::new(&img2webp_path)
            .args([
                "-loop",
                "0",
                "-d",
                &frame_delay.to_string(),
                "-q",
                &quality.to_string(),
                "-m",
                "6",
                "-f",
                &file_list_path.display().to_string(),
                "-o",
                &output_path.display().to_string(),
            ])
            .output()?
    } else {
        // Small number of frames, pass directly
        let mut cmd = Command::new(&img2webp_path);
        cmd.args([
            "-loop",
            "0",
            "-d",
            &frame_delay.to_string(),
            "-q",
            &quality.to_string(),
            "-m",
            "6",
        ]);

        for frame_path in &frame_paths {
            cmd.arg(frame_path);
        }

        cmd.args(["-o", &output_path.display().to_string()]);
        cmd.output()?
    };

    // Clean up temp directory
    fs::remove_dir_all(&temp_dir)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("img2webp failed: {}", stderr);
    }

    Ok(())
}

/// Encode frames to animated WebP using webp crate (single frame fallback)
/// This only saves the first frame - use encode_frames_to_webp_with_tool for animations
#[cfg(feature = "webp")]
pub fn encode_frames_to_webp(
    frames: Vec<RgbaImage>,
    output_path: &Path,
    quality: f32,
) -> anyhow::Result<()> {
    use std::fs::File;
    use std::io::Write;

    if frames.is_empty() {
        anyhow::bail!("No frames to encode");
    }

    // WebP uses quality 0-100 (lossless = 100)
    let webp_quality = (quality * 100.0) as u8;

    // Encode first frame only
    let frame = &frames[0];
    let width = frame.width();
    let height = frame.height();
    let pixels = frame.as_raw();

    let encoder = webp::Encoder::from_rgba(pixels, width, height);
    let encoded = if webp_quality >= 100 {
        encoder.encode_lossless()
    } else {
        encoder.encode(webp_quality as f32)
    };

    let mut file = File::create(output_path)?;
    file.write_all(&encoded)?;

    eprintln!(
        "Warning: Only first frame saved. Use encode_frames_to_webp_with_tool() for animations."
    );

    Ok(())
}

/// Estimate WebP size (typically 20-30% smaller than GIF for QR codes)
pub fn estimate_webp_size(num_frames: usize, img_size: u32) -> u64 {
    // Start with GIF estimate
    let gif_estimate = estimate_1bit_size(num_frames, img_size);

    // WebP is typically 20-30% smaller than GIF for similar content
    (gif_estimate as f64 * 0.7) as u64
}

/// Get optimal QR size in pixels for 1-bit encoding
pub fn get_optimal_qr_size(qr_version: i16) -> u32 {
    // QR version determines module count: (version * 4) + 17
    let modules = (qr_version as u32 * 4) + 17 + 8; // +8 for border

    // Target 177x177, calculate scale
    let scale = (177 / modules).max(1);
    modules * scale
}

/// Estimate 1-bit GIF/WebP size
pub fn estimate_1bit_size(num_frames: usize, img_size: u32) -> u64 {
    // 1-bit = 1/8 byte per pixel (8 pixels per byte)
    // But with GIF palette overhead and compression

    let pixels_per_frame = img_size * img_size;
    let bytes_per_frame_uncompressed = pixels_per_frame / 8; // 1-bit

    // GIF LZW compression typically achieves 2-4x on QR codes
    // Estimate 3x compression
    let bytes_per_frame_compressed = bytes_per_frame_uncompressed / 3;

    // Add GIF header overhead (~1KB per frame for palette + metadata)
    let bytes_per_frame = bytes_per_frame_compressed + 1024;

    (num_frames as u64 * bytes_per_frame as u64).max(1024)
}

#[cfg(test)]
mod tests {
    use super::*;
    use qrcodegen::QrCode;

    #[test]
    fn test_1bit_render() {
        let qr = QrCode::encode_text("Test", qrcodegen::QrCodeEcc::Low).unwrap();
        let img = render_qr_1bit(&qr).unwrap();

        // Should be close to 177x177
        assert!(img.width() >= 140 && img.width() <= 180);
        assert!(img.height() >= 140 && img.height() <= 180);

        // Check it only contains black (0) and white (255)
        for pixel in img.pixels() {
            assert!(pixel[0] == 0 || pixel[0] == 255);
            assert!(pixel[1] == 0 || pixel[1] == 255);
            assert!(pixel[2] == 0 || pixel[2] == 255);
        }
    }
}
