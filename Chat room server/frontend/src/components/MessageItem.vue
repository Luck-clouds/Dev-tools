<script setup>
import { CircleAlert, Play } from '@lucide/vue'
import { onMounted, watch } from 'vue'
import AvatarView from './AvatarView.vue'
import FileMessageCard from './FileMessageCard.vue'
import { formatDuration } from '../utils/attachmentTransfer'

const props = defineProps({
  message: { type: Object, required: true },
  own: { type: Boolean, default: false },
  mediaUrl: { type: String, default: '' },
  transferState: { type: Object, default: null },
  profileEnabled: Boolean,
})
const emit = defineEmits([
  'preview-image',
  'preview-video',
  'message-context',
  'media-request',
  'download-file',
  'retry-transfer',
  'profile-user',
])

/** 返回图片消息的本地或服务端地址。 */
function imageSource(message) {
  return message.payload.url || message.payload.dataUrl || ''
}

/** 返回视频在上传中或已完成状态下的可播放地址。 */
function videoSource(message) {
  return props.mediaUrl || message.payload.localUrl || ''
}

/** 已完成的视频进入可视列表时请求短期媒体票据。 */
function requestVideoMedia() {
  if (props.message.type === 'video' && !props.message.pending && !props.mediaUrl) emit('media-request', props.message)
}

/** 待上传消息不提供持久化消息右键菜单。 */
function openContextMenu(event) {
  if (!props.message.pending) emit('message-context', { event, message: props.message })
}

/** 将消息创建时间格式化为精确到分钟的本地时间。 */
function messageTime(value) {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

onMounted(requestVideoMedia)
watch(() => [props.message.id, props.mediaUrl], requestVideoMedia)
</script>

<template>
  <article :id="`message-${message.id}`" class="message-row" :class="{ own, pending: message.pending }" @contextmenu.prevent="openContextMenu">
    <button v-if="!own" class="message-avatar-button" :class="{ clickable: profileEnabled }" type="button" :disabled="!profileEnabled" :title="profileEnabled ? '查看个人信息' : ''" @click="emit('profile-user', message)"><AvatarView class="message-avatar" :value="message.avatar" :name="message.name" :size="36" /></button>
    <button v-if="message.pending && transferState?.status === 'failed'" class="message-failed-retry" type="button" :title="transferState.error || '点击重新发送'" @click="emit('retry-transfer', message)"><CircleAlert :size="21" fill="currentColor" /></button>
    <div class="message-stack">
      <div class="message-meta"><span>{{ own ? '我' : message.name }}</span></div>

      <div v-if="message.type === 'text'" class="message-bubble"><p>{{ message.payload.text }}</p></div>

      <button v-else-if="message.type === 'image'" type="button" class="message-media image" @click="emit('preview-image', { src: imageSource(message), alt: message.payload.fileName || '聊天图片' })">
        <img :src="imageSource(message)" :alt="message.payload.fileName || '聊天图片'">
      </button>

      <div v-else-if="message.type === 'video'" class="message-media video" role="button" tabindex="0" @click="emit('preview-video', message)" @keydown.enter="emit('preview-video', message)">
        <video v-if="videoSource(message)" :src="videoSource(message)" muted preload="metadata"></video>
        <div v-else class="video-placeholder"></div>
        <span class="video-play"><Play :size="25" fill="currentColor" /></span>
        <time>{{ formatDuration(message.payload.durationMs) }}</time>
        <div v-if="transferState && message.pending" class="media-upload-progress"><i :style="{ width: `${transferState.percent || 0}%` }"></i><b>{{ transferState.percent || 0 }}%</b></div>
      </div>

      <FileMessageCard
        v-else-if="message.type === 'file'"
        :payload="message.payload"
        :state="transferState"
        :pending="message.pending"
        @download="emit('download-file', message)"
      />

      <div v-else class="message-bubble"><p>暂不支持展示 {{ message.type }} 类型消息</p></div>
      <time class="message-sent-time">{{ messageTime(message.createdAt) }}</time>
    </div>
    <AvatarView v-if="own" class="message-avatar" :value="message.avatar" :name="message.name" :size="36" />
  </article>
</template>
