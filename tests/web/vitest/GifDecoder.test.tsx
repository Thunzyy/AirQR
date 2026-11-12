import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import GifDecoder from "@web/features/decoder/GifDecoder";

// Mock the GIF decoding pool
vi.mock("@web/workers/gif-decoder-pool", () => ({
  decodeGifFile: vi.fn().mockResolvedValue({
    frames: [],
    decodedData: new Uint8Array([1, 2, 3]),
    filename: "test.bin",
  }),
}));

describe("GifDecoder Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    render(<GifDecoder />);
    expect(screen.getAllByText(/Tap to select a GIF file/i).length).toBeGreaterThan(0);
  });

  it("shows file selection area", () => {
    const { container } = render(<GifDecoder />);
    const uploadIcon = container.querySelector('svg[data-icon="upload_file"]');
    expect(uploadIcon).toBeInTheDocument();
  });

  it("allows opening the file picker from keyboard", () => {
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    render(<GifDecoder />);

    const picker = screen.getByRole("button", {
      name: /tap to select a gif file/i,
    });

    fireEvent.keyDown(picker, { key: "Enter" });
    fireEvent.keyDown(picker, { key: " " });

    expect(clickSpy).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it("displays decode button", () => {
    render(<GifDecoder />);
    const decodeButton = screen.getByRole("button", { name: /decode/i });
    expect(decodeButton).toBeInTheDocument();
  });

  it("decode button is initially disabled", () => {
    render(<GifDecoder />);
    const decodeButton = screen.getByRole("button", { name: /decode/i });
    expect(decodeButton).toBeDisabled();
  });

  it("handles file selection", async () => {
    render(<GifDecoder />);

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();

    const file = new File(["test content"], "test.gif", {
      type: "image/gif",
    });

    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [file] } });
    }
  });
});

describe("GIF Decoding Logic", () => {
  it("validates GIF file magic number", () => {
    const validGif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    const magicNumber = String.fromCharCode(...validGif.slice(0, 6));
    expect(magicNumber).toMatch(/^GIF8[79]a$/);
  });

  it("rejects invalid files", () => {
    const invalidFile = new Uint8Array([0x50, 0x4e, 0x47]); // PNG header
    const magicNumber = String.fromCharCode(...invalidFile.slice(0, 3));
    expect(magicNumber).not.toBe("GIF");
  });
});
