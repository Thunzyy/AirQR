use airqr_core::{AirqrEncoder, EncoderConfig};
use crossterm::{
    cursor::{Hide, MoveTo, Show},
    execute, queue,
    style::Print,
    terminal::{
        size as terminal_size, Clear, ClearType, EnterAlternateScreen, LeaveAlternateScreen,
    },
};
use indicatif::{ProgressBar, ProgressStyle};
use qrcodegen::{QrCode, QrCodeEcc};
use std::borrow::Cow;
use std::env;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use std::time::Duration;

const TERMINAL_QR_STYLE_ON: &str = "\x1b[30;47m";
const TERMINAL_QR_STYLE_OFF: &str = "\x1b[0m";
static PLAYBACK_INTERRUPTED: OnceLock<Arc<AtomicBool>> = OnceLock::new();

fn print_usage(bin_name: &str) {
    println!("Usage: {bin_name} <file_path> [options]");
    println!("Options:");
    println!("  --no-compression      Disable compression (archive only)");
    println!("  --show-qr             Print first QR frame in terminal for scanning");
    println!("  --play-qr             Play all QR frames in terminal in a loop");
    println!("  --play-loops <n>      Number of playback loops (0 = infinite, default: 0)");
    println!("  --play-delay-ms <n>   Playback delay in ms (default: frame delay from config)");
    println!("  --terminal-scale <n>  Terminal QR scale (default: AIRQR_TERMINAL_SCALE or 1)");
    println!("  --terminal-x <n>      Start column (0-based, default: AIRQR_TERMINAL_X or 0)");
    println!("  --terminal-y <n>      Start row (0-based, default: AIRQR_TERMINAL_Y or 0)");
    println!("  --output <path>       Output GIF path (default: output.gif)");
    println!("  --qr-size <n>         Alias of --terminal-scale");
    println!("  --packet-size <n>     RaptorQ packet size in bytes (default: web-mode 800)");
    println!("  --raptorq-overhead <x> RaptorQ overhead ratio (default: web-mode 1.2)");
    println!("  --ecc <level>         ECC level: LOW | MEDIUM | QUARTILE | HIGH");
    println!("  note: playback auto-fits QR to terminal if needed");
    println!("  note: --show-qr / --play-qr use deflate compression (web decoder compatibility)");
    println!("  -h, --help            Show this help");
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = env::args().collect();
    let bin_name = args.first().map(String::as_str).unwrap_or("encode");

    if args.len() == 1 {
        print_usage(bin_name);
        return Ok(());
    }

    let mut input_path: Option<String> = None;
    let mut output_path = "output.gif".to_string();
    let mut compression_enabled = true;
    let mut show_qr = false;
    let mut play_qr = false;
    let mut play_loops: u32 = 0;
    let mut ecc_override: Option<QrCodeEcc> = None;
    let mut packet_size_override: Option<u16> = None;
    let mut raptorq_overhead_override: Option<f32> = None;
    let mut play_delay_ms_override: Option<u64> = env::var("AIRQR_PLAY_DELAY_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0);
    let mut terminal_scale: u8 = env::var("AIRQR_TERMINAL_SCALE")
        .ok()
        .or_else(|| env::var("AIRQR_QR_SIZE").ok())
        .and_then(|v| v.parse::<u8>().ok())
        .filter(|s| *s > 0)
        .unwrap_or(1);
    let mut terminal_x: u16 = env::var("AIRQR_TERMINAL_X")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(0);
    let mut terminal_y: u16 = env::var("AIRQR_TERMINAL_Y")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(0);

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-h" | "--help" => {
                print_usage(bin_name);
                return Ok(());
            }
            "--no-compression" => {
                compression_enabled = false;
                i += 1;
            }
            "--show-qr" => {
                show_qr = true;
                i += 1;
            }
            "--play-qr" => {
                play_qr = true;
                i += 1;
            }
            "--play-loops" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --play-loops"));
                }
                play_loops = args[i]
                    .parse::<u32>()
                    .map_err(|_| anyhow::anyhow!("--play-loops expects a non-negative integer"))?;
                play_qr = true;
                i += 1;
            }
            "--play-delay-ms" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --play-delay-ms"));
                }
                let parsed = args[i]
                    .parse::<u64>()
                    .map_err(|_| anyhow::anyhow!("--play-delay-ms expects an integer > 0"))?;
                if parsed == 0 {
                    return Err(anyhow::anyhow!("--play-delay-ms must be > 0"));
                }
                play_delay_ms_override = Some(parsed);
                play_qr = true;
                i += 1;
            }
            "--terminal-scale" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --terminal-scale"));
                }
                terminal_scale = args[i]
                    .parse::<u8>()
                    .map_err(|_| anyhow::anyhow!("--terminal-scale expects an integer > 0"))?;
                if terminal_scale == 0 {
                    return Err(anyhow::anyhow!("--terminal-scale must be > 0"));
                }
                i += 1;
            }
            "--terminal-x" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --terminal-x"));
                }
                terminal_x = args[i]
                    .parse::<u16>()
                    .map_err(|_| anyhow::anyhow!("--terminal-x expects an integer >= 0"))?;
                i += 1;
            }
            "--terminal-y" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --terminal-y"));
                }
                terminal_y = args[i]
                    .parse::<u16>()
                    .map_err(|_| anyhow::anyhow!("--terminal-y expects an integer >= 0"))?;
                i += 1;
            }
            "--output" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --output"));
                }
                output_path = args[i].clone();
                i += 1;
            }
            "--packet-size" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --packet-size"));
                }
                let parsed = args[i]
                    .parse::<u16>()
                    .map_err(|_| anyhow::anyhow!("--packet-size expects an integer >= 4"))?;
                if parsed < 4 {
                    return Err(anyhow::anyhow!("--packet-size must be >= 4"));
                }
                packet_size_override = Some(parsed);
                i += 1;
            }
            "--raptorq-overhead" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --raptorq-overhead"));
                }
                let parsed = args[i]
                    .parse::<f32>()
                    .map_err(|_| anyhow::anyhow!("--raptorq-overhead expects a number > 0"))?;
                if !parsed.is_finite() || parsed <= 0.0 {
                    return Err(anyhow::anyhow!("--raptorq-overhead must be > 0"));
                }
                raptorq_overhead_override = Some(parsed);
                i += 1;
            }
            "--ecc" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --ecc"));
                }
                let parsed = match args[i].to_ascii_uppercase().as_str() {
                    "LOW" => QrCodeEcc::Low,
                    "MEDIUM" => QrCodeEcc::Medium,
                    "QUARTILE" => QrCodeEcc::Quartile,
                    "HIGH" => QrCodeEcc::High,
                    _ => {
                        return Err(anyhow::anyhow!(
                            "--ecc expects one of: LOW, MEDIUM, QUARTILE, HIGH"
                        ))
                    }
                };
                ecc_override = Some(parsed);
                i += 1;
            }
            "--qr-size" => {
                i += 1;
                if i >= args.len() {
                    return Err(anyhow::anyhow!("Missing value for --qr-size"));
                }
                terminal_scale = args[i]
                    .parse::<u8>()
                    .map_err(|_| anyhow::anyhow!("--qr-size expects an integer > 0"))?;
                if terminal_scale == 0 {
                    return Err(anyhow::anyhow!("--qr-size must be > 0"));
                }
                i += 1;
            }
            value if value.starts_with('-') => {
                return Err(anyhow::anyhow!("Unknown option: {}", value));
            }
            value => {
                if input_path.is_some() {
                    return Err(anyhow::anyhow!("Unexpected extra argument: {}", value));
                }
                input_path = Some(value.to_string());
                i += 1;
            }
        }
    }

    let input_path = input_path.ok_or_else(|| anyhow::anyhow!("Missing <file_path> argument"))?;
    let web_compat_compression = (show_qr || play_qr) && compression_enabled;
    let web_mode = show_qr || play_qr;
    let default_packet_size = if web_mode { 800 } else { 250 };
    let default_raptorq_overhead = if web_mode { 1.2 } else { 1.5 };
    let default_ecc = QrCodeEcc::Medium;
    let mut packet_size = packet_size_override.unwrap_or(default_packet_size);
    let raptorq_overhead = raptorq_overhead_override.unwrap_or(default_raptorq_overhead);
    let ecc = ecc_override.unwrap_or(default_ecc);
    let packet_size_locked = packet_size_override.is_some();

    if play_qr && !packet_size_locked {
        if let Ok((cols, rows)) = terminal_size() {
            if terminal_x < cols && terminal_y < rows {
                let available_cols = cols.saturating_sub(terminal_x) as usize;
                let available_rows = rows.saturating_sub(terminal_y) as usize;
                if let Some(adjusted_packet_size) =
                    auto_packet_size_for_terminal(packet_size, ecc, available_cols, available_rows)
                {
                    if adjusted_packet_size < packet_size {
                        println!(
                            "ℹ️ Terminal auto-fit packet size: {} -> {} (available: {}x{}, terminal: {}x{}).",
                            packet_size,
                            adjusted_packet_size,
                            available_cols,
                            available_rows,
                            cols,
                            rows
                        );
                        packet_size = adjusted_packet_size;
                    }
                }
            }
        }
    }

    println!("Encoding: {}", input_path);
    println!(
        "Compression: {}",
        if compression_enabled {
            "enabled"
        } else {
            "disabled"
        }
    );
    println!("Output: {}", output_path);
    println!(
        "Terminal QR: {}",
        if show_qr { "enabled" } else { "disabled" }
    );
    println!(
        "Terminal playback: {}",
        if play_qr { "enabled" } else { "disabled" }
    );
    if web_compat_compression {
        println!("Compression mode: deflate (Web scanner compatibility)");
    }
    println!(
        "ECC: {}",
        match ecc {
            QrCodeEcc::Low => "LOW",
            QrCodeEcc::Medium => "MEDIUM",
            QrCodeEcc::Quartile => "QUARTILE",
            QrCodeEcc::High => "HIGH",
        }
    );
    println!("Packet size: {}", packet_size);
    println!("RaptorQ overhead: {:.2}", raptorq_overhead);
    if play_qr {
        println!(
            "Playback loops: {}",
            if play_loops == 0 {
                "infinite".to_string()
            } else {
                play_loops.to_string()
            }
        );
    }
    println!("Terminal scale: {}", terminal_scale);
    if play_qr {
        if let Some(delay) = play_delay_ms_override {
            println!("Playback delay: {} ms", delay);
        }
        println!("Terminal position: x={}, y={}", terminal_x, terminal_y);
    }
    println!();

    let config = EncoderConfig {
        compression_enabled,
        ecc,
        packet_size,
        raptorq_overhead,
        ..EncoderConfig::default()
    };
    let playback_delay_ms = play_delay_ms_override.unwrap_or(config.frame_delay_ms);

    let path_obj = Path::new(&input_path);
    let is_directory = path_obj.is_dir();

    // Phase 1: Show file/folder info
    if is_directory {
        let file_count = count_files_recursive(path_obj)?;
        println!("📁 Found {} files in directory", file_count);
    } else {
        let metadata = std::fs::metadata(path_obj)?;
        println!("📄 File size: {:.2} KB", metadata.len() as f64 / 1024.0);
    }

    // Create a progress bar
    let pb = ProgressBar::new(0);
    pb.set_style(
        ProgressStyle::default_spinner()
            .template("{spinner:.cyan} {msg}")
            .unwrap()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]),
    );
    pb.enable_steady_tick(std::time::Duration::from_millis(80));

    let encoder = AirqrEncoder::new(config);
    let mut current_state = String::new();
    let mut terminal_frames: Vec<String> = Vec::new();

    let gif_data = encoder.encode_file_with_progress_and_terminal_frames(
        &input_path,
        show_qr,
        play_qr,
        terminal_scale,
        |progress| {
            match progress {
            airqr_core::EncodeProgress::Starting => {
                pb.set_message("Starting...");
            },
            airqr_core::EncodeProgress::Reading => {
                pb.set_message("📄 Reading file...");
            },
            airqr_core::EncodeProgress::Archiving => {
                pb.set_message(if compression_enabled {
                    "📦 Creating and compressing ZIP archive..."
                } else {
                    "📦 Creating ZIP archive (no compression)..."
                });
            },
            airqr_core::EncodeProgress::Compressing { current, total } => {
                if current_state != "compressing" {
                    pb.disable_steady_tick();
                    pb.set_style(
                        ProgressStyle::default_bar()
                            .template("{spinner:.green} [{elapsed_precise}] {msg} {bar:30.cyan/blue} {bytes}/{total_bytes} ({eta})")
                            .unwrap()
                            .progress_chars("#>-")
                    );
                    pb.set_message("🗜️ Compressing data");
                    pb.set_length(total as u64);
                    current_state = "compressing".to_string();
                }
                pb.set_position(current as u64);
            },
            airqr_core::EncodeProgress::InitializingRaptorQ => {
                if current_state != "init_raptorq" {
                    pb.enable_steady_tick(std::time::Duration::from_millis(80));
                    pb.set_style(
                        ProgressStyle::default_spinner()
                            .template("{spinner:.cyan} [{elapsed_precise}] {msg}")
                            .unwrap()
                            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"])
                    );
                    pb.set_message("⚙️ Initializing RaptorQ encoder (this may take a moment)...");
                    current_state = "init_raptorq".to_string();
                }
            },
            airqr_core::EncodeProgress::GeneratingPackets { current, total } => {
                 if current_state != "generating" {
                    pb.disable_steady_tick();
                    pb.set_style(
                        ProgressStyle::default_bar()
                            .template("{spinner:.green} [{elapsed_precise}] {msg} {bar:30.cyan/blue} {pos}/{len}")
                            .unwrap()
                            .progress_chars("#>-")
                    );
                    pb.set_message("🧩 Generating RaptorQ packets");
                    pb.set_length(total as u64);
                    current_state = "generating".to_string();
                }
                pb.set_position(current as u64);
            },
            airqr_core::EncodeProgress::Info(msg) => {
                pb.println(format!("ℹ️ {}", msg));
            },
            airqr_core::EncodeProgress::QrPreview(preview) => {
                pb.suspend(|| {
                    println!();
                    println!("🔳 Scan this QR code directly from the terminal:");
                    print!("{TERMINAL_QR_STYLE_ON}{preview}{TERMINAL_QR_STYLE_OFF}");
                    println!();
                });
            },
            airqr_core::EncodeProgress::QrFrame { frame, .. } => {
                terminal_frames.push(frame);
            },
            airqr_core::EncodeProgress::RenderingFrames { current, total } => {
                if current_state != "rendering" {
                    pb.disable_steady_tick();
                    pb.set_style(
                        ProgressStyle::default_bar()
                            .template("{spinner:.green} [{elapsed_precise}] {msg} {bar:30.cyan/blue} {pos}/{len} ({eta})")
                            .unwrap()
                            .progress_chars("#>-")
                    );
                    pb.set_message("🖼️ Rendering QR frames");
                    pb.set_length(total as u64);
                    current_state = "rendering".to_string();
                }
                pb.set_position(current as u64);
            },
            airqr_core::EncodeProgress::EncodingGif { current, total } => {
                if current_state != "encoding_gif" {
                    pb.disable_steady_tick();
                    pb.set_style(
                        ProgressStyle::default_bar()
                            .template("{spinner:.green} [{elapsed_precise}] {msg} {bar:30.cyan/blue} {pos}/{len} ({eta})")
                            .unwrap()
                            .progress_chars("#>-")
                    );
                    pb.set_message("🎞️ Encoding GIF");
                    pb.set_length(total as u64);
                    current_state = "encoding_gif".to_string();
                }
                pb.set_position(current as u64);
            },
            airqr_core::EncodeProgress::Done => {
                pb.finish_with_message("✓ Encoding complete!");
            }
        }
    })?;

    // Save output
    let mut file = File::create(&output_path)?;
    file.write_all(&gif_data)?;

    println!();
    println!("✓ Success! GIF saved to {}", output_path);
    println!("  Output size: {:.2} KB", gif_data.len() as f64 / 1024.0);

    if play_qr {
        if terminal_frames.is_empty() {
            println!("⚠️ No terminal QR frames captured for playback.");
        } else {
            play_qr_frames_loop(
                &terminal_frames,
                playback_delay_ms,
                play_loops,
                terminal_x,
                terminal_y,
                terminal_scale,
            )?;
        }
    }

    // Show original size if applicable
    if is_directory {
        let total_size = calculate_directory_size(path_obj)?;
        println!("  Original: {:.2} KB", total_size as f64 / 1024.0);
        if gif_data.len() < total_size as usize {
            let ratio = (1.0 - (gif_data.len() as f64 / total_size as f64)) * 100.0;
            println!("  Compression: {:.1}% smaller", ratio);
        } else {
            let ratio = ((gif_data.len() as f64 / total_size as f64) - 1.0) * 100.0;
            println!("  Expansion: {:.1}% larger (QR code overhead)", ratio);
        }
    }

    Ok(())
}

