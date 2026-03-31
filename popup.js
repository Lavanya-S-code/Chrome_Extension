// popup.js
// Handles UI, button events, and messaging with background.
// Also initiates tabCapture directly (required to be called in user-gesture context).

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const transcriptionDiv = document.getElementById('transcription');
  const statusDiv = document.getElementById('statusText');
  const connDot = document.getElementById('connDot');

  let port = null;
  let lastTranscription = '';
  let interimTranscription = '';

  let speakerMap = {};
  chrome.storage.local.get(['speakerMap'], (data) => {
    if (data.speakerMap) speakerMap = data.speakerMap;
  });

  let geminiApiKey = '';
  chrome.storage.sync.get(['geminiApiKey'], (data) => {
    if (data.geminiApiKey) geminiApiKey = data.geminiApiKey;
  });

  // ── Rendering ─────────────────────────────────────────────────────────────
  function renderTranscription() {
    let safe = lastTranscription.replace(/</g, '&lt;').replace(/\n/g, '<br>');
    let safeInterim = interimTranscription.replace(/</g, '&lt;').replace(/\n/g, '<br>');

    // Make Speaker labels clickable
    safe = safe.replace(/Speaker (\d+):/g, (match, id) => {
      const name = speakerMap[id] || `Speaker ${id}`;
      return `<b class="speaker-label" data-speaker="${id}" style="color:#a855f7; cursor:pointer;" title="Click to edit name">${name}:</b>`;
    });
    safeInterim = safeInterim.replace(/Speaker (\d+):/g, (match, id) => {
      const name = speakerMap[id] || `Speaker ${id}`;
      return `<b style="color:#a855f7;">${name}:</b>`;
    });

    transcriptionDiv.innerHTML =
      `<span>${safe}</span><span style="color:#94a3b8;font-style:italic">${safeInterim}</span>`;
    transcriptionDiv.scrollTop = transcriptionDiv.scrollHeight;
  }

  transcriptionDiv.addEventListener('click', (e) => {
    if (e.target.classList.contains('speaker-label')) {
      const id = e.target.getAttribute('data-speaker');
      const currentName = speakerMap[id] || `Speaker ${id}`;
      const newName = prompt(`Enter real name for ${currentName}:`, currentName);
      if (newName && newName.trim()) {
        speakerMap[id] = newName.trim();
        chrome.storage.local.set({ speakerMap });
        renderTranscription();
      }
    }
  });

  function setStatus(text, connected = null, isError = false) {
    statusDiv.textContent = text;

    connDot.classList.remove('active', 'error');
    if (connected === true) connDot.classList.add('active');
    else if (connected === false) connDot.classList.add('error');

    const errorMsg = document.getElementById('errorMsg');
    if (errorMsg) {
      errorMsg.textContent = isError ? text : '';
      errorMsg.style.display = isError ? 'block' : 'none';
    }
  }

  function setTranscription(text) {
    lastTranscription = text;
    interimTranscription = '';
    renderTranscription();
  }

  function setInterim(text) {
    interimTranscription = text;
    renderTranscription();
  }

  function setButtons(isRecording) {
    startBtn.disabled = isRecording;
    stopBtn.disabled = !isRecording;
  }

  // ── Gemini API Integration ───────────────────────────────────────────────
  const summaryOutput = document.getElementById('summaryOutput');
  const summaryError = document.getElementById('summaryError');
  const generateSummaryBtn = document.getElementById('generateSummaryBtn');
  const sendPromptBtn = document.getElementById('sendPromptBtn');
  const geminiPrompt = document.getElementById('geminiPrompt');

  async function callGeminiAPI(prompt) {
    if (!geminiApiKey) {
      showSummaryError('No Gemini API key set. Click "API Settings" to add your key.');
      return;
    }

    try {
      summaryOutput.classList.remove('active');
      summaryError.classList.remove('active');
      summaryOutput.textContent = 'Generating...';
      summaryOutput.classList.add('active');

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }]
            }]
          })
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || `API Error: ${response.status}`);
      }

      const data = await response.json();
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response received.';

      summaryOutput.textContent = result;
      summaryError.classList.remove('active');
    } catch (err) {
      showSummaryError(`Error: ${err.message}`);
    }
  }

  function showSummaryError(message) {
    summaryError.textContent = message;
    summaryError.classList.add('active');
    summaryOutput.classList.remove('active');
  }

  generateSummaryBtn.onclick = () => {
    if (!lastTranscription.trim()) {
      showSummaryError('No transcription to summarize.');
      return;
    }
    const prompt = `Please provide a concise summary of the following meeting transcript:\n\n${lastTranscription}`;
    callGeminiAPI(prompt);
  };

  sendPromptBtn.onclick = () => {
    const prompt = geminiPrompt.value.trim();
    if (!prompt) {
      showSummaryError('Please enter a question.');
      return;
    }
    if (!lastTranscription.trim()) {
      showSummaryError('No transcription available. Start listening first.');
      return;
    }
    const fullPrompt = `Based on this meeting transcript:\n\n${lastTranscription}\n\nAnswer this question: ${prompt}`;
    callGeminiAPI(fullPrompt);
    geminiPrompt.value = '';
  };

  // ── Background port ───────────────────────────────────────────────────────
  function connectToBackground() {
    if (port) return;
    port = chrome.runtime.connect({ name: 'transcription' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'transcription') {
        setTranscription(msg.text);
      } else if (msg.type === 'interim') {
        setInterim(msg.text);
      } else if (msg.type === 'recording-state') {
        setButtons(msg.isRecording);
      } else if (msg.type === 'status') {
        setStatus(msg.text, msg.connected, msg.isError);
        const t = msg.text;
        if (t.includes('Listening') || t.includes('Connecting') || t.includes('Requesting')) {
          setButtons(true);
        } else if (t.includes('Stopped') || t.includes('ended') || t.includes('closed') || msg.isError) {
          setButtons(false);
        }
      } else if (msg.type === 'stop') {
        setButtons(false);
      }
    });

    port.onDisconnect.addListener(() => { port = null; });
  }

  // ── Start button ──────────────────────────────────────────────────────────
  startBtn.onclick = () => {
    setStatus('Starting…', null);
    setButtons(true);
    setTranscription('');
    connectToBackground();

    // Stop any previous capture first, so Chrome can release the old stream
    if (port) port.postMessage({ type: 'stop' });

    // Get API key first, then start capture
    chrome.storage.sync.get(['deepgramApiKey'], async (data) => {
      const apiKey = data.deepgramApiKey;
      if (!apiKey) {
        setStatus('No API key set. Click "API Settings" to add your Deepgram key.', false, true);
        setButtons(false);
        return;
      }

      try {
        // Ask for mic permission so the offscreen document can use it
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getTracks().forEach(t => t.stop()); // Stop immediately, we just needed permission
      } catch (err) {
        console.warn('Mic permission denied or error:', err);
      }

      // Wait for the old stream to be fully released before requesting a new one
      await new Promise(r => setTimeout(r, 600));

      // Use getMediaStreamId, which is the correct API to get a string ID
      // that can be passed to the offscreen document's getUserMedia.
      chrome.tabCapture.getMediaStreamId({ targetTabId: null }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          const err = chrome.runtime.lastError?.message || 'Tab capture failed';
          setStatus('Error: ' + err, false, true);
          setButtons(false);
          return;
        }

        // Pass stream ID and API key to background to hand off to offscreen doc
        port.postMessage({ type: 'start', apiKey, streamId });
      });
    });
  };

  // ── Stop button ───────────────────────────────────────────────────────────
  stopBtn.onclick = () => {
    setStatus('Stopping…', null);
    setButtons(false);
    if (port) port.postMessage({ type: 'stop' });
  };

  // ── Clear & Download ──────────────────────────────────────────────────────
  clearBtn.onclick = () => {
    setTranscription('');
    chrome.storage.local.set({ transcription: '' });
  };

  downloadBtn.onclick = () => {
    if (!lastTranscription.trim()) return;
    const blob = new Blob([lastTranscription], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcription.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── On popup open ─────────────────────────────────────────────────────────
  chrome.storage.local.get(['transcription'], (data) => {
    if (data.transcription) setTranscription(data.transcription);
  });

  connectToBackground();
});
