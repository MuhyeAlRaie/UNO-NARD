/**
 * ============================================================
 *  UNO CAFE LOUNGE — تحدي النرد
 *  js/rewards.js
 * ============================================================
 *  نظام الجوائز والخصومات + توليد كود مرجعي للجائزة.
 *  كل التعريفات تأتي من GAME_CONFIG.rewards — بدون قيم ثابتة هنا.
 *
 *  تنبيه أمني موثّق (انظر README):
 *  كود المرجع الثابت لا يمنع التصوير الشاشة ولا التزوير ولا
 *  الاستبدال المتكرر. لفرض استخدامٍ لمرة واحدة تحتاج نظام
 *  خلفي (Backend) أو تكامل مع نقاط البيع (POS).
 * ============================================================
 */

import { GAME_CONFIG } from "./game-config.js";
import { getSecureRandomInt } from "./dice-engine.js";

/**
 * يرجع الجائزة المعرفة لنتيجة النرد من الإعدادات.
 * @param {number} diceResult وجه النرد (1..6 حسب الإعدادات)
 * @returns {{title:string, discountPercent:number}|null}
 */
export function getRewardForResult(diceResult) {
  const rewards = GAME_CONFIG.rewards || {};
  const reward = rewards[diceResult];
  if (!reward || typeof reward !== "object") {
    return null;
  }
  return {
    title: reward.title,
    discountPercent: Number.isInteger(reward.discountPercent) ? reward.discountPercent : 0
  };
}

/**
 * توليد كود مرجعي للجائزة عبر crypto.getRandomValues.
 * حرف أبجدية رقمي بدون رموز ملتبسة (بدون O/0/I/1).
 * @param {number} [length=8] عدد الأحرف بعد البادئة
 * @returns {string} مثال: "UNO-K7M3XQ9A"
 */
export function generateReferenceCode(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  if (!Number.isInteger(length) || length < 4 || length > 24) {
    length = 8;
  }
  let code = "";
  for (let i = 0; i < length; i++) {
    code += alphabet[getSecureRandomInt(alphabet.length)];
  }
  return `UNO-${code}`;
}

/**
 * سطر عرض نسبة الخصم.
 * @param {{discountPercent:number}} reward
 * @returns {string} "10%" أو "—"
 */
export function formatDiscountPercent(reward) {
  if (reward && Number.isInteger(reward.discountPercent) && reward.discountPercent > 0) {
    return `${reward.discountPercent}%`;
  }
  return "—";
}

/**
 * عنوان الجائزة الكامل كما يظهر للعميل.
 * @param {{title:string, discountPercent:number}} reward
 * @returns {string}
 */
export function formatRewardHeadline(reward) {
  if (!reward) return "";
  if (Number.isInteger(reward.discountPercent) && reward.discountPercent > 0) {
    return `مبروك! ربحت ${reward.title}`;
  }
  return reward.title;
}
