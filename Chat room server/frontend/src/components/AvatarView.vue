<script setup>
import { computed, ref, watch } from 'vue'

const DEFAULT_AVATAR = '/柴郡.png'

const props = defineProps({
  value: { type: String, default: DEFAULT_AVATAR },
  name: { type: String, default: '' },
  size: { type: Number, default: 40 },
})

const failed = ref(false)
watch(() => props.value, () => { failed.value = false })

const imageSource = computed(() => {
  const value = String(props.value || '')
  const supported = /^(?:data:image\/(?:png|jpeg|gif|webp);base64,|(?:\.\/|\/|https?:\/\/).+\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$)/i.test(value)
  return supported && !failed.value ? value : DEFAULT_AVATAR
})
</script>

<template>
  <span class="avatar-view" :style="{ width: `${size}px`, height: `${size}px` }">
    <img :src="imageSource" :alt="name ? `${name}的头像` : '默认头像'" @error="failed = true">
  </span>
</template>
