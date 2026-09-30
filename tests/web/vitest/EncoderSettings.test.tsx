import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import EncoderSettings from "@web/components/encoder/EncoderSettings";

describe("EncoderSettings", () => {
  it("exposes advanced settings as a real disclosure with accessible controls", async () => {
    render(
      <EncoderSettings
        config={{
          fps: 10,
          packetSize: 800,
          ecc: "MEDIUM",
          targetSize: 300,
          raptorqOverhead: 1.5,
          compressionEnabled: true,
          customChunkSize: 10,
          forceChunkMode: false,
        }}
        forceChunkMode={false}
        onConfigChange={vi.fn()}
        onForceChunkModeChange={vi.fn()}
      />
    );

    const advancedToggle = screen.getByRole("button", {
      name: /Advanced Settings|encoder\.advancedSettings/i,
    });

    expect(advancedToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("slider", {
        name: /Frame Rate \(FPS\)|encoder\.frameRate/i,
      })
    ).not.toBeInTheDocument();

    await userEvent.click(advancedToggle);

    expect(advancedToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("slider", {
        name: /Frame Rate \(FPS\)|encoder\.frameRate/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", {
        name: /Error Correction|encoder\.errorCorrection/i,
      })
    ).toBeInTheDocument();
  });
});
