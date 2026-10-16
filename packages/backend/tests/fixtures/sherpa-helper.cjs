// Transport fixture: no recognition claims. Drives out-of-order process/session replies.
let sessions = new Map();
process.on('message', (m) => {
  const reply = (value = {}) => process.send({ requestId: m.requestId, ...value });
  if (m.type === 'load') return reply({ ready: true });
  if (m.type === 'shutdown') return setTimeout(() => process.exit(0), 40);
  if (m.type === 'start') { sessions.set(m.token, { id: m.sessionId }); return reply(); }
  const entry = sessions.get(m.token);
  if (!entry) return reply({ error: 'Speech stream is closed.' });
  const event = (partialText, token = m.token) => process.send({ type: 'transcript', token, finalText: '', partialText });
  if (m.type === 'append') {
    const marker = new Float32Array(m.audio)[0];
    if (marker === 3) return reply({ error: 'Recognizer failed' });
    if (marker === 4) return process.exit(7);
    if (marker === 6) return; // Simulate a hung decoder.
    if (marker === 7) { process.send({ type: 'nonsense' }); return; }
    if (marker === 8) entry.text = String(process.pid); // Transport liveness receipt.
    event('a cat'); event('a cap');
    return reply();
  }
  if (m.type === 'cancel') {
    sessions.delete(m.token);
    reply();
    setTimeout(() => event('late cancelled words'), 10);
    return;
  }
  if (m.type === 'stop') {
    sessions.delete(m.token);
    reply({ text: entry.text ?? 'A cap.' });
    // A stale final must not be inserted into a restarted session with the same public ID.
    setTimeout(() => event('late final words'), 10);
    return;
  }
  reply({ error: 'Invalid command for ' + entry?.id });
});
process.on('disconnect', () => process.exit(0));
