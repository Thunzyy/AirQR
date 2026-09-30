# AirQR Encode / Decode Diagrams

This page zooms into the low-level mechanics of the codec. It explains what happens between:

- file, folder, or note input
- bytes and metadata layout
- optional compression
- RaptorQ packet generation
- QR frame rendering in black and white
- GIF or chunked ZIP assembly
- live scanning, packet parsing, deduplication, recovery, decompression, and final result

For the broader system view, read [DIAGRAMS.md](./DIAGRAMS.md). For prose explanations and file-level references, read [DEEP_DIVE.md](./DEEP_DIVE.md).

## 1. Normal Encode Flow, End To End

```mermaid
flowchart TD
    Input["User input<br/>file / folder / note"]
    Normalize["Normalize source"]
    Folder["If folder:<br/>archive first"]
    Note["If note:<br/>use text bytes + note filename"]
    Bytes["Raw bytes + transport filename"]
    Named["Build named payload<br/>[filename_len:4][filename][data]"]
    Compress["Optional compression step"]
    Flag["Prefix compression flag<br/>0 = raw<br/>2 = deflate"]
    Payload["Final payload bytes"]
    PacketPlan["Choose packet size + overhead"]
    RQ["RaptorQ encoder"]
    Packets["Encoded packets + payload IDs"]
    Header["Build QR payload per packet"]
    QR["Generate QR matrix"]
    Mono["Render 1-bit/indexed frame<br/>0 = white, 1 = black"]
    GIF["Assemble animated GIF"]
    Output["Preview / display / download"]

    Input --> Normalize
    Normalize --> Folder
    Normalize --> Note
    Normalize --> Bytes
    Folder --> Bytes
    Note --> Bytes
    Bytes --> Named --> Compress --> Flag --> Payload --> PacketPlan --> RQ --> Packets --> Header --> QR --> Mono --> GIF --> Output
```

## 2. Payload Construction

```mermaid
flowchart LR
    Filename["filename bytes"]
    Data["file bytes or note bytes"]
    Named["named payload"]
    Flag["compression flag"]
    Final["encoded payload"]

    Filename --> Named
    Data --> Named
    Named -->|"[filename_len:4][filename][data]"| Flag
    Flag -->|"[compression_flag:1][named payload]"| Final
```

### Named payload layout

```text
[ filename_len: 4 bytes, big-endian ]
[ filename bytes ]
[ original content bytes ]
```

### Compression flag values used by the client surfaces

```text
0 = raw payload
2 = deflate-compressed payload
```

## 3. Packetization With RaptorQ

```mermaid
sequenceDiagram
    participant Payload as Encoded payload
    participant Config as Packet config
    participant RQ as RaptorQ encoder
    participant Meta as Metadata
    participant Packet as Packet list

    Payload->>Config: payload length
    Config->>Config: choose packetSize
    Config->>Config: choose raptorqOverhead
    Payload->>RQ: raw encoded payload
    Config->>RQ: packet size + overhead
    RQ->>Packet: symbol packets
    RQ->>Meta: totalSize + totalPackets
```

The important property here is that the receiver does not need every frame in order. It only needs enough unique packets for successful recovery.

## 4. Normal QR Payload Layout

```mermaid
flowchart LR
    Total["total_size: 4 bytes"]
    Actual["actual_packet_size: 2 bytes"]
    Id["payload_id: 4 bytes"]
    Data["packet data bytes"]
    QrPayload["normal QR payload"]

    Total --> QrPayload
    Actual --> QrPayload
    Id --> QrPayload
    Data --> QrPayload
```

### Normal QR payload layout

```text
[ total_size: 4 ]
[ actual_packet_size: 2 ]
[ payload_id: 4 ]
[ packet data bytes ]
```

## 5. Streaming QR Payload Layout

```mermaid
flowchart LR
    Mode["mode: 1 byte<br/>current rich format = 2"]
    Session["session_id: 4"]
    Chunk["chunk_id: 4"]
    TotalChunks["total_chunks: 4"]
    Offset["chunk_offset: 8"]
    Total["total_size: 4"]
    Actual["actual_packet_size: 2"]
    Exact["exact_chunk_packets: 4"]
    Id["payload_id: 4"]
    Data["packet data"]
    QrPayload["streaming QR payload"]

    Mode --> QrPayload
    Session --> QrPayload
    Chunk --> QrPayload
    TotalChunks --> QrPayload
    Offset --> QrPayload
    Total --> QrPayload
    Actual --> QrPayload
    Exact --> QrPayload
    Id --> QrPayload
    Data --> QrPayload
```

### Streaming QR payload layout