fn play_qr_frames_loop(
    frames: &[String],
    frame_delay_ms: u64,
    loops: u32,
    origin_x: u16,
    origin_y: u16,
    source_scale: u8,
) -> anyhow::Result<()> {
    if frames.is_empty() {
        return Ok(());
    }

    let mut stdout = std::io::stdout();
    let frame_width = frames
        .first()
        .and_then(|f| f.lines().map(|l| l.chars().count()).max())
        .unwrap_or(0);
    let frame_height = frames.first().map(|f| f.lines().count()).unwrap_or(0);
    let mut playback_frames: Cow<'_, [String]> = Cow::Borrowed(frames);

    if let Ok((cols, rows)) = terminal_size() {
        if origin_x >= cols || origin_y >= rows {
            println!(
                "⚠️ Terminal position out of bounds (x={}, y={}, terminal: {}x{}).",
                origin_x, origin_y, cols, rows
            );
            return Ok(());
        }

        let available_cols = cols.saturating_sub(origin_x);
        let available_rows = rows.saturating_sub(origin_y);
        if frame_width > available_cols as usize || frame_height > available_rows as usize {
            match auto_fit_frames_for_terminal(
                frames,
                available_cols as usize,
                available_rows as usize,
                source_scale,
            )? {
                Some((fitted, fitted_width, fitted_height, fitted_scale)) => {
                    println!(
                        "ℹ️ Auto-fit QR playback: scale {} -> {} ({}x{} -> {}x{}).",
                        source_scale,
                        fitted_scale,
                        frame_width,
                        frame_height,
                        fitted_width,
                        fitted_height
                    );
                    playback_frames = Cow::Owned(fitted);
                }
                None => {
                    println!(
                        "⚠️ Terminal too small for current QR size at this position (frame: {}x{}, available: {}x{}, terminal: {}x{}).",
                        frame_width, frame_height, available_cols, available_rows, cols, rows
                    );
                    println!(
                        "   Auto-fit failed. Reduce --terminal-scale or move it with --terminal-x / --terminal-y."
                    );
                    return Ok(());
                }
            }
        }
    }

    println!();
    println!("▶ Starting terminal QR playback.");
    println!("  Press Ctrl+C to stop.");
    std::thread::sleep(Duration::from_millis(800));

    let terminal_screen = PlaybackTerminalScreen::enter(&mut stdout)?;

    let interrupted = playback_interrupt_flag();
    interrupted.store(false, Ordering::SeqCst);
    let (canvas_width, canvas_height) = max_frame_dimensions(playback_frames.as_ref());

    let infinite = loops == 0;
    let mut loop_idx: u32 = 0;

    while infinite || loop_idx < loops {
        if interrupted.load(Ordering::SeqCst) {
            break;
        }
        for frame in playback_frames.iter() {
            if interrupted.load(Ordering::SeqCst) {
                break;
            }
            draw_frame_at(
                &mut stdout,
                frame,
                origin_x,
                origin_y,
                canvas_width,
                canvas_height,
            )?;
            stdout.flush()?;
            sleep_with_interrupt(frame_delay_ms, &interrupted);
        }
        if interrupted.load(Ordering::SeqCst) {
            break;
        }
        loop_idx += 1;
    }

    drop(terminal_screen);

    if interrupted.load(Ordering::SeqCst) {
        println!("Terminal QR playback interrupted.");
    } else {
        println!("Terminal QR playback finished.");
    }
    Ok(())
}

