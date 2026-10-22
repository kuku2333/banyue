import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, type PublicUser } from '@/lib/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<PublicUser | null>(null)
  const ready = ref(false)
  const dialogOpen = ref(false)
  /** 注册/重置成功后只显示一次的恢复码 */
  const recoveryCode = ref('')

  const loggedIn = computed(() => Boolean(user.value))

  async function ensure(): Promise<void> {
    if (ready.value) return
    try {
      const data = await api<{ user: PublicUser | null }>('/api/me')
      user.value = data.user
    } catch {
      user.value = null
    } finally {
      ready.value = true
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const data = await api<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    user.value = data.user
    ready.value = true
  }

  async function register(username: string, password: string, displayName: string): Promise<void> {
    const data = await api<{ user: PublicUser; recoveryCode: string }>('/api/auth/register', {
      method: 'POST',
      body: { username, password, displayName },
    })
    user.value = data.user
    ready.value = true
    recoveryCode.value = data.recoveryCode
  }

  async function recover(username: string, code: string, password: string): Promise<void> {
    const data = await api<{ recoveryCode: string }>('/api/auth/recover', {
      method: 'POST',
      body: { username, code, password },
    })
    user.value = null
    ready.value = true
    recoveryCode.value = data.recoveryCode
  }

  async function regenerateRecoveryCode(): Promise<string> {
    const data = await api<{ recoveryCode: string }>('/api/auth/recovery-code', { method: 'POST' })
    recoveryCode.value = data.recoveryCode
    return data.recoveryCode
  }

  async function logout(): Promise<void> {
    await api('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  function openDialog(): void {
    dialogOpen.value = true
  }

  return {
    user,
    ready,
    dialogOpen,
    recoveryCode,
    loggedIn,
    ensure,
    login,
    register,
    recover,
    regenerateRecoveryCode,
    logout,
    openDialog,
  }
})
