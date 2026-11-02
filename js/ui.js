/**
 * ============================================================
 *  UNO CAFE LOUNGE — تحدي النرد
 *  js/ui.js
 * ============================================================
 *  طبقة الواجهة: إدارة الشاشات، التعليمات العربية، أنيميشن النرد
 *  ثلاثي الأبعاد (CSS 3D)، شاشة الجائزة، الأخطاء، لوحة المطور،
 *  ومؤثرات صوتية مولّدة عبر WebAudio (بدون ملفات صوت).
 *  الصوت اختياري — كل المعلومات الأساسية متوفرة بصرياً.
 * ============================================================
 */

import { GAME_CONFIG } from "./game-config.js";

const $id = (id) => document.getElementById(id);

export const els = {};

const SCREEN_KEYS = ["welcome", "camera", "waiting", "countdown", "gesture", "rolling", "reward", "error"];

const AR_GESTURE_LABEL = {
  NO_HAND: "ما في يد",
  UNKNOWN: "وضعية غير واضحة",
  OPEN_PALM: "كف مفتوح",
  CLOSED_FIST: "قبضة مسكّرة"
};

/** اتجاهات عرض كل وجه من النرد: [rotateX, rotateY] */
const DICE_FACE_ORIENTATION = {
  1: [0, 0],
  2: [-90, 0],
  3: [0, -90],
  4: [0, 90],
  5: [90, 0],
  6: [0, 180]
};

const PRIVACY_TEXT =
  "نستخدم الكاميرا لاكتشاف حركة اليد فقط. لا يتم تسجيل الفيديو أو رفعه إلى أي خادم.";

// ------------------------------------------------------------
//  التهيئة
// ------------------------------------------------------------
export function initUI(config) {
  const ids = [
    "camera-preview", "camera-video", "hand-canvas", "gesture-badge", "privacy-note",
    "count-value", "count-label", "inst-waiting", "inst-gesture", "inst-rolling",
    "gesture-steps", "dice-scene", "dice-cube", "reward-card", "reward-title",
    "reward-percent", "reward-result", "reward-code", "reward-terms",
    "error-title", "error-detail", "error-steps", "dev-panel", "dev-log",
    "diag-state", "diag-gesture", "diag-held", "diag-fps", "diag-throws", "diag-cam",
    "odds-note", "dev-force"
  ];
  for (const id of ids) els[id] = $id(id);

  els.screens = {};
  for (const key of SCREEN_KEYS) els.screens[key] = $id(`screen-${key}`);

  const testMode = !!(config.game && config.game.testMode);
  document.body.classList.toggle("test-mode", testMode);

  // الشعار + بديل نصي عند غياب الصورة
  document.querySelectorAll("img.brand-logo").forEach((img) => {
    const fail = () => {
      img.style.display = "none";
      const fallback = img.closest(".logo-wrap")?.querySelector(".logo-fallback");
      if (fallback) fallback.hidden = false;
    };
    img.addEventListener("error", fail);
    img.src = config.logoPath;
    if (img.complete && img.naturalWidth === 0) fail();
  });

  document.querySelectorAll(".brand-name-text").forEach((el) => {
    el.textContent = config.brandName;
  });

  if (els["privacy-note"]) els["privacy-note"].textContent = PRIVACY_TEXT;
  if (els["reward-terms"]) els["reward-terms"].textContent = (config.promotion && config.promotion.terms) || "";
  if (els["odds-note"]) els["odds-note"].hidden = !(config.promotion && config.promotion.requireOddsDisclosure);
}

// ------------------------------------------------------------
//  الشاشات والتعليمات
// ------------------------------------------------------------
export function showScreen(key) {
  document.body.dataset.screen = key;
  for (const k of SCREEN_KEYS) {
    els.screens[k]?.classList.toggle("active", k === key);
  }
  // معاينة الكاميرا تظهر فقط أثناء اللعب الفعلي
  const withPreview = ["waiting", "countdown", "gesture", "rolling", "reward"];
  els["camera-preview"]?.classList.toggle("show", withPreview.includes(key));
}

export function setInstruction(screenKey, text) {
  const el = els[`inst-${screenKey}`];
  if (el) el.textContent = text;
}

/** تحديث خطوات الإيماءة على شاشة التحدي (palm | fist | open) */
export function setGesturePhase(phase) {
  if (els["gesture-steps"]) els["gesture-steps"].dataset.phase = phase;
}

