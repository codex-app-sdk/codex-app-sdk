// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import fixWebmDuration from 'fix-webm-duration';
import { prepareAppleSpeechAudio, transcribeRecordedAudio } from '../../src/audio/apple-speech-transcription';

describe('apple speech transcription', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('converts WebM recordings to PCM WAV without a CSP-sensitive blob fetch', async () => {
    const decodeAudioData = vi.fn(async (_audioData: ArrayBuffer) => fakeAudioBuffer());
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
      audioFormat: 1,
      bitsPerSample: 16,
      blockAlign: 2,
      byteRate: 32_000,
      channelCount: 1,
      data: 'data',
      dataSize: 6,
      fmt: 'fmt ',
      fmtSize: 16,
      format: 'WAVE',
      riff: 'RIFF',
      riffSize: 42,
      sampleRate: 16_000,
    });
    expect(api.transcribeAppleSpeech).toHaveBeenCalledWith(audioData, {
      locale: navigator.language,
    });
  });

  it('keeps non-WebM recordings as-is', async () => {
    const blob = new Blob(['wav'], { type: 'audio/wav' });
    const audio = await prepareAppleSpeechAudio({
      blob,
      durationMs: 800,
    });

    expect([...new Uint8Array(audio)]).toStrictEqual([...new Uint8Array(await blob.arrayBuffer())]);
    expect(fixWebmDuration).not.toHaveBeenCalled();
  });

  it('preserves WebM conversion when duration fixing returns a non-WebM mime type', async () => {
    const decodeAudioData = vi.fn(async (_audioData: ArrayBuffer) => fakeAudioBuffer());
    const fixDuration = vi.fn(async () => new Blob(['fixed'], { type: 'video/mp4' }));
    class FakeAudioContext {
      decodeAudioData = decodeAudioData;
      close = vi.fn(async () => undefined);
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const recording = {
      blob: new Blob(['webm'], { type: 'audio/webm' }),
      durationMs: 800,
    };
    await prepareAppleSpeechAudio(recording, fixDuration);

    expect(fixDuration).toHaveBeenCalledWith(recording.blob, 800);
    const decoded = decodeAudioData.mock.calls[0]?.[0];
    expect(decoded).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(decoded as ArrayBuffer)]).toStrictEqual([...new TextEncoder().encode('fixed')]);
  });

  it('encodes clipped, interleaved PCM samples and the complete stereo WAV header', async () => {
    const decodeAudioData = vi.fn(async () => ({
      length: 3,
      numberOfChannels: 2,
      sampleRate: 8_000,
      getChannelData: (channel: number) => channel === 0
        ? new Float32Array([-2, 0, 2])
        : new Float32Array([2, -2]),
    } as unknown as AudioBuffer));
    class FakeAudioContext {
      decodeAudioData = decodeAudioData;
      close = vi.fn(async () => undefined);
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);

    const audioData = await prepareAppleSpeechAudio({
      blob: new Blob(['webm'], { type: 'audio/webm' }),
      durationMs: 800,
    });

    expect(wavHeader(audioData)).toStrictEqual({
      audioFormat: 1,
      bitsPerSample: 16,
      blockAlign: 4,
      byteRate: 32_000,
      channelCount: 2,
      data: 'data',
      dataSize: 12,
      fmt: 'fmt ',
      fmtSize: 16,
      format: 'WAVE',
      riff: 'RIFF',
      riffSize: 48,
      sampleRate: 8_000,
    });
    const view = new DataView(audioData);
    expect(Array.from({ length: 6 }, (_, index) => view.getInt16(44 + index * 2, true)))
      .toStrictEqual([-32_768, 32_767, 0, -32_768, 32_767, 0]);
  });

  it('uses the WebKit audio context fallback and always closes it', async () => {
    const decodeAudioData = vi.fn(async () => fakeAudioBuffer());
    const close = vi.fn(async () => undefined);
    class FakeWebkitAudioContext {
      decodeAudioData = decodeAudioData;
      close = close;
    }
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', FakeWebkitAudioContext);

    await expect(prepareAppleSpeechAudio({
      blob: new Blob(['webm'], { type: 'audio/webm' }),
      durationMs: 800,
    })).resolves.toBeInstanceOf(ArrayBuffer);

    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('reports unsupported WebM conversion when no browser constructor exists', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const recording = {
      blob: new Blob(['webm'], { type: 'audio/webm' }),
      durationMs: 800,
    };

    await expect(prepareAppleSpeechAudio(recording))
      .rejects.toThrow('WebM audio conversion is not supported in this browser.');
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
    riffSize: view.getUint32(4, true),
    format: ascii(view, 8, 4),
    fmt: ascii(view, 12, 4),
    fmtSize: view.getUint32(16, true),
    audioFormat: view.getUint16(20, true),
    channelCount: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    data: ascii(view, 36, 4),
    dataSize: view.getUint32(40, true),
  };
}

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from(
    { length },
    (_, index) => view.getUint8(offset + index),
  ));
}
