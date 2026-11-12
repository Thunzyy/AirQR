import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScannerCameraMenu } from "@web/hooks/useScannerCameraMenu";

function assignRect(element: HTMLElement, rect: DOMRectInit) {
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () =>
      ({
        bottom: rect.bottom ?? 0,
        height: rect.height ?? 0,
        left: rect.left ?? 0,
        right: rect.right ?? 0,
        top: rect.top ?? 0,
        width: rect.width ?? 0,
        x: rect.x ?? rect.left ?? 0,
        y: rect.y ?? rect.top ?? 0,
        toJSON: () => ({}),
      }) satisfies DOMRect,
    configurable: true,
  });
}

describe("useScannerCameraMenu", () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 844,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", {
      value: originalInnerWidth,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: originalInnerHeight,
      configurable: true,
      writable: true,
    });
  });

  it("closes the menu and delegates camera selection", async () => {
    const selectCamera = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScannerCameraMenu({ selectCamera }));

    act(() => {
      result.current.setShowCameraSelector(true);
    });

    await act(async () => {
      await result.current.handleSelectCamera("rear-camera");
    });

    expect(result.current.showCameraSelector).toBe(false);
    expect(selectCamera).toHaveBeenCalledWith("rear-camera");
  });

  it("positions the dropdown from the trigger button and closes on outside click", async () => {
    const selectCamera = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useScannerCameraMenu({ selectCamera }));

    const wrapper = document.createElement("div");
    const button = document.createElement("button");
    const inside = document.createElement("div");
    wrapper.appendChild(button);
    wrapper.appendChild(inside);
    document.body.appendChild(wrapper);

    assignRect(button, {
      bottom: 48,
      left: 300,
      right: 360,
      top: 8,
      width: 60,
      height: 40,
    });

    act(() => {
      result.current.cameraSelectorRef.current = wrapper;
      result.current.cameraButtonRef.current = button;
      result.current.setShowCameraSelector(true);
    });

    await waitFor(() => {
      expect(result.current.cameraDropdownStyle).toEqual({
        left: 80,
        maxHeight: 320,
        position: "fixed",
        top: 56,
        width: 280,
        zIndex: 80,
      });
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true })
      );
    });

    expect(result.current.showCameraSelector).toBe(false);
    document.body.removeChild(wrapper);
  });
});
