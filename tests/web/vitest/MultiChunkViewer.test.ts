import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(
  resolve(process.cwd(), "public/multi-chunk.html"),
  "utf8"
);

describe("multi-chunk viewer shell", () => {
  it("uses the compact QR viewer layout contract", () => {
    expect(html).toContain('class="header qr-viewer-toolbar"');
    expect(html).toContain("height: calc(100dvh - var(--toolbar-height));");
    expect(html).toContain('className = "qr-card qr-viewer-card"');
  });
});
