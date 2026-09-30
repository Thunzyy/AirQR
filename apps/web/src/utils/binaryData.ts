import { globalHas } from "../parse/wire";

export type BinaryData = Uint8Array | Blob;

export function isBlobData(value: BinaryData): value is Blob {
  return globalHas("Blob") && value instanceof Blob;
}

export function getBinaryDataSize(value?: BinaryData | null): number {
  if (!value) {
    return 0;
  }
  if (isBlobData(value)) {
    return value.size;
  }
  return value.length;
}

export function toBlobPart(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export async function toUint8Array(value: BinaryData): Promise<Uint8Array> {
  if (isBlobData(value)) {
    if ("arrayBuffer" in value) {
      return new Uint8Array(await value.arrayBuffer());
    }
    if (globalHas("Response")) {
      return new Uint8Array(await new Response(value).arrayBuffer());
    }
    throw new Error("Blob arrayBuffer() is not available in this environment");
  }
  return value;
}

export function toBinaryBlob(
  value: BinaryData,
  mimeType = "application/octet-stream"
): Blob {
  if (isBlobData(value)) {
    if (!value.type || value.type === mimeType) {
      return value;
    }
    return value.slice(0, value.size, mimeType);
  }
  return new Blob([toBlobPart(value)], { type: mimeType });
}
