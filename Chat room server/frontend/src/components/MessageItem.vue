<script setup>
import AvatarView from './AvatarView.vue'

defineProps({
  message: { type: Object, required: true },
  own: { type: Boolean, default: false },
})
const emit = defineEmits(['preview-image', 'message-context'])

function imageSource(message) {
  return message.payload.url || message.payload.dataUrl || ''
}
</script>

<template>
  <article :id="`message-${message.id}`" class="message-row" :class="{ own }" @contextmenu.prevent="emit('message-context', { event: $event, message })">
    <AvatarView v-if="!own" class="message-avatar" :value="message.avatar" :name="message.name" :size="36" />
    <div class="message-stack">
      <div class="message-meta">
        <span>{{ own ? '我' : message.name }}</span>
      </div>
      <div class="message-bubble" :class="{ image: message.type === 'image' }">
        <p v-if="message.type === 'text'">{{ message.payload.text }}</p>
        <button v-else-if="message.type === 'image'" type="button" class="message-image" @click="emit('preview-image', { src: imageSource(message), alt: message.payload.fileName || '聊天图片' })">
          <img :src="imageSource(message)" :alt="message.payload.fileName || '聊天图片'">
        </button>
        <p v-else>暂不支持展示 {{ message.type }} 类型消息</p>
      </div>
    </div>
    <AvatarView v-if="own" class="message-avatar" :value="message.avatar" :name="message.name" :size="36" />
  </article>
</template>
