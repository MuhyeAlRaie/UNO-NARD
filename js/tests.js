/**
 * ============================================================
 *  UNO CAFE LOUNGE — تحدي النرد
 *  js/tests.js
 * ============================================================
 *  اختبارات آلية (بدون أي مكتبات خارجية):
 *  - إعدادات الاحتمالات والتحقق من التطابق
 *  - محرك النرد المرجّح والعادل (عشوائية حقيقية + حتمية بحقن randomFn)
 *  - الجوائز وأكواد المرجع
 *  - كشف الإيماءات من معالم يد اصطناعية
 *  - آلة حالة اللعبة: التدفق الكامل، منع التكرار، الإلغاء، إعادة الجولة
 *
 *  الاختبارات التي تحتاج كاميرا حقيقية مذكورة كتعليمات يدوية في README.
 *  التشغيل: افتح tests.html عبر خادم محلي، أو:
 *  node scripts/run-tests.mjs (من مجلد المشروع الأعلى)
 * ============================================================
 */

import { GAME_CONFIG, validateGameConfig, validateProbabilityConfig, getProbabilitySummary } from "./game-config.js";
import { rollDice, selectWeightedIndex, getSecureRandomInt } from "./dice-engine.js";
import { getRewardForResult, generateReferenceCode, formatRewardHeadline } from "./rewards.js";
import {
  isHandDetected,
  isPalmOpen,
  isFistClosed,
  classifyGesture,
  detectGestureTransition,
  GESTURE
} from "./hand-tracking.js";
import { createGameEngine, GameState } from "./game-state.js";

// ------------------------------------------------------------
//  عدّاء اختبارات مصغّر
// ------------------------------------------------------------
const suites = [];
let suiteNow = null;

function suite(name, fn) {
  suiteNow = { name, tests: [] };
  suites.push(suiteNow);
  fn();
  suiteNow = null;
}

function test(name, fn) {
  suiteNow.tests.push({ name, fn });
}

function assert(cond, msg = "فشل التحقق") {
  if (!cond) throw new Error(msg);
}

function assertEqual(a, b, msg = "") {
  if (a !== b) throw new Error(`${msg} — المتوقع ${b} والفعلي ${a}`);
}

function assertDeepEqual(a, b, msg = "") {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg} — المتوقع ${jb} والفعلي ${ja}`);
}

function assertThrows(fn, msg = "") {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${msg} — كان يجب أن ترمي استثناء`);
}

export function runAllTests() {
  let passed = 0;
  let failed = 0;
  const results = [];
  for (const s of suites) {
    const suiteResult = { name: s.name, tests: [], passed: 0, failed: 0 };
    for (const t of s.tests) {
      try {
        t.fn();
        passed++;
        suiteResult.passed++;
        suiteResult.tests.push({ name: t.name, pass: true });
      } catch (err) {
        failed++;
        suiteResult.failed++;
        suiteResult.tests.push({ name: t.name, pass: false, error: err.message });
      }
    }
    results.push(suiteResult);
  }
  return { results, passed, failed, total: passed + failed };
}

// ------------------------------------------------------------
//  معالم يد اصطناعية (نسبة أبعاد 16:9)
// ------------------------------------------------------------
const ASPECT = 16 / 9;
const lm = (x, y) => ({ x, y, z: 0 });

/** كف مفتوح — أصابع ممدودة للأعلى */
function openPalmLandmarks() {
  const l = new Array(21);
  l[0] = lm(0.5, 0.85);
  // الإبهام
  l[1] = lm(0.42, 0.78); l[2] = lm(0.36, 0.72); l[3] = lm(0.31, 0.67); l[4] = lm(0.27, 0.62);
  // السبابة
  l[5] = lm(0.42, 0.62); l[6] = lm(0.41, 0.52); l[7] = lm(0.40, 0.44); l[8] = lm(0.39, 0.37);
  // الوسطى
  l[9] = lm(0.50, 0.60); l[10] = lm(0.50, 0.49); l[11] = lm(0.50, 0.41); l[12] = lm(0.50, 0.33);
  // البنصر
  l[13] = lm(0.58, 0.62); l[14] = lm(0.59, 0.52); l[15] = lm(0.60, 0.44); l[16] = lm(0.61, 0.37);
  // الخنصر
  l[17] = lm(0.65, 0.66); l[18] = lm(0.67, 0.58); l[19] = lm(0.68, 0.52); l[20] = lm(0.70, 0.47);
  return l;
}

