<script setup>
import { ref, watch } from 'vue'
import { Search, X } from '@lucide/vue'
import AvatarView from './AvatarView.vue'

const props = defineProps({ open: Boolean, token: { type: String, default: '' } })
const emit = defineEmits(['close', 'select'])
const query = ref('')
const results = ref([])
const loading = ref(false)
const error = ref('')
let timer

watch(() => props.open, (open) => {
  if (open) { query.value = ''; results.value = []; error.value = '' }
})

watch(query, (value) => {
  clearTimeout(timer)
  const keyword = value.trim()
  if (!keyword) { results.value = []; loading.value = false; return }
  loading.value = true
  timer = setTimeout(async () => {
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`, {
        headers: { Authorization: `Bearer ${props.token}` },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error('搜索请求失败')
      results.value = body.data || []
      error.value = ''
    } catch {
      results.value = []
      error.value = '搜索暂时不可用，请稍后重试。'
    } finally {
      loading.value = false
    }
  }, 240)
})

function preview(message) {
  return message.type === 'image' ? `[图片] ${message.payload.fileName || ''}` : message.payload.text
}
</script>

<template>
  <div v-if="open" class="modal-backdrop search-backdrop" @mousedown.self="emit('close')">
    <section class="modal-card search-modal" role="dialog" aria-modal="true" aria-labelledby="search-title">
      <header class="modal-header"><div><span>GLOBAL SEARCH</span><h2 id="search-title">全局搜索</h2></div><button type="button" @click="emit('close')"><X :size="20" /></button></header>
      <div class="search-input"><Search :size="19" /><input v-model="query" autofocus placeholder="搜索昵称、文字或图片文件名"></div>
      <div class="search-result-list">
        <div v-if="!query.trim()" class="search-empty">输入关键词，在全部 SQLite 历史消息中查找。</div>
        <div v-else-if="loading" class="search-empty">正在搜索…</div>
        <div v-else-if="error" class="search-empty">{{ error }}</div>
        <div v-else-if="results.length === 0" class="search-empty">没有找到相关聊天记录。</div>
        <button v-for="message in results" v-else :key="message.id" class="search-result" type="button" @click="emit('select', message)">
          <AvatarView :value="message.avatar" :name="message.name" :size="40" />
          <span><strong>{{ message.name }}</strong><small>{{ preview(message) }}</small></span>
          <time>{{ new Date(message.createdAt).toLocaleString('zh-CN') }}</time>
        </button>
      </div>
    </section>
  </div>
</template>
