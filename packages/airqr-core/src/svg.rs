use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use qrcodegen::QrCode;
use std::fs::File;
use std::io::Write;
use std::path::Path;

/// Encode QR code matrix to compact binary format (base64)
/// Each bit represents one module: 1=black, 0=white
pub fn encode_qr_to_base64(qr: &QrCode) -> String {
    let size = qr.size() as usize;
    let border = 4;
    let total_size = size + border * 2;

    // Calculate total bits needed
    let total_modules = total_size * total_size;
    let total_bytes = total_modules.div_ceil(8); // Round up to nearest byte

    let mut bytes = vec![0u8; total_bytes];
    let mut bit_index = 0;

    // Encode matrix with border
    for y in 0..total_size {
        for x in 0..total_size {
            let is_black = if x < border || y < border || x >= size + border || y >= size + border {
                false // Border is white
            } else {
                qr.get_module((x - border) as i32, (y - border) as i32)
            };

            if is_black {
                let byte_idx = bit_index / 8;
                let bit_pos = 7 - (bit_index % 8);
                bytes[byte_idx] |= 1 << bit_pos;
            }

            bit_index += 1;
        }
    }

    // Prepend size as single byte
    let mut data = vec![total_size as u8];
    data.extend_from_slice(&bytes);

    BASE64.encode(&data)
}

/// Encode multiple QR frames to animated SVG HTML file
pub fn encode_frames_to_svg_html(
    qr_frames: Vec<QrCode>,
    output_path: &Path,
    frame_delay_ms: u64,
) -> Result<()> {
    // Encode all frames to base64
    let encoded_frames: Vec<String> = qr_frames.iter().map(encode_qr_to_base64).collect();

    // Generate HTML with embedded JavaScript
    let html = generate_svg_html(&encoded_frames, frame_delay_ms);

    // Write uncompressed HTML
    let mut file = File::create(output_path)?;
    file.write_all(html.as_bytes())?;
    drop(file);

    // Also create gzipped version
    let gz_path = output_path.with_extension("html.gz");
    encode_to_gzip(&html, &gz_path)?;

    // Also create brotli version
    let br_path = output_path.with_extension("html.br");
    encode_to_brotli(&html, &br_path)?;

    Ok(())
}

/// Compress HTML content to gzip format
fn encode_to_gzip(content: &str, output_path: &Path) -> Result<()> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    let file = File::create(output_path)?;
    let mut encoder = GzEncoder::new(file, Compression::best());
    encoder.write_all(content.as_bytes())?;
    encoder.finish()?;

    Ok(())
}

/// Compress HTML content to brotli format
fn encode_to_brotli(content: &str, output_path: &Path) -> Result<()> {
    use std::io::Write;

    let file = File::create(output_path)?;
    let mut writer = brotli::CompressorWriter::new(
        file, 4096, // buffer size
        11,   // quality (0-11, 11 = best compression)
        22,   // lgwin (window size, 22 = 4MB)
    );

    writer.write_all(content.as_bytes())?;
    writer.flush()?;

    Ok(())
}

/// Generate complete HTML document with animated SVG
fn generate_svg_html(frames: &[String], delay_ms: u64) -> String {
    let frames_json = frames
        .iter()
        .map(|f| format!("\"{}\"", f))
        .collect::<Vec<_>>()
        .join(",");

    let mut html = String::new();
    html.push_str("<!DOCTYPE html>\n");
    html.push_str("<html><head><meta charset=\"UTF-8\"><title>AirQR Animated</title><style>\n");
    html.push_str("body{background:#111;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column;font-family:monospace;color:#0f0}\n");
    html.push_str(
        "#qr{image-rendering:pixelated;border:10px solid #0f0;box-shadow:0 0 20px #0f0}\n",
    );
    html.push_str("#info{margin-top:20px;text-align:center}\n");
    html.push_str("</style></head><body>\n");
    html.push_str("<svg id=\"qr\" width=\"400\" height=\"400\" viewBox=\"0 0 177 177\"></svg>\n");
    html.push_str("<div id=\"info\">\n");
    html.push_str(&format!(
        "  <div>Frame: <span id=\"frame\">1</span>/<span id=\"total\">{}</span></div>\n",
        frames.len()
    ));
    html.push_str("  <div>FPS: <span id=\"fps\">0</span></div>\n");
    html.push_str("</div>\n");
    html.push_str("<script>\n");
    html.push_str(&format!("const F=[{}];\n", frames_json));
    html.push_str("let i=0,fps=0,fc=0,lt=Date.now();\n");
    html.push_str("const s=document.getElementById('qr'),fi=document.getElementById('frame'),fpsEl=document.getElementById('fps');\n");
    html.push_str("function r(d){\n");
    html.push_str("  const b=atob(d),sz=b.charCodeAt(0),ms=sz*sz,sc=177/sz;\n");
    html.push_str("  let h='<rect width=\"177\" height=\"177\" fill=\"#fff\"/>';\n");
    html.push_str("  for(let j=1,k=0;k<ms;k++){\n");
    html.push_str("    const by=b.charCodeAt(j+(k>>3)),bt=7-(k&7);\n");
    html.push_str("    if(by&(1<<bt)){\n");
    html.push_str("      const x=(k%sz)*sc,y=Math.floor(k/sz)*sc;\n");
    html.push_str("      h+='<rect x=\"'+x.toFixed(1)+'\" y=\"'+y.toFixed(1)+'\" width=\"'+sc+'\" height=\"'+sc+'\" fill=\"#000\"/>';\n");
    html.push_str("    }\n");
    html.push_str("  }\n");
    html.push_str("  s.innerHTML=h;\n");
    html.push_str("}\n");
    html.push_str(&format!("setInterval(()=>{{\n  r(F[i]);\n  fi.textContent=i+1;\n  fc++;\n  const n=Date.now();\n  if(n-lt>=1000){{fpsEl.textContent=fc;fc=0;lt=n}}\n  i=(i+1)%F.length;\n}},{});\n", delay_ms));
    html.push_str("document.getElementById('total').textContent=F.length;\n");
    html.push_str("r(F[0]);\n");
    html.push_str("</script></body></html>");

    html
}

/// Estimate SVG HTML file size
pub fn estimate_svg_size(num_frames: usize, qr_size: u32) -> u64 {
    let border = 4;
    let total_size = qr_size + border * 2;

    // Size byte + binary data
    let bits_per_frame = total_size * total_size;
    let bytes_per_frame = 1 + bits_per_frame.div_ceil(8);

    // Base64 overhead (~1.33x)
    let base64_per_frame = (bytes_per_frame as f64 * 1.33) as u64;

    // HTML structure overhead
    let html_overhead = 1500;

    // Frame data + separators

    html_overhead + (base64_per_frame * num_frames as u64) + (num_frames as u64 * 3)
}

#[cfg(test)]
mod tests {
    use super::*;
    use qrcodegen::{QrCode, QrCodeEcc};

    #[test]
    fn test_encode_decode() {
        let qr = QrCode::encode_text("Test", QrCodeEcc::Medium).unwrap();
        let encoded = encode_qr_to_base64(&qr);

        // Should be compact (less than 1KB for small QR)
        assert!(encoded.len() < 1000);

        // Should be valid base64
        assert!(BASE64.decode(&encoded).is_ok());
    }

    #[test]
    fn test_size_estimation() {
        let estimated = estimate_svg_size(18, 65);

        // For 18 frames, should be ~13KB
        assert!(estimated > 10_000 && estimated < 20_000);
    }
}
