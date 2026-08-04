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
  return content.trim();
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
  return { translated, source, target };
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
      case "TEST_CONNECTION":
        {
          const settings = await getSettings();
          const result = await testConnection(settings);
          sendResponse({ ok: true, models: result.models });
        }
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
