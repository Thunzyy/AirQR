export type LocalPacketPage = {
  startIndex: number;
  packets: Uint8Array[];
};

export type LocalPacketSource = {
  packetCount: number;
  visit: (
    visitor: (page: LocalPacketPage) => void | Promise<void>
  ) => Promise<void>;
};

export function normalizePacketBuffer(
  packet: Uint8Array | ArrayBuffer
): Uint8Array | null {
  const normalized = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
  return normalized.length > 0 ? normalized : null;
}

export function getLegacyPacketPages(
  fallbackPackets?: Array<Uint8Array | ArrayBuffer>
): LocalPacketPage[] {
  if (!fallbackPackets || fallbackPackets.length === 0) {
    return [];
  }

  const packets = fallbackPackets
    .map(normalizePacketBuffer)
    .filter((packet): packet is Uint8Array => packet !== null);

  return packets.length > 0 ? [{ startIndex: 0, packets }] : [];
}

export function countPacketPages(packetPages: LocalPacketPage[]): number {
  return packetPages.reduce((count, page) => count + page.packets.length, 0);
}

export function flattenPacketPages(packetPages: LocalPacketPage[]): Uint8Array[] {
  return packetPages.flatMap((page) => page.packets);
}
