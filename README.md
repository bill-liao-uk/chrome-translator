# Chrome Translator Extension

A lightweight Chrome extension for translating selected text between English and Chinese. It supports local model backends (Ollama or llama.cpp), text-to-speech playback, and single-word dictionary-style definitions with example sentences.

## Features

- Translate selected text with a floating toolbar
- Supports English ↔ Chinese translation
- Translate the whole current page paragraph by paragraph, showing each paragraph's translation below the original
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
- The dropdown lists all voices available via Chrome's TTS engine (`chrome.tts`), including browser system voices and voices registered by third-party extensions.

#### Using Supertonic voices (high-quality neural voices)

To be able to select high-quality Supertonic voices (e.g. `Supertonic M3`) in this extension:

1. Install the standalone **Supertonic Text-to-Speech Voices** Chrome extension:
   `https://chromewebstore.google.com/detail/supertonic-text-to-speech/mdoplmghlkjcnegkdhocjbjcncocbdhk`
2. Reload this extension in `chrome://extensions/`.
3. Open the options page — the downloaded Supertonic voices will now appear in the `朗读声音` dropdown.

> **Note:** Supertonic voices downloaded inside the *Read Aloud* extension are stored privately within Read Aloud and are **not** exposed to other extensions. You must install the standalone Supertonic extension above for the voices to appear here.

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

### Translate the whole page

1. Click the floating `对照翻译` button (top-right corner of the page).
2. The extension collects the page's paragraphs and inserts a translation block below each one, translating a few paragraphs at a time.
3. The button shows progress (e.g. `退出对照（12/40）`).
4. Click the button again (or the `重试` button on a failed paragraph) to stop/retry. Stopping removes all injected translations.

## Notes

- The extension uses Chrome's TTS engine (`chrome.tts`) for voice playback; voice quality depends on your operating system, browser, and any installed TTS voices or extensions.
- To use high-quality neural voices, install the standalone **Supertonic Text-to-Speech Voices** extension and select the voice in the options page (see [Configure TTS](#2-configure-tts)).
- If audio playback interferes with other media, the extension will cancel speech synthesis when the panel closes.
- For best results, use models with strong translation capability.

## Project structure

- `background.js` — handles settings, translation requests, and backend communication
- `content.js` — injects selection UI, displays translation panel, and manages TTS playback
- `options.html` / `options.js` — extension configuration UI
- `manifest.json` — Chrome extension manifest

## Troubleshooting

- If translation fails, confirm your backend service is running and reachable.
- If TTS voices do not appear, refresh the options page and wait for Chrome to load available voices. If you expect Supertonic voices, make sure the standalone **Supertonic Text-to-Speech Voices** extension is installed and reload this extension.
- If definitions are missing for single words, ensure your backend model is available and supports the request.
