# AirQR Deep Dive

This page explains how the shared Rust engine is reused across the product, how the web and Flutter runtimes call into it, and how encoding, decoding, resume, and sync work in practice.

For the visual map, read [DIAGRAMS.md](./DIAGRAMS.md). For the low-level encode/decode diagrams, read [ENCODE_DECODE_DIAGRAMS.md](./ENCODE_DECODE_DIAGRAMS.md).

## 1. The Core Idea

AirQR does not implement a separate codec per client. The core packet, QR, and recovery logic lives in one shared Rust crate:

- `packages/airqr-core/src/lib.rs`
- `packages/airqr-core/src/streaming.rs`
- `packages/airqr-core/src/wasm.rs`
- `packages/airqr-core/src/api.rs`

Everything else is a surface around that engine:

- the web app calls it through WASM
- the portable single-file HTML embeds the same web runtime
- the Flutter app calls it through `flutter_rust_bridge`
- the optional sync server stores packets, sessions, and history, but it is not required for the core transfer flow

## 2. Shared Rust Engine

### 2.1 Normal Mode vs Streaming Mode

The Rust core exposes two related decode models:

- `AirqrDecoder` in `packages/airqr-core/src/lib.rs`
  Used for the regular packet flow where one logical transfer is reconstructed from a single packet stream.
- `StreamingDecoder` in `packages/airqr-core/src/streaming.rs`
  Used for large transfers that are split into chunks with a session id, chunk id, total chunk count, offsets, and per-chunk packet counts.

The Flutter-facing API in `packages/airqr-core/src/api.rs` auto-detects which decoder to instantiate based on the incoming packet header. That is why the UI does not need to manually switch decoders for every frame.

### 2.2 Shared Data Responsibilities

At the core level, Rust is responsible for:

- input payload metadata layout
- optional compression
- RaptorQ packet generation and recovery
- packet header parsing
- deduplication and progress tracking
- final payload reconstruction
- decompression and filename extraction

This is also where typed decode errors now live through `CoreDecodeError`, which keeps packet parsing and validation failures more explicit than string-only errors.

### 2.3 What Lives In `lib.rs`

`packages/airqr-core/src/lib.rs` is the baseline engine for non-streaming transfers. It defines:

- `EncoderConfig`
- `EncodeProgress`
- `AirqrEncoder`
- `DecodeResult`
- `AirqrDecoder`
- `CoreDecodeError`

This file handles the classic encode and decode path:

1. build a named payload
2. optionally compress it
3. generate RaptorQ packets
4. render packets as QR frames
5. emit a GIF
6. on the receive side, recover enough packets to reconstruct the original payload

### 2.4 What Lives In `streaming.rs`

`packages/airqr-core/src/streaming.rs` adds the large-file model:

- `StreamingConfig`
- `StreamingEncoder`
- `StreamingDecoder`
- `StreamEncodeProgress`
- `StreamDecodeResult`

This layer adds:

- chunk planning
- `session_id`
- `chunk_id`
- `total_chunks`
- `chunk_offset`
- per-chunk packet expectations

That extra transport metadata is what makes resume, chunk-aware progress, and multi-device sync possible without confusing packets from unrelated transfers.

## 3. How The Web App Uses Rust Through WASM

### 3.1 Committed WASM Bundles

The web app does not build Rust on every user install. The repo already contains prebuilt WASM bundles under:

- `apps/web/src/pkg`
- `apps/web/src/pkg-threaded`

The selection logic is centralized in:

- `apps/web/src/wasm/airqrCoreThreaded.ts`
- `apps/web/src/wasm/airqrCoreTyped.ts`

### 3.2 Threaded vs Non-Threaded WASM

`airqrCoreThreaded.ts` chooses between:

- the threaded bundle when `crossOriginIsolated === true` and `SharedArrayBuffer` is available
- the non-threaded bundle otherwise

When the threaded bundle is active, it can call `initThreadPool(...)` exposed from `packages/airqr-core/src/wasm.rs` through `wasm-bindgen-rayon`.

That means:

- same Rust core contract
- different runtime capability
- safe fallback when the browser cannot use WASM threads

### 3.3 Typed WASM Boundary

`apps/web/src/wasm/airqrCoreTyped.ts` normalizes the raw `wasm-bindgen` values into stable TypeScript-facing structures such as:

- generated packet metadata
- packet arrays
- packed packet buffers
- decode results

This file is important because it keeps the rest of the web app from depending on low-level JS interop details.

### 3.4 Why The Web Uses Workers

The heavy encoding path would block the UI if it ran on the main thread. The work is therefore coordinated by:

- `apps/web/src/workers/worker-parallel.ts`
- `apps/web/src/workers/qr-worker-pool.ts`
- `apps/web/src/workers/qr-encoder.worker.ts`

