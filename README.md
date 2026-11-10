# Chrome Translator Extension

A lightweight Chrome extension for translating selected text between English and Chinese. It supports local model backends (Ollama or llama.cpp), text-to-speech playback, and single-word dictionary-style definitions with example sentences.

## Features

- Translate selected text with a floating toolbar
- Supports English ↔ Chinese translation
- Translate the whole current page paragraph by paragraph, showing each paragraph's translation below the original
- Uses local Ollama or llama.cpp models for translation
- Reads original text and translated text aloud using browser TTS
- Shows detailed definitions and example sentences for single-word selections
- Configurable per-language TTS voices (English and Chinese separately), plus rate and pitch
- Optional local **Kokoro-82M** neural TTS over HTTP (OpenAI-compatible `/v1/audio/speech`)

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

- Choose a `朗读引擎`: `浏览器语音（系统 / chrome.tts）` uses Chrome's native TTS engine, while `本地 Kokoro-82M（HTTP TTS）` sends text to a local Kokoro-FastAPI server (see [Using local Kokoro-82M](#using-local-kokoro-82m-http-tts)).
- In the options page, pick an `英文朗读声音` and a `中文朗读声音`. The two languages are configured independently, so English text and Chinese translations never switch mid-sentence to a different timbre.
- Adjust `语速（rate）` and `音调（pitch）` for more natural playback.
- Click `保存设置` to store your preferences.
- Both dropdowns list voices available via Chrome's TTS engine (`chrome.tts`), including system voices and voices registered by third-party extensions. Premium/Enhanced voices are listed first.
- Leave a dropdown on `自动选择（推荐）` to let Chrome choose the best voice for that language.
- A configured voice is used only when it supports the text's language; otherwise, Chrome chooses a voice based on the requested language. The legacy single `ttsVoiceName` setting is still used as a fallback when the per-language setting is empty.
- Playback is verified by TTS `start`/`end` events (not by the `speak` callback, which returns before audio starts); when an utterance is swallowed or interrupted, the extension resets the engine and retries a bounded number of times.
- Retries keep your configured voice (a temporary timeout/interruption should not change the voice); built-in voices fall back to Chrome's language-based voice selection on an explicit engine error, while extension-provided voices keep the configured voice on errors and only fall back on the final attempt (their errors are usually transient, and switching would suddenly change the timbre).
- Each click on a speak button starts the requested text again; clicking it does not toggle playback off.

#### Using local Kokoro-82M (HTTP TTS)

The extension can send text to a locally running **Kokoro-FastAPI** server through its OpenAI-compatible `/v1/audio/speech` endpoint. Everything stays on your machine; no API key is needed.

1. Start Kokoro-FastAPI on its default port `8880`, e.g.:
   `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest`
2. Reload this extension in `chrome://extensions/` (it now requests the `offscreen` permission, which is used to play the audio).
3. In `朗读设置`, set `朗读引擎` to `本地 Kokoro-82M（HTTP TTS）`.
4. Keep `Kokoro 服务地址` as `http://localhost:8880` and click `测试 Kokoro 连接`; the voice suggestions are replaced with the list reported by your server.
5. Choose an English voice (default `af_heart`) and a Chinese voice (default `zf_xiaobei`), then save.

Notes:

- `语速（rate）` is sent as Kokoro's `speed` parameter. `音调（pitch）` only applies to browser voices.
- The background service worker downloads the audio, and an extension offscreen document plays it. This bypasses page CSP and mixed-content restrictions, so it works on any site.
- Long paragraphs are split into sentence-sized pieces (≤300 characters each), synthesized one piece at a time, and the next piece is prefetched while the current one plays. This keeps the first sound fast, avoids per-request length limits, and makes pauses between sentences shorter.
- While Kokoro audio is playing, the service worker pings an extension API every 15 seconds. Manifest V3 service workers are otherwise terminated after about 30 seconds of idle time, which used to stop long paragraphs halfway through.
- MP3 is the default because it keeps messages small. If your server has no `ffmpeg`, switch `音频格式` to `wav`.
- Stop and re-selection semantics are shared with browser voices: stopping interrupts Kokoro audio, and a new utterance cancels the previous one.
- If you change the port or use a remote host, update `Kokoro 服务地址`; the extension already has host access via `<all_urls>`.

#### Recommended: built-in system voices

Operating-system voices marked **Premium** or **Enhanced** are neural voices synthesized by the OS. They start in tens of milliseconds, need no host tab or model download in the browser, and are the most reliable option for single words and rapid re-selection:

- macOS: open `系统设置 → 辅助功能 → 朗读内容 → 系统语音 → 管理语音`, download voices such as `Serena (Premium)`, `Jamie (Premium)`, `Tom (Enhanced)`, `Evan (Enhanced)`, `Daniel (Enhanced)`, or the Chinese `Li-mu` / `Yu-shu` / `Tingting` voices, then restart Chrome. They will appear in the per-language dropdowns above.
- Windows: `设置 → 时间和语言 → 语音 → 添加语音`, and prefer the natural/neural voices offered there.

