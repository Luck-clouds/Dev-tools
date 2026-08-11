<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ImagePlus, Menu, MessageCircle, Paperclip, Search, SendHorizontal, Settings, UserPlus, Users } from '@lucide/vue'
import AttachmentConfirmModal from './components/AttachmentConfirmModal.vue'
import AvatarView from './components/AvatarView.vue'
import ImageViewer from './components/ImageViewer.vue'
import MessageContextMenu from './components/MessageContextMenu.vue'
import NotificationCenter from './components/NotificationCenter.vue'
import ProfileModal from './components/ProfileModal.vue'
import SearchModal from './components/SearchModal.vue'
import UserSearchModal from './components/UserSearchModal.vue'
import UserProfileCard from './components/UserProfileCard.vue'
import VideoViewer from './components/VideoViewer.vue'
import VirtualMessageList from './components/VirtualMessageList.vue'
import { attachmentKind, hashFile, readVideoMetadata, requestAttachmentTicket, uploadAttachment } from './utils/attachmentTransfer'
import { notifyWithPermission } from './utils/notification'
import { showNotification } from './utils/notifications'
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
const limits = reactive({
  maxNameLength: 24,
  maxTextLength: 20000,
  maxAvatarBytes: 256 * 1024,
  maxImageBytes: 2 * 1024 * 1024,
  uploadChunkBytes: 8 * 1024 * 1024,
  maxFileBytes: 10 * 1024 ** 3,
  maxVideoBytes: 4 * 1024 ** 3,
})
const conversations = ref([])
const activeConversationId = ref(1)
const messages = ref([])
const initialized = ref(false)
const connected = ref(false)
const onlineCount = ref(0)
const messageText = ref('')
const profileOpen = ref(false)
const searchOpen = ref(false)
const userSearchOpen = ref(false)
const userCard = reactive({ open: false, user: null })
const mobileChatOpen = ref(false)
const dragActive = ref(false)
const imageViewer = reactive({ open: false, src: '', alt: '' })
const videoViewer = reactive({ open: false, message: null, src: '' })
const attachmentConfirmation = reactive({ open: false, files: [], source: '选择' })
const pendingMessages = ref([])
const transferStates = reactive({})
const mediaUrls = reactive({})
const messageMenu = reactive({ open: false, x: 0, y: 0, message: null })
const virtualMessageList = ref(null)
const attachmentInput = ref(null)
const imageInput = ref(null)
const uploadControllers = new Map()
const mediaRequests = new Map()
let socket
let reconnectTimer

/** 判断文件是否属于当前图片消息支持的安全格式。 */
function isSupportedImage(file) {
  return /^image\/(?:png|jpeg|gif|webp)$/i.test(file?.type || '')
}

const activeConversation = computed(() => conversations.value.find((item) => item.id === activeConversationId.value) || {
  id: 1, type: 'public', title: '公共客厅', avatar: '', unreadCount: 0,
})
const displayMessages = computed(() => [
  ...messages.value,
  ...pendingMessages.value.filter((message) => message.conversationId === activeConversationId.value),
].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()))

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
  if (!text) return
  showNotification({
    type: error ? 'error' : 'normal',
    title: error ? '操作失败' : '操作成功',
    content: text,
    duration: error ? 7000 : 4000,
  })
}

/** 创建带客户端标识的本地消息，供发送确认、失败展示和重新发送共用。 */
function createPendingMessage(type, payload, extra = {}) {
  const clientId = `msg_${crypto.randomUUID()}`
  const pending = {
    id: clientId,
    clientId,
    transferKey: clientId,
    conversationId: activeConversationId.value,
    type,
    senderId: profile.userId,
    name: profile.name,
    avatar: profile.avatar,
    createdAt: new Date().toISOString(),
    pending: true,
    payload,
    ...extra,
  }
  pendingMessages.value.push(pending)
  transferStates[clientId] = { status: 'sending', percent: 0 }
  scrollToLatest()
  return pending
}

/** 将本地消息提交到 WebSocket，并在同步失败时保留为可重发状态。 */
function publishPending(pending, payload = pending.payload) {
  try {
    transferStates[pending.transferKey] = { ...transferStates[pending.transferKey], status: 'sending' }
    pending.wirePayload = payload
    sendPacket({
      clientId: pending.clientId,
      conversationId: pending.conversationId,
      type: pending.type,
      payload,
    })
  } catch (error) {
    failPendingMessage(pending.clientId, error.message)
  }
}

