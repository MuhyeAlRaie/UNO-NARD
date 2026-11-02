/**
 * ============================================================
 *  UNO CAFE LOUNGE — تحدي النرد
 *  js/main.js
 * ============================================================
 *  المنسّق الرئيسي:
 *  - تشغيل تلقائي كامل عند تحميل الصفحة (بدون أي زر أو لمسة).
 *  - تشغيل الكاميرا + MediaPipe بالتوازي، مع استرجاع تلقائي عند
 *    فشل الكاميرا أو فقدانها.
 *  - ربط إطارات اليد بآلة الحالة، وإدارة العد التنازلي والأنيميشن
 *    والجائزة وإعادة الجولة بالإيماءة.
 *  - وضع المطور (testMode): لوحة تشخيص ومحاكاة إيماءات — مخفية
 *    تماماً عن العملاء في الوضع العادي.
 * ============================================================
 */

import { GAME_CONFIG, validateGameConfig, getProbabilitySummary } from "./game-config.js";
import { GameState, createGameEngine } from "./game-state.js";
import {
  initHandTracking,
  startCamera,
  stopCamera,
  getCameraActive,
  setGestureStateHandler,
  GESTURE
} from "./hand-tracking.js";
import { rollDice } from "./dice-engine.js";
import { getRewardForResult } from "./rewards.js";
import * as UI from "./ui.js";

let engine = null;
let bootStarted = false;
let countdownTimers = [];
let nudgeTimer = 0;
let forcedResult = null; // وضع المطور فقط
let lastPresentAt = 0;
let previousGestureForDiag = GESTURE.NO_HAND;
let recoveryTimer = 0;
let pipelineRetrying = false;

// ------------------------------------------------------------
//  الإقلاع
// ------------------------------------------------------------
async function boot() {
  if (bootStarted) return;
  bootStarted = true;

  UI.initUI(GAME_CONFIG);

  const validation = validateGameConfig(GAME_CONFIG);
  if (!validation.ok) {
    console.error("[UNO] إعدادات غير صالحة:", validation.errors);
    UI.showConfigError(validation.errors);
    return;
  }
  if (validation.warnings.length) {
    console.warn("[UNO] تحذيرات الإعدادات:", validation.warnings);
  }

  createEngine();
  UI.showScreen("welcome");
  // لحظة ظهور شاشة الترحيب قبل الانتقال لتشغيل الكاميرا تلقائياً
  await new Promise((resolve) => setTimeout(resolve, 1500));
  engine.setCameraStatus("initializing");
  await startVisionPipeline();
  setupLifecycle();
}

function createEngine() {
  engine = createGameEngine({
    config: GAME_CONFIG,
    rollFn: () => (forcedResult !== null ? forcedResult : rollDice()),
    hooks: {
      onStateChange: applyState,
      onCountdownStart: runCountdown,
      onCountdownCancel: clearCountdownTimers,
      onFistConfirmed: () => {
        UI.setGesturePhase("open");
        UI.sounds.confirm();
        UI.devLog("تم تأكيد القبضة — بانتظار فتح الكف");
      },
      onGestureCancelled: () => UI.devLog("أُلغيت الإيماءة المعلقة (فقدان اليد)"),
      onThrow: handleThrow,
      onThrowBlocked: (info) => {
        UI.devLog(`رميات الجلسة مستنفدة (${info.max}) — أعد الجولة بالإيماءة`);
        UI.setInstruction("gesture", "انتهت رميات هذه الجلسة. سكّر إيدك وثبّتها لمدة ثانية لبدء جلسة جديدة.");
      }
    }
  });
}