```text
[ mode: 2 ]
[ session_id: 4 ]
[ chunk_id: 4 ]
[ total_chunks: 4 ]
[ chunk_offset: 8 ]
[ total_size: 4 ]
[ actual_packet_size: 2 ]
[ exact_chunk_packets: 4 ]
[ payload_id: 4 ]
[ packet data bytes ]
```

This diagram shows the current richer streaming header with `exact_chunk_packets`, which corresponds to mode `2`. The decoder still accepts the older mode `1` variant documented later on this page.

## 6. QR Rendering To Black And White Frames

```mermaid
flowchart TD
    QrPayload["QR payload bytes"]
    QrMatrix["QR matrix from qrcodegen"]
    Border["Add quiet zone / border"]
    Scale["Choose scale from target size"]
    Raster["Rasterize modules into indexed buffer"]
    Palette["Palette<br/>0 = white<br/>1 = black"]
    Frame["1-bit style frame buffer"]
    GifFrame["GIF frame"]

    QrPayload --> QrMatrix --> Border --> Scale --> Raster --> Palette --> Frame --> GifFrame
```

What actually happens at this stage:

- each QR module is expanded into a square of pixels
- the buffer is indexed, not full RGBA
- the exported GIF palette is effectively two colors: white and black
- this keeps the frames compact and scannable

## 7. Web Encode Runtime, Detailed

```mermaid
flowchart TD
    UI["Encoder UI"]
    Payload["encoderPayload.ts<br/>named payload + compression probe"]
    Worker["worker-parallel.ts"]
    Wasm["airqrCoreThreaded.ts / airqrCoreTyped.ts"]
    ThreadPool["optional WASM thread pool"]
    RQ["packed RaptorQ packet generation"]
    QRPool["QR worker pool"]
    SAB["SharedArrayBuffer path when available"]
    GIF["contiguous GIF assembly"]
    Artifact["GIF or ZIP result"]

    UI --> Payload --> Worker --> Wasm
    Wasm --> ThreadPool
    Wasm --> RQ
    RQ --> SAB
    RQ --> QRPool
    SAB --> QRPool
    QRPool --> GIF --> Artifact
```

This is why the web app is not just “Rust in the browser”. The heavy pipeline is split between:

- Rust/WASM for packet and QR logic
- workers for parallel frame rendering
- JavaScript orchestration for packing, batching, and GIF assembly

## 8. Chunked Encode Flow

```mermaid
flowchart TD
    Large["Large input"]
    Planner["Chunk planner"]
    Chunk["Select chunk N"]
    Named["Build named payload for chunk"]
    Flag["Prefix compression flag"]
    Header["Attach session / chunk metadata in QR header"]
    RQ["RaptorQ packets for this chunk"]
    Frames["QR frames for this chunk"]
    ChunkGif["chunk-X.gif"]
    Zip["ZIP containing all chunk GIFs"]

    Large --> Planner --> Chunk --> Named --> Flag --> Header --> RQ --> Frames --> ChunkGif --> Zip
```

The payload still carries filename metadata inside the chunk payload, while the QR header carries transport metadata for chunk ordering and resume.

## 9. Live Decode Flow, End To End

```mermaid
flowchart TD
    Source["Source<br/>camera / GIF import / packet replay"]
    Detect["QR detection or frame extraction"]
    Bytes["Extract QR payload bytes"]
    Mode["Detect mode<br/>legacy or streaming"]
    Parse["Parse packet header"]
    Validate["Validate lengths / ids / chunk bounds"]
    Dedupe["Ignore duplicates"]
    Session["Update decoder state"]
    Enough["Enough unique packets?"]
    Recover["RaptorQ recovery"]
    Decompress["Decompress if flag requires it"]
    Metadata["Read filename_len + filename"]
    Final["Produce file or note result"]
    Persist["Save result / history / local resume cleanup"]

    Source --> Detect --> Bytes --> Mode --> Parse --> Validate --> Dedupe --> Session --> Enough
    Enough -->|no| Session
    Enough -->|yes| Recover --> Decompress --> Metadata --> Final --> Persist
```

## 10. Decode State In Legacy Mode

```mermaid
sequenceDiagram
    participant Frame as QR frame bytes
    participant API as add_chunk(...)
    participant Parser as header parser
    participant Decoder as RaptorQ decoder
    participant Result as DecodeResult

    Frame->>API: packet bytes
    API->>Parser: read total_size, packet_size, payload_id
    Parser->>Parser: validate payload length
    Parser->>Decoder: add encoding packet
    Decoder-->>API: still incomplete or recovered payload
    API-->>Result: Progress / Completed / Error
```

On completion:

1. the decoder reconstructs the encoded payload
2. the compression flag is read
3. the payload is decompressed if needed
4. `filename_len` and `filename` are read
5. the remaining bytes become the final file or note content

## 11. Decode State In Streaming Mode