/** 将指定本地消息标记为失败并显示统一错误通知。 */
function failPendingMessage(clientId, reason = '消息发送失败') {
  if (!clientId || !pendingMessages.value.some((item) => item.clientId === clientId)) return
  transferStates[clientId] = { ...transferStates[clientId], status: 'failed', error: reason }
  showNotification({ type: 'error', title: '消息发送失败', content: reason, duration: 7000 })
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

  socket.addEventListener('open', () => { connected.value = true })
  socket.addEventListener('message', async (event) => {
    try {
      const packet = JSON.parse(event.data)
      if (packet.event === 'ready') {
        Object.assign(limits, packet.data.limits)
        Object.assign(profile, packet.data.user)
        conversations.value = packet.data.conversations || conversations.value
        persistIdentity()
      } else if (packet.event === 'message' || packet.event === 'message.revoked') {
        if (packet.event === 'message' && packet.data.senderId === profile.userId && packet.data.clientId) {
          removePendingMessage(packet.data.clientId)
        }
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
        if (packet.data.clientId) failPendingMessage(packet.data.clientId, packet.data.message)
        else setStatus(packet.data.message || '消息发送失败', true)
      }
    } catch (error) {
      setStatus(error.message, true)
    }
  })
  socket.addEventListener('close', () => {
    connected.value = false
    onlineCount.value = 0
    for (const message of pendingMessages.value) {
      if (transferStates[message.transferKey]?.status === 'sending') failPendingMessage(message.clientId, '连接已断开，请点击感叹号重新发送')
    }
    showNotification({ type: 'warning', title: '连接中断', content: '正在尝试重新连接聊天室。', duration: 3500 })
    reconnectTimer = setTimeout(connect, 2000)
  })
  socket.addEventListener('error', () => { connected.value = false })
}

function sendPacket(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('聊天室尚未连接')
  socket.send(JSON.stringify({
    action: 'message.send',
    data: { ...message, conversationId: message.conversationId ?? activeConversationId.value },
  }))
}

function sendText() {
  const text = messageText.value.trim()
  if (!text) return
  const pending = createPendingMessage('text', { text })
  messageText.value = ''
  publishPending(pending)
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
    const pending = createPendingMessage('image', { dataUrl: reader.result, fileName: file.name, mimeType: file.type, size: file.size })
    publishPending(pending)
  }
  reader.onerror = () => setStatus('图片读取失败', true)
  reader.readAsDataURL(file)
}

/** 校验附件类型和大小，图片沿用轻量消息通道，视频与文件走分片上传。 */
function validateAttachment(file) {
  if (isSupportedImage(file)) {
    return file.size <= limits.maxImageBytes ? '' : `图片不能超过 ${(limits.maxImageBytes / 1024 / 1024).toFixed(2)} MB`
  }
  if (file.type.startsWith('image/')) return '图片仅支持 PNG、JPEG、GIF 和 WebP'
  const kind = attachmentKind(file)
  const maximum = kind === 'video' ? limits.maxVideoBytes : limits.maxFileBytes
  return file.size <= maximum ? '' : `${kind === 'video' ? '视频' : '文件'}不能超过 ${(maximum / 1024 ** 3).toFixed(2)} GiB`
}

/** 将选择、拖拽或粘贴得到的附件放入统一确认窗口。 */
function queueAttachments(fileList, source = '选择') {
  const files = Array.from(fileList || []).filter(Boolean)
  if (!files.length) return false
  const invalid = files.find(validateAttachment)
  if (invalid) {
    setStatus(`${invalid.name}：${validateAttachment(invalid)}`, true)
    return false
  }
  Object.assign(attachmentConfirmation, { open: true, files, source })
  return true
}

/** 从待确认附件列表移除指定项目。 */
function removeQueuedAttachment(index) {
  attachmentConfirmation.files = attachmentConfirmation.files.filter((_, current) => current !== index)
  if (!attachmentConfirmation.files.length) closeAttachmentConfirmation()
}

/** 关闭附件确认窗口并清空临时选择。 */
function closeAttachmentConfirmation() {
  Object.assign(attachmentConfirmation, { open: false, files: [], source: '选择' })
}

/** 确认后分别发送图片，或启动视频和文件的可恢复上传。 */
function confirmAttachments() {
  const files = [...attachmentConfirmation.files]
  closeAttachmentConfirmation()
  for (const file of files) {
    if (isSupportedImage(file)) sendImage(file)
    else void beginAttachmentUpload(file)
  }
}

/** 响应隐藏文件输入框并打开附件确认窗口。 */
function onAttachmentSelected(event) {
  queueAttachments(event.target.files)
  event.target.value = ''
}

