const DEFAULT_SETTINGS = {
  backend: "ollama",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  llamacppBaseUrl: "http://localhost:8080",
  llamacppModel: "",
  temperature: 0.2,
  maxTokens: 512,
  // UI settings
  showPageBtn: true,
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
    let done = false;
    const finish = (voices) => {
      if (done) return;
      done = true;
      resolve(voices || []);
    };
    const tryGet = (tries) => {
      try {
        chrome.tts.getVoices((voices) => {
          if (voices && voices.length) {
            finish(voices);
          } else if (tries >= 15) {
            finish([]);
          } else {
            // service worker 冷启动后首次 getVoices 常返回空列表（语音还在异步加载）。
            // 此时直接朗读会用不上用户配置的语音，听起来像“发音不正常”。
            setTimeout(() => tryGet(tries + 1), 60);
          }
        });
      } catch (e) {
        finish([]);
      }
    };
    tryGet(0);
  });
}

const ttsWarmups = new Map();

// 用一段静音占位（volume 为 0）让语音引擎完成首次初始化。chrome.tts 在
// service worker 冷启动后的第一次朗读经常吞音、只读半截或音色异常，
// 预热后再朗读可以规避。等占位自然结束（或超时）再放行，避免在途替换。
function primeTtsEngine(options) {
  return new Promise((resolve) => {
    if (!chrome.tts || typeof chrome.tts.speak !== "function") {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const warmOptions = {
      volume: 0,
      rate: 2,
      enqueue: false,
      onEvent: function (event) {
        if (done || !event) return;
        if (event.type === "end" || event.type === "error" ||
          event.type === "interrupted" || event.type === "cancelled") {
          finish();
        }
      }
    };
    // 用与真正朗读相同的语音/语言预热，避免预热的是另一个引擎
    if (options && options.lang) warmOptions.lang = options.lang;
    if (options && options.voiceName) warmOptions.voiceName = options.voiceName;
    try {
      // 不传回调：回调会在真正发声之前就返回，无法代表预热完成。
      // 只等占位读完（end）或超时，确保引擎与声道已就绪。
      chrome.tts.speak("1", warmOptions);
    } catch (e) {
      finish();
      return;
    }
    setTimeout(finish, 700);
  });
}

function ensureTtsEngineWarmed(options) {
  const key = ((options && options.voiceName) || "") + "|" + ((options && options.lang) || "");
  let warmup = ttsWarmups.get(key);
  if (!warmup) {
    warmup = primeTtsEngine(options).then(function () {
      // 预热结束后稍等片刻，让引擎把发音通道准备好
      return new Promise(function (r) { setTimeout(r, 120); });
    });
    ttsWarmups.set(key, warmup);
  }
  return warmup;
}

function ttsIsSpeaking() {
  return new Promise((resolve) => {
    if (!chrome.tts || typeof chrome.tts.isSpeaking !== "function") {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    try {
      const maybePromise = chrome.tts.isSpeaking((speaking) => finish(!!speaking));
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then((value) => finish(!!value), () => finish(null));
      }
    } catch (e) {
      finish(null);
    }
    // 老版本 Chrome 只支持回调；长时间不回调时不要卡住重试流程
    setTimeout(() => finish(null), 300);
  });
}

function ttsSpeak(text, options, isCurrentRequest) {
  return new Promise((resolve) => {
    if (!chrome.tts || typeof chrome.tts.speak !== "function") {
      resolve({ ok: false, error: "浏览器不支持 chrome.tts" });
      return;
    }

    const MAX_ATTEMPTS = 3;
    let settled = false;
    let activeAttempt = 0;
    let endNotified = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    // 无论正常读完、被中断还是重试耗尽，调用方只应收到一次结束通知
    const notifyTerminal = (event) => {
      if (endNotified) return;
      endNotified = true;
      if (options.onEvent) options.onEvent(event);
    };

    const runAttempt = (attemptNo) => {
      if (!isCurrentRequest()) {
        finish({ ok: false, cancelled: true });
        return;
      }
      activeAttempt = attemptNo;
      const attemptOptions = Object.assign({}, options);
      // 第一次尝试使用用户配置的语音，之后退回浏览器为该语言选择的默认语音
      if (attemptNo > 1) delete attemptOptions.voiceName;

      let attemptOver = false;
      let started = false;
      let watchdog = null;
      let spokeDetected = false;
      let probeTimer = null;

      const endAttempt = (ok, errorMessage) => {
        if (attemptOver) return;
        attemptOver = true;
        if (watchdog) {
          clearTimeout(watchdog);
          watchdog = null;
        }
        if (probeTimer) {
          clearInterval(probeTimer);
          probeTimer = null;
        }
        if (ok) {
          finish({ ok: true });
          return;
        }
        if (!isCurrentRequest()) {
          finish({ ok: false, cancelled: true });
          return;
        }
        if (attemptNo < MAX_ATTEMPTS) {
          // 先彻底停掉这次失败的朗读，等引擎复位后再试（逐次拉长等待时间），
          // 否则残留的 stop / 未结束的朗读会把下一次朗读继续吞掉。
          try {
            if (chrome.tts && typeof chrome.tts.stop === "function") chrome.tts.stop();
          } catch (e) {
            // ignore
          }
          setTimeout(() => runAttempt(attemptNo + 1), 250 + attemptNo * 150);
          return;
        }
        console.error("[划线翻译] 语音引擎朗读失败:", errorMessage || "未知错误");
        notifyTerminal({ type: "error", errorMessage });
        finish({ ok: false, error: errorMessage || "朗读引擎出错" });
      };

      // 少数语音引擎不派发任何事件。此时靠 isSpeaking() 判断是否真的在发声，
      // 并在朗读结束后补发结束通知，避免调用方的按钮状态永远卡在“朗读中”。
      const pollEndWithoutEvents = () => {
        const deadline = Date.now() + 120000;
        const tick = () => {
          if (attemptNo !== activeAttempt || !isCurrentRequest()) return;
          ttsIsSpeaking().then((speaking) => {
            if (attemptNo !== activeAttempt || !isCurrentRequest()) return;
            if (speaking === false) {
              notifyTerminal({ type: "end" });
              return;
            }
            if (Date.now() > deadline) return;
            setTimeout(tick, 250);
          });
        };
        setTimeout(tick, 250);
      };

      attemptOptions.onEvent = function (event) {
        // 忽略已被后续尝试取代的旧尝试事件，避免误发 TTS_END
        if (!event || attemptNo !== activeAttempt || !isCurrentRequest()) return;
        if (event.type === "start") {
          started = true;
          endAttempt(true);
          return;
        }
        if (event.type === "error") {
          if (attemptOver) {
            // 已经开始朗读后中途出错：通知调用方复位，不再重试
            notifyTerminal(event);
            return;
          }
          endAttempt(false, event.errorMessage || "语音引擎出错");
          return;
        }
        if (event.type === "end") {
          endAttempt(true);
          notifyTerminal(event);
          return;
        }
        if (event.type === "interrupted" || event.type === "cancelled") {
          if (!started) endAttempt(false, "朗读被中断");
          else notifyTerminal(event);
          return;
        }
        if (options.onEvent) options.onEvent(event);
      };

      // 引擎吞音时既没有事件也没有回调，必须靠超时判定失败并自动重试，
      // 否则第一次点击会毫无反应（且调用方状态一直卡住）。
      // 同时采样 isSpeaking()，用于识别“确实发声但不派发事件”的语音引擎。
      probeTimer = setInterval(() => {
        if (attemptOver) return;
        ttsIsSpeaking().then((speaking) => {
          if (speaking === true) spokeDetected = true;
        });
      }, 300);
      watchdog = setTimeout(() => {
        if (attemptOver) return;
        if (!isCurrentRequest()) {
          endAttempt(false, "已取消");
          return;
        }
        ttsIsSpeaking().then((speaking) => {
          if (attemptOver) return;
          if (speaking === true) {
            // 确实在发声，只是该语音不派发事件：视为成功，并等待真正读完
            endAttempt(true);
            pollEndWithoutEvents();
            return;
          }
          if (spokeDetected) {
            // 曾采样到正在发声，说明已经读过（只是没有事件），补发结束通知
            endAttempt(true);
            notifyTerminal({ type: "end" });
            return;
          }
          endAttempt(false, "语音引擎无响应");
        });
      }, 1200);

      try {
        chrome.tts.speak(text, attemptOptions, function () {
          if (attemptNo !== activeAttempt) return;
          const error = chrome.runtime.lastError;
          // 这个回调在引擎真正发声之前就会返回，只能用来发现参数级错误，
          // 不能当作“朗读成功”的依据。是否真正开始朗读由 start/end 事件判定，
          // 没有事件时交给 watchdog 超时重试。旧实现把回调当作成功，导致
          // 第一次点击被引擎吞掉时既不重试也不恢复状态（第二次才正常）。
          if (error) endAttempt(false, error.message);
        });
      } catch (e) {
        endAttempt(false, (e && e.message) || String(e));
      }
    };

    runAttempt(1);
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
  if (ttsSettings && ttsSettings.ttsVoiceName) {
    const byName = voices.find((v) => v.voiceName === ttsSettings.ttsVoiceName && langMatches(v));
    if (byName) return byName;
  }
  // An unconfigured voice may belong to an intermittently available TTS
  // extension. Let Chrome choose the default voice for the requested language.
  return null;
}

let ttsRequestVersion = 0;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const requestVersion = msg && (msg.type === "TTS_SPEAK" || msg.type === "TTS_STOP")
    ? ++ttsRequestVersion
    : ttsRequestVersion;

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
          if (requestVersion !== ttsRequestVersion) {
            sendResponse({ ok: false, cancelled: true });
            break;
          }
          const voices = await ttsGetVoices();
          if (requestVersion !== ttsRequestVersion) {
            sendResponse({ ok: false, cancelled: true });
            break;
          }
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
                if (requestVersion !== ttsRequestVersion) return;
                if (tabId != null && textKey) {
                  try {
                    chrome.tabs.sendMessage(tabId, { type: "TTS_END", text: textKey }, function () {
                      if (chrome.runtime.lastError) { /* 接收方可能已存在或无监听，忽略 */ }
                    });
                  } catch (e) {
                    // ignore
                  }
                } else {
                  // 发送方是扩展页面（如 popup），通过运行时消息通知其恢复朗读状态
                  try {
                    chrome.runtime.sendMessage({ type: "TTS_END", text: textKey }, function () {
                      if (chrome.runtime.lastError) { /* 无接收方，忽略 */ }
                    });
                  } catch (e) {
                    // ignore
                  }
                }
              }
            }
          };
          if (voice) options.voiceName = voice.voiceName;
          // 首次朗读前先静音预热语音引擎，规避冷启动时吞音/半截/音色异常
          await ensureTtsEngineWarmed(options);
          if (requestVersion !== ttsRequestVersion) {
            sendResponse({ ok: false, cancelled: true });
            break;
          }
          const res = await ttsSpeak(
            String(textKey || ""),
            options,
            () => requestVersion === ttsRequestVersion
          );
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