```mermaid
flowchart TD
    Packet["Streaming QR payload"]
    Session["Read session_id"]
    Chunk["Read chunk_id / total_chunks / offset"]
    PacketId["Read payload_id"]
    DecoderMap["Get or create per-chunk decoder"]
    ChunkState["Update chunk packet set"]
    ChunkDone{"Chunk recovered?"}
    Store["Store decoded chunk bytes"]
    Merge{"All chunks recovered?"}
    Final["Concatenate chunks in order"]
    Result["AllCompleted result"]
    Progress["Progress or ChunkCompleted result"]

    Packet --> Session --> Chunk --> PacketId --> DecoderMap --> ChunkState --> ChunkDone
    ChunkDone -->|no| Progress
    ChunkDone -->|yes| Store --> Merge
    Merge -->|no| Progress
    Merge -->|yes| Final --> Result
```

This is where the streaming decoder tracks:

- session id
- total chunk count
- which chunk decoders exist
- which chunks are already completed
- temporary decoded chunk buffers
- overall progress

## 12. Sync-Aware Decode And Resume

```mermaid
flowchart LR
    Client["Web or Flutter client"]
    Local["Local incomplete scan state"]
    Server["Optional sync-server"]
    Packets["Stored packets"]
    Replay["Replay packets through same decoder"]
    Final["Recovered result"]

    Client --> Local
    Client -. optional .-> Server
    Server --> Packets
    Local --> Replay
    Packets --> Replay
    Replay --> Final
```

Resume does not use a different decode algorithm. It replays previously stored packets through the same Rust decoder state machine.

## 13. Where Notes Differ From Generic Files

```mermaid
flowchart TD
    Note["Note text"]
    Encode["Encode exactly like a small named payload"]
    QR["QR / GIF pipeline"]
    Decode["Decode back to bytes"]
    Filename["Transport filename identifies note semantics"]
    UI["UI renders text viewer/editor instead of generic file card"]

    Note --> Encode --> QR --> Decode --> Filename --> UI
```

At the codec layer, notes are still bytes plus filename metadata. The note-specific behavior happens mostly in the client UI after decoding.

## 14. Byte-Level View Of A Normal QR Packet

```mermaid
flowchart LR
    B0["0..3<br/>total_size"]
    B1["4..5<br/>actual_packet_size"]
    B2["6..9<br/>payload_id"]
    B3["10..N<br/>packet_data"]

    B0 --> B1 --> B2 --> B3
```

### Normal packet offsets

| Offset | Size | Field | Meaning |
| --- | ---: | --- | --- |
| `0` | `4` | `total_size` | Size of the encoded payload before RaptorQ splitting |
| `4` | `2` | `actual_packet_size` | Actual byte length of this packet's data section |
| `6` | `4` | `payload_id` | RaptorQ payload id / symbol id |
| `10` | variable | `packet_data` | Raw RaptorQ packet payload bytes |

This is the header parsed by the normal decoder in `packages/airqr-core/src/lib.rs`.

## 15. Byte-Level View Of A Streaming Packet, Mode 2

Mode `2` is the current richer streaming header used by the web/WASM path and by the Rust streaming encoder. It adds `exact_chunk_packets`.

```mermaid
flowchart LR
    M0["0<br/>mode = 2"]
    M1["1..4<br/>session_id"]
    M2["5..8<br/>chunk_id"]
    M3["9..12<br/>total_chunks"]
    M4["13..20<br/>chunk_offset"]
    M5["21..24<br/>total_size"]
    M6["25..26<br/>actual_packet_size"]
    M7["27..30<br/>exact_chunk_packets"]
    M8["31..34<br/>payload_id"]
    M9["35..N<br/>packet_data"]

    M0 --> M1 --> M2 --> M3 --> M4 --> M5 --> M6 --> M7 --> M8 --> M9
```

### Streaming mode 2 offsets

| Offset | Size | Field | Meaning |
| --- | ---: | --- | --- |
| `0` | `1` | `mode` | `2` = streaming packet with exact chunk packet count |
| `1` | `4` | `session_id` | Transfer/session identifier |
| `5` | `4` | `chunk_id` | Current chunk number |
| `9` | `4` | `total_chunks` | Total number of chunks in this transfer |
| `13` | `8` | `chunk_offset` | Byte offset of this chunk inside the original file |
| `21` | `4` | `total_size` | Encoded payload size for this chunk |
| `25` | `2` | `actual_packet_size` | Actual byte length of the packet payload |
| `27` | `4` | `exact_chunk_packets` | Exact number of packets expected for this chunk |
| `31` | `4` | `payload_id` | RaptorQ payload id / symbol id |
| `35` | variable | `packet_data` | Raw RaptorQ packet payload bytes |

This is the layout produced by `build_streaming_qr_data(...)` in `packages/airqr-core/src/wasm.rs`.

