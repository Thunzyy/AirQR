import React, { useCallback, useEffect, useRef, useState } from "react";
import { loadGifSource, type GifFrameSource } from './gifFrameSource';

interface GifPlayerProps {
  gifUrl: string;
  onFrameChange?: (frame: number) => void;
  onLoad?: (data: {
    totalFrames: number;
    width: number;
    height: number;
    duration: number;
  }) => void;
  onLoop?: () => void;
  className?: string;
  scale?: number;
  isPlaying?: boolean;
  playbackFps?: number | null;
  seekFrame?: number | null;
}

function clampFrame(frame: number, total: number): number {
  if (total <= 0 || !Number.isFinite(frame)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(frame), 0), total - 1);
}

function getNextFrame(frame: number, total: number): number {
  if (total <= 1) {
    return 0;
  }

  return (clampFrame(frame, total) + 1) % total;
}

const GifPlayer: React.FC<GifPlayerProps> = ({
  gifUrl,
  onFrameChange,
  onLoad,
  onLoop,
  className,
  scale = 1,
  isPlaying = true,
  playbackFps = null,
  seekFrame = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const sourceRef = useRef<GifFrameSource | null>(null);
  const currentFrameRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying !== false);
  const playbackFpsRef = useRef<number | null | undefined>(playbackFps);
  const seekFrameRef = useRef<number | null | undefined>(seekFrame);
  const onFrameChangeRef = useRef(onFrameChange);
  const onLoopRef = useRef(onLoop);
  const [dimensions, setDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  isPlayingRef.current = isPlaying !== false;
  playbackFpsRef.current = playbackFps;
  seekFrameRef.current = seekFrame;
  onFrameChangeRef.current = onFrameChange;
  onLoopRef.current = onLoop;

  const renderFrame = useCallback((frameIndex: number) => {
    const source = sourceRef.current;
    const totalFrames = source?.frameCount ?? 0;
    if (totalFrames === 0) return null;

    const renderedFrame = clampFrame(frameIndex, totalFrames);
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      ctx.putImageData(source!.getFrame(renderedFrame), 0, 0);
    }

    if (onFrameChangeRef.current) {
      onFrameChangeRef.current(renderedFrame);
    }

    return renderedFrame;
  }, []);

  useEffect(() => {
    if (seekFrame === null || seekFrame === undefined || !sourceRef.current) {
      return;
    }

    const renderedFrame = renderFrame(seekFrame);
    if (renderedFrame !== null) {
      currentFrameRef.current = getNextFrame(
        renderedFrame,
        sourceRef.current.frameCount
      );
    }
    startTimeRef.current = performance.now();
  }, [renderFrame, seekFrame]);

  useEffect(() => {
    let isMounted = true;

    const loadGif = async () => {
      try {
        setError(null);
        const source = await loadGifSource(gifUrl);
        if (!isMounted) return;
        const { width, height, frameCount } = source;
        sourceRef.current = source;
        setDimensions({ width, height });

        if (onLoad) {
          onLoad({
            totalFrames: frameCount,
            width,
            height,
            duration: source.duration,
          });
        }

        // Set canvas size
        if (canvasRef.current) {
          canvasRef.current.width = width;
          canvasRef.current.height = height;
        }

        let renderedFrame = renderFrame(0);
        const requestedFrame = seekFrameRef.current;
        if (requestedFrame !== null && requestedFrame !== undefined) {
          const clampedFrame = clampFrame(requestedFrame, frameCount);
          if (clampedFrame !== 0) {
            renderedFrame = renderFrame(clampedFrame);
          }
        }
        if (renderedFrame !== null) {
          currentFrameRef.current = getNextFrame(renderedFrame, frameCount);
        }

        startTimeRef.current = performance.now();
        requestRef.current = requestAnimationFrame(animate);
      } catch (err) {
        console.error("Failed to parse GIF:", err);
        if (isMounted) {
          setError("Failed to load GIF");
        }
      }
    };

    loadGif();

    return () => {
      isMounted = false;
      cancelAnimationFrame(requestRef.current);
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gifUrl]);

  const getFrameDelay = (frameIndex: number) => {
    const fps = playbackFpsRef.current;
    if (fps !== null && fps !== undefined && Number.isFinite(fps) && fps > 0) {
      return 1000 / fps;
    }

    return sourceRef.current?.delays[frameIndex] ?? 0;
  };

  const animate = (time: number) => {
    const frameCount = sourceRef.current?.frameCount ?? 0;
    if (frameCount === 0) {
      requestRef.current = requestAnimationFrame(animate);
      return;
    }

    if (!isPlayingRef.current) {
      startTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
      return;
    }

    const frameIndex = currentFrameRef.current;
    const delay = getFrameDelay(frameIndex);
    const elapsed = time - startTimeRef.current;

    if (elapsed >= delay) {
      renderFrame(frameIndex);
      const nextFrame = (frameIndex + 1) % frameCount;

      if (nextFrame === 0 && frameCount > 1 && onLoopRef.current) {
        onLoopRef.current();
      }

      currentFrameRef.current = nextFrame;
      startTimeRef.current = time;
    }

    requestRef.current = requestAnimationFrame(animate);
  };

  if (error) {
    return <div className="error">{error}</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: dimensions ? dimensions.width * scale : undefined,
        height: dimensions ? dimensions.height * scale : undefined,
        imageRendering: "pixelated", // Key for sharp zoom
      }}
    />
  );
};

export default GifPlayer;
