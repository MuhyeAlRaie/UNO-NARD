/**
 * ============================================================
 *  UNO CAFE LOUNGE — تحدي النرد
 *  js/game-config.js
 * ============================================================
 *  ملف الإعدادات المركزي: كل ما يحتاجه صاحب الكافيه لتعديل
 *  سلوك اللعبة موجود هنا — بدون لمس محرك اللعبة إطلاقاً.
 *
 *  ملاحظة شفافية مهمة:
 *  إعدادات الاحتمالات (probability) هي كود JavaScript يعمل
 *  داخل متصفح الزائر، وهو قابل للفحص والتعديل من أي شخص.
 *  لا تعتبر هذه الإعدادات سرية ولا مقاوِمة للتلاعب.
 * ============================================================
 */

export const GAME_CONFIG = {
  language: "ar",
  brandName: "UNO CAFE LOUNGE",
  logoPath: "assets/uno-cafe-logo.png",

  dice: {
    minValue: 1,
    maxValue: 6,
    // مدة أنيميشن رمي النرد بالمللي ثانية (مسموح 1000 - 3000)
    rollDurationMs: 2200
  },

  probability: {
    // عند التفعيل: الاحتمالات موزونة حسب weights.
    // عند التعطيل: نرد عادل تماماً (1/6 لكل وجه).
    enabled: true,
    targetNumber: 1,
    weights: {
      1: 1,
      2: 2,
      3: 2,
      4: 1,
      5: 2,
      6: 2
    },
    targetProbability: {
      numerator: 1,
      denominator: 10
    }
  },

  camera: {
    preferredFacingMode: "user",
    handDetectionConfidence: 0.65,
    handPresenceConfidence: 0.65,
    handTrackingConfidence: 0.65,
    // مدة ثبات الكف المفتوح قبل بدء العد التنازلي
    stableDetectionMs: 700,
    // مدة ثبات القبضة المسكّرة قبل اعتبارها مؤكدة
    fistHoldMs: 300,
    // مدة ثبات الكف المفتوح بعد القبضة لتفعيل الرمية
    openPalmHoldMs: 150,
    // مدة ثبات القبضة على شاشة الجائزة لإعادة الجولة
    restartFistHoldMs: 1000,
    // مهلة فقدان اليد قبل إلغاء العد التنازلي / الإيماءة المعلقة
    lostHandToleranceMs: 800
  },

  countdown: {
    seconds: 3
  },

  rewards: {
    1: {
      title: "خصم 100%",
      discountPercent: 100
    },
    2: {
      title: "حظ أوفر في المرة القادمة",
      discountPercent: 0
    },
    3: {
      title: "حصلت على فطور مجاني لشخصين ",
      discountPercent: 2
    },
    4: {
      title: "خصم 10%",
      discountPercent: 10
    },
    5: {
      title: "حظ أوفر في المرة القادمة",
      discountPercent: 0
    },
    6: {
      title: "خصم 15%",
      discountPercent: 15
    }
  },

  promotion: {
    terms: "تطبق الشروط والأحكام الخاصة بالكافيه.",
    requireOddsDisclosure: true
  },

  game: {
    // أقصى عدد رميات مسموح في الجلسة الواحدة؛
    // إيماءة إعادة الجولة (سكّر إيدك ثانية واحدة) تبدأ جلسة جديدة.
    maxThrowsPerSession: 1,
    // وضع المطور: يشغّل لوحة تشخيص وأدوات اختبار (لا تظهر للعملاء).
    testMode: false
  },

  audio: {
    enabled: true
  }
};

/**
 * التحقق من صحة إعدادات الاحتمالات.
 * يرفض أي تعارض بصمت — إما الإعدادات صحيحة أو تُرجع أخطاء صريحة.
 * @returns {{ok:boolean, errors:string[], warnings:string[], total:number}}
 */
