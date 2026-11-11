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
  // ttsVoiceName 是旧版单语音设置，仅作为按语言设置留空时的兜底
  ttsVoiceName: "",
  ttsVoiceNameEn: "",
  ttsVoiceNameZh: "",
  // browser: 使用 chrome.tts；kokoro: 调用本地 HTTP TTS（OpenAI 兼容接口）
  ttsEngine: "browser",
  kokoroBaseUrl: "http://localhost:8880",
  kokoroModel: "kokoro",
  kokoroFormat: "mp3",
  kokoroVoiceEn: "af_heart",
  kokoroVoiceZh: "zf_xiaobei",
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

function ttsGetVoices(isReady, maxTries) {
  const limit = maxTries || 20;
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
          const list = voices || [];
          // 语音列表可能已经返回，但用户配置的语音仍在异步加载中；
          // 此时过早朗读会退回默认语音，听起来像“发音不正常”。
          const ready = !!isReady && list.length > 0 && isReady(list);
          if (list.length > 0 && (ready || !isReady)) {
            finish(list);
          } else if (tries >= limit) {
            finish(list);
          } else {
            // service worker 冷启动后首次 getVoices 常返回空列表（语音还在异步加载）。
            setTimeout(() => tryGet(tries + 1), 80);
          }
        });
      } catch (e) {
        finish([]);
      }
    };
    tryGet(0);
  });
}

// 等待语音列表里出现用户配置的语音（若已配置），避免冷启动时退回到默认语音。
// 第三方语音扩展的语音偶尔会短暂从列表里消失：见过这个语音时稍等即可，
// 从未见过（冷启动/刚安装）时多等一会儿（约 2 秒）。
function ttsGetVoicesForSettings(ttsSettings, lang) {
  const wanted = ttsVoiceNameForLang(ttsSettings, lang);
  if (!wanted) return ttsGetVoices();
  const maxTries = ttsKnownVoices.has(wanted) ? 10 : 25;
  return ttsGetVoices(function (list) {
    return list.some(function (v) { return v.voiceName === wanted; });
  }, maxTries);
}

const ttsWarmups = new Map();
// 仍在进行中的预热。正式朗读必须等它们全部结束，
// 否则另一种语言/音色的预热占位会把刚开始的朗读打断（只读半截或首音丢失）。
const ttsPendingWarmups = new Set();
// 最近一次语音引擎活动的结束时间，用于保证两次朗读之间的最小间隔。
let ttsLastActiveAt = 0;

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
          ttsLastActiveAt = Date.now();
          finish();
        }
      }
    };
    // 用与真正朗读相同的语音/语言/语速/音调预热，避免预热的是一个
    // 完全不同的引擎配置，真正朗读时仍要重新初始化。
    if (options && options.lang) warmOptions.lang = options.lang;
    if (options && options.voiceName) warmOptions.voiceName = options.voiceName;
    if (options && options.rate) warmOptions.rate = options.rate;
    if (options && options.pitch) warmOptions.pitch = options.pitch;
    try {
      // 不传回调：回调会在真正发声之前就返回，无法代表预热完成。
      // 只等占位读完（end）或超时，确保引擎与声道已就绪。
      chrome.tts.speak("1", warmOptions);
    } catch (e) {
      finish();
      return;
    }
    // 语音引擎首次加载可能较慢，留足时间；超时后仍会继续真正朗读
    setTimeout(finish, 1200);
  });
}

function waitUntilTtsSilent(maxMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs;
    const tick = () => {
      ttsIsSpeaking().then((speaking) => {
        // null 表示浏览器未提供 isSpeaking，直接放行
        if (speaking === false || speaking === null || Date.now() >= deadline) {
          resolve();
          return;
        }
        setTimeout(tick, 120);
      });
    };
    tick();
  });
}

