import workletUrl from './pcm-capture.worklet.js?worker&url';

export interface SpeechRecorder {
  /** Opens the microphone; audio delivery begins only when activate is called. */
  start(onAudio: (audio: ArrayBuffer) => Promise<void>, onError: (error: Error) => void, onLevel?: (level: number) => void): Promise<number>;
  activate(): void;
  stop(): Promise<void>;
  release(): void;
}

export function isBrowserSpeechRecordingSupported(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined';
}

/** Mono PCM capture with bounded transport backlog and a stop/flush handshake. */
export class BrowserSpeechRecorder implements SpeechRecorder {
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private released = false;
  private pending = Promise.resolve();
  private pendingBytes = 0;
  private flushed?: () => void;
  private unlisten?: () => void;

  async start(onAudio: (audio: ArrayBuffer) => Promise<void>, onError: (error: Error) => void, onLevel?: (level: number) => void): Promise<number> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    if (this.released) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('Speech recording cancelled.');
    }
    this.stream = stream;
    const fail = (message: string) => {
      if (this.released) return;
      this.release();
      onError(new Error(message));
    };
    const ended = () => fail('Microphone access ended.');
    stream.getTracks().forEach((track) => track.addEventListener('ended', ended));
    this.unlisten = () => stream.getTracks().forEach((track) => track.removeEventListener('ended', ended));
    const context = this.context = new AudioContext({ sampleRate: 16000 });
    await context.audioWorklet.addModule(workletUrl);
    if (this.released) throw new Error('Speech recording cancelled.');
    this.source = context.createMediaStreamSource(stream);
    this.node = new AudioWorkletNode(context, 'codex-pcm-capture', { channelCount: 1, channelCountMode: 'explicit' });
    this.node.onprocessorerror = () => fail('Microphone audio processing failed.');
    // The processor never writes to its output, so the microphone is not audible.
    this.node.connect(context.destination);
    this.node.port.onmessage = ({ data }: MessageEvent<ArrayBuffer | string>) => {
      if (data === 'stopped') { this.flushed?.(); return; }
      if (this.released || !(data instanceof ArrayBuffer)) return;
      // Report local microphone energy before transport backpressure or recognition.
      if (onLevel && data.byteLength) {
        const samples = new Float32Array(data);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        onLevel(Math.min(1, Math.sqrt(energy / samples.length) * 8));
      }
      this.pendingBytes += data.byteLength;
      if (this.pendingBytes > 256 * 1024) {
        fail('Speech recognition cannot keep up with the microphone.');
        return;
      }
      this.pending = this.pending.then(async () => {
        if (!this.released) await onAudio(data);
      }).catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      }).finally(() => { this.pendingBytes -= data.byteLength; });
    };
    await context.resume();
    if (this.released) throw new Error('Speech recording cancelled.');
    return context.sampleRate;
  }

  activate(): void { if (!this.released && this.node) this.source?.connect(this.node); }

  async stop(): Promise<void> {
    if (this.released || !this.node) throw new Error('No active speech recording.');
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Microphone did not finish recording.')), 2000);
        this.flushed = () => { clearTimeout(timeout); resolve(); };
        this.node!.port.postMessage('stop');
      });
      await this.pending;
      if (this.released) throw new Error('Speech recording was interrupted.');
    } finally { this.release(); }
  }

  release(): void {
    this.released = true;
    this.flushed?.();
    this.flushed = undefined;
    this.unlisten?.();
    this.unlisten = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    this.node?.port.close();
    void this.context?.close().catch(() => {});
    this.stream = undefined;
    this.context = undefined;
    this.node = undefined;
    this.source = undefined;
  }
}
