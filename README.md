# AI Tab Transcriber

A Chrome extension that captures audio from any tab (such as a Google Meet) and transcribes it in real-time using the Deepgram API directly from the browser. It supports speaker diarization (distinguishing different speakers) and allows you to rename them. You can also chat with a Gemini-powered AI about your transcript.

## Requirements

1. A **Deepgram API Key** (Get one for free at [deepgram.com](https://deepgram.com/)).
2. A **Google Gemini API Key** (Get one for free at [Google AI Studio](https://aistudio.google.com/)).

---

## Step 1: Install the Chrome Extension

1. Open Google Chrome.
2. Type `chrome://extensions/` in the URL bar and press Enter.
3. Turn on **Developer mode** (the toggle switch in the top right corner).
4. Click the **Load unpacked** button in the top left.
5. In the file explorer, select the folder that contains the `manifest.json` file. 

---

## Step 2: Configure the Extension

1. Click the puzzle piece icon (🧩) in the top right of Chrome and **pin** the AI Tab Transcriber extension to your toolbar.
2. Click the new extension icon to open its popup.
3. Click the **Settings (Gear Icon)** in the top right of the popup.
4. Enter your **Deepgram API Key** and **Gemini API Key**, and click **Save**.

---

## Step 3: How to Use It

1. Open a Google Meet or any tab that has audio playing.
2. Click the extension icon and click **Start Listening**.
3. Chrome will ask for permission to use your **microphone**. Click **Allow**. *(This is required so the extension can record your own voice along with the meeting participants!)*
4. Chrome will ask which tab you want to share audio from. **Select the tab** with your meeting, check **Share tab audio** at the bottom, and click **Share**.
5. As people speak, the transcription will appear in the extension. 

### Labeling Speakers with Names
Because the extension only gets one mixed audio stream, Deepgram automatically separates the voices into `Speaker 0:`, `Speaker 1:`, etc.

**To label them with real names:**
Simply **click** on the text `Speaker 0:` anywhere in the live transcript. A box will appear asking you to type their real name (e.g., "John"). From then on, all text from that speaker will automatically say **John:**!

### AI Chat feature
After capturing a transcript, you can click on the Chat tab to talk with Gemini about the contents of the transcript. You can ask for a summary, action items, or direct questions about the recorded conversation.
