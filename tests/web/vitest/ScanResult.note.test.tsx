import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ScanResult from "@web/features/scanner/ScanResult";
import { resolveVisualNoteLineCount } from "@web/components/note/noteCodeViewerUtils";

describe("ScanResult note mode", () => {
  it("continues line numbering across visually wrapped rows", () => {
    expect(resolveVisualNoteLineCount(7, 12 * 24)).toBe(12);
  });

  it("renders icon-only copy and download actions without overflowing the filename", () => {
    const onCopyNote = vi.fn();
    const onDownload = vi.fn();
    render(
      <ScanResult
        filename="a-very-long-note-filename-that-must-stay-inside-the-mobile-toolbar.md"
        fileSize={42}
        duration={1.2}
        isNote
        noteContent={"# Title\nhello"}
        onCopyNote={onCopyNote}
        onDownload={onDownload}
        onScanAgain={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const filename = screen.getByText(
      "a-very-long-note-filename-that-must-stay-inside-the-mobile-toolbar.md"
    );
    expect(screen.getByTestId("scanner-note-content")).toHaveTextContent(
      "# Title hello"
    );
    expect(screen.getByTestId("scanner-note-content")).toHaveClass("pl-1");
    expect(screen.getByTestId("note-code-gutter")).toHaveClass(
      "bg-[var(--airqr-control-surface)]"
    );
    expect(screen.getAllByTestId("note-code-line-number")).toHaveLength(2);
    expect(screen.getAllByTestId("note-code-line-number")[0]).toHaveClass(
      "translate-y-[2px]"
    );
    const copyButton = screen.getByRole("button", { name: "Copy to Clipboard" });
    const downloadButton = screen.getByRole("button", { name: "Download" });

    expect(filename).toHaveClass("truncate");
    expect(copyButton).toHaveTextContent("");
    expect(downloadButton).toHaveTextContent("");
    expect(copyButton).toHaveAttribute("title", "Copy to Clipboard");
    expect(downloadButton).toHaveAttribute("title", "Download");
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.click(copyButton);
    fireEvent.click(downloadButton);

    expect(onCopyNote).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});

describe("ScanResult file preview", () => {
  it("renders a scanned image preview with the download action", () => {
    render(
      <ScanResult
        filename="photo.png"
        fileSize={125}
        duration={1.2}
        fileData={new Uint8Array([1, 2, 3])}
        mimeType="image/png"
        onDownload={vi.fn()}
        onScanAgain={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("img", { name: /photo\.png/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("renders scanned video and PDF previews", () => {
    const { rerender } = render(
      <ScanResult
        filename="clip.mp4"
        fileSize={512}
        duration={1.2}
        fileData={new Uint8Array([1, 2, 3])}
        mimeType="video/mp4"
        onDownload={vi.fn()}
        onScanAgain={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("scan-result-video-preview")).toHaveAttribute("controls");

    rerender(
      <ScanResult
        filename="report.pdf"
        fileSize={1024}
        duration={1.2}
        fileData={new Uint8Array([1, 2, 3])}
        mimeType="application/pdf"
        onDownload={vi.fn()}
        onScanAgain={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTitle("report.pdf")).toHaveAttribute("type", "application/pdf");
  });
});
