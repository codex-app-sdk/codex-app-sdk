// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import fixWebmDuration from 'fix-webm-duration';
import { prepareAppleSpeechAudio, transcribeRecordedAudio } from '../../../src/vue/audio/apple-speech-transcription';

vi.mock('fix-webm-duration', () => ({
  default: vi.fn(async (blob: Blob) => blob),
}));

describe('apple speech transcription', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('converts WebM recordings to PCM WAV without a CSP-sensitive blob fetch', async () => {
    const decodeAudioData = vi.fn(async () => fakeAudioBuffer());
    const close = vi.fn(async () => undefined);
    class FakeAudioContext {
      decodeAudioData = decodeAudioData;
      close = close;
    }
    const fetch = vi.fn(() => {
      throw new Error('blob fetch is blocked by the sample CSP');
    });
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('fetch', fetch);
    const api = {
      transcribeAppleSpeech: vi.fn(async (
        _audioData: ArrayBuffer,
        _options?: { locale?: string },
      ) => ({ text: 'hello' })),
    };
    const recording = {
      blob: new Blob(['webm'], { type: 'audio/webm' }),
      durationMs: 1200,
    };

    const result = await transcribeRecordedAudio(recording, api);

    expect(result).toStrictEqual({ text: 'hello' });
    expect(fixWebmDuration).toHaveBeenCalledWith(recording.blob, 1200);
    expect(decodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(close).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    const audioData = api.transcribeAppleSpeech.mock.calls[0]?.[0];
    expect(wavHeader(audioData)).toStrictEqual({
      bitsPerSample: 16,
      channelCount: 1,
      dataSize: 6,
      format: 'WAVE',
      riff: 'RIFF',
      sampleRate: 16_000,
    });
    expect(api.transcribeAppleSpeech).toHaveBeenCalledWith(audioData, {
      locale: navigator.language,
    });
  });

  it('keeps non-WebM recordings as-is', async () => {
    const audio = await prepareAppleSpeechAudio({
      blob: new Blob(['wav'], { type: 'audio/wav' }),
      durationMs: 800,
    });

    expect(audio.byteLength).toBeGreaterThan(0);
  });

  it('preserves the original WebM mime type when duration fixing changes it', async () => {
    const decodeAudioData = vi.fn(async () => fakeAudioBuffer());
    class FakeAudioContext {
      decodeAudioData = decodeAudioData;
      close = vi.fn(async () => undefined);
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.mocked(fixWebmDuration).mockResolvedValueOnce(new Blob(['fixed'], { type: 'video/webm' }));

    await prepareAppleSpeechAudio({
      blob: new Blob(['webm'], { type: 'audio/webm' }),
      durationMs: 800,
    });

    expect(decodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer));
  });

  it('throws when the preload bridge does not expose transcription', async () => {
    await expect(transcribeRecordedAudio({
      blob: new Blob(['wav'], { type: 'audio/wav' }),
      durationMs: 800,
    }, undefined)).rejects.toThrow('Apple speech transcription is not available.');
  });
});

function fakeAudioBuffer(): AudioBuffer {
  return {
    length: 3,
    numberOfChannels: 1,
    sampleRate: 16_000,
    getChannelData: () => new Float32Array([-1, 0, 1]),
  } as unknown as AudioBuffer;
}

function wavHeader(audioData: ArrayBuffer | undefined) {
  expect(audioData).toBeInstanceOf(ArrayBuffer);
  const view = new DataView(audioData as ArrayBuffer);
  return {
    riff: ascii(view, 0, 4),
    format: ascii(view, 8, 4),
    channelCount: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize: view.getUint32(40, true),
  };
}

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from(
    { length },
    (_, index) => view.getUint8(offset + index),
  ));
}
