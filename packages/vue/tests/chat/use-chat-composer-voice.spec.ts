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
    expect(voice.buttonTitle.value).toBe('Stop recording');

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

  it('blocks disabled idle input but permits voice control while sending', async () => {
    const blockedRecorder = fakeRecorder();
    const blocked = useChatComposerVoice({
      isDisabled: () => true,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => true,
      createRecorder: () => blockedRecorder,
      isRecordingSupported: () => true,
    });
    expect(blocked.buttonDisabled.value).toBe(true);
    await blocked.toggle();
    expect(blockedRecorder.start).not.toHaveBeenCalled();

    const sendingRecorder = fakeRecorder();
    const sending = useChatComposerVoice({
      isDisabled: () => true,
      isSending: () => true,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => true,
      createRecorder: () => sendingRecorder,
      isRecordingSupported: () => true,
    });
    expect(sending.buttonDisabled.value).toBe(false);
    await sending.toggle();
    expect(sendingRecorder.start).toHaveBeenCalledOnce();
  });

  it('reports recording unavailability before transcription state', () => {
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => false,
      isRecordingSupported: () => false,
    });

    expect(voice.buttonDisabled.value).toBe(true);
    expect(voice.buttonTitle.value).toBe('Audio recording is not available.');
  });

  it('exposes transcribing state until transcription and transcript handling settle', async () => {
    let resolveTranscription!: (result: { text: string }) => void;
    const transcription = new Promise<{ text: string }>((resolve) => {
      resolveTranscription = resolve;
    });
    const recorder = fakeRecorder();
    const onTranscript = vi.fn(async () => undefined);
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript,
    }, {
      canTranscribe: () => true,
      createRecorder: () => recorder,
      isRecordingSupported: () => true,
      transcribe: () => transcription,
    });

    await voice.toggle();
    const stopping = voice.stop();
    await Promise.resolve();
    expect(voice.isRecording.value).toBe(false);
    expect(voice.isTranscribing.value).toBe(true);
    expect(voice.recorder.value).toBeNull();
    expect(voice.buttonDisabled.value).toBe(true);
    expect(voice.buttonTitle.value).toBe('Transcribing...');

    resolveTranscription({ text: 'settled transcript' });
    await expect(stopping).resolves.toBe(true);
    expect(onTranscript).toHaveBeenCalledWith('settled transcript');
    expect(voice.isTranscribing.value).toBe(false);
  });

  it('returns false without an active recorder', async () => {
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => true,
      isRecordingSupported: () => true,
    });

    await expect(voice.stop()).resolves.toBe(false);
    expect(voice.error.value).toBeNull();
    expect(voice.isTranscribing.value).toBe(false);
  });

  it('returns the default unavailable error when forced transcription has no native host', async () => {
    const wav = new Blob([], { type: 'audio/wav' });
    Object.defineProperty(wav, 'arrayBuffer', {
      configurable: true,
      value: vi.fn(async () => new ArrayBuffer(0)),
    });
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => true,
      createRecorder: () => fakeRecorder({
        stop: vi.fn(async () => ({ blob: wav, durationMs: 1 })),
      }),
      isRecordingSupported: () => true,
    });

    await voice.toggle();
    await expect(voice.stop()).resolves.toBe(false);
    expect(voice.error.value).toBe('Speech transcription is not available.');
  });

  it('does not register scope cleanup when created outside an active scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript: vi.fn(),
    }, {
      canTranscribe: () => true,
      isRecordingSupported: () => true,
    });

    expect(warn).not.toHaveBeenCalled();
    voice.dispose();
  });

  it('surfaces transcription result errors without publishing a transcript', async () => {
    const onTranscript = vi.fn();
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript,
    }, {
      canTranscribe: () => true,
      createRecorder: () => fakeRecorder(),
      isRecordingSupported: () => true,
      transcribe: vi.fn(async () => ({ error: 'No speech detected', text: '' })),
    });

    await voice.toggle();
    await expect(voice.stop()).resolves.toBe(false);
    expect(voice.error.value).toBe('No speech detected');
    expect(voice.buttonTitle.value).toBe('No speech detected');
    expect(onTranscript).not.toHaveBeenCalled();
    expect(voice.isTranscribing.value).toBe(false);
  });

  it.each([
    ['transcription', () => { throw 'transcription failed'; }],
    ['transcript callback', async () => ({ text: 'result' })],
  ] as const)('normalizes a %s failure and always clears transcribing state', async (kind, transcribe) => {
    const onTranscript = kind === 'transcript callback'
      ? vi.fn(async () => { throw new Error('callback failed'); })
      : vi.fn();
    const voice = useChatComposerVoice({
      isDisabled: () => false,
      isSending: () => false,
      onTranscript,
    }, {
      canTranscribe: () => true,
      createRecorder: () => fakeRecorder(),
      isRecordingSupported: () => true,
      transcribe: async () => await transcribe(),
    });

    await voice.toggle();
    await expect(voice.stop()).resolves.toBe(false);
    expect(voice.error.value).toBe(kind === 'transcription' ? 'transcription failed' : 'callback failed');
    expect(voice.isTranscribing.value).toBe(false);
  });

  it('disposes an active recorder and resets public recording state', async () => {
    const recorder = fakeRecorder();
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

    voice.dispose();

    expect(recorder.release).toHaveBeenCalledOnce();
    expect(voice.recorder.value).toBeNull();
    expect(voice.isRecording.value).toBe(false);
  });
});
