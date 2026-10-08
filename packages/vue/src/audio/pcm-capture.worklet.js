// Transfer each microphone frame once; flush the final short block before stopping.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(2048);
    this.offset = 0;
    this.active = true;
    this.port.onmessage = () => {
      this.flush();
      this.active = false;
      this.port.postMessage('stopped');
    };
  }
  flush() {
    if (!this.offset) return;
    const data = this.samples.slice(0, this.offset);
    this.port.postMessage(data.buffer, [data.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    if (!this.active) return false;
    const mono = inputs[0]?.[0];
    if (mono) {
      for (const sample of mono) {
        this.samples[this.offset++] = sample;
        if (this.offset === this.samples.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('codex-pcm-capture', PcmCapture);
