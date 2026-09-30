import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { WireValue } from "../parse/wire";
import type { CameraResolution } from "../types";
import { createLogger } from "../utils/logger";

const logger = createLogger("hooks:useScannerCamera");

const BACK_CAMERA_HINT_RE =
  /(back|rear|environment|arriere|arri[eè]re|trasera|traseira|hinten|后置|後置|背面|world)/i;
const FRONT_CAMERA_HINT_RE =
  /(front|user|avant|selfie|facetime|frontal|前置|前面|face)/i;

const RESOLUTION_DIMENSIONS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
} as const;

type TranslateOptions = {
  readonly [name: string]: string | number | boolean | undefined;
};

interface UseScannerCameraArgs {
  resultData: WireValue | null;
  scannerConfig: {
    enableTorch: boolean;
    resolution: CameraResolution;
  };
  settingsDefaultCameraId: string | null;
  setStatus: (value: string) => void;
  t: (key: string, options?: TranslateOptions) => string;
  videoRef: RefObject<HTMLVideoElement | null>;
}

function scoreCamera(camera: MediaDeviceInfo): number {
  const label = camera.label.toLowerCase();
  let score = 0;
  if (BACK_CAMERA_HINT_RE.test(label)) score += 100;
  if (FRONT_CAMERA_HINT_RE.test(label)) score -= 100;
  if (/wide|main|primary|1x/.test(label)) score += 8;
  if (/ultra|macro|tele/.test(label)) score -= 6;
  return score;
}

function getPreferredRearCameraId(cameras: MediaDeviceInfo[]): string | null {
  if (cameras.length === 0) return null;
  const sorted = [...cameras].sort((a, b) => scoreCamera(b) - scoreCamera(a));
  return sorted[0]?.deviceId ?? null;
}

function inferFacingMode(camera: MediaDeviceInfo | null): "user" | "environment" {
  const label = camera?.label?.toLowerCase() ?? "";
  return FRONT_CAMERA_HINT_RE.test(label) ? "user" : "environment";
}

