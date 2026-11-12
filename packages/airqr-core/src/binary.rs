use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use qrcodegen::QrCode;
use std::fs::File;
use std::io::Write;
use std::path::Path;

const MAGIC: &[u8; 5] = b"AIRQR";
const VERSION: u16 = 1;
const HEADER_SIZE: usize = 100;

/// Encode QR code matrix to raw binary (no base64)
/// Each bit represents one module: 1=black, 0=white
/// OPTIMIZATION: Does NOT encode the quiet zone (border) to save space.
pub fn encode_qr_to_binary(qr: &QrCode) -> Vec<u8> {
    let size = qr.size() as usize;
    // No border in binary data!
    let total_bits = size * size;
    let total_bytes = total_bits.div_ceil(8);

    let mut bytes = vec![0u8; total_bytes];
    let mut bit_index = 0;

    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x as i32, y as i32) {
                let byte_idx = bit_index / 8;
                let bit_pos = 7 - (bit_index % 8);
                bytes[byte_idx] |= 1 << bit_pos;
            }
            bit_index += 1;
        }
    }

    bytes
}

/// Create binary file header
fn create_header(num_frames: u32, frame_delay_ms: u16, qr_size: u8) -> Vec<u8> {
    let mut header = vec![0u8; HEADER_SIZE];

    // Magic number "AIRQR"
    header[0..4].copy_from_slice(MAGIC);

    // Version
    header[4..6].copy_from_slice(&VERSION.to_be_bytes());

    // Total frames
    header[6..10].copy_from_slice(&num_frames.to_be_bytes());

    // Frame delay in ms
    header[10..12].copy_from_slice(&frame_delay_ms.to_be_bytes());

    // QR size (RAW size, without border)
    header[12] = qr_size;

    // Reserved bytes for future use (13..100 remain 0)

    header
}

/// Encode frames to binary HTML with embedded data
pub fn encode_frames_to_binary_html(
    qr_frames: Vec<QrCode>,
    output_path: &Path,
    frame_delay_ms: u64,
) -> Result<()> {
    if qr_frames.is_empty() {
        anyhow::bail!("No frames to encode");
    }

    // Encode all frames to binary
    use rayon::prelude::*;
    let frame_binaries: Vec<Vec<u8>> = qr_frames.par_iter().map(encode_qr_to_binary).collect();

    // Create header
    let qr_size = qr_frames[0].size() as u8; // Raw size
    let header = create_header(qr_frames.len() as u32, frame_delay_ms as u16, qr_size);

    // Concatenate all binary data
    let mut binary_data = header;
    for frame in frame_binaries {
        binary_data.extend(frame);
    }

    // Encode to base64 (for embedding in HTML)
    let base64_data = BASE64.encode(&binary_data);

    // Generate HTML with embedded binary data
    let html = generate_binary_html(&base64_data);

    // Write uncompressed HTML
    let mut file = File::create(output_path)?;
    file.write_all(html.as_bytes())?;
    drop(file);

    // Create brotli version
    let br_path = output_path.with_extension("html.br");
    encode_to_brotli(&html, &br_path)?;

    Ok(())
}

