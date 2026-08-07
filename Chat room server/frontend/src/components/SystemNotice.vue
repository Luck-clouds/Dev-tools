<script setup>
defineProps({
  text: { type: String, required: true },
  createdAt: { type: String, default: '' },
  noticeType: { type: String, default: 'system' },
})
</script>

<template>
  <div class="system-notice" :class="`notice-${noticeType}`">
    <i aria-hidden="true"></i>
    <span class="system-notice-content">
      <span>{{ text }}</span>
    </span>
    <i aria-hidden="true"></i>
  </div>
</template>
