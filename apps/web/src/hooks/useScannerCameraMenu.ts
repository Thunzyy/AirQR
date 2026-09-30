import React, { useCallback, useEffect, useRef, useState } from "react";

type UseScannerCameraMenuArgs = {
  selectCamera: (deviceId: string) => Promise<void>;
};

export function useScannerCameraMenu({
  selectCamera,
}: UseScannerCameraMenuArgs) {
  const cameraSelectorRef = useRef<HTMLDivElement>(null);
  const cameraButtonRef = useRef<HTMLButtonElement>(null);
  const [showCameraSelector, setShowCameraSelector] = useState(false);
  const [cameraDropdownStyle, setCameraDropdownStyle] =
    useState<React.CSSProperties | null>(null);

  const handleSelectCamera = useCallback(
    async (deviceId: string) => {
      setShowCameraSelector(false);
      await selectCamera(deviceId);
    },
    [selectCamera]
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        cameraSelectorRef.current &&
        event.target instanceof Node &&
        !cameraSelectorRef.current.contains(event.target)
      ) {
        setShowCameraSelector(false);
      }
    };

    if (showCameraSelector) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showCameraSelector]);

  useEffect(() => {
    if (!showCameraSelector) {
      return;
    }

    const updatePosition = () => {
      const button = cameraButtonRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(280, Math.max(220, viewportWidth - 16));
      const left = Math.min(
        Math.max(8, rect.right - width),
        Math.max(8, viewportWidth - width - 8)
      );
      const top = Math.min(rect.bottom + 8, viewportHeight - 96);
      const maxHeight = Math.max(140, viewportHeight - top - 8);

      setCameraDropdownStyle({
        position: "fixed",
        top,
        left,
        width,
        maxHeight: Math.min(320, maxHeight),
        zIndex: 80,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("orientationchange", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("orientationchange", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showCameraSelector]);

  return {
    cameraButtonRef,
    cameraDropdownStyle,
    cameraSelectorRef,
    handleSelectCamera,
    setShowCameraSelector,
    showCameraSelector,
  };
}