/** 响应独立图片入口，只接受当前支持的图片格式。 */
function onImageSelected(event) {
  const files = Array.from(event.target.files || [])
  const invalid = files.find((file) => !isSupportedImage(file) || file.size > limits.maxImageBytes)
  if (invalid) setStatus(`${invalid.name} 不是受支持的图片或体积超过限制`, true)
  else queueAttachments(files, '选择图片')
  event.target.value = ''
}

/** 仅当拖入内容包含文件时显示投放提示。 */
function onDragEnter(event) { if (Array.from(event.dataTransfer?.types || []).includes('Files')) dragActive.value = true }

/** 鼠标真正离开聊天面板时关闭投放提示。 */
function onDragLeave(event) { if (!event.currentTarget.contains(event.relatedTarget)) dragActive.value = false }

/** 将拖入的图片、视频与普通文件交给统一确认流程。 */
function onDrop(event) { dragActive.value = false; queueAttachments(event.dataTransfer?.files, '拖拽') }

/** 捕获剪贴板文件，并为后续音频等类型保留统一入口。 */
function onPaste(event) {
  const files = Array.from(event.clipboardData?.items || []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean)
  if (queueAttachments(files, '粘贴')) event.preventDefault()
}

/** 创建一条本地临时消息，让上传进度直接显示在当前聊天时间线。 */
async function beginAttachmentUpload(file) {
  const kind = attachmentKind(file)
  const conversationId = activeConversationId.value
  const transferKey = `msg_${crypto.randomUUID()}`
  const metadata = kind === 'video' ? await readVideoMetadata(file) : {}
  const localUrl = kind === 'video' ? URL.createObjectURL(file) : ''
  const pending = {
    id: transferKey,
    clientId: transferKey,
    transferKey,
    conversationId,
    type: kind,
    senderId: profile.userId,
    name: profile.name,
    avatar: profile.avatar,
    createdAt: new Date().toISOString(),
    pending: true,
    file,
    payload: {
      fileName: file.name,
      extension: file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '',
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      localUrl,
      ...metadata,
    },
  }
  pendingMessages.value.push(pending)
  transferStates[transferKey] = { status: 'hashing', percent: 0, transferredBytes: 0, totalBytes: file.size }
  scrollToLatest()
  await runPendingUpload(pending)
}

/** 执行哈希、分片上传和消息发布，并保留失败项目用于重试。 */
async function runPendingUpload(pending) {
  const controller = new AbortController()
  uploadControllers.set(pending.transferKey, controller)
  try {
    const attachment = await uploadAttachment({
      file: pending.file,
      kind: pending.type,
      conversationId: pending.conversationId,
      token: profile.token,
      signal: controller.signal,
      onProgress: (state) => { transferStates[pending.transferKey] = { ...state, status: state.stage } },
    })
    pending.payload = { ...attachment, localUrl: pending.payload.localUrl }
    publishPending(pending, attachment)
  } catch (error) {
    const cancelled = error?.name === 'AbortError'
    transferStates[pending.transferKey] = {
      ...transferStates[pending.transferKey],
      status: cancelled ? 'cancelled' : 'failed',
      error: cancelled ? '已取消' : (error.message || '上传失败'),
    }
    if (!cancelled) setStatus(`${pending.payload.fileName} 上传失败：${error.message}`, true)
  } finally {
    uploadControllers.delete(pending.transferKey)
  }
}

/** 删除本地临时消息并回收视频预览地址。 */
function removePendingMessage(transferKey) {
  const pending = pendingMessages.value.find((item) => item.transferKey === transferKey)
  if (pending?.payload.localUrl) URL.revokeObjectURL(pending.payload.localUrl)
  pendingMessages.value = pendingMessages.value.filter((item) => item.transferKey !== transferKey)
  delete transferStates[transferKey]
}

/** 重新发送任何失败消息；已上传附件直接发布，其他附件重新上传。 */
function retryTransfer(message) {
  if (message?.pending && message.wirePayload) publishPending(message, message.wirePayload)
  else if (message?.pending && message.file) void runPendingUpload(message)
  else if (message?.pending) publishPending(message)
  else if (message?.payload?.hash) void downloadAttachment(message)
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
    userCard.open = false
    await loadConversation(data.conversationId)
  } catch (error) { setStatus(error.message, true) }
}