/** قبضة مسكّرة — الأطراف منحنية نحو الكف */
function fistLandmarks() {
  const l = new Array(21);
  l[0] = lm(0.5, 0.85);
  // الإبهام مطوي فوق الأصابع
  l[1] = lm(0.43, 0.77); l[2] = lm(0.39, 0.72); l[3] = lm(0.41, 0.68); l[4] = lm(0.44, 0.65);
  // السبابة
  l[5] = lm(0.42, 0.62); l[6] = lm(0.425, 0.56); l[7] = lm(0.43, 0.60); l[8] = lm(0.44, 0.65);
  // الوسطى
  l[9] = lm(0.50, 0.60); l[10] = lm(0.50, 0.54); l[11] = lm(0.50, 0.59); l[12] = lm(0.505, 0.64);
  // البنصر
  l[13] = lm(0.58, 0.62); l[14] = lm(0.575, 0.56); l[15] = lm(0.57, 0.60); l[16] = lm(0.57, 0.65);
  // الخنصر
  l[17] = lm(0.65, 0.66); l[18] = lm(0.645, 0.60); l[19] = lm(0.64, 0.64); l[20] = lm(0.64, 0.68);
  return l;
}

/** وضعية غامضة — سبابة ووسطى مفتوحة فقط */
function partialPoseLandmarks() {
  const open = openPalmLandmarks();
  const fist = fistLandmarks();
  const mixed = open.map((p, i) => (i >= 13 ? fist[i] : p)); // البنصر والخنصر مطويان
  return mixed;
}

/** لافتة إبهام: قبضة + إبهام مرفوع (نتعامل معها كقبضة بالتصميم المتسامح) */
function thumbsUpLandmarks() {
  const f = fistLandmarks();
  f[1] = lm(0.45, 0.62); f[2] = lm(0.42, 0.56); f[3] = lm(0.39, 0.50); f[4] = lm(0.36, 0.45);
  return f;
}

// ------------------------------------------------------------
//  1) إعدادات الاحتمالات
// ------------------------------------------------------------
suite("إعدادات الاحتمالات والتحقق", () => {
  test("الإعدادات الافتراضية صالحة بالكامل", () => {
    const v = validateGameConfig(GAME_CONFIG);
    assertEqual(v.errors.length, 0, `أخطاء غير متوقعة: ${v.errors.join(" | ")}`);
    assert(v.ok, "يجب أن تكون ok=true");
  });

  test("مجموع الأوزان الافتراضي = 1000 و P(6)=1/1000", () => {
    const weights = Object.values(GAME_CONFIG.probability.weights);
    const total = weights.reduce((a, b) => a + b, 0);
    assertEqual(total, 1000, "المجموع");
    const summary = getProbabilitySummary();
    const six = summary.find((s) => s.face === 6);
    assert(Math.abs(six.probability - 1 / 1000) < 1e-12, `P(6) الفعلي ${six.probability}`);
  });

  test("وزن سالب يُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.probability = { ...bad.probability, weights: { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: -5 } };
    const v = validateProbabilityConfig(bad);
    assert(!v.ok, "يجب أن يفشل");
  });

  test("مجموع أوزان صفري يُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.probability = { ...bad.probability, weights: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } };
    const v = validateProbabilityConfig(bad);
    assert(!v.ok);
  });

  test("تعارض targetProbability مع الأوزان يُرفض ولا يُقبل بصمت", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.probability = { ...bad.probability, targetProbability: { numerator: 1, denominator: 2 } };
    const v = validateProbabilityConfig(bad);
    assert(!v.ok, "1/2 لا تطابق 1/1000");
  });

  test("targetNumber خارج النطاق يُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.probability = { ...bad.probability, targetNumber: 9 };
    const v = validateProbabilityConfig(bad);
    assert(!v.ok);
  });

  test("عجز وزن لوجه يُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.probability = { ...bad.probability, weights: { 1: 200, 2: 200, 3: 200, 4: 200, 5: 199 } };
    const v = validateProbabilityConfig(bad);
    assert(!v.ok);
  });

  test("تعطيل الوضع المرجح مسموح (نرد عادل)", () => {
    const fair = structuredClone(GAME_CONFIG);
    fair.probability = { ...fair.probability, enabled: false };
    const v = validateProbabilityConfig(fair);
    assert(v.ok, `يجب أن يمر: ${v.errors.join(" | ")}`);
  });

  test("إعدادات ناقصة (جائزة مفقودة) تُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    delete bad.rewards[3];
    const v = validateGameConfig(bad);
    assert(!v.ok);
  });
});