export function validateProbabilityConfig(config = GAME_CONFIG) {
  const errors = [];
  const warnings = [];
  const dice = config.dice || {};
  const prob = config.probability;

  const minValue = dice.minValue;
  const maxValue = dice.maxValue;
  if (!Number.isInteger(minValue) || !Number.isInteger(maxValue) || minValue < 1 || maxValue > 6 || minValue > maxValue) {
    errors.push(`نطاق النرد غير صالح: dice.minValue=${minValue}, dice.maxValue=${maxValue} (مطلوب 1..6)`);
    return { ok: false, errors, warnings, total: 0 };
  }

  if (!prob || typeof prob !== "object") {
    errors.push("قسم probability مفقود أو غير صالح");
    return { ok: false, errors, warnings, total: 0 };
  }

  const faces = [];
  for (let f = minValue; f <= maxValue; f++) faces.push(f);

  let total = 0;
  if (prob.enabled !== false) {
    for (const f of faces) {
      const w = prob.weights ? prob.weights[f] : undefined;
      if (!Number.isInteger(w) || w < 0) {
        errors.push(`وزن الوجه ${f} غير صالح: يجب أن يكون عدداً صحيحاً ≥ 0 (القيمة الحالية: ${w})`);
      } else {
        total += w;
      }
    }
    if (total <= 0) {
      errors.push("مجموع الأوزان يجب أن يكون أكبر من صفر");
    }

    // التحقق من الهدف واحتماله
    const t = prob.targetNumber;
    if (!Number.isInteger(t) || t < minValue || t > maxValue) {
      errors.push(`probability.targetNumber=${t} خارج نطاق النرد (${minValue}..${maxValue})`);
    } else if (prob.targetProbability) {
      const { numerator, denominator } = prob.targetProbability;
      if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0 || numerator < 0 || numerator > denominator) {
        errors.push(`probability.targetProbability غير صالح: ${numerator}/${denominator}`);
      } else if (Number.isInteger(prob.weights ? prob.weights[t] : undefined) && total > 0) {
        const actual = prob.weights[t] / total;
        const configured = numerator / denominator;
        if (Math.abs(actual - configured) > 1e-9) {
          errors.push(
            `تعارض في الاحتمالات: وزن الوجه ${t} يعطي احتمالاً ${actual} بينما targetProbability يقول ${configured}. لا يتم قبول الإعدادات المتعارضة.`
          );
        }
      }
    } else {
      warnings.push("probability.targetProbability غير مضبوط — لن يتم التحقق من تطابق احتمال الهدف");
    }
  } else {
    warnings.push("الوضع المرجح معطّل — سيتم استخدام نرد عادل (احتمال متساوٍ 1/6 لكل وجه) ويتم تجاهل الأوزان");
  }

  return { ok: errors.length === 0, errors, warnings, total };
}

