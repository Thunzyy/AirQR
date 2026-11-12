import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import Toast from "@web/components/ui/Toast";
import { useToastStore } from "@web/store";

describe("Toast", () => {
  beforeEach(() => {
    useToastStore.setState({
      ...useToastStore.getState(),
      hide: useToastStore.getState().hide,
      message: "",
      show: useToastStore.getState().show,
      type: "info",
      visible: false,
    });
  });

  it("announces info toasts as polite status messages", () => {
    useToastStore.setState({
      ...useToastStore.getState(),
      message: "Saved",
      type: "success",
      visible: true,
    });

    render(<Toast />);

    const liveRegion = screen.getByRole("status");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    expect(liveRegion).toHaveTextContent("Saved");
  });

  it("announces error toasts as assertive alerts", () => {
    useToastStore.setState({
      ...useToastStore.getState(),
      message: "Failed",
      type: "error",
      visible: true,
    });

    render(<Toast />);

    const liveRegion = screen.getByRole("alert");
    expect(liveRegion).toHaveAttribute("aria-live", "assertive");
    expect(liveRegion).toHaveAttribute("aria-atomic", "true");
    expect(liveRegion).toHaveTextContent("Failed");
  });
});