// 与上一次发声之间留出最小间隔。引擎报 end 之后仍可能在做内部收尾，
// 紧接着开始的新朗读容易被截断（只读半截、首音丢失）。
function waitForTtsSettle(minGapMs) {
  const waitMs = Math.max(0, (ttsLastActiveAt || 0) + minGapMs - Date.now());
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function waitForPendingWarmups() {
  if (!ttsPendingWarmups.size) return Promise.resolve();
  return Promise.all(Array.from(ttsPendingWarmups)).then(function () {});
}

function ensureTtsEngineWarmed(options, voiceIsExtension) {
  // 第三方语音扩展（Supertonic 等）有自己的固定宿主页和常驻合成器，
  // 静音占位反而会让它多合成一次、还可能取消正在进行的合成，
  // 因而这类语音完全交给扩展自己初始化，只靠放宽超时来等待。
  if (voiceIsExtension) return Promise.resolve();
  const key = ((options && options.voiceName) || "") + "|" + ((options && options.lang) || "");
  let warmup = ttsWarmups.get(key);
  if (!warmup) {
    warmup = primeTtsEngine(options)
      // 占位结束后引擎可能仍在收尾，等它真正静下来再朗读，
      // 否则紧接着的 speak 会打断收尾中的引擎，出现“只有半截音”。
      .then(() => waitUntilTtsSilent(800))
      .then(function () {
        return new Promise(function (r) { setTimeout(r, 250); });
      });
    ttsWarmups.set(key, warmup);
    ttsPendingWarmups.add(warmup);
    const unregister = function () { ttsPendingWarmups.delete(warmup); };
    warmup.then(unregister, unregister);
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

// chrome.tts.speak 会严格校验 options，出现任何未知属性都会直接报错而不朗读。
// 这里只保留官方支持的字段，避免内部标记/调试字段泄漏到 API 参数里。
const TTS_SPEAK_OPTION_KEYS = [
  "voiceName", "extensionId", "lang", "gender", "rate", "pitch", "volume",
  "enqueue", "requiredEventTypes", "desiredEventTypes", "onEvent"
];

function sanitizeTtsOptions(options) {
  const out = {};
  for (const key of TTS_SPEAK_OPTION_KEYS) {
    if (options && options[key] !== undefined) out[key] = options[key];
  }
  return out;
}

function ttsSpeak(text, options, isCurrentRequest, voiceIsExtension) {
  return new Promise((resolve) => {
    if (!chrome.tts || typeof chrome.tts.speak !== "function") {
      resolve({ ok: false, error: "浏览器不支持 chrome.tts" });
      return;
    }

    const MAX_ATTEMPTS = 3;
    let settled = false;
    let activeAttempt = 0;
    let endNotified = false;
    // 只有语音引擎明确报错时才改用默认语音；超时/中断重试仍保留用户选择的语音，
    // 否则用户会听到音色/口音突然改变，误以为“发音异常”。
    let forceDefaultVoice = false;
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
      const attemptOptions = sanitizeTtsOptions(options);
      // 保留用户配置的语音重试；仅在引擎明确报错或最后一次尝试时退回默认语音
      if (attemptNo >= MAX_ATTEMPTS || forceDefaultVoice) delete attemptOptions.voiceName;

      let attemptOver = false;
      let started = false;
      let startedAt = 0;
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
          console.warn("[划线翻译] 朗读未正常开始，准备第 " + (attemptNo + 1) + " 次尝试:", errorMessage || "未知原因");
          // 先彻底停掉这次失败的朗读，等引擎复位后再试（逐次拉长等待时间），
          // 否则残留的 stop / 未结束的朗读会把下一次朗读继续吞掉。
          // 第三方扩展语音的 stop 也要经宿主页处理，留更长的间隔避免 stop 抢在新朗读之后到达。
          try {
            if (chrome.tts && typeof chrome.tts.stop === "function") chrome.tts.stop();
          } catch (e) {
            // ignore
          }
          const retryDelay = voiceIsExtension ? 800 : 400 + attemptNo * 150;
          setTimeout(() => runAttempt(attemptNo + 1), retryDelay);
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
        if (event.type === "end" || event.type === "error" ||
          event.type === "interrupted" || event.type === "cancelled") {
          ttsLastActiveAt = Date.now();
        }
        if (event.type === "start") {
          started = true;
          startedAt = Date.now();
          endAttempt(true);
          return;
        }
        if (event.type === "error") {
          if (attemptOver) {
            // 已经开始朗读后中途出错：通知调用方复位，不再重试
            notifyTerminal(event);
            return;
          }
          // 语音本身不可用：后续尝试改用浏览器默认语音。
          // 第三方扩展语音的 error 多是“合成器尚未就绪”之类的临时状态，
          // 换默认语音会让音色突然改变，所以仍用原语音重试。
          if (!voiceIsExtension) forceDefaultVoice = true;
          endAttempt(false, event.errorMessage || "语音引擎出错");
          return;
        }
        if (event.type === "end") {
          // 诊断用：正常读完一个多字符文本不可能只用几十毫秒，
          // 出现这种时长说明引擎只读出了部分音节（便于用户反馈问题时排查）
          if (startedAt && text.length >= 3 && Date.now() - startedAt < 120) {
            console.warn("[划线翻译] 朗读时长异常短，可能只读出了部分音节:", text, (Date.now() - startedAt) + "ms");
          }
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
      }, 150);
      // 第三方扩展语音需要先唤醒宿主页、加载模型再合成，启动明显更慢，
      // 给足时间避免误判超时而重复朗读（重叠的朗读会互相取消、只读半截）。
      const watchdogMs = voiceIsExtension ? 8000 : 1800;
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
      }, watchdogMs);

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
  ttsLastActiveAt = Date.now();
  stopKokoroPlayback();
  try {
    if (chrome.tts && typeof chrome.tts.stop === "function") chrome.tts.stop();
  } catch (e) {
    // ignore
  }
}

// 朗读结束/中断通知：有 tabId 时发给内容脚本，否则发给扩展页面（popup）。
function sendTtsEnd(tabId, textKey) {
  if (tabId != null && textKey) {
    try {
      chrome.tabs.sendMessage(tabId, { type: "TTS_END", text: textKey }, function () {
        if (chrome.runtime.lastError) { /* 接收方可能已存在或无监听，忽略 */ }
      });
    } catch (e) {
      // ignore
    }
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: "TTS_END", text: textKey }, function () {
      if (chrome.runtime.lastError) { /* 无接收方，忽略 */ }
    });
  } catch (e) {
    // ignore
  }
}