fn playback_interrupt_flag() -> Arc<AtomicBool> {
    let flag = PLAYBACK_INTERRUPTED.get_or_init(|| {
        let flag = Arc::new(AtomicBool::new(false));
        let handler_flag = Arc::clone(&flag);
        let _ = ctrlc::set_handler(move || {
            handler_flag.store(true, Ordering::SeqCst);
        });
        flag
    });
    Arc::clone(flag)
}

fn sleep_with_interrupt(delay_ms: u64, interrupted: &AtomicBool) {
    let mut slept_ms: u64 = 0;
    while slept_ms < delay_ms {
        if interrupted.load(Ordering::SeqCst) {
            break;
        }
        let chunk = (delay_ms - slept_ms).min(25);
        std::thread::sleep(Duration::from_millis(chunk));
        slept_ms += chunk;
    }
}

struct PlaybackTerminalScreen;

impl PlaybackTerminalScreen {
    fn enter(stdout: &mut std::io::Stdout) -> anyhow::Result<Self> {
        execute!(
            stdout,
            EnterAlternateScreen,
            Hide,
            MoveTo(0, 0),
            Clear(ClearType::All)
        )?;
        stdout.flush()?;
        Ok(Self)
    }
}

impl Drop for PlaybackTerminalScreen {
    fn drop(&mut self) {
        let mut stdout = std::io::stdout();
        let _ = execute!(stdout, Show, LeaveAlternateScreen);
        let _ = stdout.flush();
    }
}

