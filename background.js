const DEFAULT_SETTINGS = {
  backend: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  llamacppBaseUrl: "http://localhost:8080",
  llamacppModel: "",
  temperature: 0.2,
  maxTokens: 512,
  // TTS settings
  ttsVoiceName: "",
  ttsRate: 1,
  ttsPitch: 1
};

function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS).then((items) => {
    return Object.assign({}, DEFAULT_SETTINGS, items);
  });
}

function detectLanguage(text) {
  if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text)) {
    return "zh";
  }
  return "en";
}

const LANG_NAMES = { zh: "中文", en: "英文" };

function buildSystemPrompt(target) {
  return (
    "你是一名专业翻译。请将用户提供的文本翻译成" +
    LANG_NAMES[target] +
    "。" +
    "只输出翻译结果，不要添加任何解释、注释、引号或标点说明。保持原有语气和格式。"
  );
}

function buildDefinitionPrompt() {
  return (
    "你是一名专业词典编辑。用户将提供一个单词或短语，请你：\n" +
    "1) 标注词性（如 n., v., adj.）\n" +
    "2) 提供简明的中文释义（针对英语单词），或英文释义（针对中文词）\n" +
    "3) 给出两个常见例句，并为每个例句提供中文翻译。\n" +
    "只输出内容，不添加其他说明，尽量使用清晰可读的分段格式。"
  );
}

async function callOllama(settings, systemPrompt, userText) {
  const url = settings.ollamaBaseUrl.replace(/\/+$/, "") + "/api/chat";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.ollamaModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      stream: false,
      options: {
        temperature: Number(settings.temperature) || 0.2,
        num_predict: Number(settings.maxTokens) || 512
      }
    })
  });
  if (!res.ok) {
    throw new Error("Ollama 请求失败：" + res.status + " " + (await res.text()));
  }
  const data = await res.json();
  const content = data && data.message && data.message.content;
  if (!content) {
    throw new Error("Ollama 返回内容为空，请检查模型是否正确。");
  }
  return content.trim();
}

function cleanOutput(content) {
  let s = String(content).trim();
  const pairs = [
    ['"', '"'],
    ["'", "'"],
    ["\u201C", "\u201D"],
    ["\u2018", "\u2019"]
  ];
  for (const pair of pairs) {
    if (s.length >= 2 && s[0] === pair[0] && s[s.length - 1] === pair[1]) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}

async function callLlamacpp(settings, systemPrompt, userText) {
  const url = settings.llamacppBaseUrl.replace(/\/+$/, "") + "/v1/chat/completions";
  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText }
    ],
    temperature: Number(settings.temperature) || 0.2,
    max_tokens: Number(settings.maxTokens) || 512,
    stream: false
  };
  if (settings.llamacppModel) {
    body.model = settings.llamacppModel;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error("llama.cpp 请求失败：" + res.status + " " + (await res.text()));
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message &&
    data.choices[0].message.content;
  if (!content) {
    throw new Error("llama.cpp 返回内容为空，请检查模型是否正确。");
  }
  return cleanOutput(content);
}

async function translate(text, settings) {
  const source = detectLanguage(text);
  const target = source === "zh" ? "en" : "zh";
  const systemPrompt = buildSystemPrompt(target);
  let translated;
  if (settings.backend === "llamacpp") {
    translated = await callLlamacpp(settings, systemPrompt, text);
  } else {
    translated = await callOllama(settings, systemPrompt, text);
  }
  const actualTarget = detectLanguage(translated);
  return { translated, source, target: actualTarget };
}

async function testConnection(settings) {
  if (settings.backend === "llamacpp") {
    const url = settings.llamacppBaseUrl.replace(/\/+$/, "") + "/v1/models";
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }
    const data = await res.json();
    const models = (data.data || []).map((m) => m.id).filter(Boolean);
    return { models };
  }
  const url = settings.ollamaBaseUrl.replace(/\/+$/, "") + "/api/tags";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }
  const data = await res.json();
  const models = (data.models || []).map((m) => m.name).filter(Boolean);
  return { models };
}

function ttsGetVoices() {
  return new Promise((resolve) => {
    if (!chrome.tts || typeof chrome.tts.getVoices !== "function") {
      resolve([]);
      return;
    }
    chrome.tts.getVoices((voices) => {
      resolve(voices || []);
    });
  });
}

function ttsSpeak(text, options) {
  return new Promise((resolve) => {
    if (!chrome.tts || typeof chrome.tts.speak !== "function") {
      resolve({ ok: false, error: "浏览器不支持 chrome.tts" });
      return;
    }
    chrome.tts.speak(text, options, () => {
      resolve(!!chrome.runtime.lastError
        ? { ok: false, error: chrome.runtime.lastError.message }
        : { ok: true });
    });
  });
}