// ------------------------------------------------------------
//  خط أنابيب الرؤية (كاميرا + نموذج بالتوازي)
// ------------------------------------------------------------
async function startVisionPipeline() {
  const video = UI.els["camera-video"];
  const canvas = UI.els["hand-canvas"];

  // معالج الإيماءة الوحيد — حلقة معالجة واحدة في hand-tracking
  setGestureStateHandler(onHandFrame);

  const cameraAttempt = startCamera(video, canvas).then(
    () => ({ ok: true }),
    (error) => ({ ok: false, kind: "camera", error })
  );
  const modelAttempt = isModelReadyCached()
    ? Promise.resolve({ ok: true })
    : initHandTracking(GAME_CONFIG, {
        onFrame: onHandFrame,
        onCameraLost: handleCameraLost
      }).then(
        () => ({ ok: true }),
        (error) => ({ ok: false, kind: "model", error })
      );

  const [cameraResult, modelResult] = await Promise.all([cameraAttempt, modelAttempt]);

  if (!cameraResult.ok) {
    handleCameraError(cameraResult.error);
    return;
  }
  if (!modelResult.ok) {
    handleModelError(modelResult.error);
    return;
  }
  modelReadyFlag = true;

  UI.sounds.unlock(); // محاولة تفعيل الصوت (اختياري — تُتجاهل بصمت إن رفض المتصفح)
  engine.setCameraStatus("ready");
  UI.devLog("الكاميرا ونموذج تتبع اليد جاهزان");
  scheduleCameraRecoveryWatch();

  if (GAME_CONFIG.game.testMode) {
    showDevPanel();
  }
}

/** هل تم تحميل نموذج MediaPipe بنجاح سابقاً؟ (يتجنّب إعادة التهيئة عند إعادة المحاولة) */
let modelReadyFlag = false;
function isModelReadyCached() {
  return modelReadyFlag;
}

// ------------------------------------------------------------
//  معالجة إطارات اليد
// ------------------------------------------------------------
function onHandFrame(frame) {
  if (!engine) return;
  if (frame.present) lastPresentAt = frame.now;

  // تشخيص الانتقال بين الإيماءات (للعرض التقني فقط)
  const transition = transitionLabel(previousGestureForDiag, frame.gesture);
  previousGestureForDiag = frame.gesture;

  UI.setGestureBadge(frame.gesture);
  UI.updateDiagnostic({
    state: engine.getState(),
    gesture: frame.gesture,
    heldMs: frame.heldMs,
    fps: frame.fps,
    throws: engine.getThrowsThisSession(),
    cam: getCameraActive()
  });

  if (transition && transition !== "NONE") {
    UI.devLog(`انتقال الإيماءة: ${transition}`);
  }

  engine.handleHandFrame(frame);
}

function transitionLabel(prev, curr) {
  if (prev === curr) return "NONE";
  if (curr === GESTURE.NO_HAND) return "HAND_LOST";
  if (prev === GESTURE.NO_HAND) return "HAND_APPEARED";
  if (prev === GESTURE.CLOSED_FIST && curr === GESTURE.OPEN_PALM) return "FIST_TO_PALM";
  if (prev === GESTURE.OPEN_PALM && curr === GESTURE.CLOSED_FIST) return "PALM_TO_FIST";
  return "GESTURE_CHANGED";
}

// ------------------------------------------------------------
//  تطبيق الحالة على الواجهة
// ------------------------------------------------------------
function screenKeyFor(state) {
  switch (state) {
    case GameState.WELCOME: return "welcome";
    case GameState.CAMERA_INITIALIZING: return "camera";
    case GameState.WAITING_FOR_HAND: return "waiting";
    case GameState.COUNTDOWN: return "countdown";
    case GameState.WAITING_FOR_FIST:
    case GameState.WAITING_FOR_OPEN_PALM: return "gesture";
    case GameState.ROLLING_DICE: return "rolling";
    case GameState.SHOWING_REWARD: return "reward";
    case GameState.CAMERA_ERROR: return "error";
    default: return "welcome";
  }
}

