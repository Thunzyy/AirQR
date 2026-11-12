import { describe, expect, it } from "vitest";

import fr from "@web/i18n/locales/fr";

describe("French chunk terminology", () => {
  it("keeps Chunk untranslated across encoder and scanner copy", () => {
    expect(fr.encoder.dataChunks).toBe("Chunks");
    expect(fr.encoder.chunk).toBe("Chunk {{current}}/{{total}}");
    expect(fr.encoder.chunkOption).toBe("Chunk {{index}}");
    expect(fr.scanner.chunkSelectorLabel).toBe("Choisir le chunk");
    expect(JSON.stringify(fr)).not.toMatch(/morceau/i);
  });
});
