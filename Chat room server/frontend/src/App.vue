<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ImagePlus, Menu, MessageCircle, Search, SendHorizontal, Settings, UserPlus, Users } from '@lucide/vue'
import AvatarView from './components/AvatarView.vue'
import ImageViewer from './components/ImageViewer.vue'
import MessageContextMenu from './components/MessageContextMenu.vue'
import ProfileModal from './components/ProfileModal.vue'
import SearchModal from './components/SearchModal.vue'
import UserSearchModal from './components/UserSearchModal.vue'
import VirtualMessageList from './components/VirtualMessageList.vue'
import { notifyWithPermission } from './utils/notification'
import './enhancements.css'

const IDENTITY_KEY = 'portable-chat-identity-v1'
const LEGACY_PROFILE_KEY = 'portable-chat-profile-v2'
const DEFAULT_AVATAR = '/柴郡.png'

function loadSavedIdentity() {
  try {
    const identity = JSON.parse(localStorage.getItem(IDENTITY_KEY) || '{}')
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PROFILE_KEY) || '{}')
    return {
      userId: identity.userId || legacy.senderId || '',
      token: identity.token || '',
      name: identity.name || legacy.name || '访客',
      avatar: identity.avatar || legacy.avatar || DEFAULT_AVATAR,
    }
  } catch {
    return { userId: '', token: '', name: '访客', avatar: DEFAULT_AVATAR }
  }
}

const profile = reactive(loadSavedIdentity())
const limits = reactive({ maxNameLength: 24, maxTextLength: 2000, maxAvatarBytes: 256 * 1024, maxImageBytes: 2 * 1024 * 1024 })
const conversations = ref([])
const activeConversationId = ref(1)
const messages = ref([])
const initialized = ref(false)
const connected = ref(false)
const onlineCount = ref(0)
const messageText = ref('')
const statusText = ref('')
const statusError = ref(false)
const profileOpen = ref(false)
const searchOpen = ref(false)
const userSearchOpen = ref(false)
const mobileChatOpen = ref(false)
const dragActive = ref(false)
const imageViewer = reactive({ open: false, src: '', alt: '' })
const messageMenu = reactive({ open: false, x: 0, y: 0, message: null })
const virtualMessageList = ref(null)
const imageInput = ref(null)
let socket
let reconnectTimer

const activeConversation = computed(() => conversations.value.find((item) => item.id === activeConversationId.value) || {
  id: 1, type: 'public', title: '公共客厅', avatar: '', unreadCount: 0,
})

function persistIdentity() {
  // user_id 和服务端签发 token 按需求保存在 LocalStorage，页面初始化时自动恢复。
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({
    userId: profile.userId,
    token: profile.token,
    name: profile.name,
    avatar: profile.avatar,
  }))
  localStorage.removeItem(LEGACY_PROFILE_KEY)
}

async function apiRequest(path, options = {}) {
  try {
    const headers = { ...(options.headers || {}) }
    if (profile.token) headers.Authorization = `Bearer ${profile.token}`
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
    const response = await fetch(path, { ...options, headers })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.message || '请求失败')
    return body.data
  } catch (error) {
    // 所有 HTTP 请求统一在这里收口，避免网络异常形成未处理的 Promise。
    throw new Error(error instanceof Error ? error.message : '网络请求失败')
  }
}

async function initializeIdentity() {
  const data = await apiRequest('/api/session', {
    method: 'POST',
    body: JSON.stringify(profile),
  })
  Object.assign(profile, data.user, { token: data.token })
  conversations.value = data.conversations || []
  persistIdentity()
  activeConversationId.value = conversations.value.find((item) => item.type === 'public')?.id || conversations.value[0]?.id || 1
}

function setStatus(text = '', error = false) {
  statusText.value = text
  statusError.value = error
}

function scrollToLatest(smooth = true) {
  nextTick(() => virtualMessageList.value?.scrollToEnd(smooth))
}

