import { describe, expect, it } from "vitest";

import { buildNoteFilename } from "@web/utils/noteDetection";
import {
  createHistoryItem,
  getVersionedHistoryTitle,
  normalizeHistoryItem,
} from "@web/utils/history";

describe("history utils", () => {
  it("normalizes binary payloads and array-like chunk minima from loose storage records", () => {
    const fileData = new Uint8Array([1, 2, 3]).buffer;
    const chunkMinFrames = {
      0: "12",
      1: 13,
      length: 2,
    };

    const item = normalizeHistoryItem({
      id: "scan-1",
      origin: "scanned",
      title: "capture.gif",
      date: "2026-04-02T10:00:00.000Z",
      fileData,
      chunkMinFrames,
    });

    expect(item.fileData).toBeInstanceOf(Uint8Array);
    expect(Array.from(item.fileData as Uint8Array)).toEqual([1, 2, 3]);
    expect(item.chunkMinFrames).toEqual([12, 13]);
    expect(item.mimeType).toBe("image/gif");
  });

  it("creates text history items for transport note filenames", () => {
    const item = createHistoryItem({
      id: "note-1",
      origin: "generated",
      filename: buildNoteFilename("markdown"),
      fileData: new TextEncoder().encode("# hello"),
    });

    expect(item.type).toBe("text");
    expect(item.mimeType).toBe("text/plain");
    expect(item.title).toBe("note.md");
  });

  it("normalizes note-like records to friendly text items", () => {
    const item = normalizeHistoryItem({
      id: "note-2",
      origin: "scanned",
      title: "__airqr_note__.py",
      fileData: new TextEncoder().encode("print('ok')"),
    });

    expect(item.type).toBe("text");
    expect(item.mimeType).toBe("text/plain");
    expect(item.title).toBe("note.py");
  });

  it("treats text mime types as text items even when raw storage tagged them as files", () => {
    const item = normalizeHistoryItem({
      id: "note-3",
      origin: "scanned",
      type: "file",
      title: "note.md",
      mimeType: "text/plain",
      fileData: new TextEncoder().encode("# hello"),
    });

    expect(item.type).toBe("text");
    expect(item.title).toBe("note.md");
  });

  it("infers previewable media MIME types from filenames when storage omitted them", () => {
    expect(normalizeHistoryItem({ title: "photo.jpeg" }).mimeType).toBe("image/jpeg");
    expect(normalizeHistoryItem({ title: "clip.mp4" }).mimeType).toBe("video/mp4");
    expect(normalizeHistoryItem({ title: "document.pdf" }).mimeType).toBe("application/pdf");

    const created = createHistoryItem({
      id: "scan-photo-1",
      origin: "scanned",
      filename: "capture.png",
      fileData: new Uint8Array([1, 2, 3]),
    });

    expect(created.mimeType).toBe("image/png");
    expect(created.type).toBe("file");
  });

  it("versions repeated note titles while preserving the extension", () => {
    const title = getVersionedHistoryTitle(
      [
        { title: "note.md" },
        { title: "note (2).md" },
        { title: "capture.gif" },
      ],
      "note.md"
    );

    expect(title).toBe("note (3).md");
  });
});