#### Using Supertonic voices (high-quality neural voices)

To be able to select high-quality Supertonic voices (e.g. `Supertonic M3`) in this extension:

1. Install the standalone **Supertonic Text-to-Speech Voices** Chrome extension:
   `https://chromewebstore.google.com/detail/supertonic-text-to-speech/mdoplmghlkjcnegkdhocjbjcncocbdhk`
2. Reload this extension in `chrome://extensions/`.
3. Open the options page — the downloaded Supertonic voices will now appear in the `英文朗读声音` / `中文朗读声音` dropdowns.

> **Note:** Supertonic voices downloaded inside the *Read Aloud* extension are stored privately within Read Aloud and are **not** exposed to other extensions. You must install the standalone Supertonic extension above for the voices to appear here.

Supertonic audio is synthesized and played by its own extension (it keeps a pinned host tab that loads a local neural model), so its reliability and pronunciation depend on that extension. This extension deliberately does **not** send a silent placeholder to extension-provided voices: doing so makes Supertonic synthesize and then cancel an extra utterance, which can clip or interrupt the real one. Instead it waits longer for extension voices to start (up to 8 s) and pauses longer between consecutive utterances. If Supertonic voices still occasionally drop, truncate, or mispronounce a word while built-in voices are stable, the remaining cause is inside Supertonic itself. Try these in order:

1. Open the Supertonic host tab (the pinned `supertonic.ttstool.com` tab) and use its **Test** form to read the same word. If it sounds the same there, it is the voice/model, not this extension.
2. Keep the host tab open and do not let Chrome discard it (`chrome://discards`), since synthesis runs there.
3. Adjust **Quality (inference steps)** in the host tab. The default is 5; the panel itself suggests lowering it if you hear speech gaps.
4. Update or reinstall the Supertonic extension, or switch to a built-in system voice — those are handled by Chrome's native TTS engine and are unaffected by this issue.

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

## How to install HTTP TTS Kokoro-82M
docker pull ghcr.io/remsky/kokoro-fastapi-cpu:latest

docker run -d \
--name kokoro-tts \
--restart unless-stopped \
-p 8880:8880 \
ghcr.io/remsky/kokoro-fastapi-cpu:latest

to test local TTS:  http://localhost:8880/web

## Notes

- The extension uses Chrome's TTS engine (`chrome.tts`) for voice playback; voice quality depends on your operating system, browser, and any installed TTS voices or extensions.
- To use high-quality neural voices, install the standalone **Supertonic Text-to-Speech Voices** extension and select the voice in the options page (see [Configure TTS](#2-configure-tts)).
- If audio playback interferes with other media, the extension will cancel speech synthesis when the panel closes.
- For best results, use models with strong translation capability.

## Project structure

- `background.js` — handles settings, translation requests, backend communication, and TTS dispatch (browser or local Kokoro HTTP)
- `content.js` — injects selection UI, displays translation panel, and manages TTS playback state
- `offscreen.html` / `offscreen.js` — plays Kokoro audio outside page CSP restrictions
- `options.html` / `options.js` — extension configuration UI
- `manifest.json` — Chrome extension manifest

## Troubleshooting

- If translation fails, confirm your backend service is running and reachable.
- If TTS voices do not appear, refresh the options page and wait for Chrome to load available voices. If you expect Supertonic voices, make sure the standalone **Supertonic Text-to-Speech Voices** extension is installed and reload this extension.
- If English and Chinese are read with an unexpected voice, check both the `英文朗读声音` and `中文朗读声音` dropdowns. Leaving one empty makes Chrome choose automatically; an old single-voice setting is only used as a fallback, and a voice whose language does not match is never forced.
- If definitions are missing for single words, ensure your backend model is available and supports the request.
- If Kokoro speech fails, click `测试 Kokoro 连接` in the options page. `无法连接 …` means the service is not reachable at that address (check the port and that Kokoro-FastAPI is running). After updating the extension, reload it in `chrome://extensions/` so the `offscreen` permission takes effect.
- If Kokoro returns an HTTP error while browser voices are fine, try switching `音频格式` to `wav` (the default MP3 path needs `ffmpeg` on the server) and confirm the voice name exists in the list returned by `测试 Kokoro 连接`.
- If a long Kokoro paragraph stops halfway, make sure the extension was reloaded after updating (the `offscreen` permission and the keep-alive logic live in `background.js`/`offscreen.js`). Long text is now split into short pieces and the service worker is kept alive during playback, so the whole paragraph should finish and the button should return to `朗读原文`.
- If a Supertonic (third-party) voice occasionally drops, truncates, or mispronounces a word while built-in voices are stable, the problem is inside the Supertonic extension or its neural model (audio is synthesized and played by that extension). This extension already gives extension voices a longer startup timeout and a longer pause between utterances, and avoids sending them silent placeholder utterances. To narrow it down, read the **same word** in the pinned Supertonic host tab's **Test** form: if it sounds wrong there too, it is the voice/model; try adjusting **Quality (inference steps)**, keeping the host tab alive, updating/reinstalling Supertonic, or using a built-in system voice.