function mergeMessages(incoming) {
  const byId = new Map(messages.value.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  messages.value = [...byId.values()].sort((a, b) => a.id - b.id)
}

async function refreshConversations() {
  conversations.value = await apiRequest('/api/conversations')
}

async function loadConversation(conversationId, smooth = false) {
  try {
    activeConversationId.value = Number(conversationId)
    messages.value = await apiRequest(`/api/conversations/${activeConversationId.value}/messages`)
    mobileChatOpen.value = true
    await refreshConversations()
    scrollToLatest(smooth)
  } catch {
    setStatus('会话加载失败，请稍后重试。', true)
  }
}

function connect() {
  clearTimeout(reconnectTimer)
  if (!profile.token) return
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(profile.token)}`)

  socket.addEventListener('open', () => { connected.value = true; setStatus() })
  socket.addEventListener('message', async (event) => {
    try {
      const packet = JSON.parse(event.data)
      if (packet.event === 'ready') {
        Object.assign(limits, packet.data.limits)
        Object.assign(profile, packet.data.user)
        conversations.value = packet.data.conversations || conversations.value
        persistIdentity()
      } else if (packet.event === 'message' || packet.event === 'message.revoked') {
        if (packet.event === 'message' && packet.data.senderId !== profile.userId) notifyForMessage(packet.data)
        if (packet.data.conversationId === activeConversationId.value) {
          mergeMessages([packet.data])
          scrollToLatest()
        }
        await refreshConversations()
      } else if (packet.event === 'conversation.updated') {
        await refreshConversations()
      } else if (packet.event === 'presence') {
        onlineCount.value = packet.data.online
      } else if (packet.event === 'error') {
        setStatus(packet.data.message || '消息发送失败', true)
      }
    } catch (error) {
      setStatus(error.message, true)
    }
  })
  socket.addEventListener('close', () => {
    connected.value = false
    onlineCount.value = 0
    reconnectTimer = setTimeout(connect, 2000)
  })
  socket.addEventListener('error', () => { connected.value = false })
}

function sendPacket(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('聊天室尚未连接')
  socket.send(JSON.stringify({
    action: 'message.send',
    data: { ...message, conversationId: activeConversationId.value },
  }))
}

function sendText() {
  const text = messageText.value.trim()
  if (!text) return
  try {
    sendPacket({ type: 'text', payload: { text } })
    messageText.value = ''
  } catch (error) { setStatus(error.message, true) }
}

function onComposerKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendText() }
}

function sendImage(file) {
  if (!file) return
  if (file.size > limits.maxImageBytes) {
    setStatus(`图片不能超过 ${(limits.maxImageBytes / 1024 / 1024).toFixed(2)} MB`, true)
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    try {
      sendPacket({ type: 'image', payload: { dataUrl: reader.result, fileName: file.name, mimeType: file.type, size: file.size } })
      setStatus(`正在发送 ${file.name}`)
    } catch (error) { setStatus(error.message, true) }
  }
  reader.onerror = () => setStatus('图片读取失败', true)
  reader.readAsDataURL(file)
}

// 附件类型统一分发，后续文件、音频和视频可继续追加处理器。
const attachmentTypeHandlers = [
  { type: 'image', matches: (file) => /^image\/(?:png|jpeg|gif|webp)$/i.test(file.type), send: sendImage },
]

function sendAttachments(fileList, source = '选择') {
  const files = Array.from(fileList || []).filter(Boolean)
  if (!files.length) return false
  for (const file of files) {
    const handler = attachmentTypeHandlers.find((candidate) => candidate.matches(file))
    if (handler) handler.send(file)
    else setStatus(`${source}的文件类型暂不支持：${file.type || file.name}`, true)
  }
  return true
}

function onImageSelected(event) { sendAttachments(event.target.files); event.target.value = '' }
function onDragEnter(event) { if (Array.from(event.dataTransfer?.types || []).includes('Files')) dragActive.value = true }
function onDragLeave(event) { if (!event.currentTarget.contains(event.relatedTarget)) dragActive.value = false }
function onDrop(event) { dragActive.value = false; sendAttachments(event.dataTransfer?.files, '拖拽') }
function onPaste(event) {
  const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean)
  if (sendAttachments(files, '粘贴')) event.preventDefault()
}

async function saveProfile(nextProfile) {
  try {
    const user = await apiRequest('/api/me', { method: 'PATCH', body: JSON.stringify(nextProfile) })
    Object.assign(profile, user)
    persistIdentity()
    profileOpen.value = false
    setStatus('个人资料已保存')
    await refreshConversations()
  } catch (error) { setStatus(error.message, true) }
}

async function inviteUser(user) {
  try {
    const data = await apiRequest('/api/conversations/direct', {
      method: 'POST', body: JSON.stringify({ targetUserId: user.userId }),
    })
    conversations.value = data.conversations
    userSearchOpen.value = false
    await loadConversation(data.conversationId)
  } catch (error) { setStatus(error.message, true) }
}

async function locateMessage(message) {
  searchOpen.value = false
  if (message.conversationId !== activeConversationId.value) await loadConversation(message.conversationId)
  mergeMessages([message])
  nextTick(() => virtualMessageList.value?.scrollToMessage(message.id))
}

function conversationPreview(conversation) {
  const message = conversation.lastMessage
  if (!message) return conversation.type === 'direct' ? '开始你们的单聊' : '还没有消息'
  if (message.type === 'notice') return message.payload.text
  return message.type === 'image' ? `${message.name}：[图片]` : `${message.name}：${message.payload.text}`
}

function openImageViewer(image) { Object.assign(imageViewer, { open: true, src: image.src, alt: image.alt }) }

function notifyForMessage(message) {
  const conversation = conversations.value.find((item) => item.id === message.conversationId)
  const content = message.type === 'image' ? '[图片]' : (message.payload.text || `[${message.type}]`)
  // 浏览器仅在用户已经授权通知时展示；通知失败不影响 WebSocket 收消息。
  void notifyWithPermission({
    title: conversation?.title || '新消息',
    body: `“${message.name}”：${content}`,
    icon: message.avatar || DEFAULT_AVATAR,
    tag: `conversation-${message.conversationId}`,
    onClick: (notification) => { window.focus(); notification.close() },
  }).catch(() => {})
}

function openMessageMenu({ event, message }) {
  const width = 156
  const height = message.senderId === profile.userId ? 120 : 76
  Object.assign(messageMenu, {
    open: true,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
    message,
  })
}

async function copySelectedMessage() {
  const message = messageMenu.message
  if (!message) return
  const text = message.type === 'image' ? (message.payload.url || message.payload.fileName || '[图片]') : message.payload.text
  try {
    await navigator.clipboard.writeText(text)
    setStatus()
  } catch {
    setStatus('浏览器未允许访问剪贴板', true)
  }
  messageMenu.open = false
}

function revokeSelectedMessage() {
  const message = messageMenu.message
  messageMenu.open = false
  if (!message || message.senderId !== profile.userId) return
  try {
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('聊天室尚未连接')
    socket.send(JSON.stringify({
      action: 'message.revoke',
      data: { conversationId: message.conversationId, messageId: message.id },
    }))
  } catch (error) { setStatus(error.message, true) }
}

function handleGlobalKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchOpen.value = true }
  if (event.key === 'Escape') {
    searchOpen.value = false; userSearchOpen.value = false; profileOpen.value = false; imageViewer.open = false; messageMenu.open = false
  }
}

onMounted(async () => {
  try {
    await initializeIdentity()
    await loadConversation(activeConversationId.value)
    connect()
    initialized.value = true
  } catch (error) { setStatus(error.message, true) }
  window.addEventListener('keydown', handleGlobalKeydown)
})

onBeforeUnmount(() => {
  clearTimeout(reconnectTimer)
  socket?.close()
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <main class="app-shell" :class="{ 'mobile-chat-open': mobileChatOpen }">
    <nav class="app-rail" aria-label="主要功能">
      <button class="rail-avatar" type="button" title="个人资料" @click="profileOpen = true"><AvatarView :value="profile.avatar" :name="profile.name" :size="44" /></button>
      <button class="rail-action active" type="button" title="聊天"><MessageCircle :size="23" /></button>
      <button class="rail-action" type="button" title="邀请单聊" @click="userSearchOpen = true"><UserPlus :size="22" /></button>
      <button class="rail-action" type="button" title="全局搜索" @click="searchOpen = true"><Search :size="22" /></button>
      <button class="rail-action rail-bottom" type="button" title="个人设置" @click="profileOpen = true"><Settings :size="22" /></button>
    </nav>

    <aside class="conversation-pane">
      <header class="conversation-titlebar"><div><p class="eyebrow">CHAT ROOM</p><h1>近邻</h1></div><button class="plain-icon" type="button" aria-label="设置个人资料" @click="profileOpen = true"><Menu :size="22" /></button></header>
      <button class="global-search-trigger" type="button" @click="searchOpen = true"><Search :size="17" /><span>搜索全部聊天记录</span><kbd>Ctrl K</kbd></button>
      <div class="conversation-section-label">会话</div>

      <div class="conversation-list">
        <button v-for="conversation in conversations" :key="conversation.id" class="conversation-card" :class="{ selected: conversation.id === activeConversationId }" type="button" @click="loadConversation(conversation.id)">
          <div v-if="conversation.type === 'public'" class="room-avatar"><Users :size="22" /></div>
          <AvatarView v-else :value="conversation.avatar" :name="conversation.title" :size="46" />
          <div class="conversation-copy">
            <div class="conversation-line"><strong>{{ conversation.title }}</strong></div>
            <p>{{ conversationPreview(conversation) }}</p>
          </div>
          <div class="conversation-state">
            <time v-if="conversation.lastMessage">{{ new Date(conversation.lastMessage.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</time>
            <span v-if="conversation.unreadCount" class="unread-badge">{{ conversation.unreadCount > 99 ? '99+' : conversation.unreadCount }}</span>
          </div>
        </button>
      </div>

    </aside>

    <section class="chat-pane" @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop" @paste="onPaste">
      <header class="chat-header">
        <button class="mobile-back" type="button" aria-label="返回会话列表" @click="mobileChatOpen = false">‹</button>
        <div v-if="activeConversation.type === 'public'" class="room-avatar small"><Users :size="19" /></div>
        <AvatarView v-else :value="activeConversation.avatar" :name="activeConversation.title" :size="38" />
        <div class="chat-heading"><h2>{{ activeConversation.title }}</h2><p><span class="online-dot" :class="{ online: connected }"></span>{{ connected ? `${onlineCount || 1} 人在线` : initialized ? '正在重新连接' : '正在初始化' }}</p></div>
        <button class="header-search" type="button" @click="searchOpen = true"><Search :size="19" /><span>搜索聊天记录</span></button>
      </header>

      <VirtualMessageList ref="virtualMessageList" :messages="messages" :current-user-id="profile.userId" @preview-image="openImageViewer" @message-context="openMessageMenu" />

      <footer class="composer-area">
        <div class="composer-toolbar"><button type="button" title="发送图片" @click="imageInput?.click()"><ImagePlus :size="20" /></button><span>{{ profile.name }}</span></div>
        <div class="composer-row"><textarea v-model="messageText" :maxlength="limits.maxTextLength" rows="2" placeholder="输入消息，Enter 发送，Shift + Enter 换行" @keydown="onComposerKeydown"></textarea><button class="send-button" type="button" :disabled="!connected || !messageText.trim()" @click="sendText"><SendHorizontal :size="19" /></button></div>
        <p class="composer-status" :class="{ error: statusError }">{{ statusText }}</p>
        <input ref="imageInput" hidden multiple type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="onImageSelected">
      </footer>
      <div v-if="dragActive" class="drop-overlay"><div><ImagePlus :size="34" /><strong>释放即可发送</strong><span>当前支持 PNG、JPEG、GIF 和 WebP</span></div></div>
    </section>

    <ProfileModal :open="profileOpen" :profile="profile" :default-avatar="DEFAULT_AVATAR" :max-avatar-bytes="limits.maxAvatarBytes" @close="profileOpen = false" @save="saveProfile" />
    <SearchModal :open="searchOpen" :token="profile.token" @close="searchOpen = false" @select="locateMessage" />
    <UserSearchModal :open="userSearchOpen" :token="profile.token" @close="userSearchOpen = false" @invite="inviteUser" />
    <ImageViewer :open="imageViewer.open" :src="imageViewer.src" :alt="imageViewer.alt" @close="imageViewer.open = false" />
    <MessageContextMenu :open="messageMenu.open" :x="messageMenu.x" :y="messageMenu.y" :can-revoke="messageMenu.message?.senderId === profile.userId" @close="messageMenu.open = false" @copy="copySelectedMessage" @revoke="revokeSelectedMessage" />
  </main>
</template>