/// Generate HTML with binary decoder (minified)
fn generate_binary_html(base64_data: &str) -> String {
    let mut html = String::new();
    html.push_str("<!DOCTYPE html>\n");
    html.push_str("<html><head><meta charset=\"UTF-8\"><title>AirQR Binary</title><style>\n");
    html.push_str("body{background:#111;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;flex-direction:column;font-family:monospace;color:#0f0}\n");
    html.push_str(
        "#qr{image-rendering:pixelated;border:10px solid #0f0;box-shadow:0 0 20px #0f0}\n",
    );
    html.push_str("#info{margin-top:20px;text-align:center}\n");
    html.push_str("</style></head><body>\n");
    html.push_str("<svg id=\"qr\" width=\"400\" height=\"400\" viewBox=\"0 0 177 177\"></svg>\n");
    html.push_str("<div id=\"info\">\n");
    html.push_str("  <div>Frame: <span id=\"frame\">0</span>/<span id=\"total\">0</span></div>\n");
    html.push_str("  <div>FPS: <span id=\"fps\">0</span></div>\n");
    html.push_str("  <div>Format: Binary (No Border)</div>\n");
    html.push_str("</div>\n");
    html.push_str("<script>\n");

    // Embedded base64 data
    html.push_str(&format!("const d=atob(\"{}\");\n", base64_data));

    // Binary decoder (minified)
    html.push_str("const b=new Uint8Array(d.length);\n");
    html.push_str("for(let i=0;i<d.length;i++)b[i]=d.charCodeAt(i);\n");
    html.push_str("const v=new DataView(b.buffer);\n");
    html.push_str("const tf=v.getUint32(6);\n");
    html.push_str("const fd=v.getUint16(10);\n");
    html.push_str("const qs=b[12];\n");
    html.push_str("const fs=Math.ceil(qs*qs/8);\n");
    html.push_str("let fi=0,fc=0,lt=Date.now();\n");
    html.push_str("const s=document.getElementById('qr');\n");
    html.push_str("const fie=document.getElementById('frame');\n");
    html.push_str("const fte=document.getElementById('total');\n");
    html.push_str("const fpse=document.getElementById('fps');\n");
    html.push_str("fte.textContent=tf;\n");

    // Render function
    html.push_str("function r(i){\n");
    html.push_str("  const o=100+i*fs;\n");
    html.push_str("  const fd=b.slice(o,o+fs);\n");
    // Add border in JS
    html.push_str("  const border=4;\n");
    html.push_str("  const total_size=qs+border*2;\n");
    html.push_str("  const sc=177/total_size;\n");
    html.push_str("  let h='<rect width=\"177\" height=\"177\" fill=\"#fff\"/>';\n");
    html.push_str("  for(let j=0;j<qs*qs;j++){\n");
    html.push_str("    const bi=Math.floor(j/8);\n");
    html.push_str("    const bp=7-(j%8);\n");
    html.push_str("    if(fd[bi]&(1<<bp)){\n");
    html.push_str("      const x=((j%qs)+border)*sc;\n");
    html.push_str("      const y=(Math.floor(j/qs)+border)*sc;\n");
    html.push_str("      h+='<rect x=\"'+x.toFixed(1)+'\" y=\"'+y.toFixed(1)+'\" width=\"'+sc+'\" height=\"'+sc+'\" fill=\"#000\"/>';\n");
    html.push_str("    }\n");
    html.push_str("  }\n");
    html.push_str("  s.innerHTML=h;\n");
    html.push_str("}\n");

    // Animation loop
    html.push_str("setInterval(()=>{\n");
    html.push_str("  r(fi);\n");
    html.push_str("  fie.textContent=fi+1;\n");
    html.push_str("  fc++;\n");
    html.push_str("  const n=Date.now();\n");
    html.push_str("  if(n-lt>=1000){fpse.textContent=fc;fc=0;lt=n}\n");
    html.push_str("  fi=(fi+1)%tf;\n");
    html.push_str("},fd);\n");
    html.push_str("r(0);\n");
    html.push_str("</script></body></html>");

    html
}

/// Compress HTML to brotli
fn encode_to_brotli(content: &str, output_path: &Path) -> Result<()> {
    use std::io::Write;

    let file = File::create(output_path)?;
    let mut writer = brotli::CompressorWriter::new(
        file, 4096, // buffer size
        9,    // quality (0-11, 9 = default/fast, 11 = best/slow)
        22,   // lgwin (window size, 22 = 4MB)
    );

    writer.write_all(content.as_bytes())?;
    writer.flush()?;

    Ok(())
}

/// Estimate binary HTML.br size
pub fn estimate_binary_size(num_frames: usize, qr_size: u32) -> u64 {
    let border = 4;
    let total_size = qr_size + border * 2;
    let bits_per_frame = total_size * total_size;
    let bytes_per_frame = bits_per_frame.div_ceil(8);

    // Binary data: header + frames
    let binary_size = HEADER_SIZE as u64 + (num_frames as u64 * bytes_per_frame as u64);

    // Base64 overhead for embedding in HTML (~33%)
    let base64_size = (binary_size as f64 * 1.33) as u64;

    // HTML structure (~2KB)
    let html_size = base64_size + 2000;

    // Brotli compression (better on binary: ~45% of original)
    (html_size as f64 * 0.45) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use qrcodegen::{QrCode, QrCodeEcc};

    #[test]
    fn test_encode_binary() {
        let qr = QrCode::encode_text("Test", QrCodeEcc::Medium).unwrap();
        let binary = encode_qr_to_binary(&qr);

        // Should be compact
        assert!(binary.len() < 1000);
    }

    #[test]
    fn test_size_estimation() {
        let estimated = estimate_binary_size(100, 65);

        // Should be smaller than base64 version
        assert!(estimated > 0);
        assert!(estimated < 100_000);
    }
}
