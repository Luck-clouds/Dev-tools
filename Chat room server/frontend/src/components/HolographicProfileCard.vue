<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { MessageCircle, X } from '@lucide/vue'

const props = defineProps({ open: Boolean, user: { type: Object, default: null } })
const emit = defineEmits(['close', 'chat'])
const wrapper = ref(null)
const shell = ref(null)
const active = ref(false)
const entering = ref(false)
const demonstrating = ref(false)

const DEFAULT_AVATAR = '/柴郡.png'
const INITIAL_DURATION = 1200
let animationFrame = 0
let settleFrame = 0
let enterTimer = 0
let running = false
let lastTime = 0
let initialUntil = 0
let currentX = 0
let currentY = 0
let targetX = 0
let targetY = 0

/** 将数值限制在指定范围内。 */
function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(Math.max(value, minimum), maximum)
}

/** 保留动画变量需要的有限小数位。 */
function round(value, precision = 3) {
  return Number(value.toFixed(precision))
}

/** 将一个数值区间线性映射到另一个区间。 */
function adjust(value, fromMin, fromMax, toMin, toMax) {
  return round(toMin + ((toMax - toMin) * (value - fromMin)) / (fromMax - fromMin))
}

/** 将账号创建日期转换为适合卡片底栏的短文本。 */
function createdDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '创建日期未知'
}

/** 图片加载失败时恢复聊天室默认头像。 */
function useDefaultAvatar(event) {
  if (event.target.src.endsWith(encodeURI(DEFAULT_AVATAR))) return
  event.target.src = DEFAULT_AVATAR
}

/** 根据平滑后的指针坐标写入卡片全部视觉变量。 */
function applyPointerVariables(x, y) {
  if (!wrapper.value || !shell.value) return
  const width = shell.value.clientWidth || 1
  const height = shell.value.clientHeight || 1
  const percentX = clamp((100 / width) * x)
  const percentY = clamp((100 / height) * y)
  const centerX = percentX - 50
  const centerY = percentY - 50
  const variables = {
    '--pointer-x': `${percentX}%`,
    '--pointer-y': `${percentY}%`,
    '--background-x': `${adjust(percentX, 0, 100, 35, 65)}%`,
    '--background-y': `${adjust(percentY, 0, 100, 35, 65)}%`,
    '--pointer-from-center': clamp(Math.hypot(centerY, centerX) / 50, 0, 1),
    '--pointer-from-top': percentY / 100,
    '--pointer-from-left': percentX / 100,
    '--rotate-x': `${round(-(centerX / 5))}deg`,
    '--rotate-y': `${round(centerY / 4)}deg`,
  }
  for (const [name, value] of Object.entries(variables)) wrapper.value.style.setProperty(name, value)
}

/** 使用时间常数缓动追踪目标坐标，避免指针移动时发生抖动。 */
function animateTilt(timestamp) {
  if (!running) return
  if (!lastTime) lastTime = timestamp
  const delta = (timestamp - lastTime) / 1000
  lastTime = timestamp
  const tau = timestamp < initialUntil ? 0.6 : 0.14
  const strength = 1 - Math.exp(-delta / tau)
  currentX += (targetX - currentX) * strength
  currentY += (targetY - currentY) * strength
  applyPointerVariables(currentX, currentY)
  if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) {
    animationFrame = requestAnimationFrame(animateTilt)
  } else {
    running = false
    lastTime = 0
  }
}

/** 在动画停止时重新启动指针缓动循环。 */
function startTilt() {
  if (running) return
  running = true
  lastTime = 0
  animationFrame = requestAnimationFrame(animateTilt)
}

/** 设置下一帧需要追踪的卡片内坐标。 */
function setTarget(x, y) {
  targetX = x
  targetY = y
  startTilt()
}

/** 将动画目标移动到卡片中心。 */
function moveToCenter() {
  if (!shell.value) return
  setTarget(shell.value.clientWidth / 2, shell.value.clientHeight / 2)
}

