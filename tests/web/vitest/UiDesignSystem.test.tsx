import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, Toggle } from "@web/components/ui";

describe("shared UI design system", () => {
  it("renders primary buttons with the dark fintech action style", () => {
    render(<Button variant="primary">Generate</Button>);

    const button = screen.getByRole("button", { name: "Generate" });
    expect(button.className).toContain("rounded-full");
    expect(button.className).toContain("airqr-primary-button");
    expect(button.className).toContain("disabled:bg-[var(--airqr-disabled-surface)]");
  });

  it("renders toggles with themed labels and a calm checked state", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Toggle
        label="Server sync"
        description="Keep scanned files available across devices"
        checked={false}
        onChange={onChange}
      />
    );

    expect(screen.getByText("Server sync").className).toContain(
      "text-[var(--airqr-text-primary)]"
    );
    expect(screen.getByText("Keep scanned files available across devices").className).toContain(
      "text-[var(--airqr-text-muted)]"
    );

    const toggle = screen.getByRole("switch", { name: "Server sync" });
    expect(toggle.className).toContain("bg-[var(--airqr-control-surface)]");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <Toggle
        label="Server sync"
        description="Keep scanned files available across devices"
        checked
        onChange={onChange}
      />
    );
    expect(screen.getByRole("switch", { name: "Server sync" }).className).toContain(
      "bg-[var(--airqr-switch-selected)]"
    );
  });
});
