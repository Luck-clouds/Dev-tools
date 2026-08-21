let fallbackSequence = 0

/**
 * 创建仅用于收发回执关联的客户端消息 ID。
 * randomUUID 在普通局域网 HTTP 页面中可能不可用，因此保留兼容生成路径。
 */
export function createClientMessageId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `msg_${globalThis.crypto.randomUUID()}`
  }

  fallbackSequence = (fallbackSequence + 1) % 0x10000
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    // 极旧浏览器兜底；时间、页内序号和随机字节共同避免同页消息冲突。
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  const randomHex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `msg_${Date.now().toString(16)}-${fallbackSequence.toString(16)}-${randomHex}`
}
