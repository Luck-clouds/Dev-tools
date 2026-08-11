<script setup>
import { File, FileArchive, FileCode2, FileText } from '@lucide/vue'
import { computed } from 'vue'
import { formatBytes } from '../utils/attachmentTransfer'

const props = defineProps({
  payload: { type: Object, required: true },
  state: { type: Object, default: null },
  pending: Boolean,
})
const emit = defineEmits(['download'])

/** 根据常见扩展名选择文件类型图标。 */
function fileIcon(extension) {
  if (/^(zip|rar|7z|tar|gz)$/i.test(extension)) return FileArchive
  if (/^(txt|md|pdf|doc|docx|xls|xlsx|ppt|pptx)$/i.test(extension)) return FileText
  if (/^(js|ts|vue|html|css|json|xml|py|java|c|cpp)$/i.test(extension)) return FileCode2
  return File
}

/** 返回用户可理解的当前传输状态。 */
function statusLabel(state) {
  const labels = {
    hashing: '正在校验',
    uploading: '正在上传',
    verifying: '服务端校验中',
    sending: '正在发送',
    downloading: '正在下载',
    completed: '已完成',
    failed: '传输失败',
    cancelled: '已取消',
  }
  return labels[state?.status || state?.stage] || '下载'
}

const extension = computed(() => props.payload.extension || props.payload.fileName?.split('.').pop() || 'FILE')
</script>

<template>
  <div class="file-message-card" :class="{ pending }" role="button" tabindex="0" @click="!pending && emit('download')" @keydown.enter="!pending && emit('download')">
    <div class="file-message-icon"><component :is="fileIcon(extension)" :size="34" /></div>
    <div class="file-message-info">
      <strong :title="payload.fileName">{{ payload.fileName }}</strong>
      <div><span>{{ extension.toUpperCase() }}</span><span>{{ formatBytes(payload.size) }}</span></div>
      <div v-if="state" class="file-transfer-state">
        <span>{{ statusLabel(state) }}</span><b>{{ state.percent || 0 }}%</b>
      </div>
      <div v-if="state" class="file-transfer-track"><i :style="{ width: `${state.percent || 0}%` }"></i></div>
    </div>
  </div>
</template>
