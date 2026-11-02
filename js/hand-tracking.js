/**
 * ============================================================
 *  UNO CAFE LOUNGE — تحدي النرد
 *  js/hand-tracking.js
 * ============================================================
 *  محرك تتبع اليد عبر MediaPipe Tasks Vision / Hand Landmarker.
 *
 *  - المعالجة تتم محلياً 100% داخل المتصفح: لا تسجيل، لا رفع،
 *    لا تخزين لأي إطار فيديو.
 *  - حلقة معالجة واحدة فقط (requestAnimationFrame) + تجاهل
 *    الإطارات المكررة عبر مقارنة video.currentTime.
 *  - تنعيم إطارات (EMA) + debounce ثنائي الإطار + عتبات ثقة
 *    + تصنيف "غير متأكد" (UNKNOWN) لمنع تفسير وضعية غامضة
 *    كقبضة أو كف مفتوح بالخطأ.
 * ============================================================
 */

/** تصنيفات الإيماءة المعروضة في لوحة التشخيص (وضع المطور فقط) */
export const GESTURE = Object.freeze({
  NO_HAND: "NO_HAND",
  UNKNOWN: "UNKNOWN",
  OPEN_PALM: "OPEN_PALM",
  CLOSED_FIST: "CLOSED_FIST"
});

/** أنواع الانتقالات بين الإيماءات */
export const GESTURE_TRANSITION = Object.freeze({
  NONE: "NONE",
  HAND_LOST: "HAND_LOST",
  HAND_APPEARED: "HAND_APPEARED",
  PALM_TO_FIST: "PALM_TO_FIST",
  FIST_TO_PALM: "FIST_TO_PALM",
  GESTURE_CHANGED: "GESTURE_CHANGED"
});

const MEDIAPIPE_VERSION = "0.10.14"; // نسخة مثبّتة لضمان الثبات
const MEDIAPIPE_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** وصلات عظام اليد للرسم فوق المعاينة */
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8], [5, 9],
  [9, 10], [10, 11], [11, 12], [9, 13],
  [13, 14], [14, 15], [15, 16], [13, 17],
  [17, 18], [18, 19], [19, 20], [0, 17]
];

// ---- الحالة الداخلية للوحدة ----
let landmarker = null;
let stream = null;
let videoEl = null;
let canvasEl = null;
let ctx2d = null;
let rafId = 0;
let loopActive = false;
let lastVideoTime = -1;
let lastDetectTimestamp = 0;
let aspectRatio = 16 / 9;
let configRef = null;
let frameHandlers = null;

// تنعيم المعالم + ثبات الإيماءة
let smoothedLandmarks = null;
let currentRaw = GESTURE.NO_HAND;
let pendingGesture = null;
let pendingCount = 0;
let rawSince = 0;

// إحصاءات تشخيصية
let fpsAvg = 0;
let lastFrameAt = 0;
let lastFrameInfo = null;

// ---- أدوات هندسية ----

/** مسافة ثنائية الأبعاد مع تصحيح نسبة أبعاد الفيديو */
function dist2(a, b, aspect) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * هل المعالم صالحة (21 نقطة بأرقام منطقية)؟
 * @param {Array<{x:number,y:number,z?:number}>|null} landmarks
 * @returns {boolean}
 */
export function isHandDetected(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return false;
  for (const p of landmarks) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") return false;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
    if (p.x < -0.5 || p.x > 1.5 || p.y < -0.5 || p.y > 1.5) return false;
  }
  return true;
}

/** حجم اليد المرجعي (معلم → مفصل الوسطى) لتطبيع المسافات مهما بعدت الكاميرا */
export function getHandScale(landmarks, aspect = aspectRatio) {
  if (!isHandDetected(landmarks)) return 0;
  return Math.max(dist2(landmarks[0], landmarks[9], aspect), 1e-6);
}

/**
 * نسبة امتداد إصبع: مسافة(طرف الإصبع، الرسغ) ÷ مسافة(المفصل الأوسط، الرسغ).
 * مفتوح ≈ 1.3+ ، مسكّر ≈ 0.6..0.95 — مستقلة عن حجم اليد ومسافة الكاميرا.
 */
function fingerRatio(landmarks, tipIdx, pipIdx, aspect) {
  const dTip = dist2(landmarks[tipIdx], landmarks[0], aspect);
  const dPip = dist2(landmarks[pipIdx], landmarks[0], aspect);
  return dTip / Math.max(dPip, 1e-6);
}

const EXTENDED_RATIO = 1.12; // فوق هذه النسبة: إصبع مفتوح بوضوح
const FOLDED_RATIO = 0.97;   // تحت هذه النسبة: إصبع مسكّر بوضوح

