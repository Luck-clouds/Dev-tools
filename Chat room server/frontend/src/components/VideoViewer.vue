<script setup>
import { Download, X } from '@lucide/vue'
import { ref, watch } from 'vue'
import AvatarView from './AvatarView.vue'
import { formatBytes, formatDuration } from '../utils/attachmentTransfer'

const props = defineProps({
  open: Boolean,
  message: { type: Object, default: null },
  src: { type: String, default: '' },
})
const emit = defineEmits(['close', 'download'])
const video = ref(null)

/** 关闭预览时暂停播放并清理当前播放位置。 */
function resetPlayer() {
  if (!video.value) return
  video.value.pause()
  video.value.currentTime = 0
}

watch(() => [props.open, props.message?.id], () => {
  if (!props.open) resetPlayer()
})
</script>

<template>
  <Transition name="video-viewer-fade">
    <div v-if="open && message" class="video-viewer-mask" @mousedown.self="emit('close')">
      <section class="video-viewer" role="dialog" aria-modal="true" aria-label="视频预览">
        <button class="video-viewer-close" type="button" title="关闭" @click="emit('close')"><X :size="22" /></button>
        <div class="video-player-stage">
          <video ref="video" :src="src" controls autoplay preload="metadata"></video>
        </div>
        <aside class="video-information">
          <span class="eyebrow">VIDEO MESSAGE</span>
          <h2 :title="message.payload.fileName">{{ message.payload.fileName }}</h2>
          <div class="video-sender"><AvatarView :value="message.avatar" :name="message.name" :size="42" /><div><strong>{{ message.name }}</strong><span>{{ new Date(message.createdAt).toLocaleString('zh-CN') }}</span></div></div>
          <dl>
            <div><dt>时长</dt><dd>{{ formatDuration(message.payload.durationMs) }}</dd></div>
            <div><dt>分辨率</dt><dd>{{ message.payload.width && message.payload.height ? `${message.payload.width} × ${message.payload.height}` : '未知' }}</dd></div>
            <div><dt>格式</dt><dd>{{ message.payload.mimeType }}</dd></div>
            <div><dt>大小</dt><dd>{{ formatBytes(message.payload.size) }}</dd></div>
            <div><dt>SHA-256</dt><dd class="video-hash">{{ message.payload.hash }}</dd></div>
          </dl>
          <button class="video-download" type="button" @click="emit('download', message)"><Download :size="18" />下载原视频</button>
        </aside>
      </section>
    </div>
  </Transition>
</template>
