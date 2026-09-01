/** 将浏览器数值转换为安全的有限数字。 */
function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/**
 * 采集登录初始化所需的屏幕和触摸辅助信息。
 * User-Agent 由服务端读取；采集失败时返回安全默认值，不影响登录。
 */
export function collectDeviceInfo() {
  try {
    consoleDeviceInfo()
    return {
      screenWidth: finiteNumber(window.screen?.width),
      screenHeight: finiteNumber(window.screen?.height),
      availableWidth: finiteNumber(window.screen?.availWidth),
      availableHeight: finiteNumber(window.screen?.availHeight),
      pixelRatio: finiteNumber(window.devicePixelRatio, 1),
      maxTouchPoints: finiteNumber(navigator.maxTouchPoints),
      touchEventSupported: 'ontouchstart' in window,
    }
  } catch {
    return {
      screenWidth: 0,
      screenHeight: 0,
      availableWidth: 0,
      availableHeight: 0,
      pixelRatio: 1,
      maxTouchPoints: 0,
      touchEventSupported: false,
    }
  }
}

function consoleDeviceInfo(){
  console.log("设备信息:",navigator.userAgent)
}