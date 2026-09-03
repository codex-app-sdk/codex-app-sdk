import fixWebmDuration from 'fix-webm-duration';
import type { CodexSpeechTranscriptionResult } from '../chat/contracts';
import type { RecordedAudio } from './browser-audio-recorder';

export type AppleSpeechTranscriptionApi = {
  transcribeAppleSpeech(audioData: ArrayBuffer, options?: { locale?: string }): Promise<CodexSpeechTranscriptionResult>;
};

type WebmDurationFixer = (blob: Blob, durationMs: number) => Promise<Blob>;

export async function transcribeRecordedAudio(
  recording: RecordedAudio,
  api: AppleSpeechTranscriptionApi | undefined,
): Promise<CodexSpeechTranscriptionResult> {
  if (!api?.transcribeAppleSpeech) {
    throw new Error('Apple speech transcription is not available.');
  }

  const audioData = await prepareAppleSpeechAudio(recording);
  return api.transcribeAppleSpeech(audioData, {
    locale: navigator.language,
  });
}

export async function prepareAppleSpeechAudio(
  recording: RecordedAudio,
  fixDuration: WebmDurationFixer = fixWebmDuration,
): Promise<ArrayBuffer> {
  const source = await normalizeWebmDuration(recording, fixDuration);
  const wavBlob = source.type.includes('webm')
    ? await convertWebmToWav(source)
    : source;

  return wavBlob.arrayBuffer();
}

async function convertWebmToWav(source: Blob): Promise<Blob> {
  const AudioContextConstructor = resolveAudioContextConstructor();
  if (!AudioContextConstructor) {
    throw new Error('WebM audio conversion is not supported in this browser.');
  }

  const audioContext = new AudioContextConstructor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(await source.arrayBuffer());
    return encodePcm16Wav(audioBuffer);
  } finally {
    await audioContext.close();
  }
}

function encodePcm16Wav(audioBuffer: AudioBuffer): Blob {
  const bytesPerSample = 2;
  const channelCount = audioBuffer.numberOfChannels;
  const dataSize = audioBuffer.length * channelCount * bytesPerSample;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = Array.from(
    { length: channelCount },
    (_, channel) => audioBuffer.getChannelData(channel),
  );
  let offset = 44;
  for (let frame = 0; frame < audioBuffer.length; frame += 1) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([output], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function resolveAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

async function normalizeWebmDuration(recording: RecordedAudio, fixDuration: WebmDurationFixer): Promise<Blob> {
  if (!recording.blob.type.includes('webm')) {
    return recording.blob;
  }

  const fixedBlob = await fixDuration(recording.blob, recording.durationMs);
  if (fixedBlob.type === recording.blob.type) {
    return fixedBlob;
  }

  return new Blob([fixedBlob], { type: recording.blob.type });
}
