export function formatMessageTime(value) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function formatTimelineTime(value) {
  const date = new Date(value)
  return `${String(date.getMonth() + 1).padStart(2, '0')}月${String(date.getDate()).padStart(2, '0')}日`
}

function dateBucket(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * 把原始消息组装成可扩展时间轴。时间分隔和服务端 notice 都转换为统一提醒项，
 * 后续入群、风控、已读等提醒只需新增 noticeType 和文案生成器。
 */
export function buildMessageTimeline(messages) {
  const items = []
  let previousDate = ''

  for (const message of messages) {
    const currentDate = dateBucket(message.createdAt)
    // 参考 SSS-WEB：首条消息和日期发生变化时才插入时间提醒。
    if (currentDate !== previousDate) {
      items.push({
        key: `time-${message.id}`,
        kind: 'notice',
        noticeType: 'time',
        text: formatTimelineTime(message.createdAt),
        createdAt: message.createdAt,
      })
    }

    if (message.type === 'notice') {
      items.push({
        key: `notice-${message.id}`,
        kind: 'notice',
        noticeType: message.payload.noticeType || 'system',
        text: message.payload.text || '系统提醒',
        createdAt: message.createdAt,
        message,
      })
    } else {
      items.push({ key: `message-${message.id}`, kind: 'message', message })
    }
    previousDate = currentDate
  }
  return items
}
