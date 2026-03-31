// main.js
// Background service worker — coordinator only.
// Receives stream ID from popup, passes to offscreen document which does all audio work.

let transcription = '';
let port = null;
let currentStatus = { text: '', connected: null, isError: false };
let isRecording = false;
let lastSpeaker = null;

function sendStatus(text, connected = null, isError = false) {
  console.log('[bg] Status:', text);
  currentStatus = { text, connected, isError };
  if (port) port.postMessage({ type: 'status', text, connected, isError });
}

function sendTranscription(text) {
  transcription += text;
  chrome.storage.local.set({ transcription });
  if (port) port.postMessage({ type: 'transcription', text: transcription });
}

// ── Offscreen document ─────────────────────────────────────────────────────
async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });
  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Capture tab audio and route it back for playback so the user can still hear it'
    });
  }
}

async function closeOffscreen() {
  try {
    const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existing.length > 0) await chrome.offscreen.closeDocument();
  } catch (_) { }
}

// ── Start / Stop ───────────────────────────────────────────────────────────
async function startRecording(apiKey, streamId) {
  if (isRecording) return;
  transcription = '';
  lastSpeaker = null;
  isRecording = true;

  sendStatus('Connecting to backend...', null, false);

  // Always close any existing offscreen doc first so the old tab stream is released
  await closeOffscreen();

  // Small delay to ensure Chrome has fully released the previous stream
  await new Promise(r => setTimeout(r, 500));

  await ensureOffscreen();

  // Small delay to let offscreen doc initialize
  await new Promise(r => setTimeout(r, 300));

  chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start-capture',
    streamId,
    apiKey
  });
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  sendStatus('Stopped.', false, false);
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-capture' });
  await closeOffscreen();
  if (port) port.postMessage({ type: 'stop' });
}

// ── Messages from offscreen.js ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ws-status') {
    if (msg.status === 'connected') {
      sendStatus('Connected to Deepgram. Listening...', true, false);
    } else if (msg.status === 'error') {
      sendStatus(msg.message || 'Backend error.', false, true);
      isRecording = false;
      if (port) port.postMessage({ type: 'stop' });
    } else if (msg.status === 'closed' && isRecording) {
      sendStatus('Connection closed unexpectedly.', false, true);
      isRecording = false;
      if (port) port.postMessage({ type: 'stop' });
    }
    return false;
  }

  if (msg.type === 'deepgram-response') {
    try {
      const r = JSON.parse(msg.data);
      if (r.type === 'Results' || r.channel) {
        const text = r.channel?.alternatives?.[0]?.transcript || '';
        const words = r.channel?.alternatives?.[0]?.words || [];

        let speakerId = null;
        if (words.length > 0 && typeof words[0].speaker !== 'undefined') {
          speakerId = words[0].speaker;
        }

        if (text) {
          if (r.is_final || r.speech_final) {
            let toAdd = '';
            if (speakerId !== null && speakerId !== lastSpeaker) {
              toAdd = (transcription.length > 0 ? '\n\n' : '') + `Speaker ${speakerId}: `;
              lastSpeaker = speakerId;
            } else if (transcription.length === 0 && speakerId !== null) {
              toAdd = `Speaker ${speakerId}: `;
              lastSpeaker = speakerId;
            }
            sendTranscription(toAdd + text + ' ');
            if (port) port.postMessage({ type: 'interim', text: '' });
          } else {
            let interimText = text;
            if (speakerId !== null && speakerId !== lastSpeaker) {
              interimText = `\n\nSpeaker ${speakerId}: ` + text;
            }
            if (port) port.postMessage({ type: 'interim', text: interimText });
          }
        }
      }
    } catch (e) { console.error('[bg] parse error:', e); }
    return false;
  }

  if (msg.type === 'stream-ended' && isRecording) {
    isRecording = false;
    sendStatus('Audio stream ended.', false, false);
    closeOffscreen();
    if (port) port.postMessage({ type: 'stop' });
    return false;
  }

  if (msg.type === 'offscreen-error') {
    sendStatus('Capture error: ' + msg.error, false, true);
    isRecording = false;
    if (port) port.postMessage({ type: 'stop' });
    return false;
  }

  return false;
});

// ── Popup port ─────────────────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((p) => {
  if (p.name !== 'transcription') return;
  port = p;

  if (currentStatus.text) port.postMessage({ type: 'status', ...currentStatus });
  port.postMessage({ type: 'transcription', text: transcription });
  port.postMessage({ type: 'recording-state', isRecording });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'start') {
      startRecording(msg.apiKey, msg.streamId);
    } else if (msg.type === 'stop') {
      stopRecording();
    }
  });

  port.onDisconnect.addListener(() => { port = null; });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ transcription: '' });
});