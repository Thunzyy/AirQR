#!/usr/bin/env python3
"""
Build a single-file encoder link site for AirQR.
Generates a standalone HTML page with the same dark design as the web app.
"""
from __future__ import annotations
import argparse, base64, sys
from pathlib import Path

def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")

def build_html(wasm_b64: str, logo_data_url: str) -> str:
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>AirQR Encoder</title>
<meta name="description" content="Encode files or notes into animated QR code GIFs with fountain codes">
<meta name="theme-color" content="#0f1419">
<link rel="icon" type="image/svg+xml" href="{logo_data_url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
html{{height:100%;-webkit-text-size-adjust:100%}}
body{{
  min-height:100%;font-family:'Manrope',system-ui,-apple-system,sans-serif;
  background:#0f1419;color:#e5e7eb;display:flex;flex-direction:column;
  overflow-x:hidden;-webkit-font-smoothing:antialiased;
}}
@keyframes fadeIn{{from{{opacity:0}}to{{opacity:1}}}}
@keyframes slideUp{{from{{transform:translateY(12px);opacity:0}}to{{transform:translateY(0);opacity:1}}}}
@keyframes spin{{to{{transform:rotate(360deg)}}}}
@keyframes gradientShift{{0%{{background-position:0% 50%}}50%{{background-position:100% 50%}}100%{{background-position:0% 50%}}}}
.spinner{{width:20px;height:20px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin .6s linear infinite;display:inline-block}}
.hidden{{display:none!important}}
.file-picker-input{{
  position:absolute;width:1px;height:1px;padding:0;margin:-1px;border:0;
  overflow:hidden;clip:rect(0,0,0,0);clip-path:inset(50%);white-space:nowrap;
}}

/* App Shell */
.app-shell{{display:flex;flex-direction:column;min-height:100vh}}

/* Content */
.content{{
  flex:1;padding:24px 16px 32px;max-width:640px;width:100%;margin:0 auto;
  display:flex;flex-direction:column;gap:16px;animation:fadeIn .4s ease-out;
}}

