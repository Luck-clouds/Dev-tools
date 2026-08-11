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
        <AvatarView :value="user.avatar" :name="user.name" :size="76" />
        <h2>{{ user.name }}</h2>
        <dl><div><dt>user_id</dt><dd>{{ user.userId }}</dd></div><div><dt>创建日期</dt><dd>{{ createdDate(user.createdAt) }}</dd></div></dl>
        <button class="user-card-chat" type="button" @click="emit('chat', user)"><MessageCircle :size="18" />发起聊天</button>
      </section>
    </div>
  </Transition>
</template>