fn max_frame_dimensions(frames: &[String]) -> (usize, usize) {
    frames
        .iter()
        .fold((0usize, 0usize), |(max_w, max_h), frame| {
            let (w, h) = frame_dimensions(frame);
            (max_w.max(w), max_h.max(h))
        })
}

fn draw_frame_at(
    stdout: &mut std::io::Stdout,
    frame: &str,
    origin_x: u16,
    origin_y: u16,
    canvas_width: usize,
    canvas_height: usize,
) -> anyhow::Result<()> {
    let lines: Vec<&str> = frame.lines().collect();

    for row in 0..canvas_height {
        let y = origin_y.saturating_add(row as u16);
        let line = lines.get(row).copied().unwrap_or("");
        let line_width = line.chars().count();
        let pad_len = canvas_width.saturating_sub(line_width);
        let padding = " ".repeat(pad_len);

        queue!(
            stdout,
            MoveTo(origin_x, y),
            Print(TERMINAL_QR_STYLE_ON),
            Print(line),
            Print(padding),
            Print(TERMINAL_QR_STYLE_OFF)
        )?;
    }

    Ok(())
}

type FittedTerminalFrames = (Vec<String>, usize, usize, u8);

fn auto_fit_frames_for_terminal(
    frames: &[String],
    available_cols: usize,
    available_rows: usize,
    source_scale: u8,
) -> anyhow::Result<Option<FittedTerminalFrames>> {
    if frames.is_empty() || available_cols == 0 || available_rows == 0 {
        return Ok(None);
    }

    let (original_width, original_height) = frame_dimensions(&frames[0]);
    if original_width <= available_cols && original_height <= available_rows {
        return Ok(None);
    }

    let first_bitmap = parse_ascii_qr_frame(&frames[0])?;
    let bitmap_height = first_bitmap.len();
    let bitmap_width = first_bitmap.first().map(|row| row.len()).unwrap_or(0);
    if bitmap_width == 0 || bitmap_height == 0 {
        return Ok(None);
    }

    let source_scale = source_scale.max(1) as usize;
    if bitmap_width % source_scale != 0 || bitmap_height % source_scale != 0 {
        return Ok(None);
    }

    let module_width = bitmap_width / source_scale;
    let module_height = bitmap_height / source_scale;
    if module_width == 0 || module_height == 0 {
        return Ok(None);
    }

    let mut fitted_scale: Option<usize> = None;
    for candidate_scale in (1..=source_scale).rev() {
        let candidate_width = module_width.saturating_mul(candidate_scale);
        let candidate_height = div_ceil(module_height.saturating_mul(candidate_scale), 2);
        if candidate_width <= available_cols && candidate_height <= available_rows {
            fitted_scale = Some(candidate_scale);
            break;
        }
    }

    let fitted_scale = match fitted_scale {
        Some(scale) => scale,
        None => return Ok(None),
    };

    let module_first = collapse_scaled_bitmap(&first_bitmap, source_scale)?;
    let fitted_first = upscale_bitmap_nearest(&module_first, fitted_scale);
    let rendered_first = render_bitmap_compact(&fitted_first);
    let (fitted_width, fitted_height) = frame_dimensions(&rendered_first);

    if fitted_width > available_cols || fitted_height > available_rows {
        return Ok(None);
    }

    let mut fitted_frames = Vec::with_capacity(frames.len());
    fitted_frames.push(rendered_first);
    for frame in frames.iter().skip(1) {
        let bitmap = parse_ascii_qr_frame(frame)?;
        let module_bitmap = collapse_scaled_bitmap(&bitmap, source_scale)?;
        let fitted_bitmap = upscale_bitmap_nearest(&module_bitmap, fitted_scale);
        fitted_frames.push(render_bitmap_compact(&fitted_bitmap));
    }

    Ok(Some((
        fitted_frames,
        fitted_width,
        fitted_height,
        fitted_scale as u8,
    )))
}

