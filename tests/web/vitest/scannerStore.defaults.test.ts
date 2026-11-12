import { describe, expect, it } from "vitest";

import { useScannerStore } from "@web/store";

describe("scannerStore Flutter parity defaults", () => {
  it("starts with Flutter's Fast preset and 720p camera resolution", () => {
    const initialState = useScannerStore.getInitialState();

    expect(initialState.selectedPreset).toBe("fast");
    expect(initialState.config).toMatchObject({
      scanInterval: 16,
      resolution: "720p",
      tryHarder: false,
      enableTorch: false,
    });
  });
});
