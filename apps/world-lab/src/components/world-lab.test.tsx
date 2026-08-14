import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { WorldLab } from './world-lab';

vi.mock('maplibre-gl', () => {
  class Map {
    addControl() {}
    addLayer() {}
    addSource() {}
    getCanvas() {
      return { style: { cursor: '' } };
    }
    getSource() {
      return undefined;
    }
    on(event: string, layerOrCallback: unknown, callback?: () => void) {
      if (event === 'load' && typeof layerOrCallback === 'function')
        layerOrCallback();
      void callback;
    }
    remove() {}
  }
  return {
    default: {
      Map,
      NavigationControl: class {},
      AttributionControl: class {},
    },
  };
});

describe('WorldLab', () => {
  it('renders the map shell and reserved developer areas', () => {
    render(<WorldLab />);
    expect(
      screen.getByRole('heading', { name: 'World Lab' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('world-map')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Simulation controls' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Agent inspector' }),
    ).toBeInTheDocument();
  });

  it('selects another hex and reports its H3 index and state', async () => {
    const user = userEvent.setup();
    render(<WorldLab />);
    const secondHex = screen.getByRole('button', { name: 'Select hex 2' });
    expect(secondHex).toHaveAttribute('aria-pressed', 'false');
    await user.click(secondHex);
    expect(secondHex).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(secondHex.getAttribute('title')!),
    ).toBeInTheDocument();
  });
});
