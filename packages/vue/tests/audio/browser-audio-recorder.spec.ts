// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAudioRecorder, isBrowserAudioRecordingSupported } from '../../src/audio/browser-audio-recorder';

describe('BrowserAudioRecorder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported recording when browser APIs are missing', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal('MediaRecorder', undefined);

    expect(isBrowserAudioRecordingSupported()).toBe(false);
  });

  it.each([
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ])('reports support when the browser can record %s', (supportedType) => {
    installAudioContextMock();
    installMediaDevices();
    vi.stubGlobal('MediaRecorder', mediaRecorderClass((mimeType) => mimeType === supportedType));

    expect(isBrowserAudioRecordingSupported()).toBe(true);
  });

  it('requires media capture, MediaRecorder, an audio context, and a supported format', () => {
    installMediaDevices();
    installAudioContextMock();
    vi.stubGlobal('MediaRecorder', mediaRecorderClass(() => false));
    expect(isBrowserAudioRecordingSupported()).toBe(false);

    vi.stubGlobal('MediaRecorder', undefined);
    expect(isBrowserAudioRecordingSupported()).toBe(false);

    vi.stubGlobal('MediaRecorder', mediaRecorderClass(() => true));
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    expect(isBrowserAudioRecordingSupported()).toBe(false);

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: null },
    });
    installAudioContextMock();
    expect(isBrowserAudioRecordingSupported()).toBe(false);
  });

  it('records audio with the preferred WebM codec and stops tracks', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);
    const track = { stop: vi.fn() };
    installAudioContextMock();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [track],
        })),
      },
    });
    const FakeMediaRecorder = mediaRecorderClass((mimeType) => mimeType === 'audio/webm;codecs=opus');
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    const recording = await recorder.stop();

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeMediaRecorder.createdOptions).toStrictEqual({ mimeType: 'audio/webm;codecs=opus' });
    expect(recording.blob.type).toBe('audio/webm;codecs=opus');
    await expect(recording.blob.text()).resolves.toBe('audio');
    expect(recording.durationMs).toBe(250);
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('falls back through supported mime types', async () => {
    installAudioContextMock();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [],
        })),
      },
    });
    const FakeMediaRecorder = mediaRecorderClass((mimeType) => mimeType === 'audio/mp4');
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    await recorder.stop();

    expect(FakeMediaRecorder.createdOptions).toStrictEqual({ mimeType: 'audio/mp4' });
  });

  it('uses plain WebM when the opus codec is unavailable', async () => {
    installAudioContextMock();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [],
        })),
      },
    });
    const FakeMediaRecorder = mediaRecorderClass((mimeType) => mimeType === 'audio/webm');
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    await recorder.stop();

    expect(FakeMediaRecorder.createdOptions).toStrictEqual({ mimeType: 'audio/webm' });
  });

  it('uses browser defaults when no preferred mime type is supported', async () => {
    installAudioContextMock();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [],
        })),
      },
    });
    const FakeMediaRecorder = mediaRecorderClass(() => false);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    await recorder.stop();

    expect(FakeMediaRecorder.createdOptions).toStrictEqual({});
  });

  it('falls back to WebM when the recorder reports an empty mime type', async () => {
    installAudioContextMock();
    installMediaDevices();
    const FakeMediaRecorder = mediaRecorderClass(() => false, { reportedMimeType: '' });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    const recording = await recorder.stop();

    expect(recording.blob.type).toBe('audio/webm');
  });

  it('releases an active recording before starting its replacement', async () => {
    const firstTrack = { stop: vi.fn() };
    const secondTrack = { stop: vi.fn() };
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce({ getTracks: () => [firstTrack] })
      .mockResolvedValueOnce({ getTracks: () => [secondTrack] });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    installAudioContextMock();
    const FakeMediaRecorder = mediaRecorderClass(() => true);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    await recorder.start();

    expect(FakeMediaRecorder.stopCalls).toBe(1);
    expect(firstTrack.stop).toHaveBeenCalledOnce();
    expect(secondTrack.stop).not.toHaveBeenCalled();
    recorder.release();
  });

  it('releases active recordings without returning audio', async () => {
    const track = { stop: vi.fn() };
    installAudioContextMock();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [track],
        })),
      },
    });
    const FakeMediaRecorder = mediaRecorderClass(() => true);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    recorder.release();

    expect(FakeMediaRecorder.stopCalls).toBe(1);
    expect(track.stop).toHaveBeenCalled();

    recorder.release();
    expect(FakeMediaRecorder.stopCalls).toBe(1);
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('rejects and releases when the MediaRecorder errors', async () => {
    const track = { stop: vi.fn() };
    installAudioContextMock();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [track],
        })),
      },
    });
    const FakeMediaRecorder = mediaRecorderClass(() => true, { failOnStop: true });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();

    await expect(recorder.stop()).rejects.toThrow('Audio recording failed.');
    expect(track.stop).toHaveBeenCalled();
  });

  it('rejects when stopping without an active recording', async () => {
    const recorder = new BrowserAudioRecorder();

    await expect(recorder.stop()).rejects.toThrow('No active audio recording.');
  });

  it('rejects a second stop after MediaRecorder becomes inactive before its stop event', async () => {
    installAudioContextMock();
    installMediaDevices();
    const FakeMediaRecorder = mediaRecorderClass(() => true, { deferStopEvent: true });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    const recorder = new BrowserAudioRecorder();

    await recorder.start();
    void recorder.stop();

    await expect(recorder.stop()).rejects.toThrow('No active audio recording.');
    expect(FakeMediaRecorder.stopCalls).toBe(1);
    recorder.release();
  });
});

function mediaRecorderClass(
  isTypeSupported: (mimeType: string) => boolean,
  config: { deferStopEvent?: boolean; failOnStop?: boolean; reportedMimeType?: string } = {},
) {
  return class FakeMediaRecorder {
    static createdOptions: MediaRecorderOptions | undefined;
    static isTypeSupported = vi.fn(isTypeSupported);
    static stopCalls = 0;

    mimeType: string;
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onstop: (() => void) | null = null;
    state: RecordingState = 'inactive';

    constructor(_stream: MediaStream, options: MediaRecorderOptions = {}) {
      FakeMediaRecorder.createdOptions = options;
      this.mimeType = config.reportedMimeType ?? options.mimeType ?? 'audio/webm';
    }

    start(): void {
      this.state = 'recording';
    }

    stop(): void {
      FakeMediaRecorder.stopCalls += 1;
      if (config.deferStopEvent) {
        this.state = 'inactive';
        return;
      }
      if (config.failOnStop) {
        this.state = 'inactive';
        this.onerror?.();
        return;
      }

      this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) } as BlobEvent);
      this.state = 'inactive';
      this.onstop?.();
    }
  };
}

function installMediaDevices(track = { stop: vi.fn() }) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
      })),
    },
  });
  return track;
}

function installAudioContextMock() {
  vi.stubGlobal('AudioContext', class {});
}
