import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ScannerHelpModal from "@web/features/scanner/ScannerHelpModal";

describe("ScannerHelpModal", () => {
  it("renders as an accessible modal dialog and closes on Escape", () => {
    const onClose = vi.fn();

    render(
      <ScannerHelpModal
        closeLabel="Close"
        helpTips={[
          {
            icon: "qr_code_scanner",
            title: "Positioning",
            description: "Positioning desc",
          },
        ]}
        isOpen
        onClose={onClose}
        title="Help title"
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Help title" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Close Help title" })).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps focus inside the dialog when tabbing", () => {
    render(
      <ScannerHelpModal
        closeLabel="Close"
        helpTips={[
          {
            icon: "qr_code_scanner",
            title: "Positioning",
            description: "Positioning desc",
          },
        ]}
        isOpen
        onClose={vi.fn()}
        title="Help title"
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Help title" });
    const iconCloseButton = screen.getByRole("button", { name: "Close Help title" });
    const primaryCloseButton = screen.getByRole("button", { name: "Close" });

    expect(iconCloseButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(primaryCloseButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(iconCloseButton).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(primaryCloseButton).toHaveFocus();
  });
});
