# AirQR Architecture

This section explains how AirQR is built, how the shared Rust engine is reused across the web and Flutter apps, and how data moves from encoding to scanning, decoding, resume, and optional sync.

## Read This Section In This Order

1. [DIAGRAMS.md](./DIAGRAMS.md)
   Mermaid diagrams for the full system, runtime surfaces, encoding, decoding, sync, and build outputs.
2. [ENCODE_DECODE_DIAGRAMS.md](./ENCODE_DECODE_DIAGRAMS.md)
   Low-level Mermaid diagrams for payload construction, packet generation, 1-bit QR rendering, GIF/chunk assembly, and decode/recovery.
3. [DEEP_DIVE.md](./DEEP_DIVE.md)
   Detailed explanation of the Rust core, the WASM and Flutter bridges, the encoding pipeline, the decoding pipeline, and the optional sync server.

[MAP.md](./MAP.md) indexes every diagram of this section if you prefer jumping
straight to a specific view.

## What This Covers

- The shared Rust engine in `packages/airqr-core`
- The web runtime: React, workers, WASM, threaded and non-threaded bundles
- The Flutter runtime: native Rust, `flutter_rust_bridge`, mobile and desktop surfaces
- The encoding pipeline for files, folders, notes, GIFs, and chunked ZIP output
- The low-level payload, packet, QR frame, and recovery steps
- The decoding pipeline for camera scans, GIF imports, replay, progress, and finalization
- The optional sync server for shared history, resume, and multi-device scanning

## Reading Guide

- If you only want the big picture, read [DIAGRAMS.md](./DIAGRAMS.md).
- If you want the low-level encode/decode mechanics, read [ENCODE_DECODE_DIAGRAMS.md](./ENCODE_DECODE_DIAGRAMS.md).
- If you want to understand the runtime contracts, packet flow, and where logic lives in the repo, read [DEEP_DIVE.md](./DEEP_DIVE.md).
- If you are new to the repo, start from the root [README.md](../../README.md) first.