// ------------------------------------------------------------
//  2) محرك النرد
// ------------------------------------------------------------
suite("محرك النرد (الاحتمالات)", () => {
  test("randomFn حتمي: حدود الأوزان تحدد الوجه بدقة", () => {
    const w = [200, 200, 200, 200, 199, 1];
    assertEqual(selectWeightedIndex(w, () => 0) + 1, 1);
    assertEqual(selectWeightedIndex(w, () => 199) + 1, 1);
    assertEqual(selectWeightedIndex(w, () => 200) + 1, 2);
    assertEqual(selectWeightedIndex(w, () => 799) + 1, 4);
    assertEqual(selectWeightedIndex(w, () => 998) + 1, 5);
    assertEqual(selectWeightedIndex(w, () => 999) + 1, 6, "الرمي 999 يجب أن يعطي الوجه 6 (1/1000)");
  });

  test("rollDice مع حقن randomFn يعيد نتيجة حتمية صحيحة", () => {
    let seq = [0, 500, 999, 3];
    let i = 0;
    const result = rollDice({ randomFn: () => seq[i++ % seq.length] });
    assertEqual(result, 1); // 0 → وجه 1
    const cfg = GAME_CONFIG;
    // مرة أخرى بتوزيع كامل
    const results = new Set();
    for (let k = 0; k < 6; k++) {
      results.add(rollDice({ config: cfg, randomFn: () => k * 166 }));
    }
    assert(results.size >= 4, "توزيع القيم الحتمي يجب أن يعطي وجوهاً متعددة");
  });

  test("نرد عادل عند تعطيل الوضع المرجح (1/6 لكل وجه)", () => {
    const fair = structuredClone(GAME_CONFIG);
    fair.probability = { ...fair.probability, enabled: false };
    let i = 0;
    const out = [];
    for (let k = 0; k < 6; k++) out.push(rollDice({ config: fair, randomFn: () => i++ }));
    assertDeepEqual(out, [1, 2, 3, 4, 5, 6]);
  });

  test("التوزيع الإحصائي الافتراضي قريب من الأوزان (20000 رمية)", () => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (let k = 0; k < 20000; k++) counts[rollDice()]++;
    for (const f of [1, 2, 3, 4]) {
      assert(counts[f] > 3200 && counts[f] < 4800, `الوجه ${f} تكرر ${counts[f]} (متوقع ~4000)`);
    }
    assert(counts[5] > 3100 && counts[5] < 4800, `الوجه 5 تكرر ${counts[5]} (متوقع ~3980)`);
    assert(counts[6] <= 80, `الوجه 6 تكرر ${counts[6]} — متوقع ~20 بـ p=0.001`);
  });

  test("getSecureRandomInt غير منحاز تقريبياً", () => {
    const buckets = new Array(6).fill(0);
    for (let k = 0; k < 6000; k++) buckets[getSecureRandomInt(6)]++;
    for (let b = 0; b < 6; b++) {
      assert(buckets[b] > 850 && buckets[b] < 1150, `الحاوية ${b}=${buckets[b]} خارج النطاق الآمن`);
    }
  });

  test("rollDice يرمي استثناء عند إعدادات احتمالات فاسدة", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.probability = { ...bad.probability, weights: { 1: -1, 2: 500, 3: 200, 4: 200, 5: 199, 6: 1 } };
    assertThrows(() => rollDice({ config: bad }), "وزن سالب");
  });

  test("نتائج rollDice دائماً ضمن 1..6", () => {
    for (let k = 0; k < 500; k++) {
      const r = rollDice();
      assert(r >= 1 && r <= 6, `قيمة خارج النطاق: ${r}`);
    }
  });
});

