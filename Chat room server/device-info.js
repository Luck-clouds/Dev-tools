const MAX_USER_AGENT_LENGTH = 512;

/** 将客户端数字限制在可信范围内，异常值使用默认值。 */
function normalizeNumber(value, { min, max, fallback, integer = false }) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return fallback;
  if (integer && !Number.isInteger(number)) return fallback;
  return number;
}

/**
 * 清洗前端上传的屏幕与触摸数据，避免原始请求内容直接进入数据库。
 * @param {unknown} value 前端上传的 device 对象
 */
function normalizeDeviceSignals(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    screenWidth: normalizeNumber(source.screenWidth, { min: 0, max: 32768, fallback: 0, integer: true }),
    screenHeight: normalizeNumber(source.screenHeight, { min: 0, max: 32768, fallback: 0, integer: true }),
    availableWidth: normalizeNumber(source.availableWidth, { min: 0, max: 32768, fallback: 0, integer: true }),
    availableHeight: normalizeNumber(source.availableHeight, { min: 0, max: 32768, fallback: 0, integer: true }),
    pixelRatio: normalizeNumber(source.pixelRatio, { min: 0.25, max: 10, fallback: 1 }),
    maxTouchPoints: normalizeNumber(source.maxTouchPoints, { min: 0, max: 32, fallback: 0, integer: true }),
    touchEventSupported: source.touchEventSupported === true
  };
}

/**
 * 以 User-Agent 为主要依据，触摸能力用于识别桌面模式下的 iPad。
 * @returns {'desktop'|'mobile'|'tablet'|'unknown'}
 */
function detectDeviceType(userAgent, signals) {
  const ua = String(userAgent || '');
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Macintosh/i.test(ua) && signals.maxTouchPoints > 1) return 'tablet';
  if (/Mobile|iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
  if (/Windows NT|Macintosh|X11|Linux x86_64|CrOS/i.test(ua)) return 'desktop';
  return 'unknown';
}

/**
 * 根据请求头和客户端辅助数据生成可落库的设备快照。
 * @param {unknown} userAgent HTTP 请求中的 User-Agent
 * @param {unknown} rawSignals 前端采集的屏幕与触摸数据
 */
function createDeviceSnapshot(userAgent, rawSignals) {
  const normalizedUserAgent = String(userAgent || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, MAX_USER_AGENT_LENGTH);
  const signals = normalizeDeviceSignals(rawSignals);
  return {
    deviceType: detectDeviceType(normalizedUserAgent, signals),
    userAgent: normalizedUserAgent,
    ...signals,
    capturedAt: new Date().toISOString()
  };
}

module.exports = { createDeviceSnapshot, detectDeviceType, normalizeDeviceSignals };
