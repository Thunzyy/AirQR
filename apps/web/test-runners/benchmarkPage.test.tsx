import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';

import BenchmarkPage from '@web/components/benchmark/BenchmarkPage';
import { createBenchmarkProfile, estimateBenchmarkRunCount } from '@web/features/benchmark/matrix';

describe('BenchmarkPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the current sweep controls and updates the smart run count when they change', async () => {
    const user = userEvent.setup();

    render(
      <Router hook={() => ['/benchmark', () => undefined]}>
        <BenchmarkPage />
      </Router>,
    );

    expect(screen.queryByLabelText(/Target size min/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Target size max/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Target size step/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/FPS max/i)).toHaveValue(30);
    expect(screen.getByLabelText(/FPS step/i)).toHaveValue(1);
    expect(screen.getByLabelText(/Packet size min/i)).toHaveValue(100);
    expect(screen.getByLabelText(/Packet size max/i)).toHaveValue(2800);
    expect(screen.getByLabelText(/Packet size step/i)).toHaveValue(25);
    expect(screen.getByText(/30 values: 1 → 30 fps/i)).toBeInTheDocument();

    const fullButton = screen.getByRole('button', { name: /Smart/i });
    expect(fullButton).toHaveTextContent(
      `${estimateBenchmarkRunCount('full', createBenchmarkProfile())} runs`
    );

    await user.clear(screen.getByLabelText(/FPS max/i));
    await user.type(screen.getByLabelText(/FPS max/i), '60');
    await user.tab();
    await user.clear(screen.getByLabelText(/FPS step/i));
    await user.type(screen.getByLabelText(/FPS step/i), '2');
    await user.tab();
    await user.clear(screen.getByLabelText(/Packet size step/i));
    await user.type(screen.getByLabelText(/Packet size step/i), '50');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText(/31 values: 1 → 60 fps/i)).toBeInTheDocument();
      expect(fullButton).toHaveTextContent(
        `${estimateBenchmarkRunCount(
          'full',
          createBenchmarkProfile({
            maxFps: 60,
            fpsStep: 2,
            packetSizeStep: 50,
          }),
        )} runs`,
      );
    });
  });
});