/**
 * تحليل امتداد الأصابع الأربعة (بدون الإبهام — مواقفه مضللة هندسياً).
 * @returns {{extended:number, folded:number, detail:string[]}}
 */
export function analyzeFingers(landmarks, aspect = aspectRatio) {
  const defs = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [طرف, مفصل] للسبابة..الخنصر
  let extended = 0;
  let folded = 0;
  const detail = [];
  for (const [tip, pip] of defs) {
    const r = fingerRatio(landmarks, tip, pip, aspect);
    if (r >= EXTENDED_RATIO) {
      extended++;
      detail.push("E");
    } else if (r <= FOLDED_RATIO) {
      folded++;
      detail.push("F");
    } else {
      detail.push("U"); // غير متأكد — لا يُحسب لأي اتجاه
    }
  }
  return { extended, folded, detail };
}

/**
 * هل الكف مفتوح؟ الأصابع الأربعة ممتدة (الإبهام غير مطلوب).
 * لا نعتمد على الموضع العمودي للأطراف فقط — بل على علاقات
 * المفاصل والمسافات المطبّعة بحجم اليد.
 */
export function isPalmOpen(landmarks, aspect = aspectRatio) {
  if (!isHandDetected(landmarks)) return false;
  return analyzeFingers(landmarks, aspect).extended === 4;
}

/**
 * هل القبضة مسكّرة؟ لا إصبع مفتوح + ثلاثة على الأقل مسكّرة بوضوح.
 * القبضة وحدها لا ترمي النرد — هي فقط "تسليح" للرمية.
 */
export function isFistClosed(landmarks, aspect = aspectRatio) {
  if (!isHandDetected(landmarks)) return false;
  const a = analyzeFingers(landmarks, aspect);
  return a.extended === 0 && a.folded >= 3;
}

/**
 * التصنيف اللحظي للإيماءة. الوضعيات الغامضة تُرجع UNKNOWN
 * ولن تُقبل كقبضة أو كف مفتوح.
 */
export function classifyGesture(landmarks, aspect = aspectRatio) {
  if (!isHandDetected(landmarks)) return GESTURE.NO_HAND;
  const a = analyzeFingers(landmarks, aspect);
  if (a.extended === 4) return GESTURE.OPEN_PALM;
  if (a.extended === 0 && a.folded >= 3) return GESTURE.CLOSED_FIST;
  return GESTURE.UNKNOWN;
}

/**
 * تحديد نوع الانتقال بين إيماءتين متتاليتين.
 * @param {string} previousGesture
 * @param {string} currentGesture
 * @returns {string} أحد GESTURE_TRANSITION
 */
export function detectGestureTransition(previousGesture, currentGesture) {
  if (previousGesture === currentGesture) return GESTURE_TRANSITION.NONE;
  if (currentGesture === GESTURE.NO_HAND) return GESTURE_TRANSITION.HAND_LOST;
  if (previousGesture === GESTURE.NO_HAND) return GESTURE_TRANSITION.HAND_APPEARED;
  if (previousGesture === GESTURE.CLOSED_FIST && currentGesture === GESTURE.OPEN_PALM) {
    return GESTURE_TRANSITION.FIST_TO_PALM;
  }
  if (previousGesture === GESTURE.OPEN_PALM && currentGesture === GESTURE.CLOSED_FIST) {
    return GESTURE_TRANSITION.PALM_TO_FIST;
  }
  return GESTURE_TRANSITION.GESTURE_CHANGED;
}

/** الحالة الحالية للإيماءة المستقرة (نُمررها لآلة الحالة عبر main.js) */
export function getCurrentGestureState(now = performance.now()) {
  return { gesture: currentRaw, heldMs: now - rawSince };
}

/** تصفير حالة الإيماءة (تُستدعى عند كل انتقال حالة في اللعبة) */
export function resetGestureState() {
  currentRaw = GESTURE.NO_HAND;
  pendingGesture = null;
  pendingCount = 0;
  rawSince = typeof performance !== "undefined" ? performance.now() : 0;
  smoothedLandmarks = null;
}

/**
 * تنعيم المعالم (Exponential Moving Average) لتقليل الاهتزاز
 * بين الإطارات دون إبطاء ملحوظ في الاستجابة.
 */
function smoothLandmarks(lm) {
  if (!lm) {
    smoothedLandmarks = null;
    return null;
  }
  if (!smoothedLandmarks || smoothedLandmarks.length !== lm.length) {
    smoothedLandmarks = lm.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
    return smoothedLandmarks;
  }
  const alpha = 0.55; // وزن الإطار الجديد
  for (let i = 0; i < lm.length; i++) {
    const s = smoothedLandmarks[i];
    s.x += (lm[i].x - s.x) * alpha;
    s.y += (lm[i].y - s.y) * alpha;
    s.z += (lm[i].z - s.z) * alpha;
  }
  return smoothedLandmarks;
}

