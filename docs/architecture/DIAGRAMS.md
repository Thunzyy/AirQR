# AirQR Architecture Diagrams

This page contains the public Mermaid diagrams for the repo. It focuses on structure and data flow.

If you want the low-level codec flow, read [ENCODE_DECODE_DIAGRAMS.md](./ENCODE_DECODE_DIAGRAMS.md). For the detailed prose explanation behind the diagrams, read [DEEP_DIVE.md](./DEEP_DIVE.md).

## 1. System Overview

```mermaid
flowchart TD
    User["User"]

    subgraph Clients["Client Surfaces"]
        Web["Web App<br/>React + TypeScript + Vite"]
        Portable["Portable HTML<br/>single-file offline build"]
        Flutter["Flutter App<br/>Android / iOS / Windows / Linux"]
    end

    subgraph SharedCore["Shared Engine"]
        Rust["airqr-core<br/>Rust encoder / decoder / packet logic"]
        Wasm["WASM bindings"]
        Frb["flutter_rust_bridge bindings"]
    end

    subgraph Sync["Optional Sync Layer"]
        Server["sync-server<br/>Python HTTP + WebSocket"]
        Storage["storage backend<br/>sessions / history / auth"]
    end

    User --> Web
    User --> Portable
    User --> Flutter

    Web --> Wasm --> Rust
    Portable --> Wasm
    Flutter --> Frb --> Rust

    Web -. optional sync .-> Server
    Flutter -. optional sync .-> Server
    Server --> Storage
```

## 2. Repository Responsibilities

```mermaid
flowchart LR
    Repo["AirQR"]

    Repo --> Packages["packages/"]
    Repo --> Apps["apps/"]
    Repo --> Services["services/"]
    Repo --> Build["build/"]
    Repo --> Dist["dist/"]
    Repo --> Docs["docs/"]

    Packages --> Core["airqr-core<br/>shared Rust runtime"]

    Apps --> Web["apps/web<br/>web UI + portable single-file outputs"]
    Apps --> Flutter["apps/flutter<br/>mobile + desktop app"]

    Services --> SyncServer["services/sync-server<br/>optional server"]

    Build --> BuildScripts["single-file / packaging / bundling scripts"]
    Dist --> Artifacts["generated outputs"]
    Docs --> Architecture["public docs"]
```

## 3. Web Runtime And WASM Selection

```mermaid
flowchart TD
    UI["React encoder / scanner UI"]
    Worker["worker-parallel.ts"]
    Loader["airqrCoreThreaded.ts"]
    Typed["airqrCoreTyped.ts"]
    WasmThreaded["pkg-threaded/airqr_core"]
    WasmBase["pkg/airqr_core"]
    Pool["QR worker pool"]
    GIF["GIF assembly"]

    UI --> Worker
    Worker --> Loader
    Loader -->|crossOriginIsolated + SharedArrayBuffer| WasmThreaded
    Loader -->|fallback| WasmBase
    WasmThreaded --> Typed
    WasmBase --> Typed
    Worker --> Typed
    Worker --> Pool
    Pool --> GIF
```

## 4. Flutter Runtime And Native Bridge

```mermaid
flowchart TD
    FlutterUI["Flutter pages + controllers"]
    DartApi["generated Dart API<br/>src/rust/api/simple.dart"]
    Frb["flutter_rust_bridge"]
    RustApi["apps/flutter/rust/src/api/simple.rs"]
    SharedRust["airqr-core"]

    FlutterUI --> DartApi --> Frb --> RustApi --> SharedRust
```

## 5. Encoding Pipeline

```mermaid
sequenceDiagram
    participant User
    participant UI as Web / Flutter encoder UI
    participant Normalize as input normalization
    participant Core as Rust core / WASM bridge
    participant RQ as RaptorQ
    participant QR as QR rendering workers
    participant Output as GIF or ZIP output

    User->>UI: Select file, folder, or note
    UI->>Normalize: Build payload + settings
    Normalize->>Core: Encoded payload
    Core->>Core: Optional compression
    Core->>RQ: Generate fountain packets
    RQ->>QR: Convert packets into QR frames
    QR->>Output: Assemble animated GIF<br/>or chunked ZIP of GIFs
    Output-->>UI: Artifact + frame metadata
    UI-->>User: Preview / display / download
```

## 6. Streaming Encode And Chunking

```mermaid
flowchart TD
    Input["Large input"]
    ChunkPlan["Chunk planner"]
    ChunkPayload["Per-chunk payload + compression"]
    Session["sessionId / chunkId / totalChunks"]
    Packetize["RaptorQ packet generation"]
    Frames["QR frame rendering"]
    ChunkGif["Chunk GIF"]
    Zip["ZIP of GIF chunks"]

    Input --> ChunkPlan --> ChunkPayload --> Session --> Packetize --> Frames --> ChunkGif --> Zip
```

## 7. Decode Pipeline

```mermaid
flowchart TD
    Source["Camera frames / GIF import / stored packets"]
    Detect["QR detect / frame extraction"]
    Parse["Packet parse"]
    Route["Legacy vs streaming mode"]
    Session["Decoder state<br/>dedupe / progress / chunk tracking"]
    Recover["RaptorQ recovery"]
    Finalize["Decompression + metadata extraction"]
    Result["File or note result"]

    Source --> Detect --> Parse --> Route --> Session
    Session -->|enough unique packets| Recover --> Finalize --> Result
    Session -->|not enough yet| Session
```

## 8. Multi-Device Sync

```mermaid
flowchart LR
    subgraph Clients
        WebA["Web client"]
        FlutterA["Flutter client"]
        History["History / resume views"]
    end

    subgraph SyncServer["sync-server"]
        Http["HTTP routes"]
        Ws["WebSocket scan channel"]
        Persist["Storage + packet/session metadata"]
        Assembler["Node packet assembler runtime"]
    end

    WebA <--> Ws
    FlutterA <--> Ws
    WebA <--> Http
    FlutterA <--> Http
    History <--> Http
    Http --> Persist
    Ws --> Persist
    Persist --> Assembler
```

## 9. Build And Distribution

```mermaid
flowchart TD
    Rust["airqr-core Rust sources"]
    WebSrc["apps/web"]
    FlutterSrc["apps/flutter"]
    ServerSrc["services/sync-server"]

    Rust --> Wasm["WASM bundles"]
    Rust --> Native["native Rust library"]

    Wasm --> WebSrc --> WebBuild["web dist"]
    Wasm --> SingleFile["portable / linksite HTML"]

    Native --> FlutterSrc --> Mobile["Android / iOS"]
    Native --> FlutterSrc --> Desktop["Windows / Linux"]

    ServerSrc --> Docker["Docker image / compose"]
    WebBuild --> Static["static hosting"]
    SingleFile --> FileProtocol["file:// offline usage"]
```

## 10. Operational Modes

```mermaid
flowchart TD
    Start["Choose a mode"]
    Start --> Offline["Offline only"]
    Start --> Synced["Shared sync mode"]

    Offline --> Portable["Portable HTML"]
    Offline --> LocalApps["Web or Flutter with local history only"]

    Synced --> Server["Run sync-server"]
    Server --> SharedHistory["Shared history"]
    Server --> Resume["Cross-device resume"]
    Server --> MultiScanner["Multiple scanners / receivers"]
```
