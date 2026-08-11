<script setup>
import { computed, ref, watch } from 'vue'
import { Minus, Plus, RotateCcw, RotateCcwSquare, RotateCwSquare, X } from '@lucide/vue'

const props = defineProps({
  open: Boolean,
  src: { type: String, default: '' },
  alt: { type: String, default: '聊天图片' },
})
const emit = defineEmits(['close'])
const scale = ref(1)
const rotation = ref(0)

const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`)

watch(() => [props.open, props.src], () => {
  scale.value = 1
  rotation.value = 0
})

function setScale(nextScale) {
  scale.value = Math.min(5, Math.max(0.25, Number(nextScale.toFixed(2))))
}

function onWheel(event) {
  const factor = event.deltaY < 0 ? 1.12 : 0.88
  setScale(scale.value * factor)
}

/** 同时恢复图片缩放比例和旋转角度。 */
function resetView() {
  scale.value = 1
  rotation.value = 0
}

/** 按九十度步进顺时针或逆时针旋转当前图片。 */
function rotateImage(direction) {
  rotation.value = (rotation.value + direction * 90) % 360
}
</script>

<template>
  <Transition name="image-viewer-fade">
    <div v-if="open" class="image-viewer" role="dialog" aria-modal="true" aria-label="查看大图" @mousedown.self="emit('close')">
      <header class="image-viewer-toolbar">
        <button type="button" title="缩小" @click="setScale(scale / 1.2)"><Minus :size="19" /></button>
        <span>{{ scaleLabel }}</span>
        <button type="button" title="放大" @click="setScale(scale * 1.2)"><Plus :size="19" /></button>
        <button type="button" title="恢复原始视图" @click="resetView"><RotateCcw :size="18" /></button>
        <button type="button" title="逆时针旋转" @click="rotateImage(-1)"><RotateCcwSquare :size="18" /></button>
        <button type="button" title="顺时针旋转" @click="rotateImage(1)"><RotateCwSquare :size="18" /></button>
        <button class="image-viewer-close" type="button" title="关闭" @click="emit('close')"><X :size="21" /></button>
      </header>
      <div class="image-viewer-stage" @click.self="emit('close')" @wheel.prevent="onWheel">
        <img :src="src" :alt="alt" :style="{ transform: `scale(${scale}) rotate(${rotation}deg)` }">
      </div>
      <p>滚动鼠标滚轮可放大或缩小</p>
    </div>
  </Transition>
</template>
