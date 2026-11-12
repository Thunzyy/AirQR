import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FileDropzone from "@web/components/encoder/FileDropzone";

describe("FileDropzone", () => {
  it("lets keyboard users open the file picker from the dropzone region", () => {
    const inputClickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    render(
      <FileDropzone
        selectedFiles={null}
        selectedFolderName={null}
        onFileSelect={vi.fn()}
      />
    );

    const dropzone = screen.getByRole("region", {
      name: /File drop zone/i,
    });

    dropzone.focus();
    fireEvent.keyDown(dropzone, { key: "Enter" });

    expect(inputClickSpy).toHaveBeenCalledTimes(1);
  });

  it("forwards dropped files to the selection callback", () => {
    const onFileSelect = vi.fn();
    const droppedFile = new File(["hello"], "hello.txt", { type: "text/plain" });

    render(
      <FileDropzone
        selectedFiles={null}
        selectedFolderName={null}
        onFileSelect={onFileSelect}
      />
    );

    const dropzone = screen.getByRole("region", {
      name: /File drop zone/i,
    });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [droppedFile],
      },
    });

    expect(onFileSelect).toHaveBeenCalledWith([droppedFile], null);
  });

  it("keeps the selected-file icon centered and fixed-size beside long names", () => {
    const longName =
      "BNPPCampaign_DAR03_HENRIK_TEST_20260721-235612.json";
    const selectedFile = new File(["hello"], longName, {
      type: "application/json",
    });

    render(
      <FileDropzone
        selectedFiles={[selectedFile]}
        selectedFolderName={null}
        onFileSelect={vi.fn()}
      />
    );

    const icon = screen.getByTestId("encoder-selected-file-icon");
    expect(icon).toHaveClass("size-12", "shrink-0", "overflow-hidden");
    expect(icon.querySelector("svg")).toHaveClass("h-6", "w-6");
    expect(screen.getByText(longName).parentElement).toHaveClass(
      "min-w-0",
      "flex-1"
    );
  });
});