fn parse_ascii_qr_frame(frame: &str) -> anyhow::Result<Vec<Vec<bool>>> {
    let lines: Vec<&str> = frame.lines().collect();
    if lines.is_empty() {
        return Err(anyhow::anyhow!("Cannot parse empty terminal QR frame"));
    }

    let mut bitmap: Vec<Vec<bool>> = Vec::with_capacity(lines.len());
    let mut expected_width: Option<usize> = None;

    for line in lines {
        let chars: Vec<char> = line.chars().collect();
        if !chars.len().is_multiple_of(2) {
            return Err(anyhow::anyhow!("Malformed terminal QR frame width"));
        }

        let mut row: Vec<bool> = Vec::with_capacity(chars.len() / 2);
        for idx in (0..chars.len()).step_by(2) {
            row.push(chars[idx] == '█');
        }

        match expected_width {
            Some(width) if width != row.len() => {
                return Err(anyhow::anyhow!("Inconsistent terminal QR frame row width"));
            }
            None => expected_width = Some(row.len()),
            _ => {}
        }

        bitmap.push(row);
    }

    Ok(bitmap)
}

fn collapse_scaled_bitmap(bitmap: &[Vec<bool>], scale: usize) -> anyhow::Result<Vec<Vec<bool>>> {
    let height = bitmap.len();
    let width = bitmap.first().map(|row| row.len()).unwrap_or(0);
    if height == 0 || width == 0 {
        return Err(anyhow::anyhow!("Cannot collapse empty bitmap"));
    }

    let scale = scale.max(1);
    if !width.is_multiple_of(scale) || !height.is_multiple_of(scale) {
        return Err(anyhow::anyhow!(
            "Bitmap dimensions are not divisible by source scale"
        ));
    }

    let out_width = width / scale;
    let out_height = height / scale;

    let mut out = vec![vec![false; out_width]; out_height];
    for (out_y, out_row) in out.iter_mut().enumerate() {
        let src_y = out_y * scale;
        for (out_x, cell) in out_row.iter_mut().enumerate() {
            let src_x = out_x * scale;
            *cell = bitmap[src_y][src_x];
        }
    }

    Ok(out)
}

