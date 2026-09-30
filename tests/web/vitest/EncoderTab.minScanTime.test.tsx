import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import EncoderTab from '@web/components/tabs/EncoderTab';
import { DEFAULT_ENCODER_CONFIG } from '@web/constants';
import { useEncoderStore, useSettingsStore } from '@web/store';
import type { EncoderConfig, GifMetadata } from '@web/types';

vi.mock('@web/components/encoder', () => ({
  FileDropzone: () => <div data-testid="file-dropzone" />,
  NoteEditor: () => <div data-testid="note-editor" />,
  EncoderSettings: ({
    config,
    onConfigChange,
  }: {
    config: EncoderConfig;
    onConfigChange: (updates: Partial<EncoderConfig>) => void;
  }) => (
    <button type="button" onClick={() => onConfigChange({ fps: 8 })}>
      Set FPS 8 from {config.fps}
    </button>
  ),
  GifPreview: ({
    metadata,
    encodedFps,
  }: {
    metadata?: Partial<GifMetadata>;
    encodedFps?: number;
  }) => {
    const label =
      metadata?.minFrames && encodedFps
        ? `min scan ${(metadata.minFrames / encodedFps).toFixed(1)}s`
        : 'no scan time';

    return <div data-testid="gif-preview">{label}</div>;
  },
}));

vi.mock('@web/services/historyDB', () => ({
  saveHistoryItemWithAutoSync: vi.fn().mockResolvedValue(undefined),
}));

type WorkerMessageHandler = (event: MessageEvent<unknown>) => void;

const createPendingEncoderWorker = () => {
  let messageHandler: WorkerMessageHandler | null = null;

  const postMessage = vi.fn();
  const removeEventListener = vi.fn();
  const worker = {
    addEventListener: vi.fn(
      (type: string, handler: EventListenerOrEventListenerObject) => {
        if (type === 'message' && typeof handler === 'function') {
          messageHandler = handler as WorkerMessageHandler;
        }
      },
    ),
    removeEventListener,
    postMessage,
  } as unknown as Worker;

  const complete = async () => {
    if (!messageHandler) {
      throw new Error('Encoder worker message handler was not registered');
    }

    await act(async () => {
      messageHandler?.({
        data: {
          type: 'METADATA',
          payload: {
            totalFrames: 20,
            minFrames: 12,
          },
        },
      } as MessageEvent<unknown>);
      messageHandler?.({
        data: {
          type: 'COMPLETE',
          payload: new Uint8Array([71, 73, 70, 56, 57, 97]),
        },
      } as MessageEvent<unknown>);
    });
  };

  return { worker, postMessage, removeEventListener, complete };
};

describe('EncoderTab minimum scan time FPS capture', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:encoded-gif'),
    });

    useSettingsStore.setState({
      showEncoderLinksiteNotice: false,
    });

    useEncoderStore.setState({
      selectedFiles: [new File([new Uint8Array([1])], 'payload.bin')],
      selectedFolderName: null,
      encoderMode: 'file',
      noteText: '',
      config: {
        ...DEFAULT_ENCODER_CONFIG,
        fps: 4,
      },
      gifUrls: ['blob:gif-1'],
      gifMetadata: {
        width: 0,
        height: 0,
        totalFrames: 20,
        minFrames: 12,
        duration: 0,
        fileSize: 256,
        originalSize: 128,
      },
      generatedFps: 4,
      downloadUrl: 'blob:gif-1',
      isStreamingResult: false,
      isEncoding: false,
      progress: 100,
      error: null,
    });
  });

  it('uses the theme-aware generate button surface', () => {
    render(<EncoderTab workerRef={{ current: null }} />);

    expect(screen.getByRole('button', { name: 'Generate QR GIF' })).toHaveClass(
      'airqr-generate-button',
    );
  });

  it('uses the shared loading color before the QR preview appears', () => {
    useEncoderStore.setState({
      gifUrls: [],
      gifMetadata: null,
      isEncoding: true,
      progress: 42,
    });

    render(<EncoderTab workerRef={{ current: null }} />);

    const progress = screen.getByTestId('encoder-progress');
    const fill = progress.querySelector<HTMLElement>('[style]');
    expect(fill?.className).toContain('bg-[var(--airqr-loading)]');
  });

  it('keeps the preview scan time tied to the generated FPS after settings change', async () => {
    const user = userEvent.setup();

    const { unmount } = render(<EncoderTab workerRef={{ current: null }} />);

    expect(screen.getByTestId('gif-preview')).toHaveTextContent('min scan 3.0s');

    await user.click(screen.getByRole('button', { name: /Set FPS 8/i }));

    await waitFor(() => {
      expect(useEncoderStore.getState().config.fps).toBe(8);
    });

    expect(screen.getByTestId('gif-preview')).toHaveTextContent('min scan 3.0s');
    expect(screen.queryByText('min scan 1.5s')).not.toBeInTheDocument();

    unmount();
    render(<EncoderTab workerRef={{ current: null }} />);

    expect(screen.getByTestId('gif-preview')).toHaveTextContent('min scan 3.0s');
    expect(screen.queryByText('min scan 1.5s')).not.toBeInTheDocument();
  });

  it('captures the FPS used when a worker encode starts', async () => {
    const user = userEvent.setup();
    const pendingWorker = createPendingEncoderWorker();

    useEncoderStore.setState({
      gifUrls: [],
      gifMetadata: null,
      generatedFps: null,
      downloadUrl: null,
      isStreamingResult: false,
      isEncoding: false,
      progress: 0,
      error: null,
    });

    render(<EncoderTab workerRef={{ current: pendingWorker.worker }} />);

    await user.click(screen.getByRole('button', { name: 'Generate QR GIF' }));

    await waitFor(() => {
      expect(pendingWorker.postMessage).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('button', { name: /Set FPS 8/i }));

    await waitFor(() => {
      expect(useEncoderStore.getState().config.fps).toBe(8);
    });

    await pendingWorker.complete();

    await waitFor(() => {
      expect(useEncoderStore.getState().generatedFps).toBe(4);
    });

    expect(screen.getByTestId('gif-preview')).toHaveTextContent('min scan 3.0s');
    expect(screen.queryByText('min scan 1.5s')).not.toBeInTheDocument();
  });
});
