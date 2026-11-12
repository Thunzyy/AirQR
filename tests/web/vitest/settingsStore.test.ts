import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "@web/store";
import { applyDevelopmentSyncConfig } from "@web/store/settingsStore";
import { STORAGE_KEYS } from "@web/constants";
import type { ScanUploadConfig } from "@web/types";

const baseConfig: ScanUploadConfig = {
  enabled: false,
  url: "same-origin",
  apiKey: "",
  username: "",
  password: "",
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: true,
};

describe("applyDevelopmentSyncConfig", () => {
  it("applies dev sync credentials from Vite env without hardcoding secrets", () => {
    expect(
      applyDevelopmentSyncConfig(baseConfig, {
        DEV: true,
        VITE_AIRQR_DEV_SYNC_URL: "https://sync.example.test",
        VITE_AIRQR_DEV_SYNC_USERNAME: "dev-admin",
        VITE_AIRQR_DEV_SYNC_PASSWORD: "dev-password",
      })
    ).toMatchObject({
      enabled: true,
      url: "https://sync.example.test",
      username: "dev-admin",
      password: "dev-password",
    });
  });

  it("does not apply dev sync credentials outside Vite dev mode", () => {
    expect(
      applyDevelopmentSyncConfig(baseConfig, {
        DEV: false,
        VITE_AIRQR_DEV_SYNC_URL: "https://sync.example.test",
        VITE_AIRQR_DEV_SYNC_USERNAME: "dev-admin",
        VITE_AIRQR_DEV_SYNC_PASSWORD: "dev-password",
      })
    ).toEqual(baseConfig);
  });
});

describe("settingsStore defaults", () => {
  afterEach(() => {
    localStorage.clear();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });

  it("uses the same disabled sync defaults as Flutter", () => {
    const initialState = useSettingsStore.getInitialState();

    expect(initialState.uploadConfig.enabled).toBe(false);
    expect(initialState.uploadConfig.url).toBe("");
    expect(initialState.uploadConfig.syncScanned).toBe(true);
    expect(initialState.uploadConfig.syncGenerated).toBe(true);
    expect(initialState.uploadConfig.autoSyncHistory).toBe(true);
  });

  it("persists sync credentials after they are entered", () => {
    useSettingsStore.getState().setUploadConfig({
      url: "https://sync.example.test",
      apiKey: "saved-api-key",
      username: "admin",
      password: "saved-password",
    });

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) ?? "{}");

    expect(persisted.state.uploadConfig).toMatchObject({
      url: "https://sync.example.test",
      apiKey: "saved-api-key",
      username: "admin",
      password: "saved-password",
    });
  });
});