fn upscale_bitmap_nearest(bitmap: &[Vec<bool>], scale: usize) -> Vec<Vec<bool>> {
    let height = bitmap.len();
    let width = bitmap.first().map(|row| row.len()).unwrap_or(0);
    if height == 0 || width == 0 {
        return Vec::new();
    }

    let scale = scale.max(1);
    let out_width = width * scale;
    let out_height = height * scale;

    let mut out = vec![vec![false; out_width]; out_height];
    for (out_y, out_row) in out.iter_mut().enumerate() {
        let src_y = out_y / scale;
        for (out_x, cell) in out_row.iter_mut().enumerate() {
            let src_x = out_x / scale;
            *cell = bitmap[src_y][src_x];
        }
    }

    out
}

fn render_bitmap_compact(bitmap: &[Vec<bool>]) -> String {
    let height = bitmap.len();
    let width = bitmap.first().map(|row| row.len()).unwrap_or(0);
    if height == 0 || width == 0 {
        return String::new();
    }

    let compact_rows = div_ceil(height, 2);
    let mut out = String::new();

    for row in 0..compact_rows {
        let top_y = row * 2;
        let bottom_y = top_y + 1;

        for (x, top) in bitmap[top_y].iter().copied().enumerate() {
            let bottom = bitmap
                .get(bottom_y)
                .map(|bottom_row| bottom_row[x])
                .unwrap_or(false);

            let ch = match (top, bottom) {
                (false, false) => ' ',
                (true, false) => '▀',
                (false, true) => '▄',
                (true, true) => '█',
            };
            out.push(ch);
        }

        if row + 1 < compact_rows {
            out.push('\n');
        }
    }

    out
}