function applyState(state, prev, payload) {
  clearTimeout(nudgeTimer);

  switch (state) {
    case GameState.WELCOME:
      UI.showScreen("welcome");
      break;

    case GameState.CAMERA_INITIALIZING:
      UI.showScreen("camera");
      break;

    case GameState.WAITING_FOR_HAND:
      UI.showScreen("waiting");
      UI.setInstruction(
        "waiting",
        payload && payload.lost
          ? "ما قدرنا نشوف إيدك. رجّعها قدام الكاميرا"
          : "وجّه إيدك نحو الكاميرا"
      );
      UI.devLog(payload && payload.restart ? "جولة جديدة — بانتظار كف مفتوح" : "بانتظار كف مفتوح مستقر");
      break;

    case GameState.COUNTDOWN:
      UI.showScreen("countdown");
      break;

    case GameState.WAITING_FOR_FIST:
      UI.showScreen("gesture");
      UI.setGesturePhase("fist");
      UI.setInstruction("gesture", "سكّر إيدك، وبعدين افتحها لترمي النرد!");
      nudgeTimer = setTimeout(() => {
        UI.setInstruction("gesture", "سكّر إيدك كامل وثبّتها لحظة، وبعدين افتحها!");
      }, 20000);
      break;

    case GameState.WAITING_FOR_OPEN_PALM:
      UI.setGesturePhase("open");
      UI.setInstruction("gesture", "ممتاز! هسا افتح إيدك لترمي النرد.");
      break;

    case GameState.ROLLING_DICE:
      UI.showScreen("rolling");
      UI.setGesturePhase("rolling");
      UI.setInstruction("rolling", "جاري رمي النرد...");
      break;

    case GameState.SHOWING_REWARD:
      UI.showScreen("reward");
      UI.showReward(payload);
      UI.devLog(`جائزة النتيجة ${payload.result}: ${payload.reward.title} (${payload.reward.discountPercent}%) — كود ${payload.code}`);
      if (payload.reward.discountPercent > 0) {
        UI.sounds.win();
      } else {
        UI.sounds.neutral();
      }
      break;

    case GameState.CAMERA_ERROR:
      UI.showScreen("error");
      break;
  }
}

// ------------------------------------------------------------
//  العد التنازلي
// ------------------------------------------------------------
function runCountdown() {
  clearCountdownTimers();
  const seconds = Math.max(1, Math.min(10, GAME_CONFIG.countdown.seconds | 0));
  const schedule = (fn, t) => countdownTimers.push(setTimeout(fn, t));

  schedule(() => {
    UI.showCountdownValue("استعد!", "prepare");
    UI.sounds.tick();
  }, 0);

  for (let i = 1; i <= seconds; i++) {
    const label = String(seconds - i + 1);
    schedule(() => {
      UI.showCountdownValue(label, "number");
      UI.sounds.tick();
    }, i * 1000);
  }

  schedule(() => {
    UI.showCountdownValue("GO!", "go");
    UI.sounds.go();
  }, (seconds + 1) * 1000);

  schedule(() => engine.handleCountdownFinished(), (seconds + 1) * 1000 + 650);
}

function clearCountdownTimers() {
  countdownTimers.forEach(clearTimeout);
  countdownTimers = [];
}

// ------------------------------------------------------------
//  الرمية والأنيميشن
// ------------------------------------------------------------
function handleThrow(result) {
  UI.devLog(`رمية ${engine.getThrowsThisSession()}: النتيجة ${result} (من محرك الاحتمالات قبل الأنيميشن)`);
  UI.sounds.roll(GAME_CONFIG.dice.rollDurationMs);
  UI.animateDiceRoll(result, {
    durationMs: GAME_CONFIG.dice.rollDurationMs,
    onDone: () => engine.handleDiceAnimationFinished()
  });
}

