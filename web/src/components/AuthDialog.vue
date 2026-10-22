<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const auth = useAuthStore()
const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const displayName = ref('')
const busy = ref(false)
const error = ref('')

const title = computed(() => (mode.value === 'login' ? '登录' : '注册'))

watch(
  () => props.open,
  (open) => {
    if (open) {
      error.value = ''
      password.value = ''
    }
  },
)

async function submit(): Promise<void> {
  if (busy.value) return
  error.value = ''
  busy.value = true
  try {
    if (mode.value === 'login') {
      await auth.login(username.value.trim(), password.value)
    } else {
      await auth.register(username.value.trim(), password.value, displayName.value.trim())
    }
    emit('update:open', false)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Transition name="auth">
    <div v-if="open" class="auth-layer" role="dialog" aria-modal="true" :aria-label="title" @click.self="emit('update:open', false)">
      <form class="auth-box" @submit.prevent="submit">
        <header>
          <h2>{{ title }}</h2>
          <button type="button" class="close" aria-label="关闭" @click="emit('update:open', false)">×</button>
        </header>

        <p class="lead">账号只用来认领你的收藏夹、书签和评论，不需要邮箱，也不接第三方登录。</p>

        <label>
          <span>用户名</span>
          <input v-model="username" autocomplete="username" placeholder="3-24 位，字母数字下划线" required />
        </label>

        <label v-if="mode === 'register'">
          <span>昵称（可选）</span>
          <input v-model="displayName" autocomplete="nickname" placeholder="别人看到的名字" />
        </label>

        <label>
          <span>密码</span>
          <input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" placeholder="至少 6 位" required />
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <button type="submit" class="submit" :disabled="busy">{{ busy ? '处理中…' : title }}</button>

        <p class="switch">
          <template v-if="mode === 'login'">
            还没有账号？<button type="button" @click="mode = 'register'; error = ''">注册一个</button>
          </template>
          <template v-else>
            已经有账号？<button type="button" @click="mode = 'login'; error = ''">去登录</button>
          </template>
        </p>
      </form>
    </div>
  </Transition>
</template>

<style scoped>
.auth-layer {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 8, 11, 0.75);
  backdrop-filter: blur(8px);
}

.auth-box {
  width: min(100%, 400px);
  padding: 24px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--card);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.close {
  color: var(--dim);
  font-size: 1.2rem;
  line-height: 1;
}

.lead {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 0.78rem;
  line-height: 1.6;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--text-2);
}

input {
  min-height: 42px;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--bg-soft);
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
}

input:focus {
  border-color: var(--accent-line);
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.78rem;
}

.submit {
  min-height: 44px;
  border-radius: 10px;
  background: linear-gradient(120deg, var(--accent), var(--accent-2));
  color: #06211d;
  font-weight: 600;
  font-size: 0.92rem;
}

.submit:disabled {
  opacity: 0.6;
}

.switch {
  margin: 4px 0 0;
  text-align: center;
  color: var(--muted);
  font-size: 0.78rem;
}

.switch button {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.auth-enter-active,
.auth-leave-active {
  transition: opacity 0.18s ease;
}

.auth-enter-from,
.auth-leave-to {
  opacity: 0;
}
</style>