// ------------------------------------------------------------
//  3) الجوائز وأكواد المرجع
// ------------------------------------------------------------
suite("الجوائز وأكواد المرجع", () => {
  test("كل الوجوه 1..6 لها جائزة من الإعدادات", () => {
    for (let f = 1; f <= 6; f++) {
      const r = getRewardForResult(f);
      assert(r && typeof r.title === "string" && r.title.length > 0, `جائزة الوجه ${f} مفقودة`);
      assert(Number.isInteger(r.discountPercent) && r.discountPercent >= 0 && r.discountPercent <= 100);
    }
  });

  test("النسب المضبوطة: 3→5% ، 4→10% ، 5→15% ، 6→20% ، 1 و 2 بلا خصم", () => {
    assertEqual(getRewardForResult(3).discountPercent, 5);
    assertEqual(getRewardForResult(4).discountPercent, 10);
    assertEqual(getRewardForResult(5).discountPercent, 15);
    assertEqual(getRewardForResult(6).discountPercent, 20);
    assertEqual(getRewardForResult(1).discountPercent, 0);
    assertEqual(getRewardForResult(2).discountPercent, 0);
  });

  test("نتيجة غير معرفة تُرجع null", () => {
    assertEqual(getRewardForResult(9), null);
    assertEqual(getRewardForResult(0), null);
  });

  test("عنوان الجائزة يُنسق مع «مبروك!» عند وجود خصم", () => {
    assertEqual(formatRewardHeadline(getRewardForResult(4)), "مبروك! ربحت خصم 10%");
    assertEqual(formatRewardHeadline(getRewardForResult(1)), "حظ أوفر في المرة القادمة");
  });

  test("كود المرجع بالصيغة الصحيحة وفريد عبر 200 توليد", () => {
    const seen = new Set();
    const re = /^UNO-[A-HJ-NP-Z2-9]{8}$/;
    for (let k = 0; k < 200; k++) {
      const c = generateReferenceCode();
      assert(re.test(c), `كود غير مطابق: ${c}`);
      seen.add(c);
    }
    assert(seen.size > 190, `تكرار مرتفع في الأكواد: ${seen.size}/200`);
  });
});

