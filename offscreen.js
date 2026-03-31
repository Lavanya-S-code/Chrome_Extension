// offscreen.js
// Runs in the offscreen document.
// Receives a tabCapture stream ID, opens getUserMedia with it,
// then streams raw binary audio directly to the Python backend WebSocket.

let mediaRecorder = null;
let backendWs = null;
let activeStream = null;

chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target !== 'offscreen') return;

    if (msg.type === 'start-capture') {
        startCapture(msg.streamId, msg.apiKey);
    }
    if (msg.type === 'stop-capture') {
        stopCapture();
    }
});

async function startCapture(streamId, apiKey) {
    try {
        // Use the tabCapture stream ID to get actual MediaStream in this doc context
        activeStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                mandatory: {
                    chromeMediaSource: 'tab',
                    chromeMediaSourceId: streamId
                }
            },
            video: false
        });

        const audioTracks = activeStream.getAudioTracks();
        if (audioTracks.length === 0) {
            chrome.runtime.sendMessage({ type: 'offscreen-error', error: 'No audio tracks in captured stream.' });
            return;
        }

        console.log('[offscreen] Audio tracks:', audioTracks.length, audioTracks[0].label);

        // ── Get Microphone Stream (User's Voice) ─────────────────────────────
        let micStream;
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            console.warn('[offscreen] Could not get microphone:', err);
            // We just continue without mic if permission is denied
        }

        // ── Audio Mixing ─────────────────────────────────────────────────────
        const audioCtx = new AudioContext();
        const recordingDest = audioCtx.createMediaStreamDestination();

        // 1. Tab Audio (Remote Participants)
        const tabSource = audioCtx.createMediaStreamSource(activeStream);

        // Route tab audio to speakers so user can hear the meeting
        tabSource.connect(audioCtx.destination);

        // Route tab audio to the recording destination
        tabSource.connect(recordingDest);

        // 2. Microphone Audio (User's Voice)
        let micSource = null;
        if (micStream) {
            micSource = audioCtx.createMediaStreamSource(micStream);
            // Route mic to the recording destination
            micSource.connect(recordingDest);
            // NOT routing mic to speakers to avoid echo/feedback
        }

        // The final combined stream for Deepgram
        const recordingStream = recordingDest.stream;
        // Keep mic stream around to stop it later
        window._micStream = micStream;
        // ─────────────────────────────────────────────────────────────────────

        // Connect directly to Deepgram WebSocket API
        const deepgramUrl = 'wss://api.deepgram.com/v1/listen?model=nova-2&language=en&interim_results=true&endpointing=300&punctuate=true&smart_format=true&diarize=true';
        
        // Browsers don't support custom headers, but Deepgram supports passing the token
        // as a subprotocol array like this: ['token', 'YOUR_API_KEY']
        backendWs = new WebSocket(deepgramUrl, ['token', apiKey]);
        backendWs.binaryType = 'arraybuffer';

        backendWs.onopen = () => {
            chrome.runtime.sendMessage({ type: 'ws-status', status: 'connected' });
            console.log('[offscreen] Connected directly to Deepgram WebSocket');

            // Pick best supported mimeType
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            mediaRecorder = new MediaRecorder(recordingStream, { mimeType });
            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0 && backendWs.readyState === WebSocket.OPEN) {
                    e.data.arrayBuffer().then(buf => backendWs.send(buf));
                }
            };
            mediaRecorder.onerror = (e) => console.error('[offscreen] MediaRecorder error:', e);
            mediaRecorder.start(250);

            // Detect when user stops the stream
            activeStream.getTracks().forEach(track => {
                track.onended = () => {
                    chrome.runtime.sendMessage({ type: 'stream-ended' });
                    stopCapture();
                };
            });
        };

        backendWs.onmessage = (e) => {
            // Forward Deepgram transcription JSON back to the service worker
            chrome.runtime.sendMessage({ type: 'deepgram-response', data: e.data });
        };

        backendWs.onerror = (e) => {
            console.error('[offscreen] WS error', e);
            chrome.runtime.sendMessage({
                type: 'ws-status',
                status: 'error',
                message: 'Cannot connect to Deepgram. Check your API key and internet connection.'
            });
        };

        backendWs.onclose = (e) => {
            console.log('[offscreen] WS closed', e.code, e.reason);
            chrome.runtime.sendMessage({ type: 'ws-status', status: 'closed' });
        };

    } catch (err) {
        console.error('[offscreen] startCapture error:', err);
        chrome.runtime.sendMessage({ type: 'offscreen-error', error: err.message });
    }
}

function stopCapture() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (_) { }
    }
    mediaRecorder = null;

    if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
        activeStream = null;
    }

    if (window._micStream) {
        window._micStream.getTracks().forEach(t => t.stop());
        window._micStream = null;
    }

    if (backendWs) {
        try { backendWs.close(); } catch (_) { }
        backendWs = null;
    }
}
