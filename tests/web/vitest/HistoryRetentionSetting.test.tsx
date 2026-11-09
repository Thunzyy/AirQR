import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { fetchHistoryRetentionMock, saveHistoryRetentionMock } = vi.hoisted(() => ({
  fetchHistoryRetentionMock: vi.fn(),
  saveHistoryRetentionMock: vi.fn(),
}));

vi.mock("@web/services/serverRetention", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@web/services/serverRetention")>()),
  fetchHistoryRetention: fetchHistoryRetentionMock,
  saveHistoryRetention: saveHistoryRetentionMock,
}));

import HistoryRetentionSetting from "@web/components/settings/HistoryRetentionSetting";

const uploadConfig = {
  enabled: true,
  url: "https://sync.example.com",
  apiKey: "",
  username: "",
  password: "",
};

describe("HistoryRetentionSetting", () => {
  beforeEach(() => {
    fetchHistoryRetentionMock.mockReset();
    saveHistoryRetentionMock.mockReset();
  });

  it("shows the retention the server currently applies", async () => {
    fetchHistoryRetentionMock.mockResolvedValue({
      historyDays: 90,
      source: "server-default",
      defaultHistoryDays: 90,
    });

    render(<HistoryRetentionSetting uploadConfig={uploadConfig} />);

    expect(await screen.findByRole("spinbutton", { name: "Delete history after (days)" })).toHaveValue(90);
    expect(screen.getByRole("switch", { name: "Never delete history" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(screen.getByRole("button", { name: "Save retention" })).toBeDisabled();
  });

  it("saves never delete without asking for confirmation", async () => {
    fetchHistoryRetentionMock.mockResolvedValue({
      historyDays: 90,
      source: "server-default",
      defaultHistoryDays: 90,
    });
    saveHistoryRetentionMock.mockResolvedValue({
      historyDays: null,
      source: "settings",
      defaultHistoryDays: 90,
    });
    const confirmSpy = vi.spyOn(window, "confirm");

    render(<HistoryRetentionSetting uploadConfig={uploadConfig} />);
    await userEvent.click(await screen.findByRole("switch", { name: "Never delete history" }));

    expect(screen.getByRole("spinbutton", { name: "Delete history after (days)" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Save retention" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(saveHistoryRetentionMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: uploadConfig.url }),
      null
    );
    expect(await screen.findByText("Retention saved.")).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("asks before shortening the retention", async () => {
    fetchHistoryRetentionMock.mockResolvedValue({
      historyDays: 90,
      source: "server-default",
      defaultHistoryDays: 90,
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<HistoryRetentionSetting uploadConfig={uploadConfig} />);
    const input = await screen.findByRole("spinbutton", { name: "Delete history after (days)" });
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    await userEvent.click(screen.getByRole("button", { name: "Save retention" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "History entries older than 30 days will be deleted at the next cleanup. Continue?"
    );
    expect(saveHistoryRetentionMock).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("refuses values outside 1 to 3650 days", async () => {
    fetchHistoryRetentionMock.mockResolvedValue({
      historyDays: 90,
      source: "settings",
      defaultHistoryDays: 90,
    });

    render(<HistoryRetentionSetting uploadConfig={uploadConfig} />);
    const input = await screen.findByRole("spinbutton", { name: "Delete history after (days)" });
    await userEvent.clear(input);
    await userEvent.type(input, "0");

    expect(screen.getByRole("button", { name: "Save retention" })).toBeDisabled();
    expect(screen.getByText("Enter a number of days between 1 and 3650.")).toBeInTheDocument();
  });

  it("explains when the server cannot report its retention", async () => {
    fetchHistoryRetentionMock.mockRejectedValue(new Error("Settings fetch failed: 500"));

    render(<HistoryRetentionSetting uploadConfig={uploadConfig} />);

    await waitFor(() => {
      expect(
        screen.getByText("Could not load the server retention. Update the sync server to change it here.")
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Save retention" })).not.toBeInTheDocument();
  });
});
