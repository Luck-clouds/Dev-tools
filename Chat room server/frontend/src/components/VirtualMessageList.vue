<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import MessageItem from './MessageItem.vue'
import SystemNotice from './SystemNotice.vue'
import { buildMessageTimeline } from '../utils/messageTimeline'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  currentUserId: { type: String, default: '' },
})
const emit = defineEmits(['preview-image', 'message-context'])
const scrollElement = ref(null)
const timeline = computed(() => buildMessageTimeline(props.messages))

// 气泡和图片高度不固定，使用 TanStack Virtual 动态测量并额外渲染 8 项。
const virtualizer = useVirtualizer(computed(() => ({
  count: timeline.value.length,
  getScrollElement: () => scrollElement.value,
  estimateSize: (index) => timeline.value[index]?.kind === 'notice' ? 48 : 110,
  getItemKey: (index) => timeline.value[index]?.key || index,
  overscan: 8,
})))
const virtualItems = computed(() => virtualizer.value.getVirtualItems())

function measureElement(element) {
  if (element) virtualizer.value.measureElement(element)
}

function scrollToEnd(smooth = true) {
  if (!timeline.value.length) return
  nextTick(() => virtualizer.value.scrollToIndex(timeline.value.length - 1, { align: 'end', behavior: smooth ? 'smooth' : 'auto' }))
}

async function scrollToMessage(messageId) {
  const index = timeline.value.findIndex((item) => item.message?.id === messageId)
  if (index < 0) return
  virtualizer.value.scrollToIndex(index, { align: 'center' })
  await nextTick()
  document.getElementById(`message-${messageId}`)?.classList.add('message-highlight')
  setTimeout(() => document.getElementById(`message-${messageId}`)?.classList.remove('message-highlight'), 1800)
}

watch(() => props.messages.length, (length, previousLength) => {
  if (length > previousLength) scrollToEnd(previousLength > 0)
})

defineExpose({ scrollToEnd, scrollToMessage })
</script>

<template>
  <div ref="scrollElement" class="message-list virtual-message-list">
    <div v-if="timeline.length === 0" class="empty-chat"><div class="empty-icon">…</div><h3>这里还很安静</h3><p>发出第一条消息吧。</p></div>
    <div v-else class="virtual-message-space" :style="{ height: `${virtualizer.getTotalSize()}px` }">
      <div
        v-for="virtualRow in virtualItems"
        :key="virtualRow.key"
        :ref="measureElement"
        :data-index="virtualRow.index"
        class="virtual-message-row"
        :style="{ transform: `translateY(${virtualRow.start}px)` }"
      >
        <SystemNotice
          v-if="timeline[virtualRow.index].kind === 'notice'"
          :text="timeline[virtualRow.index].text"
          :created-at="timeline[virtualRow.index].createdAt"
          :notice-type="timeline[virtualRow.index].noticeType"
        />
        <MessageItem
          v-else
          :message="timeline[virtualRow.index].message"
          :own="timeline[virtualRow.index].message.senderId === currentUserId"
          @preview-image="emit('preview-image', $event)"
          @message-context="emit('message-context', $event)"
        />
      </div>
    </div>
  </div>
</template>