/** 指针进入时启用全息效果并使用短暂的快速过渡。 */
function onPointerEnter(event) {
  if (!shell.value || event.pointerType === 'touch') return
  demonstrating.value = false
  active.value = true
  entering.value = true
  clearTimeout(enterTimer)
  enterTimer = setTimeout(() => { entering.value = false }, 180)
  const bounds = shell.value.getBoundingClientRect()
  setTarget(event.clientX - bounds.left, event.clientY - bounds.top)
}

/** 指针移动时持续更新缓动目标，不直接修改卡片变换。 */
function onPointerMove(event) {
  if (!shell.value || event.pointerType === 'touch') return
  const bounds = shell.value.getBoundingClientRect()
  setTarget(event.clientX - bounds.left, event.clientY - bounds.top)
}

/** 指针离开后回正卡片，并在稳定后关闭高亮状态。 */
function onPointerLeave() {
  moveToCenter()
  cancelAnimationFrame(settleFrame)

  /** 等待坐标真正回到中心后再淡出全息层。 */
  function checkSettled() {
    if (Math.hypot(targetX - currentX, targetY - currentY) < 0.6) active.value = false
    else settleFrame = requestAnimationFrame(checkSettled)
  }

  settleFrame = requestAnimationFrame(checkSettled)
}

/** 弹窗出现时从右上方执行一次自动回正演示。 */
function beginInitialAnimation() {
  if (!shell.value) return
  currentX = Math.max(0, shell.value.clientWidth - 70)
  currentY = 60
  targetX = currentX
  targetY = currentY
  applyPointerVariables(currentX, currentY)
  active.value = false
  demonstrating.value = true
  initialUntil = performance.now() + INITIAL_DURATION
  moveToCenter()
  clearTimeout(enterTimer)
  enterTimer = setTimeout(() => { demonstrating.value = false }, INITIAL_DURATION + 150)
}

/** 关闭用户卡片前取消当前交互状态。 */
function closeCard() {
  active.value = false
  demonstrating.value = false
  emit('close')
}

/** 取消组件创建的帧循环和计时器。 */
function stopAnimations() {
  running = false
  demonstrating.value = false
  cancelAnimationFrame(animationFrame)
  cancelAnimationFrame(settleFrame)
  clearTimeout(enterTimer)
}

watch(() => props.open, async (open) => {
  if (!open) {
    stopAnimations()
    return
  }
  await nextTick()
  beginInitialAnimation()
})

onBeforeUnmount(stopAnimations)
</script>

<template>
  <Transition name="profile-card-dialog">
    <div v-if="open && user" class="profile-card-mask" @mousedown.self="closeCard">
      <div
        ref="wrapper"
        class="pc-card-wrapper"
        :class="{ active, demonstrating }"
        @pointerenter="onPointerEnter"
        @pointermove="onPointerMove"
        @pointerleave="onPointerLeave"
      >
        <div class="pc-behind" aria-hidden="true"></div>
        <div ref="shell" class="pc-card-shell" :class="{ entering }">
          <section class="pc-card" role="dialog" aria-modal="true" aria-labelledby="profile-card-name">
            <div class="pc-inside">
              <div class="pc-shine" aria-hidden="true"></div>
              <div class="pc-glare" aria-hidden="true"></div>

              <div class="pc-content pc-avatar-content">
                <img class="pc-main-avatar" :src="user.avatar || DEFAULT_AVATAR" :alt="`${user.name}的头像`" @error="useDefaultAvatar">
                <div class="pc-user-info">
                  <div class="pc-user-details">
                    <div class="pc-mini-avatar"><img :src="user.avatar || DEFAULT_AVATAR" alt="" @error="useDefaultAvatar"></div>
                    <div class="pc-user-text">
                      <div class="pc-handle">@{{ user.userId }}</div>
                      <div class="pc-status">{{ createdDate(user.createdAt) }}</div>
                    </div>
                  </div>
                  <button class="pc-contact-btn" type="button" :aria-label="`与${user.name}聊天`" @click="emit('chat', user)">
                    <MessageCircle :size="15" />聊天
                  </button>
                </div>
              </div>

              <div class="pc-content pc-name-content">
                <div class="pc-details">
                  <h2 id="profile-card-name">{{ user.name }}</h2>
                  <p>CHAT ROOM MEMBER</p>
                </div>
              </div>
            </div>
          </section>
        </div>
        <button class="pc-close" type="button" title="关闭" @click="closeCard"><X :size="18" /></button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