// ---------- 本地 HTTP TTS（Kokoro-FastAPI，OpenAI 兼容接口） ----------

let kokoroAbort = null;        // 正在进行的合成请求
let kokoroPlaySeq = 0;         // 播放任务 id 序号
let kokoroCurrentFinish = null; // 当前播放任务的结束回调（stop 时立即释放等待）
let offscreenAlive = false;
let offscreenCreating = null;

function kokoroBaseUrl(settings) {
  return String((settings && settings.kokoroBaseUrl) || "http://localhost:8880")
    .trim().replace(/\/+$/, "");
}

function kokoroVoiceForLang(settings, lang) {
  const code = String(lang || "").replace("_", "-").toLowerCase().split("-")[0];
  if (code === "zh") return (settings && settings.kokoroVoiceZh) || "zf_xiaobei";
  return (settings && settings.kokoroVoiceEn) || "af_heart";
}

// 音频需要由扩展自己的页面播放：service worker 不能直接出声，
// 内容脚本里的 <audio> 又会受网页 CSP / 混合内容策略影响。
function ensureOffscreenDocument(force) {
  if (offscreenAlive && !force) return Promise.resolve();
  if (offscreenCreating) return offscreenCreating;
  offscreenCreating = (async function () {
    if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== "function") {
      throw new Error("当前浏览器不支持 offscreen 音频播放，请升级 Chrome");
    }
    const canCheck = typeof chrome.offscreen.hasDocument === "function";
    if (!force && canCheck && await chrome.offscreen.hasDocument()) {
      offscreenAlive = true;
      return;
    }
    // 文档可能已被浏览器回收（例如没有声音时），先关掉残留的再重建。
    if (force && canCheck && typeof chrome.offscreen.closeDocument === "function" &&
      await chrome.offscreen.hasDocument().catch(function () { return false; })) {
      try {
        await chrome.offscreen.closeDocument();
      } catch (e) {
        // ignore
      }
    }
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "播放本地 Kokoro TTS 合成的朗读音频"
      });
    } catch (e) {
      const message = (e && e.message) || String(e);
      // 并发创建时可能提示已存在，视为成功
      if (!/single offscreen|already|only a single/i.test(message)) throw e;
    }
    offscreenAlive = true;
  })().finally(function () {
    offscreenCreating = null;
  });
  return offscreenCreating;
}

function stopKokoroPlayback() {
  if (kokoroAbort) {
    try {
      kokoroAbort.abort();
    } catch (e) {
      // ignore
    }
    kokoroAbort = null;
  }
  const finish = kokoroCurrentFinish;
  kokoroCurrentFinish = null;
  if (finish) finish({ ok: false, cancelled: true });
  if (offscreenAlive) {
    try {
      chrome.runtime.sendMessage({ type: "KOKORO_STOP" }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // ignore
    }
  }
}

function bufferToDataUrl(buffer, mime) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return "data:" + mime + ";base64," + btoa(binary);
}

// MV3 的 service worker 会在空闲约 30 秒后被回收，离屏音频文档也会随之关闭，
// 结果就是长文本朗读到一半突然没声。朗读期间定期调用扩展 API 保活。
let kokoroKeepAliveTimer = null;

