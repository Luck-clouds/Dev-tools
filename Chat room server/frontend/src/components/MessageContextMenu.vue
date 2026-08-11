<script setup>
import { Copy, RotateCcw } from '@lucide/vue'

defineProps({
  open: Boolean,
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  canRevoke: Boolean,
})
const emit = defineEmits(['close', 'copy', 'revoke'])
</script>

<template>
  <Transition name="context-menu">
    <div v-if="open" class="message-menu-mask" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div class="message-context-menu" :style="{ left: `${x}px`, top: `${y}px` }" @click.stop>
        <button type="button" @click="emit('copy')"><Copy :size="16" />复制消息</button>
        <button v-if="canRevoke" class="danger" type="button" @click="emit('revoke')"><RotateCcw :size="16" />撤回</button>
      </div>
    </div>
  </Transition>
</template>
