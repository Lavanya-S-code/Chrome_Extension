// options.js
// Handles saving and loading Deepgram and Gemini API keys

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const geminiKeyInput = document.getElementById('geminiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');

  // Load existing API keys
  chrome.storage.sync.get(['deepgramApiKey', 'geminiApiKey'], (data) => {
    if (data.deepgramApiKey) {
      apiKeyInput.value = data.deepgramApiKey;
    }
    if (data.geminiApiKey) {
      geminiKeyInput.value = data.geminiApiKey;
    }
  });

  saveBtn.onclick = () => {
    const deepgramKey = apiKeyInput.value.trim();
    const geminiKey = geminiKeyInput.value.trim();
    
    if (!deepgramKey || !geminiKey) {
      statusDiv.textContent = 'Please enter both API keys!';
      statusDiv.style.color = '#fca5a5';
      return;
    }
    
    const keysToSave = {};
    if (deepgramKey) keysToSave.deepgramApiKey = deepgramKey;
    if (geminiKey) keysToSave.geminiApiKey = geminiKey;
    
    chrome.storage.sync.set(keysToSave, () => {
      statusDiv.textContent = 'API keys saved!';
      statusDiv.style.color = '#22c55e';
      setTimeout(() => (statusDiv.textContent = ''), 2000);
    });
  };
});
