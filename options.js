(function () {
  "use strict";

  const els = {
    backend: () => document.querySelector('input[name="backend"]:checked'),
    ollamaBaseUrl: () => document.getElementById("ollamaBaseUrl"),
    ollamaModel: () => document.getElementById("ollamaModel"),
    ollamaModels: () => document.getElementById("ollama-models"),
    llamacppBaseUrl: () => document.getElementById("llamacppBaseUrl"),
    llamacppModel: () => document.getElementById("llamacppModel"),
    llamacppModels: () => document.getElementById("llamacpp-models"),
    temperature: () => document.getElementById("temperature"),
    maxTokens: () => document.getElementById("maxTokens"),
    cardOllama: () => document.getElementById("card-ollama"),
    cardLlamacpp: () => document.getElementById("card-llamacpp"),
    secOllama: () => document.getElementById("sec-ollama"),
    secLlamacpp: () => document.getElementById("sec-llamacpp"),
    status: () => document.getElementById("status"),
    modelList: () => document.getElementById("modelList")
  };

  let saving = false;

  function setStatus(msg, kind) {
    const el = els.status();
    el.textContent = msg || "";
    el.className = "status" + (kind ? " " + kind : "");
  }

  function syncSections() {
    const backend = els.backend().value;
    els.secOllama().classList.toggle("hidden", backend !== "ollama");
    els.secLlamacpp().classList.toggle("hidden", backend !== "llamacpp");
    els.cardOllama().classList.toggle("selected", backend === "ollama");
    els.cardLlamacpp().classList.toggle("selected", backend === "llamacpp");
  }

  function collect() {
    return {
      backend: els.backend().value,
      ollamaBaseUrl: els.ollamaBaseUrl().value.trim(),
      ollamaModel: els.ollamaModel().value.trim(),
      llamacppBaseUrl: els.llamacppBaseUrl().value.trim(),
      llamacppModel: els.llamacppModel().value.trim(),
      temperature: parseFloat(els.temperature().value),
      maxTokens: parseInt(els.maxTokens().value, 10)
    };
  }

  function fillDatalist(listEl, models) {
    listEl.textContent = "";
    models.forEach(function (m) {
      const opt = document.createElement("option");
      opt.value = m;
      listEl.appendChild(opt);
    });
  }

  function load() {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, function (res) {
      if (chrome.runtime.lastError) {
        setStatus("读取设置失败：" + chrome.runtime.lastError.message, "err");
        return;
      }
      const s = res || {};
      document.getElementById("rb-" + (s.backend === "llamacpp" ? "llamacpp" : "ollama")).checked = true;
      els.ollamaBaseUrl().value = s.ollamaBaseUrl || "http://localhost:11434";
      els.ollamaModel().value = s.ollamaModel || "";
      els.llamacppBaseUrl().value = s.llamacppBaseUrl || "http://localhost:8080";
      els.llamacppModel().value = s.llamacppModel || "";
      els.temperature().value = s.temperature != null ? s.temperature : 0.2;
      els.maxTokens().value = s.maxTokens != null ? s.maxTokens : 512;
      syncSections();
    });
  }

  function save() {
    if (saving) return;
    saving = true;
    const s = collect();
    chrome.storage.sync.set(s, function () {
      saving = false;
      if (chrome.runtime.lastError) {
        setStatus("保存失败：" + chrome.runtime.lastError.message, "err");
        return;
      }
      setStatus("设置已保存", "ok");
    });
  }

  function test() {
    const s = collect();
    if (!s.backend) return;
    if (s.backend === "ollama" && !s.ollamaBaseUrl) {
      setStatus("请填写 Ollama 服务地址", "err");
      return;
    }
    if (s.backend === "llamacpp" && !s.llamacppBaseUrl) {
      setStatus("请填写 llama.cpp 服务地址", "err");
      return;
    }
    setStatus("正在测试连接…");
    els.modelList().textContent = "";
    chrome.storage.sync.set(s, function () {
      chrome.runtime.sendMessage({ type: "TEST_CONNECTION" }, function (res) {
        if (chrome.runtime.lastError) {
          setStatus("测试失败：" + chrome.runtime.lastError.message, "err");
          return;
        }
        if (!res || !res.ok) {
          setStatus("连接失败：" + (res ? res.error : "未知错误"), "err");
          return;
        }
        setStatus("连接成功，发现 " + res.models.length + " 个模型", "ok");
        if (res.models.length) {
          els.modelList().textContent = "可用模型：" + res.models.join("、");
          if (s.backend === "ollama") fillDatalist(els.ollamaModels(), res.models);
          else fillDatalist(els.llamacppModels(), res.models);
        }
      });
    });
  }

  document.querySelectorAll('input[name="backend"]').forEach(function (rb) {
    rb.addEventListener("change", syncSections);
  });
  document.getElementById("btnSave").addEventListener("click", save);
  document.getElementById("btnTest").addEventListener("click", test);

  load();
})();
