// 离屏文档只负责播放背景页取回的音频。
// 放在这里而不是内容脚本里，是为了不受网页 CSP / 混合内容限制，
// 也让 popup、设置页和网页共用同一套播放状态。
"use strict";

let audio = null;
let currentId = null;

function post(message) {
  try {
    chrome.runtime.sendMessage(message, function () {
      // 背景页可能刚好被回收，读一下 lastError 避免控制台报未处理错误
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // ignore
  }
}

function stopAudio() {
  if (!audio) return;
  try {
    audio.pause();
  } catch (e) {
    // ignore
  }
  audio.onended = null;
  audio.onerror = null;
  // 释放已解码的数据
  try {
    audio.removeAttribute("src");
    audio.load();
  } catch (e) {
    // ignore
  }
  audio = null;
  currentId = null;
}

function playAudio(id, src) {
  stopAudio();
  const a = new Audio();
  audio = a;
  currentId = id;

  a.onended = function () {
    if (currentId !== id) return;
    currentId = null;
    post({ type: "KOKORO_AUDIO_EVENT", id: id, event: "end" });
  };
  a.onerror = function () {
    if (currentId !== id) return;
    post({
      type: "KOKORO_AUDIO_EVENT",
      id: id,
      event: "error",
      error: "音频加载或解码失败（可尝试在设置里把音频格式改为 wav）"
    });
  };

  a.src = src;
  const played = a.play();
  if (played && typeof played.then === "function") {
    played.then(
      function () {
        if (currentId !== id) return;
        post({ type: "KOKORO_AUDIO_EVENT", id: id, event: "start" });
      },
      function (err) {
        if (currentId !== id) return;
        post({
          type: "KOKORO_AUDIO_EVENT",
          id: id,
          event: "error",
          error: "无法播放音频：" + ((err && err.message) || String(err))
        });
      }
    );
  }
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "KOKORO_PLAY") {
    playAudio(msg.id, msg.src);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "KOKORO_STOP") {
    stopAudio();
    sendResponse({ ok: true });
  }
});
