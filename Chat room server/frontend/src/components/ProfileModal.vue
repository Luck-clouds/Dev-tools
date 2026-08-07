<script setup>
import { ref, watch } from 'vue'
import { Camera, Copy, RotateCcw, X } from '@lucide/vue'
import AvatarView from './AvatarView.vue'

const props = defineProps({
  open: Boolean,
  profile: { type: Object, required: true },
  defaultAvatar: { type: String, default: '/柴郡.png' },
  maxAvatarBytes: { type: Number, default: 256 * 1024 },
})
const emit = defineEmits(['close', 'save'])
const name = ref('')
const avatar = ref('')
const copyStatus = ref('')
const error = ref('')
const fileInput = ref(null)

watch(() => props.open, (open) => {
  if (!open) return
  name.value = props.profile.name
  avatar.value = props.profile.avatar
  copyStatus.value = ''
  error.value = ''
})

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('头像图片读取失败')) }
    image.src = url
  })
}

// 上传头像统一裁剪为 180×180 JPEG，减少每条消息重复保存头像造成的空间占用。
async function chooseAvatar(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  try {
    const image = await loadImage(file)
    const canvas = document.createElement('canvas')
    canvas.width = 180
    canvas.height = 180
    const context = canvas.getContext('2d')
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 180, 180)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    const bytes = Math.ceil((dataUrl.split(',')[1].length * 3) / 4)
    if (bytes > props.maxAvatarBytes) throw new Error('头像压缩后仍然过大，请更换图片')
    avatar.value = dataUrl
    error.value = ''
  } catch (cause) {
    error.value = cause.message
  }
}

function save() {
  const trimmedName = name.value.trim()
  if (!trimmedName) { error.value = '昵称不能为空'; return }
  const avatarValue = avatar.value.trim() || props.defaultAvatar
  const isImage = /^(?:data:image\/(?:png|jpeg|gif|webp);base64,|(?:\.\/|\/|https?:\/\/).+\.(?:png|jpe?g|gif|webp)(?:[?#].*)?$)/i.test(avatarValue)
  if (!isImage) { error.value = '头像只支持 PNG、JPEG、GIF 或 WebP 图片'; return }
  emit('save', { name: trimmedName, avatar: avatarValue })
}

async function copyUserId() {
  try {
    await navigator.clipboard.writeText(props.profile.userId)
    copyStatus.value = '已复制'
  } catch {
    copyStatus.value = '请手动复制'
  }
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @mousedown.self="emit('close')">
    <section class="modal-card profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
      <header class="modal-header"><div><span>PERSONAL PROFILE</span><h2 id="profile-title">个人信息</h2></div><button type="button" @click="emit('close')"><X :size="20" /></button></header>
      <div class="profile-editor">
        <button class="avatar-editor" type="button" @click="fileInput?.click()">
          <AvatarView :value="avatar" :name="name" :size="88" />
          <span><Camera :size="16" /></span>
        </button>
        <div><strong>设置你的头像</strong><p>图片会裁剪压缩后保存在当前浏览器。</p></div>
      </div>
      <label class="form-field"><span>昵称</span><input v-model="name" maxlength="24" placeholder="请输入昵称"></label>
      <label class="form-field"><span>USER_ID（账号）</span><span class="user-id-field"><input :value="profile.userId" readonly><button type="button" @click="copyUserId"><Copy :size="16" />{{ copyStatus || '复制' }}</button></span></label>
      <label class="form-field"><span>头像图片地址</span><input v-model="avatar" placeholder="例如 ./avatar.png 或 https://.../avatar.webp"></label>
      <button class="reset-avatar" type="button" @click="avatar = defaultAvatar"><RotateCcw :size="15" />恢复默认头像</button>
      <p v-if="error" class="form-error">{{ error }}</p>
      <footer class="modal-actions">
        <button class="secondary" type="button" @click="emit('close')">取消</button><button class="primary" type="button" @click="save">保存设置</button>
      </footer>
      <input ref="fileInput" hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" @change="chooseAvatar">
    </section>
  </div>
</template>
