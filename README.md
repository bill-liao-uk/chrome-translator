# Chrome Translator Extension

A lightweight Chrome extension for translating selected text between English and Chinese. It supports local model backends (Ollama or llama.cpp), text-to-speech playback, and single-word dictionary-style definitions with example sentences.

## Features

- Translate selected text with a floating toolbar
- Supports English ↔ Chinese translation
- Uses local Ollama or llama.cpp models for translation
- Reads original text and translated text aloud using browser TTS
- Shows detailed definitions and example sentences for single-word selections
- Configurable TTS voice, rate, and pitch

## Installation

1. Open Chrome and go to `chrome://extensions/`.
2. Enable `Developer mode` in the top right.
3. Click `Load unpacked`.
4. Select the `chrome-translator` project folder.
5. Confirm the extension appears in the toolbar.

## Setup

### 1. Configure backend

- Open the extension's options page via the toolbar icon or `chrome://extensions/`, then click `Details` → `Extension options`.
- Choose either `Ollama` or `llama.cpp` as the backend.
- For `Ollama`, set the service address (default: `http://localhost:11434`) and model name (e.g. `qwen2.5:7b`).
- For `llama.cpp`, set the local server address (default: `http://localhost:8080`) and optional model name.

### 2. Configure TTS

- In the options page, select a voice from the `朗读声音` dropdown.
- Adjust `语速（rate）` and `音调（pitch）` for more natural playback.
- Click `保存设置` to store your preferences.

### 3. Test connection

- Click `测试连接` in the options page.
- The extension will verify the selected backend and display available models.

## Usage

1. Highlight some text on any webpage.
2. Click the floating `译` button.
3. The panel will show:
   - original text
   - translation
   - buttons for reading source and target text aloud
4. If the selection is a single word, the panel will also show a detailed definition with example sentences.

## Notes

- The extension uses browser speech synthesis for voice playback; voice quality depends on your operating system and browser.
- If audio playback interferes with other media, the extension will cancel speech synthesis when the panel closes.
- For best results, use models with strong translation capability.

## Project structure

- `background.js` — handles settings, translation requests, and backend communication
- `content.js` — injects selection UI, displays translation panel, and manages TTS playback
- `options.html` / `options.js` — extension configuration UI
- `manifest.json` — Chrome extension manifest

## Troubleshooting

- If translation fails, confirm your backend service is running and reachable.
- If TTS voices do not appear, refresh the options page and wait for your browser to load available voices.
- If definitions are missing for single words, ensure your backend model is available and supports the request.
