<script setup lang="ts">
import { IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonSelect, IonSelectOption } from '@ionic/vue'
import { useSettingsStore } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'
import type { ThemeMode } from '@/types/settings'

const settingsStore = useSettingsStore()
const { applyTheme } = useTheme()

function onThemeChange(event: CustomEvent) {
  const value = event.detail.value as ThemeMode
  settingsStore.setTheme(value)
  applyTheme(value)
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Settings</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-list>
        <ion-item>
          <ion-label>Theme</ion-label>
          <ion-select
            :value="settingsStore.theme"
            interface="popover"
            @ion-change="onThemeChange"
          >
            <ion-select-option value="system">System</ion-select-option>
            <ion-select-option value="light">Light</ion-select-option>
            <ion-select-option value="dark">Dark</ion-select-option>
          </ion-select>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>