export function showCountdownValue(text, kind = "number") {
  const el = els["count-value"];
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
  el.classList.remove("pop");
  void el.offsetWidth; // إعادة تشغيل الأنيميشن
  el.classList.add("pop");
}

export function setGestureBadge(gesture) {
  const b = els["gesture-badge"];
  if (!b) return;
  b.textContent = AR_GESTURE_LABEL[gesture] || "";
}

// ------------------------------------------------------------
//  أنيميشن النرد ثلاثي الأبعاد
//  النتيجة محددة سلفاً من محرك الاحتمالات — الأنيميشن عرض فقط
//  وينتهي دائماً بالوجه المطابق للنتيجة.
// ------------------------------------------------------------
export function animateDiceRoll(result, { durationMs = 2200, onDone } = {}) {
  const scene = els["dice-scene"];
  const cube = els["dice-cube"];
  if (!scene || !cube) {
    if (typeof onDone === "function") onDone();
    return;
  }

  const reduceMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduceMotion ? Math.min(500, durationMs) : durationMs;
  const [fx, fy] = DICE_FACE_ORIENTATION[result] || DICE_FACE_ORIENTATION[1];

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    cube.style.transition = "none";
    // تثبيت الوجه النهائي بدقة مطابقة للنتيجة
    cube.style.transform = `rotateX(${fx}deg) rotateY(${fy}deg)`;
    scene.classList.remove("rolling");
    if (typeof onDone === "function") onDone();
  };

  if (reduceMotion) {
    // حركة مخففة: انتقال قصير بدون دوران أو قفز
    cube.style.transition = "none";
    cube.style.transform = "rotateX(0deg) rotateY(0deg)";
    void cube.offsetWidth;
    cube.style.transition = `transform ${duration}ms ease`;
    cube.style.transform = `rotateX(${fx}deg) rotateY(${fy}deg)`;
  } else {
    const spinsX = 360 * (2 + Math.floor(Math.random() * 2));
    const spinsY = 360 * (2 + Math.floor(Math.random() * 2));
    cube.style.transition = "none";
    cube.style.transform = "rotateX(0deg) rotateY(0deg)";
    void cube.offsetWidth;
    cube.style.transition = `transform ${duration}ms cubic-bezier(.16,.84,.28,1)`;
    // لفات كاملة إضافية (مضاعفات 360) تنتهي على وجه النتيجة حتماً
    cube.style.transform = `rotateX(${fx + spinsX}deg) rotateY(${fy + spinsY}deg)`;
    scene.style.setProperty("--roll-dur", `${duration}ms`);
    scene.classList.add("rolling");
  }

  cube.addEventListener("transitionend", finish, { once: true });
  setTimeout(finish, duration + 200); // شبكة أمان لو لم يُطلق transitionend
}

// ------------------------------------------------------------
//  شاشة الجائزة
// ------------------------------------------------------------
export function showReward({ result, reward, code }) {
  const hasDiscount = Number.isInteger(reward.discountPercent) && reward.discountPercent > 0;

  if (els["reward-result"]) els["reward-result"].textContent = String(result);
  if (els["reward-title"]) {
    els["reward-title"].textContent = hasDiscount ? `مبروك! ربحت ${reward.title}` : reward.title;
  }
  if (els["reward-percent"]) {
    els["reward-percent"].textContent = hasDiscount ? `${reward.discountPercent}%` : "—";
  }
  if (els["reward-code"]) els["reward-code"].textContent = code || "";
  els["reward-card"]?.classList.toggle("winner", hasDiscount);
}

// ------------------------------------------------------------
//  شاشات الأخطاء
// ------------------------------------------------------------
export function showCameraError({ title, detail, steps }) {
  if (els["error-title"]) els["error-title"].textContent = title || "حدث خطأ";
  if (els["error-detail"]) els["error-detail"].textContent = detail || "";
  const ul = els["error-steps"];
  if (ul) {
    ul.innerHTML = "";
    (steps || []).forEach((s) => {
      const li = document.createElement("li");
      li.textContent = s;
      ul.appendChild(li);
    });
  }
  showScreen("error");
}

export function showConfigError(errors) {
  showCameraError({
    title: "في مشكلة بإعدادات اللعبة",
    detail: "راجع ملف js/game-config.js مع المسؤول التقني عن الجهاز.",
    steps: errors.slice(0, 6)
  });
}

