// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatComposerWaveform from '../../src/chat/ChatComposerWaveform.vue';

type WaveformAudioRecorder = {
  getAnalyser(): AnalyserNode | null;
  getBufferLength(): number;
};

function createAudioRecorder(options: {
  bufferLength: number;
  getByteTimeDomainData: (target: Uint8Array) => void;
}): WaveformAudioRecorder {
  return {
    getAnalyser: () => ({
      getByteTimeDomainData: options.getByteTimeDomainData,
    }) as unknown as AnalyserNode,
    getBufferLength: () => options.bufferLength,
  };
}

describe('ChatComposerWaveform', () => {
  let canvasContext: {
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fillStyle: string;
  };
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let rafCallbacks: FrameRequestCallback[];
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    canvasContext = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    rafCallbacks = [];
    cancelAnimationFrameSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      color: 'rgb(10, 20, 30)',
    } as CSSStyleDeclaration);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws voice activity from the right while active and stops when deactivated', async () => {
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => {
      target.set([128, 160, 96, 128]);
    });
    const audioRecorder = createAudioRecorder({
      bufferLength: 4,
      getByteTimeDomainData,
    });

    const wrapper = mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder,
        height: 20,
        label: 'Recording',
        width: 40,
      },
    });

    expect(wrapper.attributes('role')).toBe('img');
    expect(wrapper.attributes('aria-label')).toBe('Recording');
    expect(getByteTimeDomainData).toHaveBeenCalledTimes(1);
    expect(canvasContext.clearRect).toHaveBeenCalledWith(0, 0, 40, 20);
    expect(canvasContext.fillStyle).toBe('rgb(10, 20, 30)');
    expect(canvasContext.fillRect).toHaveBeenCalledWith(38, expect.any(Number), 2, expect.any(Number));
    expect(requestAnimationFrameSpy).toHaveBeenCalled();

    await wrapper.setProps({ active: false } as never);

    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1);
  });

  it('starts when active changes and reschedules while inputs are unavailable', async () => {
    const wrapper = mount(ChatComposerWaveform, {
      props: {
        active: false,
        audioRecorder: null,
      },
    });

    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();

    await wrapper.setProps({ active: true } as never);

    expect(requestAnimationFrameSpy).toHaveBeenCalledWith(expect.any(Function));
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('waits cleanly when the recorder has no analyser yet', () => {
    const audioRecorder = {
      getAnalyser: vi.fn(() => null),
      getBufferLength: vi.fn(() => 4),
    };

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder,
      },
    });

    expect(canvasContext.clearRect).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(requestAnimationFrameSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('waits cleanly when the analyser has no samples yet', () => {
    const getByteTimeDomainData = vi.fn();

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 0, getByteTimeDomainData }),
      },
    });

    expect(getByteTimeDomainData).not.toHaveBeenCalled();
    expect(canvasContext.clearRect).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(requestAnimationFrameSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('waits cleanly when the canvas context is unavailable', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
    const getByteTimeDomainData = vi.fn();

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 4, getByteTimeDomainData }),
      },
    });

    expect(getByteTimeDomainData).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(requestAnimationFrameSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('does not touch recording or canvas inputs while inactive', () => {
    const audioRecorder = {
      getAnalyser: vi.fn(() => null),
      getBufferLength: vi.fn(() => 0),
    };

    mount(ChatComposerWaveform, {
      props: {
        active: false,
        audioRecorder,
      },
    });

    expect(audioRecorder.getAnalyser).not.toHaveBeenCalled();
    expect(audioRecorder.getBufferLength).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
  });

  it('waits for a complete sample interval before recording again', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => target.fill(160));

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 4, getByteTimeDomainData }),
      },
    });
    now = 1_059;
    rafCallbacks.at(-1)?.(now);

    expect(getByteTimeDomainData).toHaveBeenCalledTimes(1);

    now = 1_060;
    rafCallbacks.at(-1)?.(now);

    expect(getByteTimeDomainData).toHaveBeenCalledTimes(2);
  });

  it('resets the scrolling history when analyser buffer length changes', () => {
    let now = 1_000;
    let bufferLength = 4;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => {
      target.fill(160);
    });
    const audioRecorder = {
      getAnalyser: () => ({
        getByteTimeDomainData,
      }) as unknown as AnalyserNode,
      getBufferLength: () => bufferLength,
    };

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder,
        width: 40,
      },
    });
    bufferLength = 2;
    now = 1_060;
    rafCallbacks.at(-1)?.(now);

    expect(getByteTimeDomainData).toHaveBeenCalledTimes(2);
    expect(canvasContext.fillRect.mock.calls.map((call) => call[0])).toEqual([38, 38]);
  });

  it('scrolls older voice activity left as new samples arrive', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const samples = [
      [128, 128, 128, 128],
      [180, 180, 180, 180],
    ];
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => {
      target.set(samples[Math.min(getByteTimeDomainData.mock.calls.length - 1, samples.length - 1)] ?? []);
    });
    const audioRecorder = createAudioRecorder({
      bufferLength: 4,
      getByteTimeDomainData,
    });

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder,
        height: 20,
        width: 40,
      },
    });
    now = 1_060;
    rafCallbacks.at(-1)?.(now);

    expect(getByteTimeDomainData).toHaveBeenCalledTimes(2);
    const calls = canvasContext.fillRect.mock.calls;
    expect(calls.map((call) => call[0])).toEqual([38, 38, 34]);
    expect(calls[1]![3]).toBeGreaterThan(2);
    expect(calls[2]![3]).toBe(2);
  });

  it('keeps three distinct samples in newest-to-oldest drawing order', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const samples = [128, 160, 255];
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => {
      target.fill(samples[Math.min(getByteTimeDomainData.mock.calls.length - 1, samples.length - 1)] ?? 128);
    });

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 4, getByteTimeDomainData }),
        height: 20,
        width: 40,
      },
    });
    now += 60;
    rafCallbacks.at(-1)?.(now);
    canvasContext.fillRect.mockClear();
    now += 60;
    rafCallbacks.at(-1)?.(now);

    expect(canvasContext.fillRect.mock.calls.map((call) => [call[0], call[3]])).toEqual([
      [38, 20],
      [34, 16],
      [30, 2],
    ]);
  });

  it('converts time-domain samples into centered, scaled bars', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => {
      target.set([128, 160, 96, 128]);
    });

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 4, getByteTimeDomainData }),
        height: 20,
        width: 40,
      },
    });

    expect(canvasContext.fillRect).toHaveBeenCalledTimes(1);
    const [x, y, width, height] = canvasContext.fillRect.mock.calls[0]!;
    expect(x).toBe(38);
    expect(width).toBe(2);
    expect(height).toBeCloseTo(Math.sqrt(0.125 / 4) * 3.2 * 20);
    expect(y).toBeCloseTo(10 - Number(height) / 2);
  });

  it('caps the history to the number of bars that fit the canvas', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => target.fill(160));

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 4, getByteTimeDomainData }),
        width: 9,
      },
    });
    for (let sample = 1; sample <= 3; sample += 1) {
      now += 60;
      rafCallbacks.at(-1)?.(now);
    }

    canvasContext.fillRect.mockClear();
    now += 60;
    rafCallbacks.at(-1)?.(now);

    expect(canvasContext.fillRect.mock.calls.map((call) => call[0])).toEqual([7, 3]);
  });

  it('does not resurrect discarded samples when the canvas grows', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => target.fill(160));
    const wrapper = mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 4, getByteTimeDomainData }),
        width: 9,
      },
    });
    for (let sample = 1; sample <= 3; sample += 1) {
      now += 60;
      rafCallbacks.at(-1)?.(now);
    }

    await wrapper.setProps({ width: 40 } as never);
    canvasContext.fillRect.mockClear();
    now += 1;
    rafCallbacks.at(-1)?.(now);

    expect(canvasContext.fillRect.mock.calls.map((call) => call[0])).toEqual([38, 34, 30]);
  });

  it('draws a bar whose right edge exactly fills a narrow canvas', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => target.fill(128));

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 1, getByteTimeDomainData }),
        width: 2,
      },
    });

    expect(canvasContext.fillRect).toHaveBeenCalledWith(0, 13, 2, 2);
  });

  it('does not draw bars beyond the left edge of the canvas', () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => target.fill(128));

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 1, getByteTimeDomainData }),
        width: 5,
      },
    });
    now += 60;
    rafCallbacks.at(-1)?.(now);

    expect(canvasContext.fillRect.mock.calls.map((call) => call[0])).toEqual([3, 3]);
  });

  it('clears recorded history when recording pauses and resumes', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const getByteTimeDomainData = vi.fn((target: Uint8Array) => target.fill(160));
    const wrapper = mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({ bufferLength: 4, getByteTimeDomainData }),
        width: 40,
      },
    });
    now += 60;
    rafCallbacks.at(-1)?.(now);
    await wrapper.setProps({ active: false } as never);

    canvasContext.fillRect.mockClear();
    now += 60;
    await wrapper.setProps({ active: true } as never);

    expect(canvasContext.fillRect.mock.calls.map((call) => call[0])).toEqual([38]);
  });

  it('reports drawing failures and keeps an active animation alive', () => {
    canvasContext.clearRect.mockImplementationOnce(() => {
      throw new Error('canvas unavailable');
    });

    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({
          bufferLength: 1,
          getByteTimeDomainData: (target) => target.fill(128),
        }),
      },
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error drawing waveform', expect.objectContaining({
      message: 'canvas unavailable',
    }));
    expect(requestAnimationFrameSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('requests a 2d canvas context', () => {
    mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: createAudioRecorder({
          bufferLength: 1,
          getByteTimeDomainData: (target) => target.fill(128),
        }),
      },
    });

    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('2d');
  });

  it('stops harmlessly when no animation is running', () => {
    const wrapper = mount(ChatComposerWaveform, {
      props: {
        active: false,
        audioRecorder: null,
      },
    });

    wrapper.unmount();

    expect(cancelAnimationFrameSpy).not.toHaveBeenCalled();
  });

  it('cancels an active animation when unmounted', () => {
    const wrapper = mount(ChatComposerWaveform, {
      props: {
        active: true,
        audioRecorder: null,
      },
    });

    wrapper.unmount();

    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(1);
  });
});
