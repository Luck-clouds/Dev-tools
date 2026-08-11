<script setup>
import { AlertTriangle, CheckCircle2, CircleAlert, X } from '@lucide/vue'
import { dismissNotification, useNotifications } from '../utils/notifications'

const notifications = useNotifications()
const icons = { normal: CheckCircle2, warning: AlertTriangle, error: CircleAlert }
const labels = { normal: '正常', warning: '警告', error: '错误' }

/** 将 ISO 时间格式化为通知所需的时分文本。 */
function notificationTime(value) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="notification-center" aria-live="polite" aria-label="全局通知">
    <TransitionGroup name="global-notification">
      <article v-for="notice in notifications" :key="notice.id" class="global-notification" :class="notice.type">
        <div class="notification-icon"><component :is="icons[notice.type]" :size="21" /></div>
        <div class="notification-copy">
          <header><strong>{{ notice.title }}</strong><time>{{ notificationTime(notice.createdAt) }}</time></header>
          <p>{{ notice.content }}</p>
          <span>{{ labels[notice.type] }}</span>
        </div>
        <button type="button" title="关闭通知" @click="dismissNotification(notice.id)"><X :size="15" /></button>
      </article>
    </TransitionGroup>
  </div>
</template>