// ------------------------------------------------------------
//  لوحة التشخيص (وضع المطور فقط — مخفية تماماً عن العملاء)
// ------------------------------------------------------------
export function updateDiagnostic(d) {
  if (!document.body.classList.contains("test-mode")) return;
  const set = (k, v) => {
    const el = els[k];
    if (el) el.textContent = v;
  };
  set("diag-state", d.state || "");
  set("diag-gesture", d.gesture || "");
  set("diag-held", `${Math.round(d.heldMs || 0)}ms`);
  set("diag-fps", `${d.fps || 0} fps`);
  set("diag-throws", String(d.throws ?? 0));
  set("diag-cam", d.cam ? "متصلة" : "مقطوعة");
}

export function devLog(line) {
  const el = els["dev-log"];
  if (!el) return;
  const time = new Date().toLocaleTimeString("ar-EG");
  const lines = el.textContent.split("\n").filter(Boolean);
  lines.unshift(`[${time}] ${line}`);
  el.textContent = lines.slice(0, 40).join("\n");
}

export function showDevPanel(handlers) {
  const panel = els["dev-panel"];
  if (!panel) return;
  panel.hidden = false;

  const bind = (id, fn) => {
    const btn = $id(id);
    if (btn) btn.addEventListener("click", fn);
  };

  bind("dev-btn-palm", () => handlers.simulate("OPEN_PALM"));
  bind("dev-btn-fist", () => handlers.simulate("CLOSED_FIST"));
  bind("dev-btn-none", () => handlers.simulate("NO_HAND"));
  bind("dev-btn-force", () => {
    const input = els["dev-force"];
    const v = parseInt(input && input.value, 10);
    if (v >= 1 && v <= 6) {
      handlers.forceResult(v);
      devLog(`نتيجة النرد القادمة مفروضة = ${v}`);
    } else {
      devLog("قيمة غير صالحة — أدخل رقماً من 1 إلى 6");
    }
  });
  bind("dev-btn-rewards", handlers.logRewards);
  bind("dev-btn-cam", handlers.toggleCamera);
  bind("dev-btn-reset", handlers.resetSession);
}

// ------------------------------------------------------------
//  مؤثرات صوتية مولّدة (WebAudio) — بدون ملفات، اختيارية تماماً
// ------------------------------------------------------------
export const sounds = (() => {
  let ctx = null;

  const enabled = () => !(GAME_CONFIG.audio && GAME_CONFIG.audio.enabled === false);

  function ensure() {
    if (!enabled()) return null;
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx.state === "running" ? ctx : null;
    } catch {
      return null;
    }
  }

  function tone(freq, dur = 0.15, delay = 0, type = "sine", gain = 0.12) {
    const c = ensure();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const t0 = c.currentTime + delay;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch {
      /* الصوت اختياري — نتجاهل أي فشل بصمت */
    }
  }

  /** دقّة نرد: نبضة ضجيج مفلترة قصيرة */
  function thud(delay = 0, gain = 0.18) {
    const c = ensure();
    if (!c) return;
    try {
      const len = Math.floor(c.sampleRate * 0.06);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource();
      src.buffer = buf;
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 900;
      const g = c.createGain();
      g.gain.value = gain;
      src.connect(filter).connect(g).connect(c.destination);
      src.start(c.currentTime + delay);
    } catch {
      /* تجاهل */
    }
  }

  return {
    unlock() {
      ensure();
    },
    tick() {
      tone(760, 0.12, 0, "triangle", 0.13);
    },
    go() {
      tone(1140, 0.22, 0, "triangle", 0.17);
    },
    confirm() {
      tone(620, 0.1, 0, "sine", 0.13);
      tone(930, 0.14, 0.1, "sine", 0.13);
    },
    roll(durationMs = 2000) {
      const n = Math.max(5, Math.floor(durationMs / 150));
      for (let i = 0; i < n; i++) {
        const jitter = 0.85 + Math.random() * 0.3;
        thud(((durationMs * 0.8) / 1000) * (i / n) * jitter, 0.14 + 0.12 * Math.exp(-i / n));
      }
    },
    win() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, i * 0.09, "triangle", 0.15));
    },
    neutral() {
      tone(440, 0.18, 0, "sine", 0.1);
      tone(350, 0.22, 0.14, "sine", 0.1);
    }
  };
})();
