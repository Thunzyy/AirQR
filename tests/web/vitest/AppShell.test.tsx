import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppShell from "@web/components/layout/AppShell";

describe("AppShell", () => {
  const originalVisualViewport = window.visualViewport;
  const originalInnerHeight = window.innerHeight;
  let viewportHeight = 780;

  beforeEach(() => {
    viewportHeight = 780;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        get height() {
          return viewportHeight;
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 780,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalVisualViewport,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it("uses dynamic viewport height so mobile Safari keeps the visible area stable", () => {
    const { container } = render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(container.firstChild).toHaveClass("h-screen", "h-dvh");
    expect(screen.getByRole("main")).not.toHaveClass(
      "mb-[calc(5.75rem+env(safe-area-inset-bottom,0px))]"
    );
    expect(screen.getByRole("main")).toHaveClass("relative", "overflow-y-auto");
  });

  it("refreshes the shell height when Safari restores an older tab", () => {
    const { container } = render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    const shell = container.firstChild as HTMLElement;

    expect(shell).toHaveStyle({ height: "780px" });

    viewportHeight = 640;

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(shell).toHaveStyle({ height: "640px" });
  });

  it("keeps the layout viewport height while the mobile keyboard resizes the visual viewport", () => {
    const { container } = render(
      <AppShell>
        <input aria-label="Username" />
      </AppShell>
    );

    const shell = container.firstChild as HTMLElement;
    expect(shell).toHaveStyle({ height: "780px" });

    screen.getByLabelText("Username").focus();
    viewportHeight = 420;

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(shell).toHaveStyle({ height: "780px" });
  });
});
