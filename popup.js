(function () {
  "use strict";

  const input = document.getElementById("input");
  const btnTranslate = document.getElementById("btnTranslate");
  const status = document.getElementById("status");
  const result = document.getElementById("result");
  const langLabel = document.getElementById("langLabel");
  const resultText = document.getElementById("resultText");
  const btnSpeak = document.getElementById("btnSpeak");

  let lastResult = null;
  let speaking = false;

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
    speaking = false;
    btnSpeak.textContent = "朗读";
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

  btnSpeak.addEventListener("click", function () {
    if (!lastResult) return;
    if (speaking) {
      chrome.runtime.sendMessage({ type: "TTS_STOP" });
      speaking = false;
      btnSpeak.textContent = "朗读";
      return;
    }
    const lang = lastResult.lang === "zh" ? "zh-CN" : "en-US";
    const text = lastResult.text.slice(0, 3000);
    btnSpeak.textContent = "停止";
    speaking = true;
    chrome.runtime.sendMessage(
      { type: "TTS_SPEAK", text: text, lang: lang },
      function (res) {
        if (chrome.runtime.lastError || (res && !res.ok)) {
          if (chrome.runtime.lastError) {
            // ignore
          }
        }
      }
    );
  });
})();
