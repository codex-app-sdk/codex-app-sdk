// Native allocations belong exclusively to this process. IPC disconnect or idle
// shutdown releases the recognizer by process exit, without relying on JS GC.
const fs = require('node:fs');
let recognizer;
let modelRate;
const streams = new Map();
const send = (value) => { if (process.connected) process.send(value); };
const join = (a, b) => [a, b].filter(Boolean).join(' ');
function decode(entry, emit = true) {
  while (recognizer.isReady(entry.stream)) recognizer.decode(entry.stream);
  const partialText = recognizer.getResult(entry.stream).text.trim();
  let snapshot = { finalText: entry.finalText, partialText };
  if (recognizer.isEndpoint(entry.stream)) {
    entry.finalText = join(entry.finalText, partialText);
    recognizer.reset(entry.stream);
    snapshot = { finalText: entry.finalText, partialText: '' };
  }
  const serialized = JSON.stringify(snapshot);
  if (emit && serialized !== entry.previous) {
    entry.previous = serialized;
    send({ type: 'transcript', token: entry.token, ...snapshot });
  }
}
process.on('message', (message) => {
  const reply = (value = {}) => send({ requestId: message.requestId, ...value });
  try {
    if (message.type === 'shutdown') { process.exit(0); }
    if (message.type === 'load') {
      if (recognizer) throw new Error('Recognizer already loaded.');
      const { model, numThreads } = message;
      for (const key of ['encoder', 'decoder', 'joiner', 'tokens']) {
        if (!fs.statSync(model[key]).isFile()) throw new Error('Missing local Sherpa model file: ' + key);
      }
      const { OnlineRecognizer } = require('sherpa-onnx-node');
      modelRate = model.sampleRate;
      recognizer = new OnlineRecognizer({
        featConfig: { sampleRate: modelRate, featureDim: 80 },
        modelConfig: { transducer: { encoder: model.encoder, decoder: model.decoder, joiner: model.joiner },
          tokens: model.tokens, numThreads, provider: 'cpu' },
        decodingMethod: 'greedy_search', enableEndpoint: true,
        rule1MinTrailingSilence: 2.4, rule2MinTrailingSilence: 0.8, rule3MinUtteranceLength: 20,
      });
      return reply();
    }
    if (!recognizer) throw new Error('Recognizer is not loaded.');
    if (message.type === 'start') {
      if (streams.has(message.token)) throw new Error('Duplicate speech stream.');
      streams.set(message.token, { token: message.token, sampleRate: message.sampleRate,
        stream: recognizer.createStream(), finalText: '', previous: '' });
      return reply();
    }
    const entry = streams.get(message.token);
    if (!entry) throw new Error('Speech stream is closed.');
    if (message.type === 'append') {
      const samples = new Float32Array(message.audio);
      if (samples.some((value) => !Number.isFinite(value))) throw new Error('PCM samples must be finite.');
      entry.stream.acceptWaveform({ sampleRate: entry.sampleRate, samples });
      decode(entry);
      return reply();
    }
    if (message.type === 'stop') {
      entry.stream.acceptWaveform({ sampleRate: entry.sampleRate, samples: new Float32Array(Math.round(entry.sampleRate * 0.5)) });
      entry.stream.inputFinished();
      decode(entry, false);
      const text = join(entry.finalText, recognizer.getResult(entry.stream).text.trim());
      streams.delete(message.token);
      return reply({ text });
    }
    if (message.type === 'cancel') { streams.delete(message.token); return reply(); }
    throw new Error('Invalid Sherpa speech command.');
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : String(error) });
  }
});
process.on('disconnect', () => process.exit(0));