/** 根据公共客厅消息查询并打开发送者的个人信息卡片。 */
async function openUserCard(message) {
  if (activeConversation.value.type !== 'public' || message.senderId === profile.userId) return
  try {
    const users = await apiRequest(`/api/users?q=${encodeURIComponent(message.senderId)}`)
    const user = users.find((item) => item.userId === message.senderId) || {
      userId: message.senderId,
      name: message.name,
      avatar: message.avatar,
    }
    Object.assign(userCard, { open: true, user })
  } catch (error) {
    setStatus(`用户信息加载失败：${error.message}`, true)
  }
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
  const content = {
    image: '[图片]',
    video: '[视频]',
    file: `[文件] ${message.payload.fileName || ''}`,
  }[message.type] || message.payload.text || `[${message.type}]`
  return `${message.name}：${content}`
}

function openImageViewer(image) { Object.assign(imageViewer, { open: true, src: image.src, alt: image.alt }) }

/** 请求并缓存短期媒体地址，供可视区内的视频直接播放。 */
async function ensureMediaUrl(message) {
  const hash = message?.payload?.hash
  if (!hash || mediaUrls[hash]) return mediaUrls[hash] || ''
  if (mediaRequests.has(hash)) return mediaRequests.get(hash)
  const request = requestAttachmentTicket(hash, profile.token, message.payload.fileName)
    .then((ticket) => {
      mediaUrls[hash] = ticket.url
      setTimeout(() => { if (mediaUrls[hash] === ticket.url) delete mediaUrls[hash] }, 25 * 60 * 1000)
      return ticket.url
    })
    .catch((error) => {
      setStatus(`媒体加载失败：${error.message}`, true)
      return ''
    })
    .finally(() => mediaRequests.delete(hash))
  mediaRequests.set(hash, request)
  return request
}

/** 打开视频详情窗口；上传中的视频直接使用本地预览。 */
async function openVideoViewer(message) {
  try {
    const src = message.pending ? message.payload.localUrl : await ensureMediaUrl(message)
    if (!src) return
    Object.assign(videoViewer, { open: true, message, src })
  } catch (error) {
    setStatus(`视频打开失败：${error.message}`, true)
  }
}

/** 关闭视频详情并清除当前引用。 */
function closeVideoViewer() {
  Object.assign(videoViewer, { open: false, message: null, src: '' })
}

/** 使用普通浏览器下载链接保存附件，作为文件系统 API 不可用时的兼容路径。 */
async function downloadWithAnchor(message) {
  const ticket = await requestAttachmentTicket(message.payload.hash, profile.token, message.payload.fileName)
  const anchor = document.createElement('a')
  anchor.href = ticket.url
  anchor.download = message.payload.fileName
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** 使用 File System Access API 实现续传、进度展示及保存后的 SHA-256 校验。 */
async function downloadWithFileHandle(message) {
  const payload = message.payload
  const handle = await window.showSaveFilePicker({ suggestedName: payload.fileName })
  const existing = await handle.getFile()
  let offset = existing.size < payload.size ? existing.size : 0
  if (existing.size === payload.size) {
    const existingHash = await hashFile(existing)
    if (existingHash === payload.hash) {
      transferStates[payload.hash] = { status: 'completed', percent: 100, transferredBytes: payload.size, totalBytes: payload.size }
      return
    }
  }
  const ticket = await requestAttachmentTicket(payload.hash, profile.token, payload.fileName)
  const response = await fetch(ticket.url, {
    headers: offset ? { Range: `bytes=${offset}-` } : {},
  })
  if (!response.ok || !response.body) throw new Error('附件下载失败')
  const writable = await handle.createWritable({ keepExistingData: offset > 0 })
  if (offset) await writable.seek(offset)
  const reader = response.body.getReader()
  let received = offset
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      await writable.write(value)
      received += value.byteLength
      transferStates[payload.hash] = {
        status: 'downloading',
        percent: Math.round((received / Math.max(1, payload.size)) * 100),
        transferredBytes: received,
        totalBytes: payload.size,
      }
    }
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => {})
    throw error
  }
  const saved = await handle.getFile()
  const savedHash = await hashFile(saved, (done, total) => {
    transferStates[payload.hash] = {
      status: 'verifying',
      percent: Math.round((done / Math.max(1, total)) * 100),
      transferredBytes: done,
      totalBytes: total,
    }
  })
  if (savedHash !== payload.hash) throw new Error('文件完整性校验失败，请重新下载')
  transferStates[payload.hash] = { status: 'completed', percent: 100, transferredBytes: payload.size, totalBytes: payload.size }
}

