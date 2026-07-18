import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { CodexSpeechTranscriptionResult, CodexChatTranscription } from './contracts'
import {
  BrowserAudioRecorder,
  isBrowserAudioRecordingSupported,
  type RecordedAudio,
} from '../audio/browser-audio-recorder'
import { transcribeRecordedAudio } from '../audio/apple-speech-transcription'
import { getCodexNativeRendererApi } from '../native-capabilities'

type ChatComposerVoiceOptions = {
  isDisabled: () => boolean
  isSending: () => boolean
  onTranscript: (text: string) => void
  transcribeAudio?: CodexChatTranscription
}

type ChatComposerVoiceDependencies = {
  canTranscribe: () => boolean
  createRecorder: () => BrowserAudioRecorder
  isRecordingSupported: () => boolean
  transcribe: (recording: RecordedAudio) => Promise<CodexSpeechTranscriptionResult>
}

const defaultDependencies: ChatComposerVoiceDependencies = {
  canTranscribe: () => getCodexNativeRendererApi()?.capabilities.transcription === true,
  createRecorder: () => new BrowserAudioRecorder(),
  isRecordingSupported: isBrowserAudioRecordingSupported,
  transcribe: (recording) => transcribeRecordedAudio(recording, {
    transcribeAppleSpeech: async (audioData, options) => {
      const nativeApi = getCodexNativeRendererApi()
      if (!nativeApi) return { error: 'Speech transcription is not available.', text: '' }
      return nativeApi.transcribeAudio(audioData, options)
    },
  }),
}

export function useChatComposerVoice(
  options: ChatComposerVoiceOptions,
  dependencyOverrides: Partial<ChatComposerVoiceDependencies> = {},
) {
  const providedTranscription = options.transcribeAudio
    ? {
        canTranscribe: () => true,
        transcribe: (recording: RecordedAudio) => transcribeRecordedAudio(recording, {
          transcribeAppleSpeech: options.transcribeAudio as CodexChatTranscription,
        }),
      }
    : {}
  const dependencies = { ...defaultDependencies, ...providedTranscription, ...dependencyOverrides }
  const recorder = ref<BrowserAudioRecorder | null>(null)
  const isRecording = ref(false)
  const isTranscribing = ref(false)
  const error = ref<string | null>(null)
  const recordingSupported = computed(() => dependencies.isRecordingSupported())
  const transcriptionAvailable = computed(() => dependencies.canTranscribe())
  const buttonDisabled = computed(() => (
    isTranscribing.value ||
    (options.isDisabled() && !options.isSending()) ||
    !recordingSupported.value ||
    !transcriptionAvailable.value
  ))
  const buttonLabel = computed(() => isRecording.value ? 'Stop recording' : 'Record voice prompt')
  const buttonTitle = computed(() => {
    if (error.value) {
      return error.value
    }
    if (!recordingSupported.value) {
      return 'Audio recording is not available.'
    }
    if (!transcriptionAvailable.value) {
      return 'Speech transcription is not available.'
    }
    if (isTranscribing.value) {
      return 'Transcribing...'
    }
    return buttonLabel.value
  })

  async function toggle(): Promise<void> {
    error.value = null
    if (isRecording.value) {
      await stop()
      return
    }
    await start()
  }

  async function start(): Promise<void> {
    if (buttonDisabled.value) {
      return
    }

    const nextRecorder = dependencies.createRecorder()
    try {
      await nextRecorder.start()
      recorder.value = nextRecorder
      isRecording.value = true
    } catch (startError) {
      nextRecorder.release()
      error.value = errorMessage(startError)
    }
  }

  async function stop(): Promise<void> {
    const activeRecorder = recorder.value
    if (!activeRecorder) {
      return
    }

    isRecording.value = false
    isTranscribing.value = true
    recorder.value = null

    try {
      const recording = await activeRecorder.stop()
      const result = await dependencies.transcribe(recording)
      if (result.error) {
        error.value = result.error
        return
      }
      options.onTranscript(result.text)
    } catch (stopError) {
      error.value = errorMessage(stopError)
    } finally {
      isTranscribing.value = false
    }
  }

  function dispose(): void {
    recorder.value?.release()
    recorder.value = null
    isRecording.value = false
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return {
    buttonDisabled,
    buttonLabel,
    buttonTitle,
    error,
    isRecording,
    isTranscribing,
    recorder,
    toggle,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