The coordinator worker handles:

- WASM initialization
- optional WASM thread pool initialization
- payload building and packet generation
- frame size measurement
- GIF assembly orchestration

The QR worker pool handles:

- rendering QR frames in parallel from packet ranges
- using packed packet buffers instead of one JS object per packet where possible

That is why the web path can scale much better than a naive single-threaded pipeline.

## 4. What `wasm.rs` Exposes To The Web

`packages/airqr-core/src/wasm.rs` is the public browser bridge. It exposes four main categories of functions.

### 4.1 Packet Generation

- `generate_raptorq_packets_raw(...)`
- `generate_raptorq_packets_raw_packed(...)`

The packed variant is the important optimized path. Instead of returning a large JS array of `{ data, packetId }` objects only, it can return contiguous packed buffers plus offsets. The web worker layer can then slice ranges without rebuilding every packet object.

### 4.2 QR Rendering

- `encode_qr_packet(...)`
- `encode_streaming_qr_packet(...)`
- `measure_qr_packet_frame_size(...)`
- `measure_streaming_qr_packet_frame_size(...)`

These functions are used by the web worker pipeline to know how much space each rendered frame needs before allocating a GIF buffer or a shared frame buffer.

### 4.3 Full Encode Helpers

- `encode_to_gif(...)`
- `encode_streaming_from_bytes(...)`

These are still useful as end-to-end helpers, but the optimized web path now bypasses part of the older monolithic encode flow and orchestrates more of the work in JavaScript workers around the lower-level packet and QR exports.

### 4.4 Decoders

- `init_normal_decoder()`
- `reset_normal_decoder()`
- `decode_normal_packet(...)`
- `init_streaming_decoder()`
- `reset_streaming_decoder()`
- `decode_streaming_packet(...)`

This makes the decode side symmetric with the encode side: the web UI can keep a Rust decoder instance alive across many packets and ask for progress on every frame.

## 5. How The Flutter App Uses Rust

### 5.1 Native Rust, Not WASM

Flutter does not use the WASM bridge. It uses a native Rust crate under:

- `apps/flutter/rust/Cargo.toml`
- `apps/flutter/rust/src/api/simple.rs`

The generated Dart bindings live under:

- `apps/flutter/lib/src/rust/api/simple.dart`
- `apps/flutter/lib/src/rust/frb_generated.dart`

### 5.2 What The Flutter Bridge Exposes

The Flutter-native Rust bridge exposes app-level functions such as:

- `processChunk(...)`
- `resetDecoder()`
- `encodeToGif(...)`
- `encodeChunkedToZip(...)`
- `decodeGifFile(...)`
- `decodeZipFile(...)`

That gives Flutter a simpler native surface than the web worker pipeline. Flutter can call higher-level Rust functions directly and let Rust do more of the orchestration.

### 5.3 Why Flutter Still Shares The Same Semantics

Even though the bridge layer is different, the transfer model is still the same:

- named payloads
- packetized QR frames
- progress from packet recovery
- optional chunked transfer for large files
- shared session id semantics for resume and sync-aware flows

That is why the web app and Flutter app can resume each other's scans and share the same sync server.

## 6. Encoding Pipeline In Detail

### 6.1 Inputs

AirQR can encode:

- a regular file
- a folder, after archiving it
- a note, represented as text with a transport filename and note-aware UI behavior

The UI surfaces normalize these inputs before sending them into the codec.

### 6.2 Web Payload Construction

On the web path, `apps/web/src/utils/encoderPayload.ts` is the important boundary.

It builds a named payload as:

- filename length
- filename bytes
- file or note bytes

It then prefixes a compression mode flag:

- `0` for raw payload
- `2` for deflate-compressed payload

The web app also does a compression probe before spending CPU on a full deflate for obviously incompressible large payloads.

### 6.3 Native Payload Construction

On the native Rust path, the payload is constructed inside the encoder implementation itself, with matching filename-plus-data semantics. The actual compression backend can differ by target, but the reconstructed output contract remains the same.

### 6.4 RaptorQ Generation

Once the payload exists, Rust uses the `raptorq` crate to generate fountain packets.

The important property is that receivers do not need every frame in order. They only need enough unique packets to satisfy the decoder.

This is what makes the system robust against:

- missed frames
- duplicate frames
- out-of-order frames
- partial scans

### 6.5 QR Packet Layout

In regular mode, the QR payload written by `wasm.rs` contains:

- total payload size
- packet size
- payload id
- packet data

In streaming mode, the header additionally includes:

- mode byte
- session id
- chunk id
- total chunks
- chunk offset
- total size
- actual packet size
- exact chunk packet count
- payload id
- packet data

That extra header is what allows chunk-aware resume and cross-device progress.