/* Header */
.hero-card{{
  display:flex;align-items:center;gap:16px;padding:18px;border-radius:18px;
  border:1px solid rgba(72,194,225,.18);
  background:radial-gradient(circle at top left,rgba(72,194,225,.18),transparent 46%),#121923;
  box-shadow:0 20px 40px rgba(0,0,0,.18);
}}
.hero-logo{{
  width:64px;height:64px;flex-shrink:0;border-radius:18px;padding:8px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);
}}
.hero-title{{font-size:22px;font-weight:800;color:#fff;line-height:1.1}}
.hero-subtitle{{font-size:13px;color:#9ca3af;margin-top:6px;line-height:1.5}}

/* Mode switch */
.mode-switch{{
  display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px;
  border-radius:16px;background:#1c2630;border:1px solid #374151;
}}
.mode-btn{{
  border:none;border-radius:12px;padding:12px 14px;background:transparent;color:#9ca3af;
  font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s ease;
}}
.mode-btn:hover{{color:#fff;background:rgba(255,255,255,.03)}}
.mode-btn.active{{background:#137fec;color:#fff;box-shadow:0 10px 25px rgba(19,127,236,.28)}}

/* File Dropzone Card */
.dropzone-card{{
  padding:20px;border-radius:16px;border:2px solid #374151;
  background:#1c2630;transition:all .2s ease;
  animation:slideUp .4s cubic-bezier(.16,1,.3,1) forwards;
}}
.dropzone-card.has-file{{
  background:linear-gradient(135deg,rgba(59,130,246,.08),rgba(147,51,234,.08));
  border-color:#137fec;
}}

/* Selected file info */
.file-info{{
  display:flex;align-items:center;gap:14px;padding-bottom:16px;
  margin-bottom:16px;border-bottom:1px solid #374151;
}}
.file-info-icon{{
  width:48px;height:48px;border-radius:12px;background:#137fec;
  display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;
}}
.file-info-name{{font-size:14px;font-weight:600;color:#fff;word-break:break-all}}
.file-info-size{{font-size:13px;color:#9ca3af;margin-top:2px}}

/* Selection buttons grid */
.btn-grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}
.btn-select{{
  display:flex;align-items:center;justify-content:center;gap:8px;
  padding:16px 12px;border-radius:12px;background:#1c2630;
  border:2px solid #374151;color:#fff;font-family:inherit;
  font-size:14px;font-weight:600;cursor:pointer;transition:all .15s ease;
}}
.btn-select:hover{{border-color:rgba(19,127,236,.5);background:#1c2630ee}}
.btn-select svg{{width:22px;height:22px;color:#9ca3af;flex-shrink:0}}
.dropzone-hint{{text-align:center;font-size:13px;color:#6b7280;margin-top:10px}}

/* Note editor */
.note-panel{{
  border-radius:16px;border:1px solid #303947;background:#0d1117;overflow:hidden;
  animation:slideUp .4s cubic-bezier(.16,1,.3,1) forwards;
}}
.note-toolbar{{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 14px;background:#161b22;border-bottom:1px solid rgba(255,255,255,.06);
}}
.note-toolbar-left{{display:flex;align-items:center;gap:10px;min-width:0}}
.note-chip{{
  display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border-radius:10px;
  background:rgba(19,127,236,.12);color:#7dd3fc;font-size:12px;font-weight:700;
}}
.note-format-select{{
  min-width:150px;padding:8px 10px;border-radius:10px;background:#0f1419;color:#e5e7eb;
  border:1px solid #374151;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;
}}
.note-clear-btn{{
  border:none;border-radius:10px;padding:8px 12px;background:#29313d;color:#e5e7eb;
  font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s ease;
}}
.note-clear-btn:hover:not(:disabled){{background:#374151}}
.note-clear-btn:disabled{{opacity:.45;cursor:not-allowed}}
.note-editor-wrap{{padding:0 14px 14px}}
.note-editor{{
  width:100%;min-height:320px;max-height:60vh;resize:vertical;border:none;outline:none;
  background:transparent;color:#e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:14px;line-height:1.6;padding:14px 0 0;
}}
.note-editor::placeholder{{color:#6b7280}}
.note-status{{
  display:flex;justify-content:space-between;align-items:center;gap:12px;
  padding:11px 14px;background:#161b22;border-top:1px solid rgba(255,255,255,.06);
  font-size:12px;color:#8b98a9;
}}

/* Generate button */
.btn-generate{{
  width:100%;padding:16px;border:none;border-radius:12px;
  background:#137fec;color:#fff;font-family:inherit;font-size:15px;
  font-weight:700;cursor:pointer;transition:all .15s ease;
  display:flex;align-items:center;justify-content:center;gap:8px;
  animation:slideUp .5s cubic-bezier(.16,1,.3,1) forwards;
}}
.btn-generate:hover:not(:disabled){{background:#0f6dd3;transform:translateY(-1px)}}
.btn-generate:disabled{{background:#374151;color:#6b7280;cursor:not-allowed}}

/* Progress */
.progress-section{{animation:slideUp .3s ease forwards}}
.progress-track{{height:6px;background:#1f2937;border-radius:3px;overflow:hidden}}
.progress-fill{{
  height:100%;background:linear-gradient(90deg,#137fec,#60a5fa);border-radius:3px;
  transition:width .3s ease;background-size:200% 100%;animation:gradientShift 2s ease infinite;
}}
.progress-label{{font-size:12px;color:#6b7280;text-align:center;margin-top:6px}}

/* Error */
.error-box{{
  padding:14px 16px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);
  border-radius:12px;animation:slideUp .3s ease forwards;
}}
.error-box p{{font-size:13px;color:#ef4444;line-height:1.5;word-break:break-word}}

/* Result Card */
.result-card{{
  border-radius:16px;background:#1c2630;border:1px solid #374151;
  overflow:hidden;animation:slideUp .4s cubic-bezier(.16,1,.3,1) forwards;
}}
.result-title{{
  color:#137fec;font-weight:700;font-size:13px;text-transform:uppercase;
  letter-spacing:0.05em;padding:16px 16px 0;
}}
.result-stats-line{{
  padding:6px 16px 14px;font-size:13px;color:#6b7280;
}}
.result-stats-line .expansion{{color:#ef4444;font-weight:500;margin-left:4px}}

/* Preview Container */
.preview-container{{position:relative;background:#101922;border-top:1px solid #1f2937}}
.preview-meta{{
  display:flex;align-items:center;justify-content:flex-start;
  gap:8px;padding:12px 16px 0;background:#101922;
}}
.preview-scroll{{
  overflow:auto;display:flex;align-items:center;justify-content:center;
  padding:24px;height:60vh;min-height:350px;max-height:600px;
}}
.preview-scroll canvas{{
  image-rendering:pixelated;image-rendering:crisp-edges;
  box-shadow:0 25px 50px -12px rgba(0,0,0,.25);
}}

/* Frame Badge */
.frame-badge{{
  background:rgba(0,0,0,.6);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  color:#fff;font-size:12px;padding:6px 12px;border-radius:9999px;
  border:1px solid rgba(255,255,255,.1);box-shadow:0 4px 12px rgba(0,0,0,.3);
  font-family:'Courier New',monospace;font-weight:700;
}}
.frame-badge .min-req{{margin-left:8px;color:rgba(255,255,255,.5);font-size:10px;font-weight:400}}

/* Zoom Controls */
.zoom-controls{{
  display:flex;align-items:center;justify-content:center;gap:16px;
  padding:12px;background:#1f2937;border-top:1px solid #374151;
}}
.zoom-group{{display:flex;align-items:center;gap:8px}}
.zoom-btn{{
  padding:8px;border-radius:8px;background:#374151;border:1px solid #4b5563;
  color:#d1d5db;cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:all .15s;
}}
.zoom-btn:hover{{background:#4b5563;color:#fff}}
.zoom-btn svg{{width:18px;height:18px}}
.zoom-pct{{
  font-size:14px;font-weight:700;color:#d1d5db;width:64px;text-align:center;
  background:none;border:none;cursor:pointer;font-family:inherit;transition:color .15s;
}}
.zoom-pct:hover{{color:#137fec}}
.zoom-separator{{width:1px;height:24px;background:#4b5563}}

/* Fullscreen */
.preview-container:fullscreen{{background:#000}}
.preview-container:fullscreen .preview-scroll{{height:calc(100vh - 56px);max-height:none;min-height:auto}}
.preview-container:-webkit-full-screen{{background:#000}}
.preview-container:-webkit-full-screen .preview-scroll{{height:calc(100vh - 56px);max-height:none;min-height:auto}}

/* Download */
.result-footer{{padding:14px 16px}}
.btn-download{{
  width:100%;display:flex;align-items:center;justify-content:center;gap:8px;
  padding:14px;border:none;border-radius:10px;background:#374151;color:#fff;
  font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s;
}}
.btn-download:hover{{background:#4b5563}}

/* Settings panel */
.settings-panel{{
  border-radius:12px;background:#1c2127;border:1px solid #1f2937;
  overflow:hidden;transition:all .3s;
  animation:slideUp .45s cubic-bezier(.16,1,.3,1) forwards;
}}
.settings-toggle{{
  display:flex;align-items:center;justify-content:space-between;width:100%;
  padding:14px 16px;background:transparent;border:none;color:#e5e7eb;
  font-family:inherit;cursor:pointer;transition:background .15s;
}}
.settings-toggle:hover{{background:rgba(255,255,255,.03)}}
.settings-toggle-left{{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}}
.settings-toggle svg{{width:18px;height:18px;color:#9ca3af}}
.settings-chevron{{transition:transform .3s}}
.settings-chevron.open{{transform:rotate(180deg)}}
.settings-body{{
  overflow:hidden;transition:max-height .3s ease,opacity .3s ease;
  max-height:0;opacity:0;
}}
.settings-body.open{{max-height:800px;opacity:1}}
.settings-content{{padding:0 16px 16px;display:flex;flex-direction:column;gap:16px;border-top:1px solid #1f2937;padding-top:14px}}

/* Slider row */
.slider-row label{{font-size:13px;font-weight:500;color:#d1d5db}}
.slider-row .slider-header{{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}}
.slider-row .slider-value{{font-size:13px;font-weight:700;color:#137fec}}
.slider-row input[type=range]{{
  width:100%;height:6px;border-radius:3px;appearance:none;background:#374151;
  cursor:pointer;accent-color:#137fec;
}}
.slider-row input[type=range]::-webkit-slider-thumb{{
  appearance:none;width:16px;height:16px;border-radius:50%;background:#137fec;cursor:pointer;
}}
.slider-hints{{display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-top:4px}}

/* Select */
.ecc-select{{
  padding:8px 12px;font-size:13px;font-weight:600;background:#1a2633;color:#137fec;
  border:1px solid #374151;border-radius:8px;cursor:pointer;font-family:inherit;
}}

@media(min-width:640px){{.content{{padding:28px 24px}}}}
</style>
</head>
<body>
<div class="app-shell">
<main class="content">
  <input type="file" id="fileInput" multiple class="file-picker-input" tabindex="-1">
  <input type="file" id="folderInput" webkitdirectory class="file-picker-input" tabindex="-1">

  <section class="hero-card" aria-label="AirQR encoder brand">
    <img class="hero-logo" src="{logo_data_url}" alt="AirQR logo">
    <div>
      <h1 class="hero-title">AirQR Encoder</h1>
      <p class="hero-subtitle">Standalone single-file encoder for files, folders, and notes. Everything runs locally in your browser.</p>
    </div>
  </section>

  <div class="mode-switch" role="tablist" aria-label="Encoder mode">
    <button class="mode-btn active" id="modeFileBtn" type="button" role="tab" aria-selected="true">File / Folder</button>
    <button class="mode-btn" id="modeNoteBtn" type="button" role="tab" aria-selected="false">Note</button>
  </div>

  <!-- Dropzone Card -->
  <div id="dropzoneCard" class="dropzone-card">
    <div id="fileInfo" class="file-info hidden">
      <div class="file-info-icon" id="fileInfoIcon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      </div>
      <div>
        <p class="file-info-name" id="fileName"></p>
        <p class="file-info-size" id="fileSize"></p>
      </div>
    </div>
    <div class="btn-grid">
      <button class="btn-select" id="btnFile">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        Select File(s)
      </button>
      <button class="btn-select" id="btnFolder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        Select Folder
      </button>
    </div>
    <p id="dropzoneHint" class="dropzone-hint">Choose files or an entire folder to encode</p>
  </div>

  <section id="notePanel" class="note-panel hidden">
    <div class="note-toolbar">
      <div class="note-toolbar-left">
        <span class="note-chip">Text note</span>
        <select id="noteFormatSelect" class="note-format-select" aria-label="Note format">
          <option value="plain">Plain text</option>
          <option value="markdown">Markdown</option>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="typescript">TypeScript</option>
          <option value="json">JSON</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
          <option value="rust">Rust</option>
          <option value="sql">SQL</option>
          <option value="yaml">YAML</option>
          <option value="shell">Shell</option>
        </select>
      </div>
      <button id="noteClearBtn" type="button" class="note-clear-btn" disabled>Clear note</button>
    </div>
    <div class="note-editor-wrap">
      <textarea
        id="noteText"
        class="note-editor"
        spellcheck="false"
        placeholder="Type or paste your note here..."
      ></textarea>
    </div>
    <div class="note-status">
      <span id="noteCharCount">0 chars</span>
      <span id="noteByteCount">0 bytes</span>
    </div>
  </section>

  <!-- Settings -->
  <div id="settingsPanel" class="settings-panel hidden">
    <button class="settings-toggle" id="settingsToggle">
      <span class="settings-toggle-left">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.5" y1="4.5" x2="6.7" y2="6.7"/><line x1="17.3" y1="17.3" x2="19.5" y2="19.5"/><line x1="17.3" y1="6.7" x2="19.5" y2="4.5"/><line x1="4.5" y1="19.5" x2="6.7" y2="17.3"/></svg>
        Advanced Settings
      </span>
      <svg class="settings-chevron" id="settingsChevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="settings-body" id="settingsBody">
      <div class="settings-content">
        <div class="slider-row">
          <div class="slider-header"><label>Frame Rate (FPS)</label><span class="slider-value" id="fpsVal">10 fps</span></div>
          <input type="range" min="1" max="60" value="10" id="fpsSlider">
          <div class="slider-hints"><span>Slow (1)</span><span>Fast (60)</span></div>
        </div>
        <div class="slider-row">
          <div class="slider-header"><label>Packet Size</label><span class="slider-value" id="pktVal">900 bytes</span></div>
          <input type="range" min="100" max="2800" step="100" value="900" id="pktSlider">
          <div class="slider-hints"><span>Small (100)</span><span>Large (2800)</span></div>
        </div>
        <div class="slider-row">
          <div class="slider-header"><label>Error Correction</label>
          <select class="ecc-select" id="eccSelect"><option value="LOW">LOW (7%)</option><option value="MEDIUM" selected>MEDIUM (15%)</option><option value="HIGH">HIGH (25%)</option></select></div>
        </div>
        <div class="slider-row">
          <div class="slider-header"><label>Target QR Size</label><span class="slider-value" id="sizeVal">177px</span></div>
          <input type="range" min="100" max="500" step="10" value="177" id="sizeSlider">
        </div>
        <div class="slider-row">
          <div class="slider-header"><label>RaptorQ Overhead</label><span class="slider-value" id="overheadVal">1.2x</span></div>
          <input type="range" min="1.0" max="3.0" step="0.1" value="1.2" id="overheadSlider">
        </div>
      </div>
    </div>
  </div>

  <!-- Generate Button -->
  <button id="generateBtn" class="btn-generate" disabled>
    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>
    <span id="generateBtnText">Generate QR GIF</span>
  </button>

  <!-- Error -->
  <div id="errorBox" class="error-box hidden"><p id="errorText"></p></div>

  <!-- Progress -->
  <div id="progressSection" class="progress-section hidden">
    <div class="progress-track"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
    <p class="progress-label" id="progressLabel">Encoding... 0%</p>
  </div>

  <!-- Result -->
  <div id="resultCard" class="result-card hidden">
    <div class="result-title">RESULT</div>
    <div class="result-stats-line" id="resultStatsLine"></div>
    <div id="previewContainer" class="preview-container">
      <div class="preview-meta">
        <div id="frameBadge" class="frame-badge"></div>
      </div>
      <div class="preview-scroll" id="previewScroll">
        <canvas id="gifCanvas"></canvas>
      </div>
      <div class="zoom-controls">
        <div class="zoom-group">
          <button class="zoom-btn" id="zoomOutBtn" title="Zoom out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </button>
          <button class="zoom-pct" id="zoomPct" title="Reset zoom">100%</button>
          <button class="zoom-btn" id="zoomInBtn" title="Zoom in">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </button>
        </div>
        <div class="zoom-separator"></div>
        <button class="zoom-btn" id="fullscreenBtn" title="Fullscreen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        </button>
      </div>
    </div>
    <div class="result-footer">
      <button class="btn-download" id="downloadBtn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="15"/><polyline points="7 10 12 15 17 10"/><line x1="4" y1="20" x2="20" y2="20"/></svg>
        Download GIF
      </button>
    </div>
  </div>
</main>
</div>

<script type="module">
// ═══════════════════════════════════════════════════════
// AirQR Encoder Link Site
// ═══════════════════════════════════════════════════════

const WASM_B64 = "{wasm_b64}";
const OMGGIF_CDN = "https://esm.sh/omggif@1.0.10";
const FFLATE_CDN = "https://esm.sh/fflate@0.8.2";

// ── DOM ──
const $ = id => document.getElementById(id);
const fileInput = $("fileInput"), folderInput = $("folderInput");
const dropzoneCard = $("dropzoneCard"), fileInfo = $("fileInfo");
const fileName = $("fileName"), fileSize = $("fileSize"), fileInfoIcon = $("fileInfoIcon");
const dropzoneHint = $("dropzoneHint");
const modeFileBtn = $("modeFileBtn"), modeNoteBtn = $("modeNoteBtn");
const notePanel = $("notePanel"), noteText = $("noteText"), noteFormatSelect = $("noteFormatSelect");
const noteClearBtn = $("noteClearBtn"), noteCharCount = $("noteCharCount"), noteByteCount = $("noteByteCount");
const settingsPanel = $("settingsPanel"), settingsToggle = $("settingsToggle");
const settingsBody = $("settingsBody"), settingsChevron = $("settingsChevron");
const generateBtn = $("generateBtn"), generateBtnText = $("generateBtnText");
const errorBox = $("errorBox"), errorText = $("errorText");
const progressSection = $("progressSection"), progressFill = $("progressFill"), progressLabel = $("progressLabel");
const resultCard = $("resultCard"), resultStatsLine = $("resultStatsLine");
const downloadBtn = $("downloadBtn");
const fpsSlider=$("fpsSlider"),fpsVal=$("fpsVal"),pktSlider=$("pktSlider"),pktVal=$("pktVal");
const eccSelect=$("eccSelect"),sizeSlider=$("sizeSlider"),sizeVal=$("sizeVal");
const overheadSlider=$("overheadSlider"),overheadVal=$("overheadVal");
const NOTE_FILENAME_PREFIX = "__airqr_note__";
const NOTE_EXTENSIONS = {{
  plain: "txt",
  markdown: "md",
  javascript: "js",
  python: "py",
  typescript: "ts",
  json: "json",
  html: "html",
  css: "css",
  rust: "rs",
  sql: "sql",
  yaml: "yml",
  shell: "sh",
}};

// ── State ──
let selectedMode = "file", selectedFiles = null, folderName = null, isEncoding = false;
let gifRawData = null, omggifMod = null;

// ── GIF Player State ──
let gifFrames = [], gifDelays = [], gifNativeW = 0, gifNativeH = 0;
let currentFrame = 0, animId = 0, animStart = 0;
let zoomScale = 3, baseZoomScale = 3, minFramesGlobal = 0, totalFramesGlobal = 0;

// ── WASM ──
let wasmInstance = null;
let cachedUint8 = null, cachedDataView = null;
let cachedTextDecoder = new TextDecoder("utf-8", {{ ignoreBOM: true, fatal: true }});
cachedTextDecoder.decode();
const cachedTextEncoder = new TextEncoder();
let WASM_VECTOR_LEN = 0;

function getUint8() {{
  if (!cachedUint8 || cachedUint8.byteLength === 0) cachedUint8 = new Uint8Array(wasmInstance.memory.buffer);
  return cachedUint8;
}}
let cachedUint32 = null;
function getUint32() {{
  if (!cachedUint32 || cachedUint32.byteLength === 0) cachedUint32 = new Uint32Array(wasmInstance.memory.buffer);
  return cachedUint32;
}}
function getDataView() {{
  if (!cachedDataView || cachedDataView.buffer.detached === true || (cachedDataView.buffer.detached === undefined && cachedDataView.buffer !== wasmInstance.memory.buffer))
    cachedDataView = new DataView(wasmInstance.memory.buffer);
  return cachedDataView;
}}
function getStringFromWasm(ptr,len){{ ptr=ptr>>>0; return cachedTextDecoder.decode(getUint8().subarray(ptr,ptr+len)); }}
function getArrayU8FromWasm(ptr,len){{ ptr=ptr>>>0; return getUint8().subarray(ptr/1,ptr/1+len); }}
function getArrayU32FromWasm(ptr,len){{ ptr=ptr>>>0; return getUint32().subarray(ptr/4,ptr/4+len); }}
function passArray8ToWasm(arg,malloc){{ const ptr=malloc(arg.length*1,1)>>>0; getUint8().set(arg,ptr/1); WASM_VECTOR_LEN=arg.length; return ptr; }}
function passStringToWasm(arg,malloc,realloc){{
  let len=arg.length; let ptr=malloc(len,1)>>>0; const mem=getUint8(); let offset=0;
  for(;offset<len;offset++){{ const code=arg.charCodeAt(offset); if(code>0x7F)break; mem[ptr+offset]=code; }}
  if(offset!==len){{ if(offset!==0)arg=arg.slice(offset); ptr=realloc(ptr,len,len=offset+arg.length*3,1)>>>0;
    const view=getUint8().subarray(ptr+offset,ptr+len); const ret=cachedTextEncoder.encodeInto(arg,view); offset+=ret.written; ptr=realloc(ptr,len,offset,1)>>>0; }}
  WASM_VECTOR_LEN=offset; return ptr;
}}
function addToExternrefTable(obj){{ const idx=wasmInstance.__externref_table_alloc(); wasmInstance.__wbindgen_externrefs.set(idx,obj); return idx; }}
function takeFromExternrefTable(idx){{ const v=wasmInstance.__wbindgen_externrefs.get(idx); wasmInstance.__externref_table_dealloc(idx); return v; }}
function debugString(v){{ const t=typeof v; if(t=="number"||t=="boolean"||v==null)return`${{v}}`; if(t=="string")return`"${{v}}"`; if(t=="function")return"Function"; if(Array.isArray(v))return"["+v.map(debugString).join(",")+"]"; try{{return"Object("+JSON.stringify(v)+")"}}catch{{return String(v)}} }}
function handleError(f,args){{ try{{return f.apply(this,args)}}catch(e){{wasmInstance.__wbindgen_exn_store(addToExternrefTable(e))}} }}

async function loadWasm() {{
  if (wasmInstance) return;
  const binary = Uint8Array.from(atob(WASM_B64), c=>c.charCodeAt(0));
  const imports = {{"./airqr_core_bg.js":{{}}}};
  const wbg = imports["./airqr_core_bg.js"];
  wbg.__wbg___wbindgen_throw_81fc77679af83bc6 = function(a0,a1){{ throw new Error(getStringFromWasm(a0,a1)); }};
  wbg.__wbg_call_f2ac1622600b957f = function(){{ return handleError(function(a,b,c,d,e){{ return a.call(b,c,d,e) }},arguments) }};
  wbg.__wbg_log_4c0baeb8af2f8f89 = function(a){{ console.log(a) }};
  wbg.__wbg_new_4f9fafbb3909af72 = function(){{ return new Object() }};
  wbg.__wbg_new_f3c9df4f38f3f798 = function(){{ return new Array() }};
  wbg.__wbg_new_from_slice_2580ff33d0d10520 = function(a0,a1){{ return new Uint8Array(getArrayU8FromWasm(a0,a1)) }};
  wbg.__wbg_new_from_slice_798885084b9cc1d2 = function(a0,a1){{ return new Uint32Array(getArrayU32FromWasm(a0,a1)) }};
  wbg.__wbg_push_6bdbc990be5ac37b = function(a0,a1){{ return a0.push(a1) }};
  wbg.__wbg_set_8ee2d34facb8466e = function(){{ return handleError(function(a,b,c){{ return Reflect.set(a,b,c) }},arguments) }};
  wbg.__wbindgen_cast_0000000000000001 = function(a0){{ return a0 }};
  wbg.__wbindgen_cast_0000000000000002 = function(a0,a1){{ return getStringFromWasm(a0,a1) }};
  wbg.__wbindgen_init_externref_table = function(){{ const t=wasmInstance.__wbindgen_externrefs; const o=t.grow(4); t.set(0,undefined); t.set(o+0,undefined); t.set(o+1,null); t.set(o+2,true); t.set(o+3,false); }};
  const {{instance}} = await WebAssembly.instantiate(binary, imports);
  wasmInstance = instance.exports; cachedUint8=null; cachedUint32=null; cachedDataView=null;
  wasmInstance.__wbindgen_start();
}}

// WASM function wrappers
function wasmGeneratePacketsRaw(rawData, packetSize, overhead) {{
  const ptr = passArray8ToWasm(rawData, wasmInstance.__wbindgen_malloc);
  const len = WASM_VECTOR_LEN;
  const ret = wasmInstance.generate_raptorq_packets_raw(ptr, len, packetSize, overhead);
  if (ret[2]) throw takeFromExternrefTable(ret[1]);
  return takeFromExternrefTable(ret[0]);
}}

function wasmEncodeQrPacket(packetData, totalSize, packetSize, packetId, eccLevel, targetSize, scale) {{
  const p0=passArray8ToWasm(packetData,wasmInstance.__wbindgen_malloc); const l0=WASM_VECTOR_LEN;
  const p1=passArray8ToWasm(packetId,wasmInstance.__wbindgen_malloc); const l1=WASM_VECTOR_LEN;
  const p2=passStringToWasm(eccLevel,wasmInstance.__wbindgen_malloc,wasmInstance.__wbindgen_realloc); const l2=WASM_VECTOR_LEN;
  const ret=wasmInstance.encode_qr_packet(p0,l0,totalSize,packetSize,p1,l1,p2,l2,targetSize,scale);
  if(ret[3]) throw takeFromExternrefTable(ret[2]);
  var v=getArrayU8FromWasm(ret[0],ret[1]).slice();
  wasmInstance.__wbindgen_free(ret[0],ret[1]*1,1);
  return v;
}}

// ── Utilities ──
function formatBytes(b){{ if(b===0)return"0 B"; const k=1024,s=["B","KB","MB","GB"],i=Math.floor(Math.log(b)/Math.log(k)); return`${{(b/Math.pow(k,i)).toFixed(2)}} ${{s[i]}}`; }}
function hasReadyInput() {{
  if (selectedMode === "note") {{
    return noteText.value.trim().length > 0;
  }}
  return Array.isArray(selectedFiles) && selectedFiles.length > 0;
}}
function updateGenerateState() {{
  generateBtn.disabled = isEncoding || !hasReadyInput();
  settingsPanel.classList.toggle("hidden", !hasReadyInput());
}}
function clearCurrentOutput() {{
  hideError();
  resultCard.classList.add("hidden");
  hideProgress();
  cancelAnimationFrame(animId);
  gifRawData = null;
  gifFrames = [];
}}
function updateNoteStats() {{
  const text = noteText.value;
  const bytes = cachedTextEncoder.encode(text).length;
  noteCharCount.textContent = `${{text.length}} chars`;
  noteByteCount.textContent = `${{bytes}} bytes`;
  noteClearBtn.disabled = text.length === 0;
  updateGenerateState();
}}
function setMode(mode) {{
  selectedMode = mode;
  clearCurrentOutput();
  modeFileBtn.classList.toggle("active", mode === "file");
  modeNoteBtn.classList.toggle("active", mode === "note");
  modeFileBtn.setAttribute("aria-selected", String(mode === "file"));
  modeNoteBtn.setAttribute("aria-selected", String(mode === "note"));
  dropzoneCard.classList.toggle("hidden", mode !== "file");
  notePanel.classList.toggle("hidden", mode !== "note");
  if (mode === "file") {{
    dropzoneHint.textContent = selectedFiles?.length ? "Tap to change selection" : "Choose files or an entire folder to encode";
  }}
  updateGenerateState();
}}
function buildNoteFilename(format) {{
  return `${{NOTE_FILENAME_PREFIX}}.${{NOTE_EXTENSIONS[format] || NOTE_EXTENSIONS.plain}}`;
}}

// ── UI ──
function showError(msg){{ errorBox.classList.remove("hidden"); errorText.textContent=msg; }}
function hideError(){{ errorBox.classList.add("hidden"); }}
function setProgress(pct, label){{ progressSection.classList.remove("hidden"); progressFill.style.width=Math.min(100,pct).toFixed(1)+"%"; progressLabel.textContent=label||`Encoding... ${{Math.floor(pct)}}%`; }}
function hideProgress(){{ progressSection.classList.add("hidden"); }}
function openPicker(input){{
  if (!input) return;
  input.value = "";
  if (typeof input.showPicker === "function") {{
    try {{
      input.showPicker();
      return;
    }} catch(err) {{
      console.debug("showPicker() unavailable, falling back to click()", err);
    }}
  }}
  input.click();
}}

// ── Settings ──
fpsSlider.oninput=()=>fpsVal.textContent=fpsSlider.value+" fps";
pktSlider.oninput=()=>pktVal.textContent=pktSlider.value+" bytes";
sizeSlider.oninput=()=>sizeVal.textContent=sizeSlider.value+"px";
overheadSlider.oninput=()=>overheadVal.textContent=parseFloat(overheadSlider.value).toFixed(1)+"x";
settingsToggle.onclick=()=>{{ settingsBody.classList.toggle("open"); settingsChevron.classList.toggle("open"); }};

// ── GIF Player ──
function parseAndPlayGif(gifData) {{
  cancelAnimationFrame(animId);
  gifFrames = []; gifDelays = [];

  const GifReader = omggifMod.default?.GifReader || omggifMod.GifReader;
  const reader = new GifReader(gifData);
  gifNativeW = reader.width;
  gifNativeH = reader.height;
  const n = reader.numFrames();
  totalFramesGlobal = n;

  for (let i = 0; i < n; i++) {{
    const info = reader.frameInfo(i);
    gifDelays.push(Math.max(info.delay * 10, 20));
    const imgData = new ImageData(gifNativeW, gifNativeH);
    reader.decodeAndBlitFrameRGBA(i, imgData.data);
    gifFrames.push(imgData);
  }}

  const canvas = $("gifCanvas");
  canvas.width = gifNativeW;
  canvas.height = gifNativeH;

  requestAnimationFrame(() => {{
    autoZoom();
    currentFrame = 0;
    animStart = performance.now();
    animId = requestAnimationFrame(animLoop);
  }});
}}

function autoZoom() {{
  const scrollEl = $("previewScroll");
  const rect = scrollEl.getBoundingClientRect();
  const pad = 48;
  const fitScale = Math.min(
    (rect.width - pad) / gifNativeW,
    (rect.height - pad) / gifNativeH
  );
  baseZoomScale = Math.max(1, Math.min(fitScale, 15));
  zoomScale = baseZoomScale;
  applyZoom();
}}

function animLoop(now) {{
  if (gifFrames.length === 0) return;
  const delay = gifDelays[currentFrame];
  if (now - animStart >= delay) {{
    const ctx = $("gifCanvas").getContext("2d");
    ctx.putImageData(gifFrames[currentFrame], 0, 0);
    $("frameBadge").innerHTML = `<b>${{currentFrame + 1}} / ${{totalFramesGlobal}}</b> <span class="min-req">(Min Required: ${{minFramesGlobal}})</span>`;
    currentFrame = (currentFrame + 1) % gifFrames.length;
    animStart = now;
  }}
  animId = requestAnimationFrame(animLoop);
}}

function applyZoom() {{
  const canvas = $("gifCanvas");
  canvas.style.width = Math.round(gifNativeW * zoomScale) + "px";
  canvas.style.height = Math.round(gifNativeH * zoomScale) + "px";
  $("zoomPct").textContent = Math.round((zoomScale / baseZoomScale) * 100) + "%";
}}

// Zoom controls
$("zoomInBtn").onclick = () => {{ zoomScale = Math.min(zoomScale + 0.5, 20); applyZoom(); }};
$("zoomOutBtn").onclick = () => {{ zoomScale = Math.max(zoomScale - 0.5, 0.5); applyZoom(); }};
$("zoomPct").onclick = () => {{ zoomScale = baseZoomScale; applyZoom(); }};

// Ctrl+Wheel zoom
$("previewContainer").addEventListener("wheel", e => {{
  if (e.ctrlKey) {{
    e.preventDefault();
    zoomScale = Math.min(Math.max(zoomScale + e.deltaY * -0.005, 0.5), 20);
    applyZoom();
  }}
}}, {{ passive: false }});

// Fullscreen
$("fullscreenBtn").onclick = () => {{
  const el = $("previewContainer");
  if (!document.fullscreenElement) {{
    el.requestFullscreen().catch(err => console.error(err));
  }} else {{
    document.exitFullscreen();
  }}
}};

document.addEventListener("fullscreenchange", () => {{
  if (gifNativeW > 0) requestAnimationFrame(autoZoom);
}});

// Download
downloadBtn.onclick = () => {{
  if (!gifRawData) return;
  const blob = new Blob([gifRawData], {{ type: "image/gif" }});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "qrcode.gif"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}};

// ── File selection ──
function handleFiles(files, folder) {{
  selectedFiles = Array.from(files);
  folderName = folder;
  clearCurrentOutput();

  dropzoneCard.classList.add("has-file");
  fileInfo.classList.remove("hidden");

  const totalSize = selectedFiles.reduce((a,f)=>a+f.size, 0);
  if (folderName) {{
    fileName.textContent = folderName;
    fileSize.textContent = `${{formatBytes(totalSize)}} · ${{selectedFiles.length}} items`;
    fileInfoIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>';
  }} else if (selectedFiles.length === 1) {{
    fileName.textContent = selectedFiles[0].name;
    fileSize.textContent = formatBytes(totalSize);
  }} else {{
    fileName.textContent = `${{selectedFiles.length}} files selected`;
    fileSize.textContent = formatBytes(totalSize);
  }}
  dropzoneHint.textContent = "Tap to change selection";
  updateGenerateState();
}}

$("btnFile").onclick = () => openPicker(fileInput);
$("btnFolder").onclick = () => openPicker(folderInput);
fileInput.onchange = e => {{ if(e.target.files.length) handleFiles(e.target.files, null); }};
folderInput.onchange = e => {{
  if (!e.target.files.length) return;
  const files = Array.from(e.target.files);
  const paths = files.map(f => f.webkitRelativePath || f.name);
  const folder = paths[0]?.includes('/') ? paths[0].split('/')[0] : null;
  handleFiles(e.target.files, folder);
}};
modeFileBtn.onclick = () => setMode("file");
modeNoteBtn.onclick = () => setMode("note");
noteText.oninput = () => {{
  clearCurrentOutput();
  updateNoteStats();
}};
noteFormatSelect.onchange = () => {{
  clearCurrentOutput();
  updateGenerateState();
}};
noteClearBtn.onclick = () => {{
  noteText.value = "";
  clearCurrentOutput();
  updateNoteStats();
}};

// ── Encoding ──
async function startEncoding() {{
  if (isEncoding) return;
  if (selectedMode === "file" && !selectedFiles) return;
  if (selectedMode === "note" && noteText.value.trim().length === 0) return;
  isEncoding = true;
  updateGenerateState();
  generateBtnText.innerHTML = '<div class="spinner"></div>';
  clearCurrentOutput();

  const startTime = performance.now();
  const config = {{
    fps: parseInt(fpsSlider.value),
    packetSize: parseInt(pktSlider.value),
    ecc: eccSelect.value,
    targetSize: parseInt(sizeSlider.value),
    raptorqOverhead: parseFloat(overheadSlider.value),
  }};

  try {{
    setProgress(0, "Loading engine...");
    const [fflateModule] = await Promise.all([import(FFLATE_CDN), loadWasm()]);
    const {{ deflateSync }} = fflateModule;

    // Load omggif early
    omggifMod = await import(OMGGIF_CDN);

    // 1. Read file data
    setProgress(2, "Reading files...");
    let dataToEncode, filename;
    let originalSize = 0;

    if (selectedMode === "note") {{
      const noteBytes = cachedTextEncoder.encode(noteText.value);
      dataToEncode = new Uint8Array(noteBytes);
      filename = buildNoteFilename(noteFormatSelect.value || "plain");
      originalSize = dataToEncode.length;
    }} else if (selectedFiles.length === 1 && !folderName) {{
      const buf = await selectedFiles[0].arrayBuffer();
      dataToEncode = new Uint8Array(buf);
      filename = selectedFiles[0].name;
      originalSize = selectedFiles.reduce((a,f)=>a+f.size,0);
    }} else {{
      // ZIP multiple files using fflate
      setProgress(3, "Creating archive...");
      const {{ zipSync }} = fflateModule;
      const zipData = {{}};
      for (const file of selectedFiles) {{
        const path = file.webkitRelativePath || file.name;
        const buf = await file.arrayBuffer();
        zipData[path] = new Uint8Array(buf);
      }}
      dataToEncode = zipSync(zipData, {{ level: 0 }});
      filename = folderName ? `${{folderName}}.zip` : "archive.zip";
      originalSize = selectedFiles.reduce((a,f)=>a+f.size,0);
    }}

    // 2. Prepare payload with compression
    setProgress(5, "Preparing payload...");
    const filenameBytes = new TextEncoder().encode(filename);
    const payload = new Uint8Array(4 + filenameBytes.length + dataToEncode.length);
    const view = new DataView(payload.buffer);
    view.setUint32(0, filenameBytes.length, false);
    payload.set(filenameBytes, 4);
    payload.set(dataToEncode, 4 + filenameBytes.length);

    let finalPayload;
    if (dataToEncode.length > 1024) {{
      try {{
        const compressed = deflateSync(payload, {{ level: 6 }});
        if (compressed.length < payload.length * 0.9) {{
          finalPayload = new Uint8Array(1 + compressed.length);
          finalPayload[0] = 2; // DEFLATE flag
          finalPayload.set(compressed, 1);
        }}
      }} catch(e) {{}}
    }}
    if (!finalPayload) {{
      finalPayload = new Uint8Array(1 + payload.length);
      finalPayload[0] = 0; // No compression
      finalPayload.set(payload, 1);
    }}

    // 3. Generate RaptorQ packets
    setProgress(10, "Generating fountain code packets...");
    let packetSize = Math.floor(config.packetSize / 4) * 4;
    if (packetSize <= 0) packetSize = 4;
    const result = wasmGeneratePacketsRaw(finalPayload, packetSize, config.raptorqOverhead);
    const metadata = result[0], packetsArray = result[1];
    const totalSize = metadata.totalSize, totalFrames = metadata.totalPackets;
    const minFrames = Math.ceil(totalSize / Math.max(1, new Uint8Array(packetsArray[0].data).length));

    // 4. Encode QR frames sequentially
    const qrFrames = [];
    for (let i = 0; i < totalFrames; i++) {{
      const pct = 15 + (i / totalFrames) * 70;
      if (i % 5 === 0) setProgress(pct, `Encoding QR frame ${{i+1}}/${{totalFrames}}...`);
      if (i % 3 === 0) await new Promise(r => setTimeout(r, 0)); // yield to UI

      const packet = packetsArray[i];
      const buffer = wasmEncodeQrPacket(
        new Uint8Array(packet.data), totalSize, packetSize,
        new Uint8Array(packet.packetId), config.ecc, config.targetSize, 1
      );
      qrFrames.push(buffer);
    }}

    // 5. Assemble GIF
    setProgress(88, "Assembling GIF...");
    const GifWriter = omggifMod.default?.GifWriter || omggifMod.GifWriter;

    const imgSize = Math.sqrt(qrFrames[0].length);
    const frameDelay = Math.round(1000 / config.fps);
    const estSize = 1024 + qrFrames.length * (Math.floor(imgSize*imgSize/2.5)+20);
    const buf = new Uint8Array(estSize);
    const gifWriter = new GifWriter(buf, imgSize, imgSize, {{ palette:[0xffffff,0x000000], loop:0 }});

    for (let i = 0; i < qrFrames.length; i++) {{
      if (i % 50 === 0) setProgress(88 + (i/qrFrames.length)*10, `Writing frame ${{i+1}}/${{qrFrames.length}}...`);
      gifWriter.addFrame(0, 0, imgSize, imgSize, qrFrames[i], {{ delay: Math.floor(frameDelay/10), disposal: 2 }});
    }}

    const gifData = buf.slice(0, gifWriter.end());
    const duration = ((performance.now() - startTime) / 1000).toFixed(1);
    const expansion = originalSize > 0 ? ((gifData.length - originalSize) / originalSize * 100).toFixed(1) : "0";

    // 6. Show result
    setProgress(100, "Complete!");
    gifRawData = gifData;
    minFramesGlobal = minFrames;

    const statsText = `${{formatBytes(gifData.length)}} ■ ${{duration}}s`;
    const expNum = parseFloat(expansion);
    const expHtml = expNum > 0 ? ` <span class="expansion">(+${{expansion}}% expansion)</span>` : "";
    resultStatsLine.innerHTML = statsText + expHtml;
    resultCard.classList.remove("hidden");

    // Parse GIF and start canvas playback
    parseAndPlayGif(gifData);

  }} catch(err) {{
    console.error("Encoding error:", err);
    showError(err.message || String(err));
  }} finally {{
    isEncoding = false;
    updateGenerateState();
    generateBtnText.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg> Generate QR GIF`;
    setTimeout(hideProgress, 2000);
  }}
}}

generateBtn.onclick = startEncoding;
updateNoteStats();
setMode("file");
</script>
</body>
</html>'''

def main() -> int:
    parser = argparse.ArgumentParser(description="Build AirQR encoder link site")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    project_root = Path(__file__).resolve().parents[1]
    wasm_path = project_root / "apps" / "web" / "src" / "pkg" / "airqr_core_bg.wasm"
    logo_path = project_root / "assets" / "logo.svg"
    if not wasm_path.exists():
        print(f"[ERR] WASM not found: {wasm_path}"); return 1
    if not logo_path.exists():
        print(f"[ERR] Logo not found: {logo_path}"); return 1
    print("[...] Reading WASM...")
    wasm_b64 = b64(wasm_path.read_bytes())
    logo_data_url = f"data:image/svg+xml;base64,{b64(logo_path.read_bytes())}"
    print(f"[OK] WASM base64: {len(wasm_b64)/1024:.1f} KB")
    html = build_html(wasm_b64, logo_data_url)
    output = args.output or (project_root / "dist" / "web-singlefile" / "airqr-encoder-linksite.html")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    print(f"[OK] Built: {output} ({output.stat().st_size/1024:.1f} KB)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
