import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAppleSpeechAudio } from '../../src/audio/apple-speech-transcription';

vi.mock('fix-webm-duration', () => ({
  default: vi.fn(async (blob: Blob) => blob),
}));

describe('apple speech transcription outside a browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported WebM conversion when window is unavailable', async () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(typeof window).toBe('undefined');

    await expect(prepareAppleSpeechAudio({
      blob: new Blob(['webm'], { type: 'audio/webm' }),
      durationMs: 800,
    })).rejects.toThrow('WebM audio conversion is not supported in this browser.');
  });
});