/**
 * تثبيت الإيماءة مع debounce: لا نغيّر الإيماءة المعتمدة إلا بعد
 * رؤية التصنيف الجديد في إطارين متتاليين على الأقل (يمنع ومضات
 * التصنيف الخاطئة من إعادة تصفير مؤقتات الثبات).
 */
function settleGesture(raw, now) {
  if (raw === currentRaw) {
    pendingGesture = null;
    pendingCount = 0;
    return currentRaw;
  }
  if (raw === pendingGesture) {
    pendingCount++;
    if (pendingCount >= 2) {
      currentRaw = raw;
      pendingGesture = null;
      pendingCount = 0;
      rawSince = now;
    }
  } else {
    pendingGesture = raw;
    pendingCount = 1;
  }
  return currentRaw;
}

/**
 * تهيئة MediaPipe Hand Landmarker (GPU عند توفره، وإلا CPU).
 * التحميل من CDN — يتطلب اتصال إنترنت عند أول تشغيل.
 * @param {object} config GAME_CONFIG
 * @param {{onFrame?:Function, onCameraLost?:Function}} handlers
 */
export async function initHandTracking(config, handlers) {
  configRef = config;
  frameHandlers = handlers || {};
  const cam = config.camera || {};

  let vision;
  try {
    const mp = await import(/* @vite-ignore */ MEDIAPIPE_MODULE_URL);
    const { HandLandmarker, FilesetResolver } = mp;
    vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

    const buildOptions = (delegate) => ({
      baseOptions: { modelAssetPath: HAND_LANDMARKER_MODEL_URL, delegate },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: cam.handDetectionConfidence ?? 0.65,
      minHandPresenceConfidence: cam.handPresenceConfidence ?? 0.65,
      minTrackingConfidence: cam.handTrackingConfidence ?? 0.65
    });

    try {
      landmarker = await HandLandmarker.createFromOptions(vision, buildOptions("GPU"));
    } catch (gpuErr) {
      console.warn("[UNO] فشل منفذ GPU، جاري التبديل إلى CPU:", gpuErr);
      landmarker = await HandLandmarker.createFromOptions(vision, buildOptions("CPU"));
    }
  } catch (err) {
    landmarker = null;
    err.isMediaPipeError = true;
    throw err;
  }
  return landmarker;
}

/** هل تم تهيئة نموذج تتبع اليد؟ */
export function isModelReady() {
  return !!landmarker;
}

/**
 * تشغيل الكاميرا وربطها بعنصر الفيديو ثم بدء حلقة المعالجة.
 * @param {HTMLVideoElement} videoElement
 * @param {HTMLCanvasElement} canvasElement
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(videoElement, canvasElement) {
  videoEl = videoElement;
  canvasEl = canvasElement || null;
  ctx2d = canvasEl ? canvasEl.getContext("2d") : null;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("MEDIA_DEVICES_UNSUPPORTED");
  }

  const facing = (configRef && configRef.camera && configRef.camera.preferredFacingMode) || "user";
  const constraints = {
    audio: false,
    video: {
      facingMode: facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    }
  };

  stream = await navigator.mediaDevices.getUserMedia(constraints);

  videoEl.muted = true;
  videoEl.playsInline = true;
  videoEl.srcObject = stream;

  await new Promise((resolve, reject) => {
    if (videoEl.readyState >= 1 && videoEl.videoWidth > 0) {
      resolve();
      return;
    }
    const to = setTimeout(() => reject(new Error("VIDEO_METADATA_TIMEOUT")), 10000);
    videoEl.onloadedmetadata = () => {
      clearTimeout(to);
      resolve();
    };
  });

  try {
    await videoEl.play();
  } catch (playErr) {
    console.warn("[UNO] تشغيل الفيديو تلقائياً تأخر:", playErr);
  }

  aspectRatio = (videoEl.videoWidth || 1280) / (videoEl.videoHeight || 720);
  if (canvasEl) {
    canvasEl.width = videoEl.videoWidth || 1280;
    canvasEl.height = videoEl.videoHeight || 720;
  }

  resetGestureState();
  startLoop();
  return stream;
}

/** هل بث الكاميرا نشط؟ */
export function getCameraActive() {
  return !!(stream && stream.getVideoTracks().some((t) => t.readyState === "live"));
}

/**
 * إيقاف الكاميرا وتحرير كل الموارد (المسارات، الحلقة، الكانفس).
 * تُستدعى عند إغلاق الصفحة أو عند إعادة التشغيل بعد خطأ.
 */