@property --bgrotate {
  syntax: '<angle>';
  inherits: false;
  initial-value: 120deg;
}

@property --pointer-x {
  syntax: '<percentage>';
  inherits: true;
  initial-value: 50%;
}

@property --pointer-y {
  syntax: '<percentage>';
  inherits: true;
  initial-value: 50%;
}

.profile-card-mask {
  position: fixed;
  inset: 0;
  z-index: 280;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(5 12 24 / 46%);
}

.pc-card-wrapper {
  --pointer-x: 50%;
  --pointer-y: 50%;
  --pointer-from-center: 0;
  --pointer-from-top: .5;
  --pointer-from-left: .5;
  --card-opacity: 0;
  --rotate-x: 0deg;
  --rotate-y: 0deg;
  --background-x: 50%;
  --background-y: 50%;
  --behind-glow-color: rgb(6 182 212 / 72%);
  --behind-glow-size: 50%;
  --card-radius: 30px;
  --sunpillar-1: hsl(188 100% 70%);
  --sunpillar-2: hsl(162 100% 71%);
  --sunpillar-3: hsl(211 100% 74%);
  --sunpillar-4: hsl(280 100% 78%);
  --sunpillar-5: hsl(328 100% 74%);
  --sunpillar-6: hsl(50 100% 72%);
  position: relative;
  width: min(388px, calc(100vw - 32px));
  perspective: 500px;
  touch-action: none;
  transform: translate3d(0, 0, .1px);
}

.pc-behind {
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: var(--card-radius);
  pointer-events: none;
  background: radial-gradient(circle at var(--pointer-x) var(--pointer-y), var(--behind-glow-color) 0%, transparent var(--behind-glow-size));
  filter: blur(50px) saturate(1.1);
  opacity: calc(.8 * var(--card-opacity));
  transition: opacity 200ms ease;
}

.pc-card-wrapper:hover,
.pc-card-wrapper.active { --card-opacity: 1; }

.pc-card-shell { position: relative; z-index: 1; }

.pc-card {
  position: relative;
  height: min(72svh, 540px);
  min-height: 430px;
  aspect-ratio: .718;
  overflow: hidden;
  display: grid;
  border-radius: var(--card-radius);
  background: #06131c;
  box-shadow: rgb(0 0 0 / 70%) calc((var(--pointer-from-left) * 10px) - 3px) calc((var(--pointer-from-top) * 20px) - 6px) 24px -5px;
  backface-visibility: hidden;
  transform: translateZ(0) rotateX(0deg) rotateY(0deg);
  transition: transform 1s ease;
}

.pc-card:hover,
.active .pc-card,
.demonstrating .pc-card {
  transform: translateZ(0) rotateX(var(--rotate-y)) rotateY(var(--rotate-x));
  transition: none;
}

.pc-card-shell.entering .pc-card { transition: transform 180ms ease-out; }

.pc-inside,
.pc-shine,
.pc-glare,
.pc-content {
  position: absolute;
  inset: 0;
  border-radius: var(--card-radius);
  pointer-events: none;
}

.pc-inside {
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 12%, rgb(34 211 238 / 30%), transparent 34%),
    linear-gradient(145deg, rgb(12 65 79 / 92%) 0%, rgb(5 27 39 / 96%) 55%, #050b15 100%);
}

