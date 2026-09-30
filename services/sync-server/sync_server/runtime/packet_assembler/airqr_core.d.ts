/* tslint:disable */
/* eslint-disable */

export function decode_normal_packet(data: Uint8Array): any;

export function decode_streaming_packet(data: Uint8Array): any;

export function encode_qr_packet(packet_data: Uint8Array, total_size: number, _packet_size: number, packet_id: Uint8Array, ecc_level: string, target_size: number, scale: number): Uint8Array;

export function encode_streaming_from_bytes(file_data: Uint8Array, filename: string, chunk_id: number, total_chunks: number, session_id: number, chunk_size_mb: number, compression_enabled: boolean, frame_delay_ms: number, ecc_level: string, packet_size: number, raptorq_overhead: number, callback: Function): Uint8Array;

export function encode_streaming_qr_packet(packet_data: Uint8Array, packet_id: Uint8Array, session_id: number, chunk_id: number, total_chunks: number, chunk_offset: number, total_size: number, _packet_size: number, exact_chunk_packets: number, ecc_level: string, target_size: number, scale: number): Uint8Array;

export function encode_to_gif(filename: string, data: Uint8Array, compression_enabled: boolean, frame_delay_ms: number, ecc_level: string, packet_size: number, target_size: number, scale: number, raptorq_overhead: number, callback: Function): Uint8Array;

export function generate_raptorq_packets_raw(raw_data: Uint8Array, packet_size: number, raptorq_overhead: number): Array<any>;

export function generate_raptorq_packets_raw_packed(raw_data: Uint8Array, packet_size: number, raptorq_overhead: number): Array<any>;

export function init_normal_decoder(): void;

export function init_streaming_decoder(): void;

export function measure_qr_packet_frame_size(packet_data: Uint8Array, total_size: number, _packet_size: number, packet_id: Uint8Array, ecc_level: string, target_size: number, scale: number): number;

export function measure_streaming_qr_packet_frame_size(packet_data: Uint8Array, packet_id: Uint8Array, session_id: number, chunk_id: number, total_chunks: number, chunk_offset: number, total_size: number, _packet_size: number, exact_chunk_packets: number, ecc_level: string, target_size: number, scale: number): number;

export function reset_normal_decoder(): void;

export function reset_streaming_decoder(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly decode_normal_packet: (a: number, b: number) => [number, number, number];
    readonly decode_streaming_packet: (a: number, b: number) => [number, number, number];
    readonly encode_qr_packet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number, number];
    readonly encode_streaming_from_bytes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: any) => [number, number, number, number];
    readonly encode_streaming_qr_packet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => [number, number, number, number];
    readonly encode_to_gif: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: any) => [number, number, number, number];
    readonly generate_raptorq_packets_raw: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly generate_raptorq_packets_raw_packed: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly init_normal_decoder: () => void;
    readonly init_streaming_decoder: () => void;
    readonly measure_qr_packet_frame_size: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly measure_streaming_qr_packet_frame_size: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => [number, number, number];
    readonly reset_normal_decoder: () => void;
    readonly reset_streaming_decoder: () => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
