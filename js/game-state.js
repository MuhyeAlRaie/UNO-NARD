/**
 * ============================================================
 *  UNO CAFE LOUNGE — تحدي النرد
 *  js/game-state.js
 * ============================================================
 *  آلة حالة اللعبة (Game State Machine) — وحدة نقية بلا DOM:
 *  تستقبل إطارات الإيماءة وأحداث المؤقتات وتُصدر انتقالات الحالة
 *  عبر hooks. كل انتقالات اللعبة تتم تلقائياً عبر الإيماءات أو
 *  المؤقتات أو أحداث النظام — بدون أي إدخال فيزيائي.
 *
 *  المسار: كشف اليد ← عد تنازلي ← قبضة ← كف مفتوح ← رمي ← جائزة
 *          ← (سكّر إيدك ثانية) ← إعادة الجولة.
 * ============================================================
 */

import { getRewardForResult, generateReferenceCode } from "./rewards.js";
import { resetGestureState } from "./hand-tracking.js";

/** حالات اللعبة */
export const GameState = Object.freeze({
  WELCOME: "WELCOME",
  CAMERA_INITIALIZING: "CAMERA_INITIALIZING",
  WAITING_FOR_HAND: "WAITING_FOR_HAND",
  COUNTDOWN: "COUNTDOWN",
  WAITING_FOR_FIST: "WAITING_FOR_FIST",
  WAITING_FOR_OPEN_PALM: "WAITING_FOR_OPEN_PALM",
  ROLLING_DICE: "ROLLING_DICE",
  SHOWING_REWARD: "SHOWING_REWARD",
  WAITING_FOR_RESTART_GESTURE: "SHOWING_REWARD", // اسم بديل واضح لنفس الحالة
  CAMERA_ERROR: "CAMERA_ERROR"
});

/**
 * إنشاء محرك اللعبة.
 * @param {object} opts
 * @param {object} opts.config GAME_CONFIG
 * @param {()=>number} [opts.rollFn] دالة رمي النرد (قابلة للحقن للاختبارات)
 * @param {object} [opts.hooks] onStateChange, onCountdownStart, onCountdownCancel,
 *                              onFistConfirmed, onGestureCancelled, onThrow,
 *                              onThrowBlocked
 */