function kokoroKeepAliveStart() {
  if (kokoroKeepAliveTimer != null) return;
  kokoroKeepAliveTimer = setInterval(function () {
    try {
      chrome.runtime.getPlatformInfo(function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // ignore
    }
  }, 15000);
}

function kokoroKeepAliveStop() {
  if (kokoroKeepAliveTimer != null) {
    clearInterval(kokoroKeepAliveTimer);
    kokoroKeepAliveTimer = null;
  }
}

// Kokoro 一次合成过长文本时容易受 token 上限影响，而且整段合成要等很久才出声。
// 这里按句子切分（后续每段不超过 300 字符），逐段合成、逐段播放，句间还可以预取下一段。
// 第一段故意切得短一些（约 80 字符）：整段合成是“全部生成完才返回”，
// 首段越短，点击朗读后听到第一个字就越快；后续段落仍用较大的长度减少请求次数。
const KOKORO_MAX_CHUNK = 300;
const KOKORO_FIRST_CHUNK = 80;
// 允许为了在标点处断句而略微超出长度上限，避免把 "everything else," 这类短语拆开
const KOKORO_CUT_TOLERANCE = 20;

// 选择切分点：优先在逗号/分号/冒号等标点之后断开（可略微超过上限），
// 找不到合适的标点再退回最近的空格，避免从短语中间切开。
function findKokoroCut(text, max) {
  const hardEnd = Math.min(text.length, max + KOKORO_CUT_TOLERANCE);
  const softStart = Math.floor(max * 0.6);
  for (let i = hardEnd - 1; i >= softStart; i--) {
    if (!/[,.!?;:。，！？；：、]/.test(text[i])) continue;
    // 标点后面的引号/括号也并入当前段，避免下一段以标点开头
    let cut = i + 1;
    while (cut < text.length && /["'”’）)\]】」』]/.test(text[cut])) cut++;
    if (cut <= max + KOKORO_CUT_TOLERANCE) return cut;
  }
  let cut = text.lastIndexOf(" ", max);
  if (cut < max * 0.5) cut = max;
  return cut;
}

function splitKokoroText(text, maxLen, firstMaxLen) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const hardMax = Math.max(1, maxLen || KOKORO_MAX_CHUNK);
  const firstMax = Math.max(1, Math.min(firstMaxLen || hardMax, hardMax));
  if (clean.length <= firstMax) return [clean];

  const parts = clean.match(/[^.!?。！？;；]+[.!?。！？;；]*/g) || [clean];
  const chunks = [];
  let buf = "";

  // 第一段用较小的上限，之后的段落用正常上限
  function limit() {
    return chunks.length === 0 ? firstMax : hardMax;
  }

  function flush() {
    if (buf) chunks.push(buf);
    buf = "";
  }

  function join(a, b) {
    // 中文句子之间不需要空格；英文需要在单词/句子之间补一个空格
    // （上一句以 . ! ? 等标点结尾时也要补，否则会读成 "quickly.Another"）
    const last = a.slice(-1);
    const first = b.charAt(0);
    const cjk = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff。，！？；：、]/;
    const needSpace = !cjk.test(last) && !cjk.test(first) &&
      /[A-Za-z0-9.,!?;:'")\]]$/.test(last) && /^[A-Za-z0-9"'(\[]/.test(first);
    return a + (needSpace ? " " : "") + b;
  }

  parts.forEach(function (part) {
    const piece = part.trim();
    if (!piece) return;
    if (buf && buf.length + piece.length + 1 > limit()) flush();
    if (piece.length <= limit()) {
      buf = buf ? join(buf, piece) : piece;
      return;
    }
    // 单句超长：优先在标点处切分，避免拆开短语
    flush();
    let rest = piece;
    while (rest.length > limit()) {
      const max = limit();
      const cut = findKokoroCut(rest, max);
      const head = rest.slice(0, cut).trim();
      if (head) chunks.push(head);
      rest = rest.slice(cut).trim();
    }
    buf = rest;
  });
  flush();
  return chunks;
}

// prefetchSignal 只用于面板打开时的提前合成：它有自己的取消信号，
// 不能占用全局 kokoroAbort，否则用户点击朗读时会把预取请求误当成“上一段朗读”中止。
async function kokoroFetchAudio(text, lang, settings, prefetchSignal) {
  const base = kokoroBaseUrl(settings);
  const format = settings.kokoroFormat === "wav" ? "wav" : "mp3";
  const controller = prefetchSignal ? null : new AbortController();
  if (controller) kokoroAbort = controller;
  const signal = prefetchSignal || controller.signal;

  let res;
  try {
    res = await fetch(base + "/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: String(settings.kokoroModel || "kokoro").trim() || "kokoro",
        input: text,
        voice: kokoroVoiceForLang(settings, lang),
        response_format: format,
        speed: Number(settings.ttsRate) || 1,
        stream: false
      }),
      signal: signal
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw new Error("无法连接本地 Kokoro TTS（" + base +
      "）。请确认服务已启动、端口正确，并重新加载扩展以授予本地访问权限。");
  } finally {
    if (controller && kokoroAbort === controller) kokoroAbort = null;
  }

  if (!res.ok) {
    const body = await res.text().catch(function () { return ""; });
    let hint = "";
    if (res.status === 404) {
      hint = "（接口 /v1/audio/speech 不存在，请确认使用的是 Kokoro-FastAPI）";
    } else if (format === "mp3") {
      hint = "（若服务端缺少 ffmpeg，请在设置里把音频格式改为 wav）";
    }
    throw new Error("Kokoro HTTP " + res.status +
      (body ? "：" + body.slice(0, 200) : "") + hint);
  }

  return {
    bytes: await res.arrayBuffer(),
    mime: format === "wav" ? "audio/wav" : "audio/mpeg"
  };
}

// 面板打开 / 译文返回时提前合成第一小段。用户点击“朗读”时如果缓存命中，
// 就能立即播放，不必再等 Kokoro 合成。缓存按“文本 + 语音 + 语速 + 格式”区分，
// 最多保留几个最近使用的结果（每段都不长，内存占用很小）。
const KOKORO_CACHE_LIMIT = 4;
const kokoroAudioCache = new Map(); // key -> Promise<{ bytes, mime }>

function kokoroCacheKey(text, lang, settings) {
  return [
    kokoroBaseUrl(settings),
    String(settings.kokoroModel || "kokoro").trim() || "kokoro",
    kokoroVoiceForLang(settings, lang),
    settings.kokoroFormat === "wav" ? "wav" : "mp3",
    Number(settings.ttsRate) || 1,
    text
  ].join("\u0001");
}

function kokoroCacheTake(key) {
  const entry = kokoroAudioCache.get(key);
  if (!entry) return null;
  // 最近使用的结果移到末尾，超出上限时优先淘汰最久未用的
  kokoroAudioCache.delete(key);
  kokoroAudioCache.set(key, entry);
  return entry;
}

function kokoroCachePut(key, promise) {
  kokoroAudioCache.set(key, promise);
  while (kokoroAudioCache.size > KOKORO_CACHE_LIMIT) {
    const oldest = kokoroAudioCache.keys().next().value;
    kokoroAudioCache.delete(oldest);
  }
  // 失败（服务未启动、超时等）的结果不能留在缓存里，否则下次点击仍会拿到同一个错误
  promise.catch(function () {
    if (kokoroAudioCache.get(key) === promise) kokoroAudioCache.delete(key);
  });
  return promise;
}

function kokoroPrefetch(text, lang, settings) {
  const piece = String(text || "").trim();
  if (!piece) return null;
  const key = kokoroCacheKey(piece, lang, settings);
  const cached = kokoroCacheTake(key);
  if (cached) return cached;

  const controller = new AbortController();
  // 预取请求不能无限挂起，否则会一直占着服务端连接
  const timer = setTimeout(function () {
    try {
      controller.abort();
    } catch (e) {
      // ignore
    }
  }, 30000);
  const promise = kokoroFetchAudio(piece, lang, settings, controller.signal)
    .finally(function () { clearTimeout(timer); });
  return kokoroCachePut(key, promise);
}

// 朗读时优先使用预取结果；没有预取才现场请求（并记入缓存）。
function kokoroGetChunk(text, lang, settings) {
  const key = kokoroCacheKey(text, lang, settings);
  const cached = kokoroCacheTake(key);
  if (cached) return cached;
  return kokoroCachePut(key, kokoroFetchAudio(text, lang, settings));
}

function kokoroPlayAudio(src, maxMs) {
  return new Promise(function (resolve) {
    const id = "kokoro-" + (++kokoroPlaySeq);
    let done = false;
    const timer = setTimeout(function () {
      finish({ ok: false, error: "Kokoro 音频播放超时" });
    }, maxMs || 180000);

    function onMessage(msg) {
      if (!msg || msg.type !== "KOKORO_AUDIO_EVENT" || msg.id !== id) return;
      if (msg.event === "start") return;
      if (msg.event === "error") {
        finish({ ok: false, error: msg.error || "Kokoro 音频播放失败" });
        return;
      }
      if (msg.event === "end") finish({ ok: true });
    }

    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
      if (kokoroCurrentFinish === finish) kokoroCurrentFinish = null;
      resolve(result);
    }

    kokoroCurrentFinish = finish;
    chrome.runtime.onMessage.addListener(onMessage);

    let retried = false;
    function sendPlay() {
      try {
        chrome.runtime.sendMessage({ type: "KOKORO_PLAY", id: id, src: src }, function () {
          const err = chrome.runtime.lastError;
          if (!err || done) return;
          if (retried) {
            finish({ ok: false, error: "无法启动音频播放：" + err.message });
            return;
          }
          // 离屏文档可能已被浏览器回收（例如长时间没有声音），重建后再试一次。
          retried = true;
          ensureOffscreenDocument(true).then(function () {
            if (!done) sendPlay();
          }).catch(function (e) {
            finish({ ok: false, error: (e && e.message) || String(e) });
          });
        });
      } catch (e) {
        finish({ ok: false, error: (e && e.message) || String(e) });
      }
    }
    sendPlay();
  });
}

async function kokoroSpeak(text, lang, settings, tabId, isCurrent) {
  const textKey = String(text || "");
  if (!textKey.trim()) return { ok: true };
  ttsActiveSpeaks++;
  kokoroKeepAliveStart();
  try {
    // 本地音频与浏览器语音共用一个“朗读”语义：开始前停掉 chrome.tts，
    // 避免上一段系统语音和新的 Kokoro 语音同时播放。
    try {
      if (chrome.tts && typeof chrome.tts.stop === "function") chrome.tts.stop();
    } catch (e) {
      // ignore
    }
    ttsLastActiveAt = Date.now();

    const voice = kokoroVoiceForLang(settings, lang);
    const chunks = splitKokoroText(textKey, KOKORO_MAX_CHUNK, KOKORO_FIRST_CHUNK);
    console.info("[划线翻译] 朗读语音: Kokoro " + voice + "（本地 " +
      kokoroBaseUrl(settings) + "） | 语言:", lang, "| 长度:", textKey.length,
      "字符 /", chunks.length, "段（首段", chunks[0].length, "字符） | 文本:", textKey.slice(0, 40));

    // 离屏文档首次创建也要几十到几百毫秒，和第一段合成并行进行，避免串行等待。
    const offscreenReady = ensureOffscreenDocument();
    offscreenReady.catch(function () { /* 真正的错误在下面 await 时处理 */ });

    // 先合成第一段，立刻播放；播放期间预取下一段，避免句与句之间的停顿。
    // 首段若已在面板打开/译文返回时预取过，直接复用缓存，点击后几乎立刻出声。
    let pending = kokoroGetChunk(chunks[0], lang, settings);
    pending.catch(function () { /* 真正的错误在下面的 await 里处理 */ });

    for (let i = 0; i < chunks.length; i++) {
      const audio = await pending;
      if (!isCurrent()) return { ok: false, cancelled: true };

      if (i + 1 < chunks.length) {
        pending = kokoroGetChunk(chunks[i + 1], lang, settings);
        pending.catch(function () { /* 同上 */ });
      }

      await offscreenReady;
      if (!isCurrent()) return { ok: false, cancelled: true };

      const src = bufferToDataUrl(audio.bytes, audio.mime);
      const timeoutMs = Math.min(300000, Math.max(60000, chunks[i].length * 400));
      const result = await kokoroPlayAudio(src, timeoutMs);
      if (!result.ok) {
        if (result.cancelled) return result;
        if (isCurrent()) sendTtsEnd(tabId, textKey);
        return result;
      }
    }

    if (isCurrent()) sendTtsEnd(tabId, textKey);
    return { ok: true };
  } catch (e) {
    if (e && e.name === "AbortError") return { ok: false, cancelled: true };
    const message = (e && e.message) || String(e);
    console.error("[划线翻译] Kokoro 朗读失败:", message);
    if (isCurrent()) sendTtsEnd(tabId, textKey);
    return { ok: false, error: message };
  } finally {
    ttsActiveSpeaks--;
    if (ttsActiveSpeaks <= 0) kokoroKeepAliveStop();
  }
}

// 从 /v1/audio/voices 或 /health 读取服务信息，供设置页“测试 Kokoro 连接”使用。
async function kokoroProbe(base) {
  const clean = String(base || "http://localhost:8880").trim().replace(/\/+$/, "");
  let voicesError = null;
  try {
    const res = await fetch(clean + "/v1/audio/voices");
    if (res.ok) {
      const data = await res.json().catch(function () { return null; });
      const raw = Array.isArray(data) ? data
        : (data && (data.voices || data.data)) || [];
      const voices = raw.map(function (v) {
        if (typeof v === "string") return v;
        return (v && (v.name || v.id || v.voice_id || v.voice)) || "";
      }).filter(Boolean);
      return { ok: true, voices: voices };
    }
    if (res.status !== 404) voicesError = new Error("HTTP " + res.status);
  } catch (e) {
    voicesError = e;
  }
  // 语音列表接口不可用时退回 /health，只要服务在线就仍可朗读
  try {
    const health = await fetch(clean + "/health");
    if (!health.ok) throw new Error("HTTP " + health.status);
    return { ok: true, voices: [] };
  } catch (e) {
    throw voicesError || e;
  }
}


function ttsLangMatches(voiceLang, lang) {
  if (!voiceLang) return false;
  const norm = (l) => String(l).replace("_", "-").toLowerCase();
  const l = norm(voiceLang);
  return l === norm(lang) || l.split("-")[0] === norm(lang).split("-")[0];
}

// 按文本语言取用户配置的语音名。中英文可以分别配置，互不干扰：
// 之前只有一个 ttsVoiceName，选了英文语音后中文译文会退回 Chrome 默认中文语音，
// 同一段中英混排文字还会在两种音色之间跳。
function ttsVoiceNameForLang(ttsSettings, lang) {
  if (!ttsSettings) return "";
  const code = String(lang || "").replace("_", "-").toLowerCase().split("-")[0];
  if (code === "zh" && ttsSettings.ttsVoiceNameZh) return ttsSettings.ttsVoiceNameZh;
  if (code === "en" && ttsSettings.ttsVoiceNameEn) return ttsSettings.ttsVoiceNameEn;
  return ttsSettings.ttsVoiceName || "";
}

function ttsPickVoice(voices, lang, ttsSettings) {
  const langMatches = (v) => ttsLangMatches(v.lang, lang);
  const wanted = ttsVoiceNameForLang(ttsSettings, lang);
  if (wanted) {
    const byName = voices.find((v) => v.voiceName === wanted && langMatches(v));
    if (byName) return byName;
  }
  // An unconfigured voice may belong to an intermittently available TTS
  // extension. Let Chrome choose the default voice for the requested language.
  return null;
}

// 记住每个语音所属语言与来源（是否由第三方扩展提供），
// 供“配置语音暂时不在列表里”时判断能否继续使用，也用于调整朗读节奏。
const ttsKnownVoices = new Map(); // voiceName -> { lang, extensionId }

// 取本次朗读要用的语音。第三方语音扩展的语音偶尔会短暂从 getVoices 列表里消失，
// 此时如果退回浏览器默认语音，用户会听到完全不同的音色/口音（听起来像“发音异常”）。
// 只要之前见过这个语音且语言匹配，就仍然按配置朗读；真的不可用时引擎会报错，
// 再由重试逻辑退回默认语音。
function ttsResolveVoice(voices, lang, ttsSettings) {
  const list = voices || [];
  for (const v of list) {
    if (v && v.voiceName) {
      ttsKnownVoices.set(v.voiceName, {
        lang: v.lang || "",
        extensionId: v.extensionId || ""
      });
    }
  }
  const picked = ttsPickVoice(list, lang, ttsSettings);
  if (picked) {
    const known = ttsKnownVoices.get(picked.voiceName) || {};
    return {
      voiceName: picked.voiceName,
      lang: picked.lang,
      extensionId: known.extensionId || ""
    };
  }
  const wanted = ttsVoiceNameForLang(ttsSettings, lang);
  if (!wanted) return null;
  const known = ttsKnownVoices.get(wanted);
  if (!known || !ttsLangMatches(known.lang, lang)) return null;
  console.warn("[划线翻译] 语音列表暂未包含已配置的语音，仍按配置朗读:", wanted);
  return { voiceName: wanted, lang: known.lang, extensionId: known.extensionId || "" };
}

let ttsRequestVersion = 0;
// 正在进行（含等待预热）的朗读请求数量；有朗读在等待时不要再启动预热去抢引擎
let ttsActiveSpeaks = 0;

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
      case "TTS_WARMUP":
        {
          // 划线取词面板打开时提前预热语音引擎（静音），
          // 让用户点击“朗读原文/译文”时引擎已经就绪。
          // 如果当前已经有朗读在进行或即将开始，说明引擎已经热了，不要打断它。
          const alreadySpeaking = await ttsIsSpeaking();
          if (alreadySpeaking !== true && ttsActiveSpeaks === 0) {
            const settings = await getSettings();
            // Kokoro 走本地 HTTP，没有需要预热的浏览器引擎；但可以提前创建
            // 离屏播放文档并合成第一小段，用户点击朗读时就能直接播放。
            if (settings.ttsEngine === "kokoro") {
              const lang = String(msg.lang || "en-US");
              const text = String(msg.text || "").trim();
              const offscreen = ensureOffscreenDocument().catch(function () {
                /* 点击朗读时会再报错 */
              });
              let prefetch = null;
              if (text) {
                const firstChunk = splitKokoroText(text, KOKORO_MAX_CHUNK, KOKORO_FIRST_CHUNK)[0];
                if (firstChunk) prefetch = kokoroPrefetch(firstChunk, lang, settings);
              }
              // 保持消息通道直到预取结束，避免 MV3 service worker 在请求途中被回收；
              // 预取失败不影响点击朗读（届时会重新请求并显示错误）。
              await Promise.all([
                offscreen,
                prefetch && prefetch.catch(function () { /* ignore */ })
              ]);
              sendResponse({ ok: true });
              break;
            }
            const lang = String(msg.lang || "en-US");
            const voices = await ttsGetVoicesForSettings(settings, lang);
            const voice = ttsResolveVoice(voices, lang, settings);
            const warmOptions = {
              lang: lang,
              rate: Number(settings.ttsRate) || 1,
              pitch: Number(settings.ttsPitch) || 1
            };
            if (voice) warmOptions.voiceName = voice.voiceName;
            // 第三方扩展语音有自己的宿主页/合成器，静音占位反而会干扰它，直接跳过；
            // 其它情况下若已有朗读请求在等待，也不用再预热去抢引擎。
            const isExtensionVoice = !!(voice && voice.extensionId);
            if (!isExtensionVoice && ttsActiveSpeaks === 0) {
              await ensureTtsEngineWarmed(warmOptions);
            }
          }
          sendResponse({ ok: true });
        }
        break;
      case "TTS_SPEAK":
        {
          const settings = await getSettings();
          if (requestVersion !== ttsRequestVersion) {
            sendResponse({ ok: false, cancelled: true });
            break;
          }
          const lang = String(msg.lang || "en-US");
          const tabId = sender && sender.tab ? sender.tab.id : null;
          const textKey = String(msg.text || "");

          // 新请求会取代旧请求：先停掉上一段本地音频，避免两段声音重叠
          stopKokoroPlayback();

          if (settings.ttsEngine === "kokoro") {
            const res = await kokoroSpeak(
              textKey,
              lang,
              settings,
              tabId,
              () => requestVersion === ttsRequestVersion
            );
            sendResponse(res);
            break;
          }

          const voices = await ttsGetVoicesForSettings(settings, lang);
          if (requestVersion !== ttsRequestVersion) {
            sendResponse({ ok: false, cancelled: true });
            break;
          }
          const voice = ttsResolveVoice(voices, lang, settings);
          const options = {
            lang: lang,
            rate: Number(msg.rate != null ? msg.rate : settings.ttsRate) || 1,
            pitch: Number(msg.pitch != null ? msg.pitch : settings.ttsPitch) || 1,
            onEvent: function (event) {
              if (event && (event.type === "end" || event.type === "interrupted" || event.type === "cancelled" || event.type === "error")) {
                if (requestVersion !== ttsRequestVersion) return;
                sendTtsEnd(tabId, textKey);
              }
            }
          };
          if (voice) options.voiceName = voice.voiceName;
          // 语音来源只作为内部标记，绝不能放进 chrome.tts.speak 的 options：
          // Chrome 会校验参数并抛出 "Unexpected property" 而不是朗读。
          const voiceIsExtension = !!(voice && voice.extensionId);
          ttsActiveSpeaks++;
          try {
            // 第三方语音扩展自己合成/播放音频，收尾更慢，需要更长的间隔，
            // 否则下一句容易从扩展的音频元素里被“截断”着开始。
            const settleMs = voice && voice.extensionId ? 600 : 300;
            const voiceLabel = voice
              ? (voice.extensionId
                ? voice.voiceName + "（第三方扩展 " + voice.extensionId + "）"
                : voice.voiceName + "（内置）")
              : "浏览器默认";
            console.info("[划线翻译] 朗读语音:", voiceLabel, "| 语言:", lang, "| 文本:", textKey.slice(0, 40));
            // 内置语音首次朗读前先静音预热，规避冷启动时吞音/半截/音色异常。
            // 第三方扩展语音完全交给扩展自己初始化（见 ensureTtsEngineWarmed）。
            await ensureTtsEngineWarmed(options, voiceIsExtension);
            // 另一种语言/音色的预热占位可能仍在进行，等它结束再朗读
            await waitForPendingWarmups();
            // 预热或其它朗读可能仍在收尾，等引擎静下来、并留出最小间隔再真正朗读
            await waitUntilTtsSilent(800);
            await waitForTtsSettle(settleMs);
            if (requestVersion !== ttsRequestVersion) {
              sendResponse({ ok: false, cancelled: true });
              break;
            }
            const res = await ttsSpeak(
              String(textKey || ""),
              options,
              () => requestVersion === ttsRequestVersion,
              voiceIsExtension
            );
            sendResponse(res);
          } finally {
            ttsActiveSpeaks--;
            if (ttsActiveSpeaks <= 0) kokoroKeepAliveStop();
          }
        }
        break;
      case "TTS_STOP":
        ttsStop();
        sendResponse({ ok: true });
        break;
      case "KOKORO_TEST":
        {
          const settings = await getSettings();
          const base = String(msg.kokoroBaseUrl || settings.kokoroBaseUrl || "http://localhost:8880");
          try {
            const result = await kokoroProbe(base);
            sendResponse({ ok: true, base: base, voices: result.voices });
          } catch (e) {
            const reason = (e && e.message) || String(e);
            sendResponse({
              ok: false,
              error: "无法连接 " + base + "：" +
                (/failed to fetch|networkerror/i.test(reason)
                  ? "服务未启动或端口不正确（请确认 Kokoro-FastAPI 正在运行，并重新加载扩展）"
                  : reason)
            });
          }
        }
        break;
      case "KOKORO_AUDIO_EVENT":
        // 离屏文档的播放进度通知，由 kokoroPlayAudio 内部监听
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
