<script setup>
import { ref, watch } from 'vue'
import { Search, UserPlus, X } from '@lucide/vue'
import AvatarView from './AvatarView.vue'

const props = defineProps({ open: Boolean, token: { type: String, default: '' } })
const emit = defineEmits(['close', 'invite'])
const query = ref('')
const users = ref([])
const loading = ref(false)
const error = ref('')
let timer

watch(() => props.open, (open) => {
  if (open) { query.value = ''; users.value = []; error.value = '' }
})

// 当前按 user_id 或昵称搜索；isFriend 字段已保留但不限制发起单聊。
watch(query, (value) => {
  clearTimeout(timer)
  const keyword = value.trim()
  if (!keyword) { users.value = []; loading.value = false; return }
  loading.value = true
  timer = setTimeout(async () => {
    try {
      const response = await fetch(`/api/users?q=${encodeURIComponent(keyword)}`, {
        headers: { Authorization: `Bearer ${props.token}` },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || '搜索失败')
      users.value = body.data || []
      error.value = ''
    } catch {
      error.value = '用户搜索暂时不可用，请稍后重试。'
      users.value = []
    } finally {
      loading.value = false
    }
  }, 220)
})
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
    <section class="modal-card search-modal" role="dialog" aria-modal="true" aria-labelledby="user-search-title">
      <header class="modal-header"><div><span>DIRECT CHAT</span><h2 id="user-search-title">邀请单聊</h2></div><button type="button" @click="emit('close')"><X :size="20" /></button></header>
      <div class="search-input"><Search :size="19" /><input v-model="query" autofocus placeholder="输入 user_id 或昵称"></div>
      <div class="search-result-list">
        <div v-if="!query.trim()" class="search-empty">输入对方的 user_id，搜索后可直接邀请单聊。</div>
        <div v-else-if="loading" class="search-empty">正在搜索…</div>
        <div v-else-if="error" class="search-empty">{{ error }}</div>
        <div v-else-if="users.length === 0" class="search-empty">没有找到对应账号。</div>
        <button v-for="user in users" v-else :key="user.userId" class="search-result user-search-result" type="button" @click="emit('invite', user)">
          <AvatarView :value="user.avatar" :name="user.name" :size="40" />
          <span class="search-result-copy"><strong>{{ user.name }}</strong><small>{{ user.userId }}</small></span>
          <span class="friend-state">{{ user.isFriend ? '好友' : '可邀请' }}</span><UserPlus :size="18" />
        </button>
      </div>
    </section>
  </div>
</template>
