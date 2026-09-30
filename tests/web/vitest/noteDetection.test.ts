import { describe, expect, it } from "vitest";

import {
  NOTE_FILENAME_PREFIX,
  buildNoteFilename,
  decodeNoteContent,
  getDisplayNoteFilename,
  getNoteExtension,
  isNoteFilename,
} from "@web/utils/noteDetection";

describe("noteDetection", () => {
  it("builds and recognizes transport note filenames", () => {
    const filename = buildNoteFilename("python");

    expect(filename).toBe(`${NOTE_FILENAME_PREFIX}.py`);
    expect(isNoteFilename(filename)).toBe(true);
    expect(getNoteExtension(filename)).toBe("py");
    expect(getDisplayNoteFilename(filename)).toBe("note.py");
  });

  it("decodes utf-8 note bytes without altering content", () => {
    const bytes = new TextEncoder().encode("print('été')\nconsole.log('QR');");

    expect(decodeNoteContent(bytes)).toBe("print('été')\nconsole.log('QR');");
  });

  it("leaves regular filenames unchanged for display", () => {
    expect(isNoteFilename("report.txt")).toBe(false);
    expect(getDisplayNoteFilename("report.txt")).toBe("report.txt");
  });
});