// ------------------------------------------------------------
//  4) كشف الإيماءات
// ------------------------------------------------------------
suite("كشف الإيماءات من المعالم", () => {
  test("isHandDetected: يقبل 21 نقطة صالحة ويرفض غير الصالح", () => {
    assert(isHandDetected(openPalmLandmarks()));
    assert(!isHandDetected(null), "null يجب أن يُرفض");
    assert(!isHandDetected(openPalmLandmarks().slice(0, 20)), "20 نقطة تُرفض");
    const bad = openPalmLandmarks();
    bad[7] = { x: NaN, y: 0.5, z: 0 };
    assert(!isHandDetected(bad), "NaN يُرفض");
  });

  test("كف مفتوح يُصنف OPEN_PALM", () => {
    assert(isPalmOpen(openPalmLandmarks(), ASPECT));
    assert(!isFistClosed(openPalmLandmarks(), ASPECT));
    assertEqual(classifyGesture(openPalmLandmarks(), ASPECT), GESTURE.OPEN_PALM);
  });

  test("قبضة تُصنف CLOSED_FIST", () => {
    assert(isFistClosed(fistLandmarks(), ASPECT));
    assert(!isPalmOpen(fistLandmarks(), ASPECT));
    assertEqual(classifyGesture(fistLandmarks(), ASPECT), GESTURE.CLOSED_FIST);
  });

  test("وضعية غامضة تُصنف UNKNOWN (لا قبضة ولا كف)", () => {
    const g = classifyGesture(partialPoseLandmarks(), ASPECT);
    assertEqual(g, GESTURE.UNKNOWN, "وضعية غير مؤكدة يجب ألا تُقبل كإيماءة صالحة");
  });

  test("لافتة إبهام تُصنف قبضة (تصميم متسامح موثّق)", () => {
    assertEqual(classifyGesture(thumbsUpLandmarks(), ASPECT), GESTURE.CLOSED_FIST);
  });

  test("غياب اليد يُصنف NO_HAND", () => {
    assertEqual(classifyGesture(null, ASPECT), GESTURE.NO_HAND);
  });

  test("تحديد نوع الانتقال بين الإيماءات", () => {
    assertEqual(detectGestureTransition(GESTURE.CLOSED_FIST, GESTURE.OPEN_PALM), "FIST_TO_PALM");
    assertEqual(detectGestureTransition(GESTURE.OPEN_PALM, GESTURE.CLOSED_FIST), "PALM_TO_FIST");
    assertEqual(detectGestureTransition(GESTURE.OPEN_PALM, GESTURE.NO_HAND), "HAND_LOST");
    assertEqual(detectGestureTransition(GESTURE.NO_HAND, GESTURE.OPEN_PALM), "HAND_APPEARED");
    assertEqual(detectGestureTransition(GESTURE.OPEN_PALM, GESTURE.OPEN_PALM), "NONE");
    assertEqual(detectGestureTransition(GESTURE.UNKNOWN, GESTURE.OPEN_PALM), "GESTURE_CHANGED");
  });
});

// ------------------------------------------------------------
//  5) آلة حالة اللعبة
// ------------------------------------------------------------
const f = (gesture, heldMs, now, present = true) => ({ present, gesture, heldMs, now });

function makeEngine(rollResults, configOverride) {
  const config = structuredClone(GAME_CONFIG);
  if (configOverride) configOverride(config);
  const events = { states: [], throws: [], countdownStarts: 0, countdownCancels: 0, blocked: 0, rewards: [] };
  const e = createGameEngine({
    config,
    rollFn: () => (rollResults.length ? rollResults.shift() : 3),
    hooks: {
      onStateChange: (s) => events.states.push(s),
      onCountdownStart: () => events.countdownStarts++,
      onCountdownCancel: () => events.countdownCancels++,
      onThrow: (r) => events.throws.push(r),
      onThrowBlocked: () => events.blocked++,
      onFistConfirmed: () => {}
    }
  });
  return { e, events, config };
}

