(function () {
  "use strict";

  const input = document.getElementById("input");
  const btnTranslate = document.getElementById("btnTranslate");
  const status = document.getElementById("status");
  const result = document.getElementById("result");
  const langLabel = document.getElementById("langLabel");
  const resultText = document.getElementById("resultText");
  const btnSpeak = document.getElementById("btnSpeak");
  const btnSpeakInput = document.getElementById("btnSpeakInput");
  const btnCopy = document.getElementById("btnCopy");

  let lastResult = null;
  let speaking = false;
  let activeSpeakBtn = null;
  let activeSpeakText = null;
  let speakToken = 0;

  document.getElementById("openOptions").addEventListener("click", function (e) {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  });

  function setStatus(msg, ok) {
    status.textContent = msg || "";
    if (ok) status.style.color = "#00b42a";
    else if (msg) status.style.color = "#f53f3f";
    else status.style.color = "";
  }

  btnTranslate.addEventListener("click", doTranslate);

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      doTranslate();
    }
  });

  function detectLang(text) {
    return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text) ? "zh" : "en";
  }

  function doTranslate() {
    const text = input.value.trim();
    if (!text) {
      setStatus("请输入要翻译的内容");
      return;
    }
    btnTranslate.disabled = true;
    setStatus("正在翻译…");
    result.classList.remove("show");
    stopSpeaking();
    chrome.runtime.sendMessage({ type: "TRANSLATE", text: text }, function (res) {
      btnTranslate.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message);
        return;
      }
      if (!res || !res.ok) {
        setStatus(res && res.error ? res.error : "翻译失败");
        return;
      }
      const srcLang = res.source || detectLang(text);
      const tgtLang = res.target || (srcLang === "zh" ? "en" : "zh");
      lastResult = { text: res.text, lang: tgtLang, langLabel: srcLang === "zh" ? "译文（英文）" : "译文（中文）" };
      langLabel.textContent = lastResult.langLabel;
      resultText.textContent = res.text;
      result.classList.add("show");
      setStatus("完成");
    });
  }

  btnCopy.addEventListener("click", function () {
    if (!lastResult) return;
    const done = function (ok) {
      btnCopy.textContent = ok ? "已复制" : "复制失败";
      setTimeout(function () {
        btnCopy.textContent = "复制";
      }, 1500);
    };
    navigator.clipboard
      .writeText(lastResult.text)
      .then(function () { done(true); })
      .catch(function () { done(false); });
  });

  function clearSpeakUI() {
    speakToken++;
    speaking = false;
    activeSpeakText = null;
    if (activeSpeakBtn) {
      activeSpeakBtn.textContent = activeSpeakBtn.dataset.label || "朗读";
      activeSpeakBtn = null;
    }
  }

  function stopSpeaking() {
    if (speaking) {
      chrome.runtime.sendMessage({ type: "TTS_STOP" });
    }
    clearSpeakUI();
  }

  function speakText(text, lang, button) {
    if (speaking && activeSpeakBtn === button) {
      stopSpeaking();
      return;
    }
    const wasSpeaking = speaking;
    if (wasSpeaking) {
      stopSpeaking();
    }

    const token = ++speakToken;
    const spoken = text.slice(0, 3000);
    button.textContent = "停止";
    speaking = true;
    activeSpeakBtn = button;
    activeSpeakText = spoken;

    const run = function () {
      if (token !== speakToken) return;
      chrome.runtime.sendMessage(
        { type: "TTS_SPEAK", text: spoken, lang: lang },
        function (res) {
          if (token !== speakToken) return;
          if (chrome.runtime.lastError || !res || !res.ok) {
            // 发声失败时恢复按钮，便于用户重试
            clearSpeakUI();
          }
        }
      );
    };

    // 刚 stop 过就立刻 speak 容易吞音，稍等引擎复位后再朗读
    if (wasSpeaking) {
      setTimeout(run, 220);
    } else {
      run();
    }
  }

  // 后台在朗读真正结束/中断时通知，恢复按钮状态，避免下次点击被当成“停止”
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "TTS_END" && msg.text === activeSpeakText) {
      clearSpeakUI();
    }
  });

  btnSpeak.addEventListener("click", function () {
    if (!lastResult) return;
    const lang = lastResult.lang === "zh" ? "zh-CN" : "en-US";
    speakText(lastResult.text, lang, btnSpeak);
  });

  btnSpeakInput.addEventListener("click", function () {
    const text = input.value.trim();
    if (!text) {
      setStatus("请输入要朗读的内容");
      return;
    }
    const lang = detectLang(text) === "zh" ? "zh-CN" : "en-US";
    speakText(text, lang, btnSpeakInput);
  });
})();