/**
 * التحقق الشامل من ملف الإعدادات قبل تشغيل اللعبة.
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validateGameConfig(config = GAME_CONFIG) {
  const errors = [];
  const warnings = [];

  if (config.language !== "ar") {
    warnings.push(`language='${config.language}' — واجهة العملاء مصممة للعربية (ar)`);
  }
  if (typeof config.brandName !== "string" || !config.brandName.trim()) {
    errors.push("brandName مطلوب كنص غير فارغ");
  }
  if (typeof config.logoPath !== "string" || !config.logoPath.trim()) {
    errors.push("logoPath مطلوب (مسار نسبي مثل assets/uno-cafe-logo.png)");
  }
  if (config.logoPath && (config.logoPath.startsWith("/") || config.logoPath.includes("://"))) {
    warnings.push("logoPath يفضّل أن يكون مساراً نسبياً ليتوافق مع GitHub Pages");
  }

  // dice
  const d = config.dice || {};
  if (!Number.isInteger(d.minValue) || !Number.isInteger(d.maxValue) || d.minValue < 1 || d.maxValue > 6 || d.minValue > d.maxValue) {
    errors.push(`dice.minValue/dice.maxValue غير صالحين (${d.minValue}..${d.maxValue}) — المسموح 1..6`);
  }
  if (!Number.isInteger(d.rollDurationMs) || d.rollDurationMs < 500 || d.rollDurationMs > 10000) {
    errors.push(`dice.rollDurationMs=${d.rollDurationMs} غير صالح — المسموح 500..10000 م.ث`);
  } else if (d.rollDurationMs < 1000 || d.rollDurationMs > 3000) {
    warnings.push(`dice.rollDurationMs=${d.rollDurationMs} خارج النطاق الموصى به 1500..2500 م.ث`);
  }

  // probability
  const pv = validateProbabilityConfig(config);
  errors.push(...pv.errors);
  warnings.push(...pv.warnings);

  // camera
  const cam = config.camera || {};
  const confKeys = ["handDetectionConfidence", "handPresenceConfidence", "handTrackingConfidence"];
  for (const k of confKeys) {
    const v = cam[k];
    if (typeof v !== "number" || v < 0 || v > 1) {
      errors.push(`camera.${k}=${v} يجب أن يكون رقماً بين 0 و 1`);
    }
  }
  const camFacing = cam.preferredFacingMode;
  if (camFacing !== "user" && camFacing !== "environment") {
    errors.push(`camera.preferredFacingMode='${camFacing}' يجب أن يكون user أو environment`);
  }
  const timings = {
    stableDetectionMs: [200, 10000],
    fistHoldMs: [100, 10000],
    openPalmHoldMs: [50, 10000],
    restartFistHoldMs: [300, 15000],
    lostHandToleranceMs: [300, 15000]
  };
  for (const [k, [lo, hi]] of Object.entries(timings)) {
    const v = cam[k];
    if (!Number.isInteger(v) || v < lo || v > hi) {
      errors.push(`camera.${k}=${v} غير صالح — المسموح ${lo}..${hi} م.ث`);
    }
  }

  // countdown
  const cd = config.countdown ? config.countdown.seconds : undefined;
  if (!Number.isInteger(cd) || cd < 1 || cd > 10) {
    errors.push(`countdown.seconds=${cd} يجب أن يكون عدداً صحيحاً بين 1 و 10`);
  }

  // rewards
  const faces = [];
  if (Number.isInteger(d.minValue) && Number.isInteger(d.maxValue)) {
    for (let f = d.minValue; f <= d.maxValue; f++) faces.push(f);
  }
  for (const f of faces) {
    const r = config.rewards ? config.rewards[f] : undefined;
    if (!r || typeof r !== "object") {
      errors.push(`rewards[${f}] مفقود — يجب تعريف جائزة لكل وجه`);
    } else {
      if (typeof r.title !== "string" || !r.title.trim()) {
        errors.push(`rewards[${f}].title يجب أن يكون نصاً غير فارغ`);
      }
      if (!Number.isInteger(r.discountPercent) || r.discountPercent < 0 || r.discountPercent > 100) {
        errors.push(`rewards[${f}].discountPercent=${r.discountPercent} يجب أن يكون نسبة صحيحة 0..100`);
      }
    }
  }

  // promotion
  const promo = config.promotion || {};
  if (typeof promo.terms !== "string" || !promo.terms.trim()) {
    errors.push("promotion.terms مطلوب كنص غير فارغ");
  }
  if (typeof promo.requireOddsDisclosure !== "boolean") {
    errors.push("promotion.requireOddsDisclosure يجب أن يكون true أو false");
  }

  // game
  const g = config.game || {};
  if (!Number.isInteger(g.maxThrowsPerSession) || g.maxThrowsPerSession < 1) {
    errors.push(`game.maxThrowsPerSession=${g.maxThrowsPerSession} يجب أن يكون صحيحاً ≥ 1`);
  }
  if (typeof g.testMode !== "boolean") {
    errors.push("game.testMode يجب أن يكون true أو false");
  }

  // audio
  if (typeof (config.audio || {}).enabled !== "boolean") {
    errors.push("audio.enabled يجب أن يكون true أو false");
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * ملخص الاحتمالات الفعلية لكل وجه (للوحة المطور والتوثيق).
 * @returns {Array<{face:number, weight:number, probability:number}>}
 */
export function getProbabilitySummary(config = GAME_CONFIG) {
  const prob = config.probability || {};
  const faces = [];
  for (let f = config.dice.minValue; f <= config.dice.maxValue; f++) faces.push(f);
  if (prob.enabled === false) {
    return faces.map((face) => ({ face, weight: null, probability: 1 / faces.length }));
  }
  let total = 0;
  for (const f of faces) total += Number.isInteger(prob.weights?.[f]) ? prob.weights[f] : 0;
  if (total <= 0) return faces.map((face) => ({ face, weight: prob.weights?.[f] ?? 0, probability: 0 }));
  return faces.map((face) => ({ face, weight: prob.weights?.[face] ?? 0, probability: (prob.weights?.[face] ?? 0) / total }));
}
