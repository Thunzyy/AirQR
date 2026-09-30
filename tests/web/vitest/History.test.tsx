import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import History from "@web/features/history/History";
import fr from "@web/i18n/locales/fr";

describe("History Component", () => {
  beforeEach(() => {
    // Clear localStorage to ensure default filter is "scanned"
    window.localStorage.clear();
  });
  const mockItems = [
    {
      id: "1",
      type: "file" as const,
      origin: "scanned" as const,
      title: "test.txt",
      subtitle: "1.5 KB • Just now",
      date: new Date().toISOString(),
      category: "today" as const,
    },
    {
      id: "2",
      type: "file" as const,
      origin: "generated" as const,
      title: "output.gif",
      subtitle: "2.3 MB • 1 hour ago",
      date: new Date().toISOString(),
      category: "today" as const,
    },
  ];

  it("provides French labels for every history filter", () => {
    expect(fr.history.all).toBe("Tous");
    expect(fr.history.scanned).toBe("Scannés");
    expect(fr.history.generated).toBe("Générés");
  });

  it("renders without crashing", () => {
    render(<History items={[]} />);
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByText("Scanned")).toBeInTheDocument();
    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("renders filter tabs", () => {
    render(<History items={mockItems} />);
    const allTab = screen.getByText("All");
    const scannedTab = screen.getByText("Scanned");
    const generatedTab = screen.getByText("Generated");
    expect(allTab).toBeInTheDocument();
    expect(scannedTab).toBeInTheDocument();
    expect(generatedTab).toBeInTheDocument();
  });

  it("shows scanned and generated items in the all tab", async () => {
    render(<History items={mockItems} />);

    await userEvent.click(screen.getByRole("button", { name: "All" }));

    expect(screen.getByText("test.txt")).toBeInTheDocument();
    expect(screen.getByText("output.gif")).toBeInTheDocument();
  });

  it("filters items by scanned tab", async () => {
    render(<History items={mockItems} />);
    const scannedTab = screen.getByText("Scanned");
    await userEvent.click(scannedTab);
    expect(screen.getByText("test.txt")).toBeInTheDocument();
  });

  it("filters items by generated tab", async () => {
    render(<History items={mockItems} />);
    const generatedTab = screen.getByText("Generated");
    await userEvent.click(generatedTab);
    expect(screen.getByText("output.gif")).toBeInTheDocument();
  });



  it("orders items from the same day by their actual timestamp instead of insertion order", async () => {
    const sameDayItems = [
      {
        id: "older",
        type: "file" as const,
        origin: "generated" as const,
        title: "older.bin",
        subtitle: "2026-03-28 - 18:58 - 128 KB",
        date: "2026-03-28",
        category: "yesterday" as const,
      },
      {
        id: "newer",
        type: "file" as const,
        origin: "generated" as const,
        title: "newer.bin",
        subtitle: "2026-03-28 - 19:22 - 128 KB",
        date: "2026-03-28",
        category: "yesterday" as const,
      },
    ];

    render(<History items={sameDayItems} />);
    await userEvent.click(screen.getByText("Generated"));

    const titles = screen
      .getAllByText(/\.bin$/)
      .map((node) => node.textContent);

    expect(titles).toEqual(["newer.bin", "older.bin"]);
  });



  it("renders date sections in oldest-first order when the oldest-first sort is selected", async () => {
    const datedItems = [
      {
        id: "today-item",
        type: "file" as const,
        origin: "generated" as const,
        title: "today.bin",
        subtitle: "2026-03-29 - 10:00 - 128 KB",
        date: "2026-03-29",
        sortTimestamp: "2026-03-29T10:00:00.000Z",
        category: "today" as const,
      },
      {
        id: "yesterday-item",
        type: "file" as const,
        origin: "generated" as const,
        title: "yesterday.bin",
        subtitle: "2026-03-28 - 10:00 - 128 KB",
        date: "2026-03-28",
        sortTimestamp: "2026-03-28T10:00:00.000Z",
        category: "yesterday" as const,
      },
      {
        id: "older-item",
        type: "file" as const,
        origin: "generated" as const,
        title: "older.bin",
        subtitle: "2026-03-20 - 10:00 - 128 KB",
        date: "2026-03-20",
        sortTimestamp: "2026-03-20T10:00:00.000Z",
        category: "older" as const,
      },
    ];

    render(<History items={datedItems} />);
    await userEvent.click(screen.getByText("Generated"));
    await userEvent.click(screen.getByTitle("Sort"));
    await userEvent.click(screen.getByText("Oldest first"));

    const headings = screen
      .getAllByRole("heading", { level: 3 })
      .map((node) => node.textContent);

    expect(headings).toEqual(["2026-03-20", "Yesterday", "Today"]);
  });

  it("calls onDownload when download button is clicked", async () => {
    const onDownload = vi.fn();
    render(<History items={mockItems} onDownload={onDownload} />);

    // Find download buttons by accessible label
    const downloadButtons = screen.getAllByRole("button", { name: /download/i });
    expect(downloadButtons.length).toBeGreaterThan(0);
  });

  it("calls onDelete when delete button is clicked", async () => {
    const onDelete = vi.fn();
    render(<History items={mockItems} onDelete={onDelete} />);

    // Find delete buttons by accessible label
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it("displays incomplete scans section when provided", () => {
    const incompleteItems = [
      {
        sessionId: "session-1",
        filename: "incomplete.bin",
        received: 50,
        total: 100,
        date: new Date().toISOString(),
      },
    ];

    render(<History items={mockItems} incompleteItems={incompleteItems} />);
    expect(screen.getByText("Incomplete Scans")).toBeInTheDocument();
    expect(screen.getByText(/incomplete.bin/)).toBeInTheDocument();
  });

  it("renders estimated incomplete scan totals without impossible over-100 ratios", () => {
    const incompleteItems = [
      {
        sessionId: "session-1",
        filename: "scan.bin",
        received: 9,
        total: 9,
        totalIsEstimate: true,
        progressPercent: 99,
        date: new Date().toISOString(),
      },
    ];

    render(<History items={mockItems} incompleteItems={incompleteItems} />);

    expect(screen.getByText(/99%/)).toBeInTheDocument();
    expect(screen.getByText(/9\/9 packets/i)).toBeInTheDocument();
  });

  it("preserves one decimal for nearly complete incomplete scan progress", () => {
    const incompleteItems = [
      {
        sessionId: "session-nearly-complete",
        filename: "almost.sql",
        received: 3635,
        total: 3635,
        progressPercent: 99.9,
        date: new Date().toISOString(),
      },
    ];

    render(<History items={mockItems} incompleteItems={incompleteItems} />);

    expect(screen.getByText(/99\.9%/)).toBeInTheDocument();
    expect(screen.getByText(/3635\/3635 packets/i)).toBeInTheDocument();
  });

  it("shows server sync progress separately when a local incomplete scan is uploading", () => {
    const incompleteItems = [
      {
        sessionId: "session-syncing",
        filename: "archive.bin",
        received: 11192,
        total: 11192,
        serverReceived: 2000,
        serverTotal: 11192,
        source: "server" as const,
        remoteSessionId: "session-syncing",
        date: new Date().toISOString(),
      },
    ];

    render(<History items={mockItems} incompleteItems={incompleteItems} />);

    const progressLine = screen.getByText((_, element) =>
      Boolean(
        element?.tagName === "P" &&
          element.textContent?.includes("11192/11192 packets") &&
          element.textContent.includes("Server sync:") &&
          element.textContent.includes("2000/11192 packets")
      )
    );
    expect(progressLine).toBeInTheDocument();
  });

  it("renders incomplete scan totals as approximate and caps progress below 100 when the total is provisional", () => {
    const incompleteItems = [
      {
        sessionId: "session-estimate",
        filename: "banierelink.jpg",
        received: 9,
        total: 6,
        totalIsEstimate: true,
        date: new Date().toISOString(),
      },
    ];

    render(<History items={mockItems} incompleteItems={incompleteItems} />);

    expect(screen.getByText("99.9%")).toBeInTheDocument();
    expect(screen.getByText(/9\/6/)).toBeInTheDocument();
  });

  it("shows a sync auth notice instead of looking silently empty when sign-in is required", () => {
    const onOpenSyncSettings = vi.fn();

    render(
      <History
        items={[]}
        syncEnabled
        syncAuthRequired
        onOpenSyncSettings={onOpenSyncSettings}
      />
    );

    expect(
      screen.getByText("Sign in to load shared server history.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Sync Settings" })).toBeInTheDocument();
  });

  it("renders a live sync status badge and a clear history action", () => {
    const onClearHistory = vi.fn();

    render(
      <History
        items={mockItems}
        syncStatusLabel="Connected"
        syncStatusClassName="status-connected"
        onClearHistory={onClearHistory}
      />
    );

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear History" })).toBeInTheDocument();
  });

  it("exposes accessible names for the search and sync controls", async () => {
    render(
      <History
        items={mockItems}
        syncEnabled
        onSyncToServer={vi.fn()}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Search history|history\.searchHistory/i })
    );

    expect(
      screen.getByRole("searchbox", { name: /Search history|history\.searchHistory/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Sync local history to server|history\.syncToServer/i,
      })
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("button", {
          name: /Sync local history to server|history\.syncToServer/i,
        })
        .querySelector('[data-icon="cloud_upload"]')
    ).toHaveClass("airqr-icon", "airqr-icon-explicit", "airqr-sync-icon");

    expect(
      screen
        .getByRole("button", {
          name: /Search history|history\.searchHistory/i,
        })
        .querySelector('[data-icon="close"]')
    ).toHaveClass("airqr-icon");
    expect(
      screen
        .getByRole("button", {
          name: /Search history|history\.searchHistory/i,
        })
        .querySelector('[data-icon="close"]')
    ).not.toHaveClass("airqr-icon-explicit");
  });

  it("exposes accessible names for icon-only incomplete and synced history actions", async () => {
    const items = [
      {
        id: "synced-generated",
        type: "file" as const,
        origin: "generated" as const,
        title: "synced-output.gif",
        subtitle: "2.3 MB • 1 hour ago",
        date: new Date().toISOString(),
        category: "today" as const,
        mimeType: "image/gif",
        isSynced: true,
        isLocalOnly: false,
      },
    ];
    const incompleteItems = [
      {
        sessionId: "session-1",
        filename: "incomplete.bin",
        received: 50,
        total: 100,
        date: new Date().toISOString(),
      },
    ];

    render(
      <History
        items={items}
        incompleteItems={incompleteItems}
        syncEnabled
        onSyncIncomplete={vi.fn()}
        onKeepLocalIncomplete={vi.fn()}
        onResume={vi.fn()}
        onDeleteIncomplete={vi.fn()}
        onView={vi.fn()}
        onKeepLocal={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: /Sync incomplete scan to server/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Resume scan/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Delete incomplete scan/i })
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Generated" }));

    expect(screen.getByRole("button", { name: /Preview file/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Keep local only \(detach from server\)/i })
    ).toBeInTheDocument();
  });

  it("offers preview actions for media, PDF, and text-compatible history files", async () => {
    render(
      <History
        items={[
          {
            id: "photo",
            type: "file",
            origin: "scanned",
            title: "photo.jpg",
            subtitle: "2 MB",
            date: new Date().toISOString(),
            mimeType: "image/jpeg",
          },
          {
            id: "video",
            type: "file",
            origin: "scanned",
            title: "clip.mp4",
            subtitle: "12 MB",
            date: new Date().toISOString(),
            mimeType: "video/mp4",
          },
          {
            id: "pdf",
            type: "file",
            origin: "scanned",
            title: "report.pdf",
            subtitle: "400 KB",
            date: new Date().toISOString(),
            mimeType: "application/pdf",
          },
          {
            id: "json",
            type: "file",
            origin: "scanned",
            title: "data.json",
            subtitle: "1 KB",
            date: new Date().toISOString(),
            mimeType: "application/json",
          },
        ]}
        onView={vi.fn()}
      />
    );

    expect(screen.getAllByRole("button", { name: /preview file/i })).toHaveLength(4);
  });

  it("calls onClearHistory when the clear history action is clicked", async () => {
    const onClearHistory = vi.fn();

    render(<History items={mockItems} onClearHistory={onClearHistory} />);

    await userEvent.click(screen.getByRole("button", { name: "Clear History" }));

    expect(onClearHistory).toHaveBeenCalledTimes(1);
  });
});
