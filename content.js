(function () {
  "use strict";

  const NS = "ct-";
  const LANG_NAMES = { zh: "中文", en: "英文" };
  const VOICE_LANG = { zh: "zh-CN", en: "en-US" };
  const MAX_TEXT = 3000;
  const PAGE_BUTTON_LABEL = "对照翻译";
  const PAGE_LIMIT = 300;
  const PARA_CONCURRENCY = 3;

  let icon = null;
  let panel = null;
  let lastSelection = { text: "", rect: null, t: 0 };
  let speaking = null;
  let ttsSettings = { ttsVoiceName: "", ttsRate: 1, ttsPitch: 1 };
  let dragState = null;
  let suppressNextClick = false;
  let mouseDownAt = null;
  let pageBtn = null;
  let pageState = { active: false, progress: null };
  const SELECTION_GRACE_MS = 600;

  function detectLang(text) {
    return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(text) ? "zh" : "en";
  }

  function getVoice(lang) {
    const voices = window.speechSynthesis.getVoices();
    const norm = (l) => String(l).replace("_", "-").toLowerCase();
    // If user selected a specific voice name, prefer it
    if (ttsSettings && ttsSettings.ttsVoiceName) {
      const byName = voices.find((v) => v.name === ttsSettings.ttsVoiceName);
      if (byName) return byName;
    }
    // prefer high-quality / neural voices by name hints
    const qualityHints = ["neural", "wavenet", "google", "microsoft", "neural-speech", "samantha", "alloy"];
    const findQuality = voices.find((v) => {
      const n = String(v.name || "").toLowerCase();
      return qualityHints.some((h) => n.includes(h));
    });
    if (findQuality) return findQuality;
    // fallback to language match
    return (
      voices.find((v) => norm(v.lang) === norm(lang)) ||
      voices.find((v) => norm(v.lang).startsWith(norm(lang).split("-")[0])) ||
      null
    );
  }

  function stopSpeech() {
    const synth = window.speechSynthesis;
    if (synth) {
      try {
        if (typeof synth.pause === "function") synth.pause();
      } catch (err) {
        // ignore
      }
      try {
        if (typeof synth.cancel === "function") synth.cancel();
      } catch (err) {
        // ignore
      }
    }
    speaking = null;
  }

  function speak(text, lang) {
    const synth = window.speechSynthesis;
    if (speaking && synth && synth.speaking && speaking._ctText === text) {
      stopSpeech();
      return false;
    }
    stopSpeech();
    const u = new SpeechSynthesisUtterance(text);
    u._ctText = text;
    u.lang = VOICE_LANG[lang] || "en-US";
    const voice = getVoice(u.lang);
    if (voice) u.voice = voice;
    // apply persisted TTS rate/pitch if available
    try {
      u.rate = (ttsSettings && ttsSettings.ttsRate) ? Number(ttsSettings.ttsRate) : 1;
    } catch (e) { u.rate = 1; }
    try {
      u.pitch = (ttsSettings && ttsSettings.ttsPitch) ? Number(ttsSettings.ttsPitch) : 1;
    } catch (e) { u.pitch = 1; }
    u.onend = function () {
      stopSpeech();
      if (window.speechSynthesis && typeof window.speechSynthesis.cancel === "function") {
        try {
          window.speechSynthesis.cancel();
        } catch (err) {
          // ignore
        }
      }
    };
    u.onerror = function () {
      stopSpeech();
      if (window.speechSynthesis && typeof window.speechSynthesis.cancel === "function") {
        try {
          window.speechSynthesis.cancel();
        } catch (err) {
          // ignore
        }
      }
    };
    synth.speak(u);
    speaking = u;
    return true;
  }

  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !sel.toString()) return null;
    const node = sel.anchorNode;
    if (node && node.nodeType === Node.ELEMENT_NODE && node.closest("." + NS + "panel,." + NS + "icon-btn")) return null;
    if (node && node.parentNode && node.parentNode.closest && node.parentNode.closest("." + NS + "panel,." + NS + "icon-btn")) return null;
    const r = sel.getRangeAt(0);
    const rect = r.getBoundingClientRect();
    if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;
    return {
      text: sel.toString().trim().slice(0, MAX_TEXT),
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    };
  }

  function scheduleSelectionUpdate() {
    setTimeout(updateSelectionUI, 10);
  }

  function updateSelectionUI() {
    if (panel) return;
    const captured = captureSelection();
    if (captured) {
      captured.t = Date.now();
      lastSelection = captured;
      showIcon(captured.rect);
      return;
    }
    // The site may have cleared the selection right after mouseup (e.g. LinkedIn),
    // so keep the icon while the last captured selection is still fresh.
    if (lastSelection && lastSelection.text && lastSelection.t && Date.now() - lastSelection.t <= SELECTION_GRACE_MS) {
      showIcon(lastSelection.rect);
    } else {
      hideIcon();
    }
  }

  function createIcon() {
    icon = document.createElement("button");
    icon.className = NS + "icon-btn";
    icon.type = "button";
    icon.title = "翻译选中文本";
    icon.innerHTML = "译";
    icon.addEventListener("click", onIconClick);
    document.documentElement.appendChild(icon);
  }

  function showIcon(rect) {
    if (!icon) createIcon();
    const size = 26;
    let x = Math.min(rect.right - size / 2, window.innerWidth - size - 4);
    let y = rect.bottom + 6;
    if (y + size > window.innerHeight - 4) y = Math.max(4, rect.top - size - 6);
    if (x < 4) x = 4;
    icon.style.left = x + "px";
    icon.style.top = y + "px";
    icon.style.display = "block";
  }

  function hideIcon() {
    if (icon) icon.style.display = "none";
  }

  function onIconClick() {
    const text = lastSelection.text;
    const rect = lastSelection.rect;
    if (!text) return;
    hideIcon();
    if (panel) {
      panel.textContent = "";
      closePanel();
    }
    showPanel(text, rect);
  }

  function showPanel(text, rect) {
    createPanel();
    const lang = detectLang(text);
    panel.innerHTML =
      '<div class="' + NS + 'head">' +
      '<span class="' + NS + 'title">划线翻译</span>' +
      '<button type="button" class="' + NS + 'close" title="关闭">×</button>' +
      "</div>" +
      '<div class="' + NS + 'body">' +
      '<div class="' + NS + 'row">' +
      '<div class="' + NS + 'row-head">' +
      '<span class="' + NS + 'lang">原文（' + LANG_NAMES[lang] + "）</span>" +
      '<button type="button" class="' + NS + 'speak ' + NS + 'speak-src">朗读原文</button>' +
      "</div>" +
      '<div class="' + NS + 'text ' + NS + 'source">' + escapeHtml(text) + "</div>" +
      "</div>" +
      '<div class="' + NS + 'row">' +
      '<div class="' + NS + 'row-head">' +
      '<span class="' + NS + 'lang">译文（…）</span>' +
      '<button type="button" class="' + NS + 'speak ' + NS + 'speak-tgt" disabled>朗读译文</button>' +
      "</div>" +
      '<div class="' + NS + 'text ' + NS + 'target">' +
      '<span class="' + NS + 'loading">正在翻译…</span>' +
      "</div>" +
      "</div>" +
      "</div>" +
      '<div class="' + NS + 'foot">' +
      '<button type="button" class="' + NS + 'copy">复制译文</button>' +
      '<span class="' + NS + 'status"></span>' +
      "</div>";

    if (text.length >= MAX_TEXT) {
      panel.querySelector("." + NS + "status").textContent = "文本过长，仅翻译前 " + MAX_TEXT + " 字符";
    }

    positionPanel(rect);
    panel.style.display = "block";

    panel.querySelector("." + NS + "head").addEventListener("pointerdown", onHeadPointerDown);

    const srcBtn = panel.querySelector("." + NS + "speak-src");
    srcBtn.addEventListener("click", function () {
      if (speak(text, lang)) this.classList.add(NS + "active");
    });
    panel.querySelector("." + NS + "close").addEventListener("click", closePanel);
    panel.querySelector("." + NS + "copy").addEventListener("click", function () {
      const tr = panel.querySelector("." + NS + "target").innerText;
      copyText(tr);
    });

    chrome.runtime.sendMessage({ type: "TRANSLATE", text: text }, function (res) {
      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }
      if (panel === null) return;
      const targetEl = panel.querySelector("." + NS + "target");
      const tgtBtn = panel.querySelector("." + NS + "speak-tgt");
      const langLabel = panel.querySelector("." + NS + "row:nth-of-type(2) ." + NS + "lang");
      const statusEl = panel.querySelector("." + NS + "status");
      if (!res || !res.ok) {
        targetEl.textContent = "";
        targetEl.appendChild(makeErrorNode(res ? res.error : "翻译失败"));
        if (statusEl) statusEl.textContent = "";
        return;
      }
      targetEl.textContent = res.text;
      tgtBtn.disabled = false;
      const tgtLang = detectLang(res.text);
      tgtBtn.addEventListener("click", function () {
        if (speak(res.text, tgtLang)) this.classList.add(NS + "active");
      });
      if (langLabel) langLabel.textContent = "译文（" + LANG_NAMES[tgtLang] + "）";
      if (statusEl) statusEl.textContent = "由本地模型完成";
      repositionPanel();

      // If the user selected a single word/phrase (no whitespace), show detailed definition
      const isSingleWord = typeof text === "string" && !/\s/.test(text) && text.length > 0 && text.length <= 64;
      if (isSingleWord) {
        const bodyEl = panel.querySelector('.' + NS + 'body');
        const defRow = document.createElement('div');
        defRow.className = NS + 'row';
        defRow.innerHTML =
          '<div class="' + NS + 'row-head"><span class="' + NS + 'lang">词典</span></div>' +
          '<div class="' + NS + 'text ' + NS + 'definition"><span class="' + NS + 'loading">正在查询释义…</span></div>';
        bodyEl.appendChild(defRow);
        repositionPanel();
        const defContainer = defRow.querySelector('.' + NS + 'definition');
        chrome.runtime.sendMessage({ type: 'DEFINE', word: text }, function (dres) {
          if (chrome.runtime.lastError) {
            defContainer.textContent = '查询失败：' + chrome.runtime.lastError.message;
            repositionPanel();
            return;
          }
          if (!dres || !dres.ok) {
            defContainer.textContent = dres && dres.error ? ('查询失败：' + dres.error) : '查询失败';
            repositionPanel();
            return;
          }
          // render definition (escape then preserve newlines)
          defContainer.innerHTML = escapeHtml(dres.text).replace(/\n/g, '<br>');
          repositionPanel();
        });
      }
    });
  }

  function makeErrorNode(msg) {
    const el = document.createElement("span");
    el.className = NS + "error";
    el.textContent = "翻译失败：" + (msg || "未知错误");
    return el;
  }

  function showError(msg) {
    if (!panel) return;
    const targetEl = panel.querySelector("." + NS + "target");
    if (targetEl) {
      targetEl.textContent = "";
      targetEl.appendChild(makeErrorNode(msg));
    }
  }

  function createPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.className = NS + "panel";
    panel.style.display = "none";
    document.documentElement.appendChild(panel);
  }

  function positionPanel(rect) {
    const margin = 8;
    const w = Math.min(480, window.innerWidth - margin * 2);
    const maxH = window.innerHeight - margin * 2;
    panel.style.width = w + "px";
    panel.style.maxHeight = maxH + "px";
    let x = rect.left;
    if (x + w > window.innerWidth - margin) x = Math.max(margin, window.innerWidth - w - margin);
    if (x < margin) x = margin;
    let y = rect.bottom + 6;
    const estH = Math.min(panel.scrollHeight || 260, maxH);
    if (y + estH > window.innerHeight - margin) {
      y = rect.top - estH - 6;
      if (y < margin) y = margin;
    }
    panel.style.left = x + "px";
    panel.style.top = y + "px";
  }

  function repositionPanel() {
    if (!panel || !lastSelection.rect) return;
    const rect = lastSelection.rect;
    const margin = 8;
    const maxH = window.innerHeight - margin * 2;
    panel.style.maxHeight = maxH + "px";
    const panelRect = panel.getBoundingClientRect();
    const w = window.innerWidth - margin * 2 < panelRect.width ? window.innerWidth - margin * 2 : panelRect.width;
    const h = Math.min(panelRect.height, maxH);
    const x = Math.min(Math.max(rect.left, margin), window.innerWidth - w - margin);
    let y = rect.bottom + 6;
    if (y + h > window.innerHeight - margin) {
      y = rect.top - h - 6;
      if (y < margin) y = margin;
    }
    panel.style.left = x + "px";
    panel.style.top = y + "px";
  }

  function onHeadPointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target instanceof Element && e.target.closest("." + NS + "close")) return;
    const rect = panel.getBoundingClientRect();
    dragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    panel.setPointerCapture(e.pointerId);
    panel.classList.add(NS + "dragging");
    e.preventDefault();
  }

  function onHeadPointerMove(e) {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true;
    const margin = 8;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    let x = Math.min(Math.max(dragState.left + dx, margin), window.innerWidth - w - margin);
    let y = Math.min(Math.max(dragState.top + dy, margin), window.innerHeight - h - margin);
    panel.style.left = x + "px";
    panel.style.top = y + "px";
  }

  function onHeadPointerUp(e) {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    if (dragState.moved) suppressNextClick = true;
    dragState = null;
    panel.classList.remove(NS + "dragging");
    try {
      panel.releasePointerCapture(e.pointerId);
    } catch (err) {}
  }

  function closePanel() {
    stopSpeech();
    if (panel) {
      panel.remove();
      panel = null;
    }
  }

  function copyText(text) {
    const statusEl = panel && panel.querySelector("." + NS + "status");
    const done = function () {
      if (statusEl) statusEl.textContent = "已复制";
    };
    const fail = function () {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      } catch (e) {
        if (statusEl) statusEl.textContent = "复制失败";
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fail();
    }
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    mouseDownAt = { x: e.clientX, y: e.clientY };
  }

  function onMouseUp(e) {
    if (e.target instanceof Element && e.target.closest("." + NS + "icon-btn,." + NS + "panel")) {
      mouseDownAt = null;
      return;
    }
    const down = mouseDownAt;
    mouseDownAt = null;
    const captured = captureSelection();
    if (captured) {
      captured.t = Date.now();
      lastSelection = captured;
      scheduleSelectionUpdate();
      return;
    }
    if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 5) {
      // A plain click that just collapsed the selection -> hide immediately.
      lastSelection = { text: "", rect: null, t: 0 };
      hideIcon();
    } else {
      scheduleSelectionUpdate();
    }
  }

  function onSelectionChange() {
    // Skip while a mouse drag is in progress; the selection is captured on mouseup.
    if (mouseDownAt) return;
    const captured = captureSelection();
    if (captured) {
      captured.t = Date.now();
      lastSelection = captured;
      scheduleSelectionUpdate();
    }
  }

  function onKeyUp(e) {
    if (e.key === "Escape") {
      closePanel();
      hideIcon();
      return;
    }
    if (e.key === "Shift" || e.ctrlKey || e.metaKey) {
      scheduleSelectionUpdate();
    }
  }

  function onClick(e) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    if (!panel && !icon) return;
    const t = e.target;
    const inside = t instanceof Element && t.closest("." + NS + "panel,." + NS + "icon-btn");
    if (!inside) closePanel();
  }

  function onScroll(e) {
    if (panel) {
      const t = e.target;
      if (t === document || !(t instanceof Element && t.closest("." + NS + "panel"))) {
        closePanel();
      }
    }
    hideIcon();
  }

  function onResize() {
    if (panel && lastSelection.rect) repositionPanel();
    else if (icon && icon.style.display === "block" && lastSelection.rect) showIcon(lastSelection.rect);
  }

  function isElementVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isPageUi(el) {
    return !!(el.closest && el.closest("." + NS + "panel,." + NS + "icon-btn,." + NS + "page-btn,." + NS + "para"));
  }

  function isSkippable(el) {
    if (isPageUi(el)) return true;
    if (el.closest("script,style,noscript,template,svg,iframe,select,textarea,button")) return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
    if (!isElementVisible(el)) return true;
    return false;
  }

  function isParagraphLike(el) {
    const text = (el.innerText || "").trim();
    if (text.length < 2) return false;
    if (!/[\u4e00-\u9fffA-Za-z]/.test(text)) return false;
    for (const child of el.children) {
      if (child.matches("p,div,section,article,ul,ol,table,blockquote,h1,h2,h3,h4,h5,h6,pre,li,td,th,form,figure,header,footer,nav,aside")) {
        return false;
      }
    }
    return true;
  }

  function collectParagraphs() {
    const seen = [];
    const seenSet = new Set();
    const add = function (el) {
      if (isSkippable(el)) return;
      let p = el.parentElement;
      while (p && p !== document.body) {
        if (seenSet.has(p)) return;
        p = p.parentElement;
      }
      const text = (el.innerText || "").trim();
      if (!text || text.length < 2) return;
      if (!/[\u4e00-\u9fffA-Za-z]/.test(text)) return;
      seenSet.add(el);
      seen.push({ el: el, text: text.slice(0, MAX_TEXT * 10), srcLang: detectLang(text) });
    };
    document.querySelectorAll("p,li,blockquote,h1,h2,h3,h4,h5,h6,td,th,dd,figcaption").forEach(add);
    document.querySelectorAll("div,section,article").forEach(function (el) {
      if (isParagraphLike(el)) add(el);
    });
    seen.sort(function (a, b) {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return seen.slice(0, PAGE_LIMIT);
  }

  function chunkText(text, maxLen) {
    const t = String(text).replace(/\s+/g, " ").trim();
    if (t.length <= maxLen) return [t];
    const chunks = [];
    let cur = "";
    const sentences = t.split(/(?<=[.!?。！？；;])\s+|\n+/);
    for (const s of sentences) {
      if (!s) continue;
      const next = cur ? cur + " " + s : s;
      if (next.length <= maxLen) {
        cur = next;
      } else {
        if (cur) chunks.push(cur.trim());
        cur = s;
        while (cur.length > maxLen) {
          chunks.push(cur.slice(0, maxLen).trim());
          cur = cur.slice(maxLen);
        }
      }
    }
    if (cur) chunks.push(cur.trim());
    return chunks;
  }

  function sendTranslate(text) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({ type: "TRANSLATE", text: text }, function (res) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!res || !res.ok) {
          reject(new Error((res && res.error) || "翻译失败"));
          return;
        }
        resolve(res.text);
      });
    });
  }

  async function pageWorker(queue, progress) {
    while (queue.length) {
      const item = queue.shift();
      const chunks = chunkText(item.text, MAX_TEXT);
      let translated = "";
      let err = null;
      for (const chunk of chunks) {
        try {
          const t = await sendTranslate(chunk);
          translated += (translated ? " " : "") + t;
        } catch (e) {
          err = (e && e.message) || String(e);
          break;
        }
      }
      if (item.node && item.node.isConnected) {
        if (err) {
          item.textEl.className = NS + "para-text " + NS + "error";
          item.textEl.textContent = "翻译失败：" + err;
          if (item.tgtBtn) {
            item.textEl.prepend(item.tgtBtn);
            item.tgtBtn.disabled = true;
          }
          if (item.retry) item.retry.style.display = "";
        } else {
          item.textEl.className = NS + "para-text";
          item.textEl.textContent = translated;
          if (item.tgtBtn) {
            item.textEl.prepend(item.tgtBtn);
            item.tgtBtn.disabled = false;
          }
          item.tgtText = translated.slice(0, MAX_TEXT);
        }
      }
      progress.done++;
      updatePageBtn();
    }
  }

  function createSpeakBtn(title, disabled, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = NS + "para-speak";
    btn.title = title;
    btn.disabled = !!disabled;
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">' +
      '<path d="M4 2.7v10.6c0 .9 1 1.4 1.7.9l8-5.3c.7-.5.7-1.5 0-2l-8-5.3C5 1 4 1.6 4 2.7z"/></svg>';
    btn.addEventListener("click", onClick);
    return btn;
  }

  function clearParaSpeakActive() {
    document.querySelectorAll("." + NS + "para-speak.ct-active").forEach(function (b) {
      b.classList.remove(NS + "active");
    });
  }

  function createParaNode(item) {
    const node = document.createElement("div");
    node.className = NS + "para";
    const head = document.createElement("div");
    head.className = NS + "para-head";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = NS + "para-retry";
    retry.textContent = "重试";
    retry.style.display = "none";
    retry.style.marginLeft = "auto";
    retry.addEventListener("click", function () {
      retry.style.display = "none";
      item.textEl.className = NS + "para-text " + NS + "loading";
      item.textEl.textContent = "翻译中…";
      if (item.tgtBtn) item.textEl.prepend(item.tgtBtn);
      item.tgtBtn.disabled = true;
      item.tgtText = "";
      pageWorker([item], pageState.progress || { done: 0, total: 1 });
    });
    head.appendChild(retry);
    const textEl = document.createElement("div");
    textEl.className = NS + "para-text " + NS + "loading";
    textEl.textContent = "翻译中…";
    node.appendChild(head);
    node.appendChild(textEl);
    item.node = node;
    item.textEl = textEl;
    item.retry = retry;

    const srcBtn = createSpeakBtn("朗读原文", false, function () {
      clearParaSpeakActive();
      if (speak(item.text.slice(0, MAX_TEXT), item.srcLang)) srcBtn.classList.add(NS + "active");
      else srcBtn.classList.remove(NS + "active");
    });
    item.srcBtn = srcBtn;
    if (item.el && item.el.prepend) item.el.prepend(srcBtn);

    const tgtBtn = createSpeakBtn("朗读译文", true, function () {
      if (!item.tgtText) return;
      clearParaSpeakActive();
      if (speak(item.tgtText, detectLang(item.tgtText))) tgtBtn.classList.add(NS + "active");
      else tgtBtn.classList.remove(NS + "active");
    });
    item.tgtBtn = tgtBtn;
    textEl.prepend(tgtBtn);

    item.el.insertAdjacentElement("afterend", node);
  }

  function updatePageBtn() {
    if (!pageBtn || !pageState.active) return;
    const p = pageState.progress;
    const done = p ? p.done : 0;
    const total = p ? p.total : 0;
    pageBtn.textContent = "退出对照（" + Math.min(done, total) + "/" + total + "）";
  }

  function removePageNodes() {
    document.querySelectorAll("." + NS + "para").forEach(function (n) {
      n.remove();
    });
    document.querySelectorAll("." + NS + "para-speak").forEach(function (n) {
      n.remove();
    });
  }

  function startPageTranslation() {
    if (pageState.active) return;
    removePageNodes();
    const paras = collectParagraphs();
    if (!paras.length) {
      if (pageBtn) pageBtn.textContent = "未找到可翻译段落";
      setTimeout(function () {
        if (pageBtn && !pageState.active) pageBtn.textContent = PAGE_BUTTON_LABEL;
      }, 1500);
      return;
    }
    pageState.active = true;
    pageState.progress = { done: 0, total: paras.length };
    pageBtn.classList.add(NS + "active");
    paras.forEach(createParaNode);
    const queue = paras.slice();
    const workers = Math.min(PARA_CONCURRENCY, queue.length);
    for (let i = 0; i < workers; i++) {
      pageWorker(queue, pageState.progress);
    }
    updatePageBtn();
  }

  function stopPageTranslation() {
    pageState.active = false;
    pageState.progress = null;
    removePageNodes();
    if (pageBtn) {
      pageBtn.textContent = PAGE_BUTTON_LABEL;
      pageBtn.classList.remove(NS + "active");
    }
  }

  function onPageBtnClick() {
    if (pageState.active) stopPageTranslation();
    else startPageTranslation();
  }

  function createPageBtn() {
    pageBtn = document.createElement("button");
    pageBtn.type = "button";
    pageBtn.className = NS + "page-btn";
    pageBtn.title = "对当前网页进行段落对照翻译";
    pageBtn.textContent = PAGE_BUTTON_LABEL;
    pageBtn.addEventListener("click", onPageBtnClick);
    document.documentElement.appendChild(pageBtn);
  }

  function cleanup() {
    stopSpeech();
    stopPageTranslation();
    if (panel) {
      panel.remove();
      panel = null;
    }
    if (icon) {
      icon.remove();
      icon = null;
    }
    if (pageBtn) {
      pageBtn.remove();
      pageBtn = null;
    }
  }

  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("selectionchange", onSelectionChange, true);
  document.addEventListener("keyup", onKeyUp, true);
  document.addEventListener("click", onClick, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
  document.addEventListener("pointermove", onHeadPointerMove);
  document.addEventListener("pointerup", onHeadPointerUp);
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);

  createPageBtn();

  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function () { window.speechSynthesis.getVoices(); };
    // load persisted TTS settings from storage
    try {
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, function (res) {
        if (!chrome.runtime.lastError && res) {
          ttsSettings.ttsVoiceName = res.ttsVoiceName || "";
          ttsSettings.ttsRate = res.ttsRate != null ? res.ttsRate : 1;
          ttsSettings.ttsPitch = res.ttsPitch != null ? res.ttsPitch : 1;
        }
      });
    } catch (e) {}
  }
})();
