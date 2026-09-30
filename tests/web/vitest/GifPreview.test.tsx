import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GifPreview from '@web/components/encoder/GifPreview';

vi.mock('@web/utils/multiviewStorage', () => ({
  generateSessionId: vi.fn(() => 'session-1'),
  saveMultiviewSession: vi.fn(),
  blobUrlToUint8Array: vi.fn(),
}));

const { gifPlayerPropsMock, gifPlayerLoadState } = vi.hoisted(() => ({
  gifPlayerPropsMock: vi.fn(),
  gifPlayerLoadState: { notified: false },
}));

const mockGifDimensions = vi.hoisted(() => ({
  width: 320,
  height: 240,
}));

vi.mock('@web/components/media/GifPlayer', () => ({
  default: (props: {
    scale?: number;
    isPlaying?: boolean;
    playbackFps?: number | null;
    seekFrame?: number | null;
    onFrameChange?: (frame: number) => void;
    onLoad?: (data: {
      totalFrames: number;
      width: number;
      height: number;
      duration: number;
    }) => void;
  }) => {
    if (!gifPlayerLoadState.notified) {
      gifPlayerLoadState.notified = true;
      queueMicrotask(() => {
        props.onLoad?.({
          totalFrames: 12,
          width: mockGifDimensions.width,
          height: mockGifDimensions.height,
          duration: 1200,
        });
      });
    }

    gifPlayerPropsMock(props);
    return <div data-testid="gif-player">scale:{props.scale}</div>;
  },
}));

