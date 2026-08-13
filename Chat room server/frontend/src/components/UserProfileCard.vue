<script setup>
import { MessageCircle, X } from '@lucide/vue'
import AvatarView from './AvatarView.vue'

defineProps({ open: Boolean, user: { type: Object, default: null } })
const emit = defineEmits(['close', 'chat'])

/** 将账号创建日期转换为本地日期文本。 */
function createdDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '未知'
}
</script>

<template>
  <Transition name="user-card-fade">
    <div v-if="open && user" class="user-card-mask" @mousedown.self="emit('close')">
      <section class="user-profile-card" role="dialog" aria-modal="true" aria-label="用户信息">
        <button class="user-card-close" type="button" title="关闭" @click="emit('close')"><X :size="18" /></button>
        <div class="user-card-avatar"><AvatarView :value="user.avatar" :name="user.name" :size="76" /></div>
        <span class="user-card-label">CHAT PROFILE</span>
        <h2>{{ user.name }}</h2>
        <dl>
          <div><dt>user_id</dt><dd>{{ user.userId }}</dd></div>
          <div><dt>创建日期</dt><dd>{{ createdDate(user.createdAt) }}</dd></div>
        </dl>
        <button class="user-card-chat" type="button" @click="emit('chat', user)"><MessageCircle :size="18" />发起聊天</button>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.user-card-mask {
  position: fixed;
  inset: 0;
  z-index: 280;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(15 23 42 / 28%);
}

.user-profile-card {
  position: relative;
  width: min(340px, 100%);
  padding: 30px 26px 24px;
  display: grid;
  justify-items: center;
  overflow: hidden;
  border: 1px solid rgb(6 182 212 / 15%);
  border-radius: 18px;
  background:
    radial-gradient(circle at 50% 0, rgb(6 182 212 / 13%), transparent 38%),
    #fff;
  box-shadow: 0 24px 72px rgb(15 23 42 / 24%);
}

.user-card-avatar {
  padding: 5px;
  border-radius: 42%;
  background: linear-gradient(145deg, #cffafe, #06b6d4);
  box-shadow: 0 12px 30px rgb(6 182 212 / 20%);
}

.user-card-avatar :deep(.avatar-view) {
  border: 3px solid #fff;
}

.user-card-label {
  margin-top: 14px;
  color: #0891b2;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .16em;
}

.user-profile-card h2 {
  margin: 5px 0 18px;
  color: #172033;
  font-size: 19px;
}

.user-profile-card dl {
  width: 100%;
  margin: 0 0 20px;
  padding: 13px 14px;
  display: grid;
  gap: 11px;
  border-radius: 12px;
  background: #f8fafc;
}

.user-profile-card dl > div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 8px;
}

.user-profile-card dt {
  color: #94a3b8;
  font-size: 10px;
}

.user-profile-card dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: #475569;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.user-card-chat {
  width: 100%;
  padding: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 10px;
  color: #fff;
  background: #06b6d4;
  box-shadow: 0 8px 20px rgb(6 182 212 / 20%);
  cursor: pointer;
}

.user-card-chat:hover {
  background: #0891b2;
}

.user-card-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 9px;
  color: #64748b;
  background: #f8fafc;
  cursor: pointer;
}

.user-card-fade-enter-active,
.user-card-fade-leave-active {
  transition: opacity 180ms ease;
}

.user-card-fade-enter-active .user-profile-card,
.user-card-fade-leave-active .user-profile-card {
  transition: transform 180ms ease;
}

.user-card-fade-enter-from,
.user-card-fade-leave-to {
  opacity: 0;
}

.user-card-fade-enter-from .user-profile-card,
.user-card-fade-leave-to .user-profile-card {
  transform: translateY(10px) scale(.97);
}
</style>