suite("آلة حالة اللعبة", () => {
  test("الجاهزية تنتقل مباشرة إلى انتظار اليد بدون أي نقرة", () => {
    const { e } = makeEngine([]);
    e.setCameraStatus("ready");
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND);
  });

  test("كف مفتوح مستقر يبدأ العد تلقائياً (بدون نقر)", () => {
    const { e, events } = makeEngine([]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 300, 500));
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND, "ثبات ناقص لا يبدأ العد");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 900));
    assertEqual(e.getState(), GameState.COUNTDOWN);
    assertEqual(events.countdownStarts, 1);
  });

  test("فقدان اليد أثناء العد يلغيه ويعيد الانتظار", () => {
    const { e, events } = makeEngine([]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    assertEqual(e.getState(), GameState.COUNTDOWN);
    e.handleHandFrame(f(GESTURE.NO_HAND, 0, 1900, false));
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND, "بعد تجاوز 800ms يجب الإلغاء");
    assertEqual(events.countdownCancels, 1);
  });

  test("فقدان قصير أثناء العد لا يلغيه", () => {
    const { e } = makeEngine([]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    e.handleHandFrame(f(GESTURE.NO_HAND, 0, 1500, false)); // 500ms فقط
    assertEqual(e.getState(), GameState.COUNTDOWN);
  });

  test("المسار الكامل: عد → قبضة → فتح → رمية واحدة → جائزة", () => {
    const { e, events } = makeEngine([4]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    e.handleCountdownFinished();
    assertEqual(e.getState(), GameState.WAITING_FOR_FIST);

    // كف مفتوح بدون قبضة لا يرمي النرد
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 5000, 2000));
    assertEqual(e.getState(), GameState.WAITING_FOR_FIST, "فتح بدون تسكير يجب ألا يرمي");
    assertEqual(events.throws.length, 0);

    // تسكير القبضة
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 350, 3000));
    assertEqual(e.getState(), GameState.WAITING_FOR_OPEN_PALM);

    // إطارات قبضة إضافية لا تغير شيئاً
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 900, 3400));
    assertEqual(e.getState(), GameState.WAITING_FOR_OPEN_PALM);

    // فتح الكف = الرمية
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 200, 4000));
    assertDeepEqual(events.throws, [4], "رمية واحدة بالنتيجة من المحرك");
    assertEqual(e.getState(), GameState.ROLLING_DICE);

    // إطارات أثناء الأنيميشن لا ترمي مجدداً
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 9999, 4100));
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 9999, 4200));
    assertEqual(events.throws.length, 1, "منع الرميات المكررة");

    // انتهاء الأنيميشن → شاشة الجائزة
    e.handleDiceAnimationFinished();
    assertEqual(e.getState(), GameState.SHOWING_REWARD);
    assertEqual(events.states[events.states.length - 1], GameState.SHOWING_REWARD);
  });

  test("قبضة سريعة جداً (قبل اكتمال المهلة) لا تُسلّح الرمية", () => {
    const { e, events } = makeEngine([6]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    e.handleCountdownFinished();
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 150, 1500)); // أقل من fistHoldMs=300
    assertEqual(e.getState(), GameState.WAITING_FOR_FIST);
    assertEqual(events.throws.length, 0);
  });

  test("إطارات مفتوحة متكررة بعد التسكير ترمي مرة واحدة فقط", () => {
    const { e, events } = makeEngine([2]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    e.handleCountdownFinished();
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 400, 2000));
    for (let k = 0; k < 10; k++) {
      e.handleHandFrame(f(GESTURE.OPEN_PALM, 9999, 3000 + k * 33));
    }
    assertEqual(events.throws.length, 1, "رمية واحدة رغم تكرار الإطارات");
  });

  test("فقدان اليد قبل إتمام الإيماءة يلغيها ويعيد التسلسل كاملاً", () => {
    const { e, events } = makeEngine([5]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    e.handleCountdownFinished();
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 400, 2000));
    assertEqual(e.getState(), GameState.WAITING_FOR_OPEN_PALM);
    e.handleHandFrame(f(GESTURE.NO_HAND, 0, 3200, false)); // اختفت > 800ms
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND, "الإيماءة المعلقة أُلغيت");

    // يجب إعادة التسلسل كاملاً: قبضة وحدها لا تكفي
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 9999, 5000));
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND, "لا عد تنازلي بدون كف مفتوح مستقر");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 6000));
    assertEqual(e.getState(), GameState.COUNTDOWN);
    e.handleCountdownFinished();
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 400, 7000));
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 200, 8000));
    assertDeepEqual(events.throws, [5], "الرمية تمت بعد تسلسل كامل جديد");
  });

  test("القبضة الثابتة على شاشة الجائزة تعيد الجولة وتتطلب تسلسلاً جديداً", () => {
    const { e, events } = makeEngine([3]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    e.handleCountdownFinished();
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 400, 2000));
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 200, 3000));
    e.handleDiceAnimationFinished();
    assertEqual(e.getState(), GameState.SHOWING_REWARD);

    // قبضة أقل من ثانية لا تعيد
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 500, 4000));
    assertEqual(e.getState(), GameState.SHOWING_REWARD);

    // قبضة ثابتة ثانية كاملة تعيد الجولة وتصفّر الجلسة
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 1200, 5000));
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND);
    assertEqual(e.getThrowsThisSession(), 0, "جلسة جديدة بعد الإعادة");

    // الجولة الجديدة تتطلب كف مفتوح ثم تسلسلاً كاملاً
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 9999, 6000));
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND, "القبضة وحدها لا تبدأ جولة");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 7000));
    assertEqual(e.getState(), GameState.COUNTDOWN, "بدأ عد تنازلي جديد تلقائياً");
    e.handleCountdownFinished();
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 400, 8000));
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 200, 9000));
    assertDeepEqual(events.throws, [3, 3], "رميتان عبر جولتين");
  });

  test("قفل الرمية: طلب رمي ثانٍ داخل نفس الجولة يُرفض", () => {
    const { e, events } = makeEngine([6, 6], (cfg) => {
      cfg.game.testMode = true;
    });
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    e.handleCountdownFinished();
    e.handleHandFrame(f(GESTURE.CLOSED_FIST, 400, 2000));
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 200, 3000));
    assertEqual(events.throws.length, 1);
    assertEqual(e.requestThrow(3500), false, "القفل يمنع رمية ثانية");
    assertEqual(events.throws.length, 1);
  });

  test("الرمي أثناء حالة غير مسموحة يُرفض (حماية مزدوجة)", () => {
    const { e, events } = makeEngine([6]);
    e.setCameraStatus("ready");
    assertEqual(e.requestThrow(1000), false, "لا رمي أثناء انتظار اليد");
    assertEqual(e.requestThrow(1000), false, "لا رمي أثناء WELCOME");
    assertEqual(events.throws.length, 0);
  });

  test("إعادة الجولة لا تعمل خارج شاشة الجائزة", () => {
    const { e } = makeEngine([]);
    e.setCameraStatus("ready");
    assertEqual(e.restart(), false, "restart من حالة الانتظار مرفوض");
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND);
  });

  test("خطأ الكاميرا يوقف التدفق من أي حالة", () => {
    const { e } = makeEngine([]);
    e.setCameraStatus("ready");
    e.handleHandFrame(f(GESTURE.OPEN_PALM, 800, 1000));
    assertEqual(e.getState(), GameState.COUNTDOWN);
    e.setCameraStatus("error", { kind: "camera" });
    assertEqual(e.getState(), GameState.CAMERA_ERROR);
    // استرجاع الكاميرا يعيد الانتظار والجلسة من الصفر
    e.setCameraStatus("ready");
    assertEqual(e.getState(), GameState.WAITING_FOR_HAND);
    assertEqual(e.getThrowsThisSession(), 0);
  });
});

// ------------------------------------------------------------
//  6) فحص أخطاء التكوين الحرفية
// ------------------------------------------------------------
suite("أخطاء الإعدادات الحرفية", () => {
  test("مفاتيح camera بأعداد سالبة تُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.camera.fistHoldMs = -5;
    assert(!validateGameConfig(bad).ok);
  });

  test("عدّاد تنازلي صفر يُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.countdown.seconds = 0;
    assert(!validateGameConfig(bad).ok);
  });

  test("نسبة خصم 150% تُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.rewards[4] = { title: "خصم 150%", discountPercent: 150 };
    assert(!validateGameConfig(bad).ok);
  });

  test("maxThrowsPerSession = 0 يُرفض", () => {
    const bad = structuredClone(GAME_CONFIG);
    bad.game.maxThrowsPerSession = 0;
    assert(!validateGameConfig(bad).ok);
  });
});
