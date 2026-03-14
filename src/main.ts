import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { IonicVue } from '@ionic/vue'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settings'
import { useTheme } from './composables/useTheme'

import './theme/global.scss'

const app = createApp(App)
  .use(IonicVue)
  .use(createPinia())
  .use(router)

router.isReady().then(async () => {
  const settingsStore = useSettingsStore()
  await settingsStore.hydrate()
  const { init } = useTheme()
  init(settingsStore.theme)
  app.mount('#app')
})
