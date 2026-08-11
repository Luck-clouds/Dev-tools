import { reactive, readonly } from 'vue'

const notifications = reactive([])
const timers = new Map()

/** 移除指定全局通知并回收其自动关闭计时器。 */
export function dismissNotification(id) {
  const index = notifications.findIndex((item) => item.id === id)
  if (index >= 0) notifications.splice(index, 1)
  clearTimeout(timers.get(id))
  timers.delete(id)
}

/** 发布包含类型、标题、内容和时间的全局通知。 */
export function showNotification({ type = 'normal', title = '提示', content = '', duration = 4500 }) {
  if (!content) return ''
  const id = `notice_${Date.now()}_${Math.random().toString(16).slice(2)}`
  notifications.push({ id, type, title, content, createdAt: new Date().toISOString() })
  if (duration > 0) timers.set(id, setTimeout(() => dismissNotification(id), duration))
  return id
}

/** 提供只读通知队列给全局展示组件。 */
export function useNotifications() {
  return readonly(notifications)
}