describe('GifPreview', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth',
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  );

  beforeEach(() => {
    cleanup();
    gifPlayerPropsMock.mockClear();
    gifPlayerLoadState.notified = false;
    mockGifDimensions.width = 320;
    mockGifDimensions.height = 240;

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 1280;
      },
    });

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 760;
      },
    });
  });

  afterEach(() => {
    cleanup();
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
  });

  it('auto-fits the encoded gif to the available preview area on first load', async () => {
    render(
      <GifPreview
        gifUrls={['blob:gif-1']}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('gif-player')).toHaveTextContent('scale:2.75');
    });

    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('100%');
  });

  it('does not overscale a square QR gif past the visible preview height', async () => {
    mockGifDimensions.width = 177;
    mockGifDimensions.height = 177;

    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return 540;
      },
    });

    render(
      <GifPreview
        gifUrls={['blob:gif-1']}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('gif-player')).toHaveTextContent('scale:2.5');
    });
  });

  it('restores the auto-fit scale when reset zoom is clicked after a manual zoom', async () => {
    const user = userEvent.setup();

    render(
      <GifPreview
        gifUrls={['blob:gif-1']}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('gif-player')).toHaveTextContent('scale:2.75');
    });

    await user.click(screen.getByRole('button', { name: 'Zoom In' }));
    await waitFor(() => {
      expect(screen.getByTestId('gif-player')).toHaveTextContent('scale:3.25');
    });

    await user.click(screen.getByTitle('Reset zoom'));
    await waitFor(() => {
      expect(screen.getByTestId('gif-player')).toHaveTextContent('scale:2.75');
    });
  });

  it('exposes playback fps and exact frame controls for the preview player', async () => {
    const user = userEvent.setup();

    render(
      <GifPreview
        gifUrls={['blob:gif-1']}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Frame scrubber')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Pause playback' })).toBeInTheDocument();
    expect(screen.getByLabelText('Playback FPS')).toHaveValue(10);
    expect(screen.getByTestId('frame-count-group')).toHaveClass(
      'justify-center',
      'gap-1',
    );
    expect(screen.getByLabelText('Frame number')).toHaveClass(
      'flex-none',
      'text-center',
    );
    expect(screen.getByLabelText('Frame number')).toHaveStyle({
      width: 'calc(2ch + 0.25rem)',
    });
    expect(gifPlayerPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isPlaying: true,
        playbackFps: 10,
        seekFrame: null,
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Pause playback' }));
    expect(gifPlayerPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isPlaying: false,
      }),
    );

    await user.clear(screen.getByLabelText('Frame number'));
    await user.type(screen.getByLabelText('Frame number'), '5');

    expect(gifPlayerPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        seekFrame: 4,
      }),
    );

    await user.clear(screen.getByLabelText('Playback FPS'));
    await user.type(screen.getByLabelText('Playback FPS'), '20');

    expect(gifPlayerPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        playbackFps: 20,
      }),
    );
  });

  it('keeps every control reachable in responsive fullscreen mode', async () => {
    const user = userEvent.setup();
    const originalFullscreenDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'fullscreenElement',
    );
    const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
    let fullscreenElement: Element | null = null;

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    HTMLElement.prototype.requestFullscreen = vi.fn(async function requestFullscreen() {
      fullscreenElement = this;
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    try {
      render(
        <GifPreview
          gifUrls={['blob:gif-1']}
          onDownload={vi.fn()}
        />,
      );

      await user.click(await screen.findByTestId('qr-fullscreen-toggle'));

      const surface = screen.getByTestId('qr-viewer-surface');
      const preview = screen.getByTestId('qr-preview-scroll');
      const controls = screen.getByTestId('qr-controls-section');
      const primaryControls = screen.getByTestId('qr-primary-controls');
      const steppers = screen.getByTestId('qr-steppers');

      expect(surface).toHaveClass('fixed', 'inset-0', 'flex', 'flex-col');
      expect(preview).toHaveClass('min-h-0', 'flex-1');
      expect(controls).toHaveClass(
        'max-h-[45dvh]',
        'overflow-y-auto',
        'overscroll-contain',
      );
      expect(primaryControls).toHaveClass(
        'grid-cols-[40px_minmax(0,1fr)_40px]',
      );
      expect(steppers).toHaveClass(
        'col-start-2',
        'row-start-1',
        'grid-cols-2',
      );
      expect(
        screen.getByRole('button', { name: 'Zoom Out' }),
      ).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Zoom In' }),
      ).toBeVisible();
      expect(screen.getByTestId('qr-fullscreen-toggle')).toHaveAccessibleName(
        'Exit fullscreen',
      );
      expect(
        screen.queryByRole('button', { name: /focus mode/i }),
      ).not.toBeInTheDocument();
    } finally {
      HTMLElement.prototype.requestFullscreen = originalRequestFullscreen;
      if (originalFullscreenDescriptor) {
        Object.defineProperty(
          document,
          'fullscreenElement',
          originalFullscreenDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, 'fullscreenElement');
      }
    }
  });

  it('passes encoder FPS to the QR viewer for minimum scan time display', async () => {
    render(
      <GifPreview
        gifUrls={['blob:gif-1']}
        metadata={{ totalFrames: 20, minFrames: 12, fileSize: 256 }}
        encodedFps={4}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('min scan 3.0s')).toBeInTheDocument();
    });
  });

  it('renders the download action in the result header instead of over the QR preview', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();

    render(
      <GifPreview
        gifUrls={['blob:gif-1']}
        stats={{
          originalSize: 1024,
          outputSize: 20300,
          expansion: 12,
          duration: 1,
        }}
        onDownload={onDownload}
      />,
    );

    const header = screen.getByTestId('gif-preview-result-header');
    const downloadButton = screen.getByRole('button', { name: /download gif|encoder\.downloadGif/i });
    const downloadIcon = downloadButton.querySelector('[data-icon="download"]');

    expect(header).toContainElement(downloadButton);
    expect(downloadIcon).toHaveClass('airqr-result-download-icon');
    expect(screen.queryByTestId('qr-viewer-actions')).not.toBeInTheDocument();

    await user.click(downloadButton);

    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('keeps the mobile frame badge close to the QR preview like Flutter', async () => {
    render(
      <GifPreview
        gifUrls={['blob:gif-1']}
        metadata={{ totalFrames: 119, minFrames: 91, fileSize: 256 }}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() => {
      const previewScroll = screen.getByTestId('qr-preview-scroll');
      const minScanBadge = screen.getByTestId('qr-min-scan-badge');
      const controls = screen.getByTestId('qr-controls-section');

      expect(previewScroll).toHaveClass(
        'items-start',
        'pb-0',
        'pt-14',
        'sm:items-center',
        'sm:pb-4',
        'sm:pt-16',
      );
      expect(previewScroll).not.toHaveClass('items-end');
      expect(minScanBadge).toHaveClass('max-w-[48%]', 'whitespace-nowrap');
      expect(minScanBadge).not.toHaveClass('truncate', 'max-w-[30%]');
      expect(controls).toHaveClass('-mt-8', 'sm:mt-0');
    });
  });
});