### 6.6 GIF And Chunked Output

The final output can be:

- one animated GIF
- a ZIP containing multiple GIF chunks for large transfers

The web path assembles GIFs in workers. The Flutter-native path can emit GIF bytes or ZIP bytes directly from Rust.

## 7. Decoding Pipeline In Detail

### 7.1 Sources

A decode flow can start from:

- a live camera frame
- an imported GIF
- a stored packet list during resume

### 7.2 Frame Detection

The UI surface is responsible for acquiring raw frame bytes and turning them into candidate QR payloads. After that point, Rust takes over the packet semantics.

### 7.3 Legacy vs Streaming Detection

The Flutter-facing Rust API in `packages/airqr-core/src/api.rs` auto-detects the packet mode:

- if the first byte indicates streaming mode, it instantiates `StreamingDecoder`
- otherwise it uses `AirqrDecoder`

This keeps the decode UI simpler and avoids per-platform protocol forks.

### 7.4 Session State And Deduplication

The decoder maintains state across many packets:

- seen packet ids
- expected packet count
- chunk progress
- overall progress
- filename
- session id when available

This is why progress can move live while the user is still scanning.

### 7.5 Reconstruction

Once enough unique packets are available:

1. RaptorQ reconstructs the payload
2. metadata is read back out
3. decompression is applied if needed
4. the original filename and content are returned

For note payloads, the UI can then render the result as text instead of a generic binary file card.

## 8. Resume And Shared History

Resume is not a separate codec. It is the same packet model plus durable state.

On the client side, resume flows use:

- local incomplete scan state
- optional remote packet download from the sync server
- replay through the same decode functions used for live scanning

On Flutter, a large amount of this orchestration now lives in dedicated scanner controllers instead of one monolithic page file. On the web side, the history and scanner flows use their own resume-aware hooks and services around the same shared packet/session contract.

## 9. Optional Sync Server

### 9.1 What The Server Does

The sync server is optional. The app works without it.

When enabled, it adds:

- shared history
- cross-device resume
- packet upload during scanning
- completion finalization
- WebSocket coordination for live multi-client flows
- basic auth and persistent session cookies

### 9.2 Main Entry Points

The public server entry starts in:

- `services/sync-server/server.py`
- `services/sync-server/sync_server/app.py`

The main HTTP and WebSocket behavior then flows through modules such as:

- `routes_scan_write.py`
- `routes_history.py`
- `ws_scan_handler.py`
- `packet_assembler.py`

### 9.3 Storage Model

There are two storage backends:

- filesystem-style storage in `storage.py`
- SQLite-backed metadata storage in `sqlite_storage.py`

In both cases, packet bytes and file artifacts still live on disk in a storage tree, while metadata and indexes can be backed by SQLite.

The storage layer persists:

- scan sessions
- uploaded scan packets
- final scanned files
- generated history items

### 9.4 Packet Resume On The Server

The WebSocket scan handler does more than just echo events. It also:

- keeps per-session live state
- stores packets durably
- reconstructs packet identity from stored filenames or packet payload
- exposes enough metadata for resume and session info endpoints

This is why web and Flutter clients can resume each other's sessions reliably.

### 9.5 Assembly Of Stored Sessions

When a completed file needs to be reconstructed from stored packets, the Python server can call the packaged Node-based packet assembler runtime:

- `services/sync-server/sync_server/packet_assembler.py`
- `services/sync-server/sync_server/runtime/packet_assembler/assemble_scan_packets.mjs`

That runtime uses the committed web packet assembly path instead of reimplementing another decoder in Python.

### 9.6 Auth, Bootstrap, And Retention

The server also handles:

- bootstrap auth from environment variables
- session cookie signing
- retention sweeps for incomplete sessions and old history items
- structured startup and runtime logs

This keeps the deployment story manageable without turning the sync server into a hard dependency for core transfers.

## 10. Portable HTML And Linksite Builds

The portable and linksite outputs are not separate applications. They are packaged builds of the same web runtime:

- the portable file is a single-file offline HTML
- the encoder linksite is a reduced standalone surface for generating QR output

That means fixes in the shared web encoder, note mode, preview sizing, and WASM path need to be propagated into those standalone builds when they are rebuilt.

## 11. Practical Mental Model

If you want the shortest correct model of the repo, it is this:

- Rust defines the transfer protocol and recovery logic
- the web app wraps it with WASM plus worker orchestration
- Flutter wraps it with native Rust plus `flutter_rust_bridge`
- the sync server stores packet/session/history state and coordinates optional shared flows
- portable HTML artifacts are just packaged web outputs, not a different protocol

That is the main reason the project can support:

- offline single-file usage
- web and Flutter parity
- resume across clients
- optional server sync without a separate encode/decode implementation per surface
