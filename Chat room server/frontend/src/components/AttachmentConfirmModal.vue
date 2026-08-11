<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { File, FileVideo, Image as ImageIcon, Trash2, X } from '@lucide/vue'
import { attachmentKind, formatBytes } from '../utils/attachmentTransfer'

const props = defineProps({
  open: Boolean,
  files: { type: Array, default: () => [] },
  source: { type: String, default: '选择' },
})
const emit = defineEmits(['close', 'confirm', 'remove'])
const previewUrls = ref(new Map())

/** 判断当前附件应使用哪种预览图标。 */
function iconFor(file) {
  if (file.type.startsWith('image/')) return ImageIcon
  if (attachmentKind(file) === 'video') return FileVideo
  return File
}

/** 回收上一批本地预览 URL，避免长时间占用浏览器内存。 */
function clearPreviewUrls() {
  for (const url of previewUrls.value.values()) URL.revokeObjectURL(url)
  previewUrls.value = new Map()
}

/** 为图片和视频创建仅用于确认窗的本地预览 URL。 */
function rebuildPreviewUrls() {
  clearPreviewUrls()
  const next = new Map()
  for (const file of props.files) {
    if (file.type.startsWith('image/') || attachmentKind(file) === 'video') next.set(file, URL.createObjectURL(file))
  }
  previewUrls.value = next
}

/** 返回当前文件的本地预览地址。 */
function previewUrl(file) {
  return previewUrls.value.get(file) || ''
}

const title = computed(() => `${props.source}附件确认`)
watch(() => [props.open, props.files], rebuildPreviewUrls, { deep: true, immediate: true })
onBeforeUnmount(clearPreviewUrls)
</script>

<template>
  <Transition name="attachment-confirm-fade">
    <div v-if="open" class="attachment-confirm-mask" @mousedown.self="emit('close')">
      <section class="attachment-confirm-card" role="dialog" aria-modal="true" aria-labelledby="attachment-confirm-title">
        <header>
          <div><span>ATTACHMENTS</span><h2 id="attachment-confirm-title">{{ title }}</h2></div>
          <button type="button" aria-label="关闭" @click="emit('close')"><X :size="20" /></button>
        </header>
        <div class="attachment-confirm-list">
          <article v-for="(file, index) in files" :key="`${file.name}-${file.size}-${file.lastModified}`">
            <div class="attachment-preview">
              <img v-if="file.type.startsWith('image/')" :src="previewUrl(file)" :alt="file.name">
              <video v-else-if="attachmentKind(file) === 'video'" :src="previewUrl(file)" muted preload="metadata"></video>
              <component :is="iconFor(file)" v-else :size="30" />
            </div>
            <div class="attachment-confirm-copy">
              <strong :title="file.name">{{ file.name }}</strong>
              <span>{{ file.type || '未知格式' }} · {{ formatBytes(file.size) }}</span>
              <small v-if="file.size > 1024 ** 3">大文件将使用分块上传和断点续传</small>
            </div>
            <button class="attachment-remove" type="button" title="移除" @click="emit('remove', index)"><Trash2 :size="18" /></button>
          </article>
        </div>
        <footer>
          <button class="secondary" type="button" @click="emit('close')">取消</button>
          <button class="primary" type="button" :disabled="files.length === 0" @click="emit('confirm')">确认发送 {{ files.length }} 个附件</button>
        </footer>
      </section>
    </div>
  </Transition>
</template>