function ttsStop() {
  try {
    if (chrome.tts && typeof chrome.tts.stop === "function") chrome.tts.stop();
  } catch (e) {
    // ignore
  }
}

function ttsPickVoice(voices, lang, ttsSettings) {
  const norm = (l) => String(l).replace("_", "-").toLowerCase();
  const langMatches = (v) => {
    if (!v.lang) return false;
    const l = norm(v.lang);
    const base = norm(lang).split("-")[0];
    return l === norm(lang) || l.split("-")[0] === base;
  };
  const qualityHints = ["supertonic", "neural", "wavenet", "google", "microsoft", "neural-speech", "samantha", "alloy"];
  const isQuality = (v) => {
    const n = String(v.voiceName || "").toLowerCase();
    return qualityHints.some((h) => n.includes(h));
  };
  // 1) user-selected voice by exact name
  if (ttsSettings && ttsSettings.ttsVoiceName) {
    const byName = voices.find((v) => v.voiceName === ttsSettings.ttsVoiceName);
    if (byName) return byName;
  }
  // 2) prefer high-quality / neural voices, but ONLY if they speak the requested language,
  //    so that (e.g.) an English word is not pronounced by a Chinese voice.
  const findQualityLang = voices.find((v) => isQuality(v) && langMatches(v));
  if (findQualityLang) return findQualityLang;
  // 3) fallback to any voice of the requested language
  const langVoice = voices.find((v) => norm(v.lang) === norm(lang)) ||
    voices.find((v) => norm(v.lang).split("-")[0] === norm(lang).split("-")[0]);
  if (langVoice) return langVoice;
  // 4) last resort: any quality voice (language-agnostic)
  const findQuality = voices.find(isQuality);
  if (findQuality) return findQuality;
  return null;
}

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case "GET_SETTINGS":
        sendResponse(await getSettings());
        break;
      case "TRANSLATE":
        {
          const settings = await getSettings();
          const result = await translate(String(msg.text), settings);
          sendResponse({ ok: true, text: result.translated, source: result.source, target: result.target });
        }
        break;
      case "DEFINE":
        {
          const settings = await getSettings();
          const word = String(msg.word || "");
          const systemPrompt = buildDefinitionPrompt();
          try {
            let def;
            if (settings.backend === "llamacpp") {
              def = await callLlamacpp(settings, systemPrompt, word);
            } else {
              def = await callOllama(settings, systemPrompt, word);
            }
            sendResponse({ ok: true, text: def });
          } catch (err) {
            sendResponse({ ok: false, error: (err && err.message) || String(err) });
          }
        }
        break;
      case "TEST_CONNECTION":
        {
          const settings = await getSettings();
          const result = await testConnection(settings);
          sendResponse({ ok: true, models: result.models });
        }
        break;
      case "TTS_GET_VOICES":
        {
          const voices = await ttsGetVoices();
          sendResponse({
            ok: true,
            voices: voices.map((v) => ({ voiceName: v.voiceName, lang: v.lang || "" }))
          });
        }
        break;
      case "TTS_SPEAK":
        {
          const settings = await getSettings();
          const voices = await ttsGetVoices();
          const lang = String(msg.lang || "en-US");
          const voice = ttsPickVoice(voices, lang, settings);
          const tabId = sender && sender.tab ? sender.tab.id : null;
          const textKey = String(msg.text || "");
          const options = {
            lang: lang,
            rate: Number(msg.rate != null ? msg.rate : settings.ttsRate) || 1,
            pitch: Number(msg.pitch != null ? msg.pitch : settings.ttsPitch) || 1,
            onEvent: function (event) {
              if (event && (event.type === "end" || event.type === "interrupted" || event.type === "cancelled" || event.type === "error")) {
                if (tabId != null && textKey) {
                  try {
                    chrome.tabs.sendMessage(tabId, { type: "TTS_END", text: textKey }, function () {
                      if (chrome.runtime.lastError) { /* 接收方可能已存在或无监听，忽略 */ }
                    });
                  } catch (e) {
                    // ignore
                  }
                }
              }
            }
          };
          if (voice) options.voiceName = voice.voiceName;
          const res = await ttsSpeak(String(textKey || ""), options);
          sendResponse(res);
        }
        break;
      case "TTS_STOP":
        ttsStop();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "未知消息类型" });
    }
  })().catch((err) => {
    console.error("[划线翻译] 后台错误:", err);
    sendResponse({ ok: false, error: (err && err.message) || String(err) });
  });
  return true;
});