export function stopCamera() {
  stopLoop();
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  if (videoEl) {
    videoEl.srcObject = null;
  }
  if (ctx2d && canvasEl) {
    ctx2d.clearRect(0, 0, canvasEl.width, canvasEl.height);
  }
  lastFrameInfo = null;
  resetGestureState();
}

function startLoop() {
  if (loopActive) return;
  loopActive = true;
  lastVideoTime = -1;
  lastDetectTimestamp = 0;
  fpsAvg = 0;
  lastFrameAt = performance.now();
  loop();
}

function stopLoop() {
  loopActive = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

/** حلقة المعالجة الوحيدة — تكتشف اليد وترسل إطاراً منظماً لآلة الحالة */
function loop() {
  if (!loopActive) return;
  rafId = requestAnimationFrame(loop);

  if (!landmarker || !videoEl || videoEl.readyState < 2) return;
  if (videoEl.currentTime === lastVideoTime) return; // لا إطار جديد — تجاهل
  lastVideoTime = videoEl.currentTime;

  // فقدان مسار الكاميرا أثناء التشغيل (فُصل الجهاز مثلاً)
  if (stream && !getCameraActive()) {
    stopLoop();
    if (frameHandlers && typeof frameHandlers.onCameraLost === "function") {
      frameHandlers.onCameraLost();
    }
    return;
  }

  const now = performance.now();
  const dt = now - lastFrameAt;
  lastFrameAt = now;
  const instantFps = 1000 / Math.max(dt, 1);
  fpsAvg = fpsAvg ? fpsAvg * 0.9 + instantFps * 0.1 : instantFps;

  // طابع زمني رتيب تصاعدي مطلوب من MediaPipe
  const ts = Math.max(now, lastDetectTimestamp + 1);
  lastDetectTimestamp = ts;

  let result = null;
  try {
    result = landmarker.detectForVideo(videoEl, ts);
  } catch (detectErr) {
    console.error("[UNO] خطأ كشف اليد:", detectErr);
  }

  const rawLandmarks = result && result.landmarks && result.landmarks[0] ? result.landmarks[0] : null;
  const landmarks = smoothLandmarks(rawLandmarks);
  drawOverlay(landmarks);

  const now2 = performance.now();
  const gesture = landmarks ? classifyGesture(landmarks) : GESTURE.NO_HAND;
  const settled = settleGesture(gesture, now2);

  const frame = {
    present: !!landmarks,
    landmarks,
    gesture: settled,
    heldMs: now2 - rawSince,
    now: now2,
    fps: Math.round(fpsAvg)
  };
  lastFrameInfo = frame;

  // واجهة مطابقة للمواصفات: تمرير الإيماءة إلى معالج الحالة الحالي
  handleGestureForCurrentState(frame);
}

/** رسم هيكل اليد فوق معاينة الكاميرا (اختياري — جمالي فقط) */
function drawOverlay(landmarks) {
  if (!ctx2d || !canvasEl) return;
  ctx2d.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (!landmarks) return;

  ctx2d.lineWidth = Math.max(2, canvasEl.width * 0.004);
  ctx2d.strokeStyle = "rgba(212,162,78,0.9)";
  ctx2d.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx2d.moveTo(landmarks[a].x * canvasEl.width, landmarks[a].y * canvasEl.height);
    ctx2d.lineTo(landmarks[b].x * canvasEl.width, landmarks[b].y * canvasEl.height);
  }
  ctx2d.stroke();

  ctx2d.fillStyle = "rgba(247,239,223,0.95)";
  const r = Math.max(3, canvasEl.width * 0.007);
  for (const p of landmarks) {
    ctx2d.beginPath();
    ctx2d.arc(p.x * canvasEl.width, p.y * canvasEl.height, r, 0, Math.PI * 2);
    ctx2d.fill();
  }
}

/**
 * نقطة توصيل معالجة الإيماءة وفق الحالة الحالية.
 * main.js يسجّل المعالج عبر setGestureStateHandler، والحلقة
 * تستدعي هذه الدالة مرة واحدة لكل إطار فيديو جديد.
 */
let gestureStateHandler = null;

export function setGestureStateHandler(fn) {
  gestureStateHandler = typeof fn === "function" ? fn : null;
}

export function handleGestureForCurrentState(frameOrGesture) {
  if (!gestureStateHandler) return;
  try {
    gestureStateHandler(frameOrGesture);
  } catch (err) {
    console.error("[UNO] خطأ في معالج الإيماءة:", err);
  }
}

/** آخر إطار تمت معالجته (للتشخيص) */
export function getLastFrameInfo() {
  return lastFrameInfo;
}
