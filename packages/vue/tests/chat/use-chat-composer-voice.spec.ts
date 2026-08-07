// @vitest-environment jsdom

import { effectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexNativeRendererApi } from '@codex-app-sdk/core/native';
import type { BrowserAudioRecorder, RecordedAudio } from '../../src/audio/browser-audio-recorder';
import { useCodexComposerVoice } from '../../src';
import { useChatComposerVoice } from '../../src/chat/use-chat-composer-voice';

const recording: RecordedAudio = {
  blob: new Blob(['audio'], { type: 'audio/webm' }),
  durationMs: 100,
};

function fakeRecorder(overrides: Partial<BrowserAudioRecorder> = {}) {
  return {
    release: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => recording),
    ...overrides,
  } as unknown as BrowserAudioRecorder;
}

describe('useChatComposerVoice', () => {
  afterEach(() => {
    delete (window as Window & { codexAppSdkNative?: CodexNativeRendererApi }).codexAppSdkNative;
  });

  it('exposes the product-neutral public controller', () => {
    const voice = useCodexComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    });

    expect(voice.buttonDisabled.value).toBe(true);
    expect(voice.recorder.value).toBeNull();
    expect(voice.buttonLabel.value).toBe('Record voice prompt');
    expect(typeof voice.dispose).toBe('function');
    voice.dispose();
  });

  it('owns the recording and transcription lifecycle', async () => {
    const onTranscript = vi.fn();
    const recorder = fakeRecorder();
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript,
    }, {
      canTranscribe: () => true,
      createRecorder: () => recorder,
      isRecordingSupported: () => true,
      transcribe: vi.fn(async () => ({ text: 'dictated change' })),
    });

    await voice.toggle();
    expect(voice.isRecording.value).toBe(true);
    expect(voice.buttonLabel.value).toBe('Stop recording');

    await voice.toggle();
    expect(voice.isRecording.value).toBe(false);
    expect(voice.isTranscribing.value).toBe(false);
    expect(onTranscript).toHaveBeenCalledWith('dictated change');
  });

  it('uses the SDK native preload transcription by default without a host callback', async () => {
    const transcribeAudio = vi.fn(async () => ({ text: 'native dictated change' }));
    (window as Window & { codexAppSdkNative?: CodexNativeRendererApi }).codexAppSdkNative = {
      capabilities: {
        attachments: true,
        clipboard: true,
        externalLinks: true,
        transcription: true,
      },
      copyToClipboard: vi.fn(async () => undefined),
      ingestAttachments: vi.fn(async () => []),
      openExternal: vi.fn(async () => undefined),
      pickAttachments: vi.fn(async () => []),
      transcribeAudio,
    };
    const audioData = new Uint8Array([1, 2, 3]).buffer;
    const wav = new Blob([], { type: 'audio/wav' });
    Object.defineProperty(wav, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => audioData),
    });
    const recorder = fakeRecorder({
      stop: vi.fn(async () => ({ blob: wav, durationMs: 100 })),
    });
    const onTranscript = vi.fn();
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript,
    }, {
      createRecorder: () => recorder,
      isRecordingSupported: () => true,
    });

    await voice.toggle();
    await voice.toggle();

    expect(transcribeAudio).toHaveBeenCalledWith(audioData, { locale: navigator.language });
    expect(onTranscript).toHaveBeenCalledWith('native dictated change');
  });

  it('releases a partially started recorder and exposes the failure', async () => {
    const recorder = fakeRecorder({ start: vi.fn(async () => { throw new Error('Microphone denied'); }) });
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => true,
      createRecorder: () => recorder,
      isRecordingSupported: () => true,
    });

    await voice.toggle();

    expect(recorder.release).toHaveBeenCalledOnce();
    expect(voice.error.value).toBe('Microphone denied');
    expect(voice.buttonTitle.value).toBe('Microphone denied');
  });

  it('disables unavailable voice input and releases active recording with its scope', async () => {
    const unavailable = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => false,
      isRecordingSupported: () => true,
    });
    expect(unavailable.buttonDisabled.value).toBe(true);
    expect(unavailable.buttonTitle.value).toBe('Speech transcription is not available.');

    const recorder = fakeRecorder();
    const scope = effectScope();
    const scoped = scope.run(() => useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => true,
      createRecorder: () => recorder,
      isRecordingSupported: () => true,
    }))!;
    await scoped.toggle();
    scope.stop();
    expect(recorder.release).toHaveBeenCalledOnce();
  });

  it('keeps native transcription disabled when the preload reports an unsupported platform', () => {
    (window as Window & { codexAppSdkNative?: CodexNativeRendererApi }).codexAppSdkNative = {
      capabilities: {
        attachments: true,
        clipboard: true,
        externalLinks: true,
        transcription: false,
      },
      copyToClipboard: vi.fn(async () => undefined),
      ingestAttachments: vi.fn(async () => []),
      openExternal: vi.fn(async () => undefined),
      pickAttachments: vi.fn(async () => []),
      transcribeAudio: vi.fn(async () => ({ text: '' })),
    };
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      isRecordingSupported: () => true,
    });

    expect(voice.buttonDisabled.value).toBe(true);
    expect(voice.buttonTitle.value).toBe('Speech transcription is not available.');
  });
});