fn frame_dimensions(frame: &str) -> (usize, usize) {
    let width = frame
        .lines()
        .map(|line| line.chars().count())
        .max()
        .unwrap_or(0);
    let height = frame.lines().count();
    (width, height)
}

fn auto_packet_size_for_terminal(
    preferred_packet_size: u16,
    ecc: QrCodeEcc,
    available_cols: usize,
    available_rows: usize,
) -> Option<u16> {
    if available_cols == 0 || available_rows == 0 {
        return None;
    }

    // Playback auto-fit renders compact terminal QR without extra quiet-zone margin:
    // width = qr_size, height = ceil(qr_size/2).
    let max_modules_total = available_cols.min(available_rows.saturating_mul(2));
    let max_qr_size = max_modules_total;
    if max_qr_size < 21 {
        return None;
    }

    let min_packet_size = 4u16;
    if !packet_size_fits_terminal(min_packet_size, ecc, max_qr_size) {
        return None;
    }

    let mut low = min_packet_size;
    let mut high = preferred_packet_size.max(min_packet_size);

    while low < high {
        let mid = low + (high - low).div_ceil(2);
        if packet_size_fits_terminal(mid, ecc, max_qr_size) {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    Some(low)
}

fn packet_size_fits_terminal(packet_size: u16, ecc: QrCodeEcc, max_qr_size: usize) -> bool {
    let frame_payload_len = 10usize + packet_size as usize;
    let sample_data = vec![0u8; frame_payload_len];
    match QrCode::encode_binary(&sample_data, ecc) {
        Ok(qr) => (qr.size() as usize) <= max_qr_size,
        Err(_) => false,
    }
}

fn div_ceil(value: usize, divisor: usize) -> usize {
    if divisor == 0 {
        return 0;
    }
    value.div_ceil(divisor)
}

fn count_files_recursive(path: &Path) -> anyhow::Result<usize> {
    let mut count = 0;
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            if entry_path.is_dir() {
                count += count_files_recursive(&entry_path)?;
            } else {
                count += 1;
            }
        }
    }
    Ok(count)
}

fn calculate_directory_size(path: &Path) -> anyhow::Result<u64> {
    let mut size = 0;
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            if entry_path.is_dir() {
                size += calculate_directory_size(&entry_path)?;
            } else {
                size += entry.metadata()?.len();
            }
        }
    }
    Ok(size)
}
