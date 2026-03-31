// content.js
// Captures tab audio and streams binary chunks directly to Python backend WebSocket.
// This avoids the Base64 serialization bottleneck in Chrome's service worker messaging.

let stream = null;
let mediaRecorder = null;
let backendWs = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── START CAPTURE ──────────────────────────────────────────────────────────
  if (msg.type === 'capture-audio') {
    const apiKey = msg.apiKey;
    const backendUrl = `ws://127.0.0.1:8000/listen?api_key=${encodeURIComponent(apiKey)}`;

    navigator.mediaDevices.getDisplayMedia({
      video: true,   // Chrome requires video:true to show the tab picker
      audio: true
    }).then(_stream => {
      stream = _stream;

      // Verify the user checked "Share tab audio"
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach(t => t.stop());
        sendResponse({ success: false, error: 'No audio track found. Please check "Share tab audio" in the Chrome dialog.' });
        return;
      }

      // Drop video immediately – we only need audio
      stream.getVideoTracks().forEach(t => t.stop());

      // Open a WebSocket directly to the Python backend from the page context
      backendWs = new WebSocket(backendUrl);
      backendWs.binaryType = 'arraybuffer';

      backendWs.onopen = () => {
        chrome.runtime.sendMessage({ type: 'ws-status', status: 'connected' });

        // Start recording – send 250ms binary blobs straight to the backend
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0 && backendWs && backendWs.readyState === WebSocket.OPEN) {
            e.data.arrayBuffer().then(buf => backendWs.send(buf));
          }
        };
        mediaRecorder.start(250);
        window._mediaRecorder = mediaRecorder;

        // Detect when user clicks Chrome's native "Stop sharing" button
        stream.getTracks().forEach(t => {
          t.onended = () => {
            chrome.runtime.sendMessage({ type: 'stream-ended' });
            stopCapture();
          };
        });
      };

      backendWs.onmessage = (e) => {
        // Forward Deepgram JSON transcription responses to the background script
        chrome.runtime.sendMessage({ type: 'deepgram-response', data: e.data });
      };

      backendWs.onerror = (err) => {
        chrome.runtime.sendMessage({ type: 'ws-status', status: 'error', message: 'Backend WebSocket error. Is the Python server running?' });
      };

      backendWs.onclose = () => {
        chrome.runtime.sendMessage({ type: 'ws-status', status: 'closed' });
      };

      sendResponse({ success: true });

    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });

    return true; // keep the port open for async sendResponse
  }

  // ── STOP CAPTURE ──────────────────────────────────────────────────────────
  if (msg.type === 'stop-capture') {
    stopCapture();
    sendResponse({ success: true });
    return false;
  }
});

function stopCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  window._mediaRecorder = null;

  if (backendWs) {
    backendWs.close();
    backendWs = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}