export function useScannerCamera({
  resultData,
  scannerConfig,
  settingsDefaultCameraId,
  setStatus,
  t,
  videoRef,
}: UseScannerCameraArgs) {
  const tRef = useRef(t);
  const streamRef = useRef<MediaStream | null>(null);
  const previousResultRef = useRef(resultData);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(
    settingsDefaultCameraId
  );
  const availableCamerasRef = useRef<MediaDeviceInfo[]>([]);
  const selectedCameraIdRef = useRef<string | null>(settingsDefaultCameraId);
  const [hasCamera, setHasCamera] = useState(false);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    selectedCameraIdRef.current = selectedCameraId;
  }, [selectedCameraId]);

  useEffect(() => {
    if (!settingsDefaultCameraId) return;
    selectedCameraIdRef.current = settingsDefaultCameraId;
    setSelectedCameraId(settingsDefaultCameraId);
  }, [settingsDefaultCameraId]);

  const attachStreamToVideo = useCallback(
    (stream: MediaStream) => {
      const video = videoRef.current;
      if (!video) return;

      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      video.setAttribute("playsinline", "true");

      const handleLoaded = () => {
        const playPromise = video.play();
        if (playPromise && playPromise.catch instanceof Function) {
          playPromise.catch(() => undefined);
        }
        setHasCamera(true);
        setStatus(tRef.current("scanner.scanning"));
      };

      if (video.readyState >= video.HAVE_METADATA) {
        handleLoaded();
      } else {
        video.onloadedmetadata = handleLoaded;
      }
    },
    [setStatus, videoRef]
  );

  const applyTorchConstraint = useCallback(
    async (stream: MediaStream, enabled: boolean) => {
      const track = stream.getVideoTracks()[0];
      if (!track || !(track.applyConstraints instanceof Function)) {
        return;
      }
      const capabilities = track.getCapabilities?.() ?? {};
      if (!("torch" in capabilities)) {
        return;
      }
      try {
        const torchConstraint: MediaTrackConstraintSet & { torch: boolean } = {
          torch: enabled,
        };
        await track.applyConstraints({
          advanced: [torchConstraint],
        });
      } catch (err) {
        logger.warn("Failed to apply torch constraint", { error: err instanceof Error ? err.message : String(err) });
      }
    },
    []
  );

  useEffect(() => {
    const stream = streamRef.current;
    if (stream) {
      void applyTorchConstraint(stream, scannerConfig.enableTorch);
    }
  }, [applyTorchConstraint, scannerConfig.enableTorch]);

  const enumerateCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === "videoinput");
      availableCamerasRef.current = videoDevices;
      setAvailableCameras(videoDevices);

      const currentSelectedId = selectedCameraIdRef.current;
      const selectedStillValid =
        currentSelectedId !== null &&
        videoDevices.some((device) => device.deviceId === currentSelectedId);

      if (!selectedStillValid && videoDevices.length > 0) {
        const fallbackFromSettings =
          settingsDefaultCameraId &&
          videoDevices.some((device) => device.deviceId === settingsDefaultCameraId)
            ? settingsDefaultCameraId
            : null;
        const preferredRear = getPreferredRearCameraId(videoDevices);
        const nextSelectedId =
          fallbackFromSettings || preferredRear || videoDevices[0].deviceId;

        selectedCameraIdRef.current = nextSelectedId;
        setSelectedCameraId(nextSelectedId);
      }
    } catch (err) {
      logger.error("Failed to enumerate cameras", { error: err instanceof Error ? err.message : String(err) });
    }
  }, [settingsDefaultCameraId]);

  const startCameraStream = useCallback(
    async (deviceId?: string) => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        const resolution =
          RESOLUTION_DIMENSIONS[scannerConfig.resolution] ||
          RESOLUTION_DIMENSIONS["1080p"];

        const videoConstraints: MediaTrackConstraints = {
          width: { ideal: resolution.width },
          height: { ideal: resolution.height },
        };

        const targetCameraId =
          deviceId || selectedCameraIdRef.current || settingsDefaultCameraId || null;

        if (targetCameraId) {
          videoConstraints.deviceId = { exact: targetCameraId };
        } else {
          videoConstraints.facingMode = { ideal: "environment" };
        }

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
        } catch (error) {
          if (!targetCameraId) {
            throw error;
          }
          const selected =
            availableCamerasRef.current.find(
              (camera) => camera.deviceId === targetCameraId
            ) || null;
          const fallbackFacing = inferFacingMode(selected);
          logger.warn("Retrying camera with facingMode fallback", {
            cameraId: targetCameraId,
            fallbackFacing,
            error: error instanceof Error ? error.message : String(error),
          });
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: resolution.width },
              height: { ideal: resolution.height },
              facingMode: { ideal: fallbackFacing },
            },
          });
        }

        streamRef.current = stream;
        attachStreamToVideo(stream);
        void applyTorchConstraint(stream, scannerConfig.enableTorch);
        void enumerateCameras();
      } catch (err) {
        const cameraErrorName = err instanceof DOMException ? err.name : "";
        const isExpectedCameraError =
          cameraErrorName === "NotAllowedError" ||
          cameraErrorName === "NotFoundError" ||
          cameraErrorName === "NotReadableError" ||
          cameraErrorName === "OverconstrainedError";

        setHasCamera(false);

        if (isExpectedCameraError) {
          logger.warn("Camera unavailable for current environment", { error: err instanceof Error ? err.message : String(err) });
        } else {
          logger.error("Error accessing camera", { error: err instanceof Error ? err.message : String(err) });
        }
        setStatus(tRef.current("scanner.cameraError"));
      }
    },
    [
      applyTorchConstraint,
      attachStreamToVideo,
      enumerateCameras,
      scannerConfig.enableTorch,
      scannerConfig.resolution,
      setStatus,
      settingsDefaultCameraId,
    ]
  );

  const selectCamera = useCallback(
    async (deviceId: string) => {
      selectedCameraIdRef.current = deviceId;
      setSelectedCameraId(deviceId);
      await startCameraStream(deviceId);
    },
    [startCameraStream]
  );

  useEffect(() => {
    void startCameraStream();
    const mountedVideoElement = videoRef.current;

    return () => {
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (mountedVideoElement) {
        mountedVideoElement.srcObject = null;
      }
    };
  }, [startCameraStream, videoRef]);

  useEffect(() => {
    const wasShowingResult = previousResultRef.current !== null;
    if (wasShowingResult && resultData === null) {
      // The result view fully unmounts the <video> element, so by the time
      // we land here a fresh element is in the DOM. Reattaching the old
      // stream is unreliable on iOS Safari (loadedmetadata never re-fires
      // on a live stream assigned to a new element → video stays black), so
      // we always restart the capture to guarantee a clean state.
      void startCameraStream();
    }

    previousResultRef.current = resultData;
  }, [resultData, startCameraStream]);

  const getCameraDisplayName = useCallback(
    (camera: MediaDeviceInfo, index: number) => {
      if (camera.label) {
        const label = camera.label;
        if (label.length > 30) {
          return `${label.substring(0, 27)}...`;
        }
        return label;
      }
      return `${t("scanner.camera")} ${index + 1}`;
    },
    [t]
  );

  return {
    availableCameras,
    getCameraDisplayName,
    hasCamera,
    selectCamera,
    selectedCameraId,
  };
}