// ------------------------------------------------------------
//  أخطاء الكاميرا والموديل + الاسترجاع التلقائي
// ------------------------------------------------------------
function describeCameraError(err) {
  const name = err && err.name ? err.name : "";
  const message = err && err.message ? String(err.message) : "";

  if (message === "MEDIA_DEVICES_UNSUPPORTED" || !navigator.mediaDevices) {
    return {
      title: "المتصفح ما يدعم الكاميرا",
      detail: "هذا المتصفح لا يوفر واجهة الكاميرا المطلوبة.",
      steps: ["استخدم متصفحاً حديثاً مثل Chrome أو Edge أو Safari", "حدّث المتصفح لأحدث إصدار"],
      retryable: false
    };
  }
  if (message === "VIDEO_METADATA_TIMEOUT") {
    return {
      title: "الكاميرا ما استجابت",
      detail: "استنفدنا المهلة أثناء انتظار بيانات الكاميرا.",
      steps: ["تأكد أن الكاميرا غير معطّلة من النظام", "سيتم إعادة المحاولة تلقائياً"],
      retryable: true
    };
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return {
      title: "يلزم تشغيل الصفحة عبر HTTPS أو localhost",
      detail: "المتصفحات تمنع الكاميرا في الصفحات غير الآمنة.",
      steps: ["شغّل الصفحة عبر https:// أو http://localhost", "لا تعمل من ملف file:// مباشرة"],
      retryable: false
    };
  }
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        title: "إذن الكاميرا مرفوض",
        detail: "ما نقدر نشوف إيدك بدون كاميرا — وما في أي أزرار أو بدائل لمسية بالتصميم.",
        steps: [
          "افتح إعدادات المتصفح (أيقونة القفل بجانب العنوان)",
          "خلي إذن الكاميرا «مسموح» لهذي الصفحة",
          "ارجع للصفحة — سيشتغل التطبيق تلقائياً بدون أي ضغطة"
        ],
        retryable: true
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        title: "ما في كاميرا موصولة",
        detail: "ما لقينا أي كاميرا على الجهاز.",
        steps: ["وصّل كاميرا أو فعّل الكاميرا المدمجة", "سيتم الاكتشاف وإعادة التشغيل تلقائياً"],
        retryable: true
      };
    case "NotReadableError":
    case "TrackStartError":
      return {
        title: "الكاميرا مستخدمة من برنامج ثاني",
        detail: "برنامج آخر مسكّر الكاميرا حالياً.",
        steps: ["سكّر أي تطبيق يستخدم الكاميرا (Zoom و Teams وغيرها)", "سيتم إعادة المحاولة تلقائياً"],
        retryable: true
      };
    case "OverconstrainedError":
      return {
        title: "إعدادات الكاميرا غير مدعومة",
        detail: "الكاميرا لا تدعم الدقة المطلوبة.",
        steps: ["جرّب كاميرا أخرى", "سيتم إعادة المحاولة تلقائياً"],
        retryable: true
      };
    default:
      return {
        title: "تعذّر تشغيل الكاميرا",
        detail: "حدث خطأ غير متوقع أثناء الوصول للكاميرا.",
        steps: ["تأكد من إذن الكاميرا ومن عدم استخدامها من تطبيق آخر", "سيتم إعادة المحاولة تلقائياً"],
        retryable: true
      };
  }
}

function handleCameraError(err) {
  console.error("[UNO] خطأ كاميرا:", err);
  stopCamera();
  const info = describeCameraError(err);
  engine.setCameraStatus("error", { kind: "camera", ...info });
  UI.showCameraError(info);
  scheduleAutoRetry(info.retryable);
}

function handleModelError(err) {
  console.error("[UNO] خطأ تحميل MediaPipe:", err);
  const info = {
    title: "تعذّر تحميل نظام تتبع اليد",
    detail: "مكوّن MediaPipe يُحمّل من الإنترنت عند أول تشغيل.",
    steps: [
      "تأكد من اتصال الجهاز بالإنترنت",
      "حدّث الصفحة وسيُعاد التحميل تلقائياً",
      "تأكد أن المتصفح يدعم WebGL"
    ],
    retryable: true
  };
  engine.setCameraStatus("error", { kind: "model", ...info });
  UI.showCameraError(info);
  scheduleAutoRetry(true);
}

function handleCameraLost() {
  UI.devLog("فُقد مسار الكاميرا أثناء التشغيل");
  stopCamera();
  const info = {
    title: "انقطع الاتصال بالكاميرا",
    detail: "أُوقفت الكاميرا أو فُصلت أثناء اللعب.",
    steps: ["تأكد من توصيل الكاميرا", "سيتم إعادة التشغيل تلقائياً عند توفرها"],
    retryable: true
  };
  engine.setCameraStatus("error", { kind: "camera_lost", ...info });
  UI.showCameraError(info);
  scheduleAutoRetry(true);
}

/**
 * استرجاع تلقائي: إعادة محاولة كل 8 ثوانٍ طالما في حالة الخطأ.
 * عندما يمنح المستخدم إذن الكاميرا أو تتحرر الكاميرا، ترجع اللعبة
 * تشتغل من تلقاء نفسها — بدون أي زر.
 */
function scheduleAutoRetry(retryable) {
  clearInterval(recoveryTimer);
  if (!retryable) return;
  recoveryTimer = setInterval(() => {
    if (!engine || engine.getState() !== GameState.CAMERA_ERROR) {
      clearInterval(recoveryTimer);
      return;
    }
    if (!pipelineRetrying) {
      retryVisionPipeline();
    }
  }, 8000);
}

