import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ThemeMode, AppMode, AppSettings } from '@/types/settings'
import { localStorageService } from '@/services/local-storage'

const CONFIG_PATH = 'config.json'

const DEFAULTS: AppSettings = {
  theme: 'system',
  defaultInstanceId: null,
  lastMode: 'chat',
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<ThemeMode>(DEFAULTS.theme)
  const defaultInstanceId = ref<string | null>(DEFAULTS.defaultInstanceId)
  const lastMode = ref<AppMode>(DEFAULTS.lastMode)

  async function hydrate(): Promise<void> {
    const saved = await localStorageService.readJson<AppSettings>(CONFIG_PATH)
    if (saved) {
      theme.value = saved.theme ?? DEFAULTS.theme
      defaultInstanceId.value = saved.defaultInstanceId ?? DEFAULTS.defaultInstanceId
      lastMode.value = saved.lastMode ?? DEFAULTS.lastMode
    }
  }

  async function save(): Promise<void> {
    const data: AppSettings = {
      theme: theme.value,
      defaultInstanceId: defaultInstanceId.value,
      lastMode: lastMode.value,
    }
    await localStorageService.writeJson(CONFIG_PATH, data)
  }

  function setTheme(mode: ThemeMode): void {
    theme.value = mode
    void save()
  }

  function setLastMode(mode: AppMode): void {
    lastMode.value = mode
    void save()
  }

  return {
    theme,
    defaultInstanceId,
    lastMode,
    hydrate,
    save,
    setTheme,
    setLastMode,
  }
})