.pc-shine {
  --space: 5%;
  --angle: -45deg;
  z-index: 3;
  overflow: hidden;
  background-image:
    repeating-linear-gradient(0deg,
      var(--sunpillar-1) calc(var(--space) * 1),
      var(--sunpillar-2) calc(var(--space) * 2),
      var(--sunpillar-3) calc(var(--space) * 3),
      var(--sunpillar-4) calc(var(--space) * 4),
      var(--sunpillar-5) calc(var(--space) * 5),
      var(--sunpillar-6) calc(var(--space) * 6),
      var(--sunpillar-1) calc(var(--space) * 7)),
    repeating-linear-gradient(var(--angle), #0e152e 0%, hsl(180 10% 60%) 3.8%, hsl(180 29% 66%) 4.5%, hsl(180 10% 60%) 5.2%, #0e152e 10%, #0e152e 12%),
    radial-gradient(farthest-corner circle at var(--pointer-x) var(--pointer-y), rgb(0 0 0 / 10%) 12%, rgb(0 0 0 / 25%) 120%);
  background-position: 0 var(--background-y), var(--background-x) var(--background-y), center;
  background-size: 500% 500%, 300% 300%, 200% 200%;
  background-blend-mode: color, hard-light;
  filter: brightness(.66) contrast(1.33) saturate(.33) opacity(.44);
  mix-blend-mode: color-dodge;
  animation: holo-background 18s linear infinite;
  transition: filter .8s ease;
}

.pc-shine::before,
.pc-shine::after {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity .8s ease;
}

.pc-shine::before {
  background-image:
    linear-gradient(45deg, var(--sunpillar-4), var(--sunpillar-5), var(--sunpillar-6), var(--sunpillar-1), var(--sunpillar-2), var(--sunpillar-3)),
    radial-gradient(circle at var(--pointer-x) var(--pointer-y), hsl(0 0% 70%) 0%, hsl(0 0% 30% / 20%) 90%);
  background-size: 250% 250%, 100% 100%;
  background-position: var(--pointer-x) var(--pointer-y), center;
  background-blend-mode: color-dodge;
  filter: brightness(calc(2 - var(--pointer-from-center))) contrast(calc(var(--pointer-from-center) + 2)) saturate(calc(.5 + var(--pointer-from-center)));
  mix-blend-mode: luminosity;
}

.pc-shine::after {
  background-image:
    repeating-linear-gradient(0deg, transparent 0 5px, rgb(255 255 255 / 10%) 6px),
    radial-gradient(circle at var(--pointer-x) var(--pointer-y), rgb(255 255 255 / 35%), transparent 48%);
  background-position: 0 var(--background-y), calc(var(--background-x) * .4) calc(var(--background-y) * .5);
  background-size: 200% 300%, 700% 700%;
  mix-blend-mode: difference;
  filter: brightness(.8) contrast(1.5);
}

.pc-card:hover .pc-shine,
.active .pc-shine {
  filter: brightness(.85) contrast(1.5) saturate(.5);
  animation-play-state: paused;
}

/* 初始回正演示只保留深青色折射，避免全息层叠加成纯白。 */
.demonstrating .pc-shine {
  filter: brightness(.48) contrast(1.28) saturate(.58) opacity(.38);
}

.pc-card:hover .pc-shine::before,
.pc-card:hover .pc-shine::after,
.active .pc-shine::before,
.active .pc-shine::after { opacity: 1; }

.pc-glare {
  z-index: 4;
  overflow: hidden;
  background-image: radial-gradient(farthest-corner circle at var(--pointer-x) var(--pointer-y), hsl(185 70% 84%) 12%, hsl(199 58% 23% / 80%) 90%);
  mix-blend-mode: overlay;
  filter: brightness(.8) contrast(1.2);
  opacity: .42;
  transition: opacity .3s ease;
}

.pc-card:hover .pc-glare,
.active .pc-glare { opacity: .72; }

.demonstrating .pc-glare { opacity: .18; }

.pc-avatar-content {
  z-index: 2;
  overflow: visible;
  backface-visibility: hidden;
  mix-blend-mode: luminosity;
}

.pc-main-avatar {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 100%;
  height: 76%;
  object-fit: cover;
  object-position: center;
  filter: saturate(.9) contrast(1.04);
  transform-origin: 50% 100%;
  transform: translateX(calc(-50% + (var(--pointer-from-left) - .5) * 6px)) scaleY(calc(1 + (var(--pointer-from-top) - .5) * .02)) scaleX(calc(1 + (var(--pointer-from-left) - .5) * .01));
  transition: transform 120ms ease-out;
}

.pc-name-content {
  z-index: 5;
  max-height: 100%;
  overflow: hidden;
  text-align: center;
  mix-blend-mode: luminosity;
  transform: translate3d(calc(var(--pointer-from-left) * -6px + 3px), calc(var(--pointer-from-top) * -6px + 3px), .1px);
}

.pc-details {
  position: absolute;
  top: 42px;
  left: 20px;
  right: 20px;
}

.pc-details h2 {
  margin: 0;
  overflow-wrap: anywhere;
  color: transparent;
  background: linear-gradient(to bottom, #fff, #7dd3fc);
  background-clip: text;
  font-size: clamp(25px, 5svh, 42px);
  font-weight: 650;
  line-height: 1.1;
}

.pc-details p {
  margin: 5px 0 0;
  color: transparent;
  background: linear-gradient(to bottom, #e6fcff, #06b6d4);
  background-clip: text;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .18em;
}

.pc-user-info {
  position: absolute;
  z-index: 7;
  left: 20px;
  right: 20px;
  bottom: 20px;
  min-width: 0;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 16px;
  background: rgb(255 255 255 / 10%);
  backdrop-filter: blur(30px);
  pointer-events: auto;
}

.pc-user-details {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}

.pc-mini-avatar {
  width: 42px;
  height: 42px;
  flex: none;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 50%;
}

.pc-mini-avatar img { width: 100%; height: 100%; object-fit: cover; }
.pc-user-text { min-width: 0; display: grid; gap: 5px; }
.pc-handle { overflow: hidden; color: rgb(255 255 255 / 92%); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.pc-status { color: rgb(255 255 255 / 66%); font-size: 9px; }

.pc-contact-btn {
  flex: none;
  padding: 9px 12px;
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 9px;
  color: rgb(255 255 255 / 92%);
  background: rgb(6 182 212 / 22%);
  cursor: pointer;
  font-size: 11px;
  font-weight: 650;
  pointer-events: auto;
  transition: border-color .2s ease, transform .2s ease, background .2s ease;
}

.pc-contact-btn:hover { border-color: rgb(255 255 255 / 45%); background: rgb(6 182 212 / 38%); transform: translateY(-1px); }

.pc-close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 10;
  width: 34px;
  height: 34px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: #e6fcff;
  background: rgb(2 12 22 / 45%);
  backdrop-filter: blur(12px);
  cursor: pointer;
}

.pc-close:hover { background: rgb(6 182 212 / 38%); }

@keyframes holo-background {
  from { background-position: 0 var(--background-y), 0 0, center; }
  to { background-position: 0 var(--background-y), 90% 90%, center; }
}

.profile-card-dialog-enter-active,
.profile-card-dialog-leave-active { transition: opacity 220ms ease; }
.profile-card-dialog-enter-active .pc-card-wrapper,
.profile-card-dialog-leave-active .pc-card-wrapper { transition: transform 260ms cubic-bezier(.2, .8, .25, 1); }
.profile-card-dialog-enter-from,
.profile-card-dialog-leave-to { opacity: 0; }
.profile-card-dialog-enter-from .pc-card-wrapper,
.profile-card-dialog-leave-to .pc-card-wrapper { transform: translateY(18px) scale(.94); }

@media (max-width: 480px) {
  .profile-card-mask { padding: 16px; }
  .pc-card { height: min(62svh, 430px); min-height: 350px; }
  .pc-user-info { left: 12px; right: 12px; bottom: 12px; padding: 9px 10px; }
  .pc-mini-avatar { width: 32px; height: 32px; }
  .pc-status { font-size: 8px; }
  .pc-contact-btn { padding: 7px 9px; }
  .pc-details { top: 30px; }
}

@media (prefers-reduced-motion: reduce) {
  .pc-card,
  .pc-main-avatar,
  .pc-card-wrapper { transform: none !important; transition: none !important; }
  .pc-shine { animation: none; }
}
</style>
