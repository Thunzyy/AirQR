import "@testing-library/jest-dom";
import { vi } from "vitest";
import i18n from "./src/i18n";

await i18n.changeLanguage("en");

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

if ("Blob" in globalThis && !("arrayBuffer" in Blob.prototype)) {
  Blob.prototype.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (result instanceof ArrayBuffer) {
          resolve(result);
          return;
        }
        reject(new Error("Failed to read Blob"));
      };
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read Blob"));
      reader.readAsArrayBuffer(this);
    });
  };
}

globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

globalThis.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

globalThis.URL.createObjectURL = vi.fn(() => "mock-url");
globalThis.URL.revokeObjectURL = vi.fn();

class WorkerMock {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn(() => true);
}

// SAFETY: jsdom has no Worker implementation; tests install an in-memory stub.
globalThis.Worker = WorkerMock as typeof Worker;

Object.defineProperty(navigator, "mediaDevices", {
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [],
    }),
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: "videoinput", deviceId: "camera1", label: "Camera 1" },
    ]),
  },
  writable: true,
});

Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
  configurable: true,
  writable: true,
});
