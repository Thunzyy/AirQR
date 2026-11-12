import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useConfirmDialog } from "@web/components/ui/useConfirmDialog";

const Harness = ({ onResult }: { onResult: (value: boolean) => void }) => {
  const { confirm, confirmDialog } = useConfirmDialog();
  return (
    <>
      <button
        type="button"
        onClick={async () =>
          onResult(
            await confirm({
              title: "Delete 2 items?",
              message: "This cannot be undone.",
              confirmLabel: "Delete",
              tone: "danger",
            })
          )
        }
      >
        Open
      </button>
      {confirmDialog}
    </>
  );
};

describe("useConfirmDialog", () => {
  it("shows an in-app card instead of the native confirm", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    render(<Harness onResult={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete 2 items?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("starts on Cancel so Enter never confirms by accident", async () => {
    render(<Harness onResult={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("resolves true when the action is confirmed", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onResult).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("resolves false on Cancel and on Escape, and gives focus back", async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    const trigger = screen.getByRole("button", { name: "Open" });

    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResult).toHaveBeenLastCalledWith(false);
    expect(trigger).toHaveFocus();

    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(onResult).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps Tab inside the card", async () => {
    render(<Harness onResult={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });
});
