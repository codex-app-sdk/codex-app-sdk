// Keep this document constant across chunks. Replacing srcdoc (or body.innerHTML)
// restarts scripts, destroys form state, and flashes the preview during streaming.
// The opaque-origin child owns an open HTML parser until the final chunk arrives.
export const htmlPreviewDocument = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
</head><body><script>
addEventListener('load', () => {
  document.open();
  addEventListener('message', function connect(event) {
    if (event.source !== parent || event.data !== 'codex-html-connect' || !event.ports[0]) return;
    removeEventListener('message', connect);
    const port = event.ports[0];
    port.onmessage = ({ data }) => {
      if (typeof data.chunk !== 'string') return;
      if (data.chunk) document.write(data.chunk);
      if (data.complete) document.close();
    };
  });
  parent.postMessage('codex-html-ready', '*');
}, { once: true });
</script></body></html>`