/** 根据浏览器能力选择带校验的断点下载或普通下载。 */
async function downloadAttachment(message) {
  try {
    if (window.showSaveFilePicker && window.isSecureContext) await downloadWithFileHandle(message)
    else await downloadWithAnchor(message)
  } catch (error) {
    if (error?.name !== 'AbortError') {
      transferStates[message.payload.hash] = { ...transferStates[message.payload.hash], status: 'failed', error: error.message }
      setStatus(`下载失败：${error.message}`, true)
    }
  }
}

function notifyForMessage(message) {
  const conversation = conversations.value.find((item) => item.id === message.conversationId)
  const content = {
    image: '[图片]',
    video: '[视频]',
    file: `[文件] ${message.payload.fileName || ''}`,
  }[message.type] || message.payload.text || `[${message.type}]`
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
  if (message.pending) return
  const width = 156
  const height = message.senderId === profile.userId ? 86 : 48
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
  const text = {
    image: message.payload.url || message.payload.fileName || '[图片]',
    video: message.payload.fileName || '[视频]',
    file: message.payload.fileName || '[文件]',
  }[message.type] || message.payload.text || `[${message.type}]`
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
    userCard.open = false
    closeVideoViewer(); closeAttachmentConfirmation()
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
  for (const controller of uploadControllers.values()) controller.abort()
  for (const message of pendingMessages.value) if (message.payload.localUrl) URL.revokeObjectURL(message.payload.localUrl)
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

      <VirtualMessageList
        ref="virtualMessageList"
        :messages="displayMessages"
        :current-user-id="profile.userId"
        :media-urls="mediaUrls"
        :transfer-states="transferStates"
        :profile-enabled="activeConversation.type === 'public'"
        @preview-image="openImageViewer"
        @preview-video="openVideoViewer"
        @message-context="openMessageMenu"
        @media-request="ensureMediaUrl"
        @download-file="downloadAttachment"
        @retry-transfer="retryTransfer"
        @profile-user="openUserCard"
      />

      <footer class="composer-area">
        <div class="composer-toolbar">
          <button type="button" title="发送图片" @click="imageInput?.click()"><ImagePlus :size="20" /></button>
          <button type="button" title="发送附件" @click="attachmentInput?.click()"><Paperclip :size="20" /></button>
          <span>{{ profile.name }}</span>
        </div>
        <div class="composer-row"><textarea v-model="messageText" :maxlength="limits.maxTextLength" rows="2" placeholder="输入消息，Enter 发送，Shift + Enter 换行" @keydown="onComposerKeydown"></textarea><button class="send-button" type="button" :disabled="!connected || !messageText.trim()" @click="sendText"><SendHorizontal :size="19" /></button></div>
        <input ref="imageInput" hidden multiple type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="onImageSelected">
        <input ref="attachmentInput" hidden multiple type="file" @change="onAttachmentSelected">
      </footer>
      <div v-if="dragActive" class="drop-overlay"><div><Paperclip :size="34" /><strong>释放后确认发送</strong><span>支持图片、MP4 / WebM / Ogg 视频与普通文件</span></div></div>
    </section>

    <ProfileModal :open="profileOpen" :profile="profile" :default-avatar="DEFAULT_AVATAR" :max-avatar-bytes="limits.maxAvatarBytes" @close="profileOpen = false" @save="saveProfile" />
    <SearchModal :open="searchOpen" :token="profile.token" @close="searchOpen = false" @select="locateMessage" />
    <UserSearchModal :open="userSearchOpen" :token="profile.token" @close="userSearchOpen = false" @invite="inviteUser" />
    <UserProfileCard :open="userCard.open" :user="userCard.user" @close="userCard.open = false" @chat="inviteUser" />
    <ImageViewer :open="imageViewer.open" :src="imageViewer.src" :alt="imageViewer.alt" @close="imageViewer.open = false" />
    <VideoViewer :open="videoViewer.open" :message="videoViewer.message" :src="videoViewer.src" @close="closeVideoViewer" @download="downloadAttachment" />
    <AttachmentConfirmModal
      :open="attachmentConfirmation.open"
      :files="attachmentConfirmation.files"
      :source="attachmentConfirmation.source"
      @close="closeAttachmentConfirmation"
      @remove="removeQueuedAttachment"
      @confirm="confirmAttachments"
    />
    <MessageContextMenu :open="messageMenu.open" :x="messageMenu.x" :y="messageMenu.y" :can-revoke="messageMenu.message?.senderId === profile.userId" @close="messageMenu.open = false" @copy="copySelectedMessage" @revoke="revokeSelectedMessage" />
    <NotificationCenter />
  </main>
</template>