/** مراقبة تغيّر إذن الكاميرا (مثلاً بعد منحه من إعدادات المتصفح) */
function scheduleCameraRecoveryWatch() {
  if (!navigator.permissions || !navigator.permissions.query) return;
  navigator.permissions
    .query({ name: "camera" })
    .then((status) => {
      status.onchange = () => {
        UI.devLog(`حالة إذن الكاميرا: ${status.state}`);
        if (status.state === "granted" && engine && engine.getState() === GameState.CAMERA_ERROR) {
          retryVisionPipeline();
        }
      };
    })
    .catch(() => {
      /* بعض المتصفحات لا تدعم مراقبة إذن camera — الاسترجاع الدوري يكفي */
    });
}

async function retryVisionPipeline() {
  if (pipelineRetrying) return;
  pipelineRetrying = true;
  try {
    stopCamera();
    engine.setCameraStatus("initializing");
    await startVisionPipeline();
  } catch (err) {
    console.error("[UNO] فشلت إعادة التشغيل:", err);
    handleCameraError(err);
  } finally {
    pipelineRetrying = false;
  }
}

// ------------------------------------------------------------
//  أحداث دورة حياة الصفحة — تنظيف الموارد
// ------------------------------------------------------------
function setupLifecycle() {
  const cleanup = () => {
    stopCamera();
    clearCountdownTimers();
    clearInterval(recoveryTimer);
  };
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      UI.sounds.unlock();
      if (engine && engine.getState() === GameState.CAMERA_ERROR && !getCameraActive() && !pipelineRetrying) {
        retryVisionPipeline();
      }
    }
  });

  // محاولات فتح قناة الصوت عند أول تفاعل نظام (اختياري — الصوت ليس شرطاً)
  ["pointerdown", "keydown"].forEach((ev) =>
    window.addEventListener(ev, () => UI.sounds.unlock(), { once: true, passive: true })
  );

  // وضع المطور: أدوات وحدة تحكم
  if (GAME_CONFIG.game.testMode) {
    window.UNO_DEBUG = {
      engine,
      config: GAME_CONFIG,
      probability: getProbabilitySummary(),
      forceResult: (n) => (forcedResult = n >= 1 && n <= 6 ? n : null),
      getState: () => engine.getState()
    };
    console.info("[UNO] وضع المطور فعّال — available: window.UNO_DEBUG");
    showDevPanel();
  }
}

// ------------------------------------------------------------
//  لوحة المطور (testMode فقط)
// ------------------------------------------------------------
function showDevPanel() {
  UI.showDevPanel({
    simulate: simulateGesture,
    forceResult: (n) => {
      forcedResult = n;
    },
    logRewards: () => {
      for (let f = GAME_CONFIG.dice.minValue; f <= GAME_CONFIG.dice.maxValue; f++) {
        const r = getRewardForResult(f);
        UI.devLog(`الوجه ${f}: ${r ? r.title + " | خصم " + r.discountPercent + "%" : "غير معرّف!"}`);
      }
      UI.devLog("الاحتمالات: " + JSON.stringify(getProbabilitySummary().map((p) => ({ [p.face]: +(p.probability * 100).toFixed(2) + "%" }))));
    },
    toggleCamera: () => {
      if (getCameraActive()) {
        stopCamera();
        UI.devLog("الكاميرا أُوقفت يدوياً (اختبار تحرير الموارد)");
      } else {
        retryVisionPipeline();
      }
    },
    resetSession: () => {
      engine.resetSessionForTesting();
      if (engine.getState() === GameState.SHOWING_REWARD) engine.restart();
      UI.devLog("تم تصفير عدّاد الجلسة");
    }
  });
}

/**
 * محاكاة إيماءة (وضع المطور): تُغذي آلة الحالة بإطار اصطناعي
 * ثابت الثبات لاختبار كامل التدفق بدون كاميرا.
 */
function simulateGesture(gesture) {
  if (!engine) return;
  const now = performance.now();
  const frame = {
    present: gesture !== GESTURE.NO_HAND,
    landmarks: null,
    gesture,
    heldMs: 99999,
    now: Math.max(now, lastPresentAt + 1)
  };
  UI.devLog(`محاكاة إيماءة: ${gesture}`);
  onHandFrame(frame);
}

// ------------------------------------------------------------
//  بدء التشغيل
// ------------------------------------------------------------
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