## 16. Byte-Level View Of A Streaming Packet, Mode 1

Mode `1` is still accepted by the streaming decoder for compatibility. It is used by the Flutter-native streaming encode helper and older streaming paths that do not carry `exact_chunk_packets`.

```mermaid
flowchart LR
    L0["0<br/>mode = 1"]
    L1["1..4<br/>session_id"]
    L2["5..8<br/>chunk_id"]
    L3["9..12<br/>total_chunks"]
    L4["13..20<br/>chunk_offset"]
    L5["21..24<br/>total_size"]
    L6["25..26<br/>packet_size"]
    L7["27..30<br/>payload_id"]
    L8["31..N<br/>packet_data"]

    L0 --> L1 --> L2 --> L3 --> L4 --> L5 --> L6 --> L7 --> L8
```

### Streaming mode 1 offsets

| Offset | Size | Field | Meaning |
| --- | ---: | --- | --- |
| `0` | `1` | `mode` | `1` = streaming packet without exact chunk packet count |
| `1` | `4` | `session_id` | Transfer/session identifier |
| `5` | `4` | `chunk_id` | Current chunk number |
| `9` | `4` | `total_chunks` | Total number of chunks in this transfer |
| `13` | `8` | `chunk_offset` | Byte offset of this chunk inside the original file |
| `21` | `4` | `total_size` | Encoded payload size for this chunk |
| `25` | `2` | `packet_size` | Nominal packet size |
| `27` | `4` | `payload_id` | RaptorQ payload id / symbol id |
| `31` | variable | `packet_data` | Raw RaptorQ packet payload bytes |

The streaming decoder in `packages/airqr-core/src/streaming.rs` accepts both mode `1` and mode `2`.

## 17. Reconstructed Payload After RaptorQ

After the decoder has received enough unique packets, RaptorQ reconstructs the encoded payload. That reconstructed payload is not yet the final file. It still contains the compression flag and the named payload.

```mermaid
flowchart LR
    C0["0<br/>compression_flag"]
    C1["1..4<br/>filename_len"]
    C2["5..X<br/>filename bytes"]
    C3["X+1..end<br/>original content bytes"]

    C0 --> C1 --> C2 --> C3
```

### Reconstructed payload layout

| Offset | Size | Field | Meaning |
| --- | ---: | --- | --- |
| `0` | `1` | `compression_flag` | `0` = raw, `2` = deflate |
| `1` | `4` | `filename_len` | Big-endian filename byte length |
| `5` | variable | `filename` | Original transport filename |
| after filename | variable | `content` | Final file bytes or note text bytes |

Decode completion therefore requires:

1. RaptorQ recovery
2. reading `compression_flag`
3. optional decompression
4. reading `filename_len`
5. extracting `filename`
6. returning the remaining bytes as the final content

## 18. How The Decoder Chooses Legacy vs Streaming

```mermaid
flowchart TD
    Packet["Incoming QR payload bytes"]
    First["Inspect byte 0"]
    Streaming{"byte 0 == 1 or 2 ?"}
    Legacy["Use AirqrDecoder"]
    Stream["Use StreamingDecoder"]

    Packet --> First --> Streaming
    Streaming -->|yes| Stream
    Streaming -->|no| Legacy
```

This heuristic is used in the Flutter-facing API layer. The normal decoder then expects the non-streaming header beginning with `total_size`, while the streaming decoder expects one of the explicit mode bytes.

## 19. What Makes The Output Scannable

```mermaid
flowchart TD
    Packet["QR payload bytes"]
    Matrix["QR matrix"]
    Quiet["Quiet zone / border"]
    Target["Target frame size"]
    Scale["Integer scale selection"]
    Mono["Black/white indexed raster"]
    Preview["Display fit / auto-zoom"]
    Screen["Visible animated QR"]

    Packet --> Matrix --> Quiet --> Target --> Scale --> Mono --> Preview --> Screen
```

The main practical scannability constraints are:

- packet size must stay small enough for the chosen QR capacity
- the QR matrix must keep a proper border
- the rendered output must stay fully visible on screen
- the animation speed must remain readable by the receiving camera

That is why the repo pays attention to:

- packet-size tuning
- ECC level
- target size and scale
- fully-visible preview fit
- GIF frame timing

## 20. Folder And Note Specializations

```mermaid
flowchart LR
    Folder["Folder input"] --> Archive["Archive step"] --> Named["named payload"]
    File["File input"] --> Named
    Note["Note input"] --> Text["text bytes + transport filename"] --> Named
```

The important point is that the codec only sees named bytes. The specialization happens before encoding:

- folders are archived first
- notes are turned into text bytes
- files pass through directly

After that, they all follow the same packet, QR, GIF, and decode machinery.