export function createGameEngine({ config, rollFn, hooks } = {}) {
  if (!config) throw new Error("createGameEngine: config مطلوب");
  const H = hooks || {};
  const roll = typeof rollFn === "function" ? rollFn : () => 1;

  let state = GameState.WELCOME;
  let throwsThisSession = 0;
  let throwLock = false; // قفل الإيماءة: رمية واحدة لكل جولة بلا تكرار
  let lastResult = null;
  let lastPresentAt = 0;

  function setState(next, payload = {}) {
    if (state === next) return;
    const prev = state;
    state = next;
    if (typeof H.onStateChange === "function") {
      try {
        H.onStateChange(next, prev, payload);
      } catch (err) {
        console.error("[UNO] خطأ في onStateChange:", err);
      }
    }
  }

  /** هل غابت اليد لمدة تتجاوز مهلة التحمل؟ */
  function lostTooLong(frame) {
    if (frame.present) return false;
    const baseline = lastPresentAt || frame.now;
    return frame.now - baseline > config.camera.lostHandToleranceMs;
  }

  const engine = {
    getState: () => state,
    getThrowsThisSession: () => throwsThisSession,
    getLastResult: () => lastResult,

    /**
     * تحديث حالة الكاميرا/النظام:
     *  'initializing' | 'error' | 'ready'
     */
    setCameraStatus(status, payload = {}) {
      if (status === "initializing") {
        setState(GameState.CAMERA_INITIALIZING, payload);
      } else if (status === "error") {
        setState(GameState.CAMERA_ERROR, payload);
      } else if (status === "ready") {
        throwsThisSession = 0;
        throwLock = false;
        lastResult = null;
        resetGestureState();
        setState(GameState.WAITING_FOR_HAND, { fresh: true, ...payload });
      }
    },

    /** يُستدعى من main.js عند اكتمال العد التنازلي (بعد GO!) */
    handleCountdownFinished() {
      if (state !== GameState.COUNTDOWN) return;
      setState(GameState.WAITING_FOR_FIST, {});
    },

    /**
     * المعالج الرئيسي لإطارات اليد.
     * @param {{present:boolean, gesture:string, heldMs:number, now:number}} frame
     */
    handleHandFrame(frame) {
      const now = frame.now ?? (typeof performance !== "undefined" ? performance.now() : 0);
      if (frame.present) lastPresentAt = now;

      switch (state) {
        case GameState.WAITING_FOR_HAND: {
          // كف مفتوح مستقر = رغبة واضحة في اللعب — يبدأ العد تلقائياً
          if (frame.present && frame.gesture === "OPEN_PALM" && frame.heldMs >= config.camera.stableDetectionMs) {
            setState(GameState.COUNTDOWN, { prepare: true });
            if (typeof H.onCountdownStart === "function") H.onCountdownStart();
          }
          break;
        }

        case GameState.COUNTDOWN: {
          // اختفاء اليد أثناء العد = إلغاء تلقائي والعودة للانتظار
          if (lostTooLong(frame)) {
            if (typeof H.onCountdownCancel === "function") H.onCountdownCancel();
            resetGestureState();
            setState(GameState.WAITING_FOR_HAND, { lost: true });
          }
          break;
        }

        case GameState.WAITING_FOR_FIST: {
          if (lostTooLong(frame)) {
            resetGestureState();
            setState(GameState.WAITING_FOR_HAND, { lost: true });
            if (typeof H.onGestureCancelled === "function") H.onGestureCancelled();
          } else if (frame.present && frame.gesture === "CLOSED_FIST" && frame.heldMs >= config.camera.fistHoldMs) {
            // القبضة المسكّرة تسلّح الرمية فقط — لا ترمي النرد
            setState(GameState.WAITING_FOR_OPEN_PALM, {});
            if (typeof H.onFistConfirmed === "function") H.onFistConfirmed();
          }
          break;
        }

        case GameState.WAITING_FOR_OPEN_PALM: {
          if (lostTooLong(frame)) {
            // اليد اختفت قبل إتمام الإيماءة — إلغاء الإيماءة المعلقة
            resetGestureState();
            setState(GameState.WAITING_FOR_HAND, { lost: true });
            if (typeof H.onGestureCancelled === "function") H.onGestureCancelled();
          } else if (frame.present && frame.gesture === "OPEN_PALM" && frame.heldMs >= config.camera.openPalmHoldMs) {
            engine.requestThrow(now);
          }
          break;
        }

        case GameState.SHOWING_REWARD: {
          // إعادة الجولة بالإيماءة فقط: قبضة ثابتة ثانية واحدة
          if (frame.present && frame.gesture === "CLOSED_FIST" && frame.heldMs >= config.camera.restartFistHoldMs) {
            engine.restart();
          }
          break;
        }

        default:
          // ROLLING_DICE / WELCOME / CAMERA_* — الإيماءات مقفلة
          break;
      }
    },

    /**
     * تنفيذ الرمية — مرة واحدة فقط لكل جولة.
     * @returns {boolean} هل نُفذت الرمية؟
     */
    requestThrow(now = typeof performance !== "undefined" ? performance.now() : 0) {
      if (state !== GameState.WAITING_FOR_OPEN_PALM) return false;
      if (throwLock) return false; // منع الرميات المكررة من إطارات متتالية
      const max = (config.game && config.game.maxThrowsPerSession) || 1;
      if (throwsThisSession >= max) {
        if (typeof H.onThrowBlocked === "function") {
          try {
            H.onThrowBlocked({ throwsThisSession, max });
          } catch (err) {
            console.error(err);
          }
        }
        return false;
      }
      throwLock = true;
      throwsThisSession += 1;
      lastResult = roll();
      setState(GameState.ROLLING_DICE, { result: lastResult });
      if (typeof H.onThrow === "function") H.onThrow(lastResult);
      return true;
    },

    /** يُستدعى من main.js عند انتهاء أنيميشن النرد */
    handleDiceAnimationFinished() {
      if (state !== GameState.ROLLING_DICE) return;
      const result = lastResult;
      const reward = getRewardForResult(result) || { title: "مفاجأة من أونو", discountPercent: 0 };
      const code = generateReferenceCode();
      setState(GameState.SHOWING_REWARD, { result, reward, code });
    },

    /**
     * إعادة الجولة (من شاشة الجائزة عبر قبضة ثابتة):
     * تصفير الجولة السابقة والجلسة والعودة لانتظار اليد.
     * @returns {boolean}
     */
    restart() {
      if (state !== GameState.SHOWING_REWARD) return false;
      throwsThisSession = 0; // جلسة جديدة
      throwLock = false;
      lastResult = null;
      resetGestureState();
      setState(GameState.WAITING_FOR_HAND, { restart: true });
      return true;
    },

    /** تصفير العدّاد لأغراض الاختبار (وضع المطور فقط) */
    resetSessionForTesting() {
      if (config.game && config.game.testMode) {
        throwsThisSession = 0;
        throwLock = false;
      }
    },

    /** للاختبارات فقط مع testMode */
    forceStateForTesting(s) {
      if (config.game && config.game.testMode) {
        state = s;
      }
    }
  };

  return engine;
}
