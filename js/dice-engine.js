/**
 * ============================================================
 *  UNO CAFE LOUNGE — تحدي النرد
 *  js/dice-engine.js
 * ============================================================
 *  محرك الاحتمالات:
 *  - اختيار عشوائي غير منحاز (rejection sampling) عبر
 *    crypto.getRandomValues() لتجنب انحياز باقي القسمة (modulo bias).
 *  - توزيع مرجّح من GAME_CONFIG.probability.weights.
 *  - التحقق من التطابق بين احتمال الهدف المُعلن والأوزان الفعلية.
 *
 *  شفافية: هذه دالة client-side قابلة للفحص والتعديل من الزائر
 *  ولا تُعد سرية أو مقاوِمة للتلاعب.
 * ============================================================
 */

import { GAME_CONFIG, validateProbabilityConfig } from "./game-config.js";

/**
 * يرجع عدداً صحيحاً عشوائياً غير منحاز في النطاق [0, maxExclusive).
 *
 * الخوارزمية: rejection sampling — نرفض أي قيمة من 32-بت تقع في
 * النطاق الزائد فوق أقرب مضاعف لـ max، وبذلك يصبح باقي القسمة
 * موزعاً بانتظام تام بدون انحياز.
 *
 * Fallback موثّق: إذا لم يتوفر crypto.getRandomValues (متصفح قديم
 * جداً أو سياق غير آمن) نستخدم Math.random() — أقل أمناً لكنه يعمل.
 *
 * @param {number} maxExclusive عدد صحيح > 0
 * @returns {number}
 */
export function getSecureRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`getSecureRandomInt: maxExclusive يجب أن يكون صحيحاً > 0 (القيمة: ${maxExclusive})`);
  }
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const range = 4294967296; // 2^32
    const limit = range - (range % maxExclusive);
    const buf = new Uint32Array(1);
    let guard = 0;
    do {
      cryptoObj.getRandomValues(buf);
      guard++;
    } while (buf[0] >= limit && guard < 64);
    if (buf[0] < limit) {
      return buf[0] % maxExclusive;
    }
    // تعذر القبول بعد 64 محاولة (احتمال فلكي) — نكهب للبدائل أدناه
  }
  // Fallback موثّق: Math.random
  return Math.floor(Math.random() * maxExclusive);
}

/**
 * اختيار مفهرس من توزيع مرجّح.
 * @param {number[]} weights أوزان صحيحة ≥ 0، مجموعها > 0
 * @param {(maxExclusive:number)=>number} [randomFn] مصدر عشوائي قابل للحقن (للاختبارات)
 * @returns {number} الفهرس المختار
 */
export function selectWeightedIndex(weights, randomFn = getSecureRandomInt) {
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new Error("selectWeightedIndex: weights يجب أن تكون مصفوفة غير فارغة");
  }
  let total = 0;
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) {
      throw new Error(`selectWeightedIndex: وزن غير صالح ${w} — يجب أن يكون صحيحاً ≥ 0`);
    }
    total += w;
  }
  if (total <= 0) {
    throw new Error("selectWeightedIndex: مجموع الأوزان يجب أن يكون أكبر من صفر");
  }
  let r = randomFn(total); // عدد صحيح في [0, total)
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1; // أمان حسابي فقط
}

/**
 * رمي النرد: يرجع رقماً بين dice.minValue و dice.maxValue
 * وفق التوزيع المرجّح المعرّف في الإعدادات، أو توزيع عادل (1/6)
 * إذا كان probability.enabled = false.
 *
 * النتيجة تُحدد هنا قبل بدء الأنيميشن — الأنيميشن لا يؤثر إطلاقاً
 * على نتيجة النرد.
 *
 * @param {{config?:object, randomFn?:(max:number)=>number}} [options]
 * @returns {number} وجه النرد
 * @throws Error إذا كانت إعدادات الاحتمالات غير صالحة
 */
export function rollDice(options = {}) {
  const cfg = options.config || GAME_CONFIG;
  const randomFn = options.randomFn || getSecureRandomInt;
  const { minValue, maxValue } = cfg.dice;
  const faceCount = maxValue - minValue + 1;

  const prob = cfg.probability;
  if (prob && prob.enabled !== false) {
    const validation = validateProbabilityConfig(cfg);
    if (!validation.ok) {
      throw new Error("إعدادات احتمالات غير صالحة: " + validation.errors.join(" | "));
    }
    const weights = [];
    for (let f = minValue; f <= maxValue; f++) {
      weights.push(prob.weights[f] ?? 0);
    }
    const idx = selectWeightedIndex(weights, randomFn);
    return minValue + idx;
  }

  // نرد عادل — احتمال متساوٍ لكل وجه
  return minValue + randomFn(faceCount);
}
