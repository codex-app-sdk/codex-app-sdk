export type RecordedAudio = {
  blob: Blob;
  durationMs: number;
};

type AudioContextConstructor = typeof AudioContext;

export function isBrowserAudioRecordingSupported(): boolean {
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined' &&
    resolveAudioContextConstructor() &&
    (MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ||
      MediaRecorder.isTypeSupported('audio/webm') ||
      MediaRecorder.isTypeSupported('audio/mp4')),
  );
}

export class BrowserAudioRecorder {
  private chunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private startTime = 0;
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.release();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.startTime = Date.now();
    this.mediaRecorder = new MediaRecorder(this.stream, preferredMediaRecorderOptions());
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.mediaRecorder.start();
  }

  stop(): Promise<RecordedAudio> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.reject(new Error('No active audio recording.'));
    }

    return new Promise((resolve, reject) => {
      recorder.onerror = () => {
        this.release();
        reject(new Error('Audio recording failed.'));
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - this.startTime;
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.release();
        resolve({ blob, durationMs });
      };
      recorder.stop();
    });
  }

  release(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.startTime = 0;
  }
}

function preferredMediaRecorderOptions(): MediaRecorderOptions {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    return { mimeType: 'audio/webm;codecs=opus' };
  }

  if (MediaRecorder.isTypeSupported('audio/webm')) {
    return { mimeType: 'audio/webm' };
  }

  if (MediaRecorder.isTypeSupported('audio/mp4')) {
    return { mimeType: 'audio/mp4' };
  }

  return {};
}

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  return window.AudioContext ?? ((window as unknown as {
    webkitAudioContext?: AudioContextConstructor;
  }).webkitAudioContext ?? null);
}
