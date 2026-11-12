import { describe, expect, it } from "vitest";

import { APP_INFO } from "@web/constants";
import en from "@web/i18n/locales/en";
import fr from "@web/i18n/locales/fr";

describe("public AirQR download link", () => {
  it("uses the public download site instead of the private GitHub release", () => {
    expect(APP_INFO.releasesUrl).toBe("https://get-airqr.pgnrd.fr/");
    expect(en.encoder.openGithubReleases).toBe("Get AirQR");
    expect(fr.encoder.openGithubReleases).toBe("Obtenir AirQR");
    expect(en.encoder.encoderLinksiteSuffix).toContain("AirQR download page");
    expect(fr.encoder.encoderLinksiteSuffix).toContain(
      "page de telechargement AirQR",
    );
  });
});
