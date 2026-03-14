<script setup lang="ts">
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet } from '@ionic/vue'
import { chatbubbles, construct, gitNetwork, settings } from 'ionicons/icons'
import { usePlatform } from '@/composables/usePlatform'

const { isMobile } = usePlatform()
</script>

<template>
  <ion-tabs>
    <ion-router-outlet />
    <ion-tab-bar slot="bottom">
      <ion-tab-button tab="chat" href="/chat">
        <ion-icon :icon="chatbubbles" />
        <ion-label>Chat</ion-label>
      </ion-tab-button>
      <ion-tab-button v-if="!isMobile" tab="cowork" href="/cowork">
        <ion-icon :icon="construct" />
        <ion-label>Cowork</ion-label>
      </ion-tab-button>
      <ion-tab-button v-if="!isMobile" tab="workflow" href="/workflow">
        <ion-icon :icon="gitNetwork" />
        <ion-label>Workflow</ion-label>
      </ion-tab-button>
      <ion-tab-button tab="settings" href="/settings">
        <ion-icon :icon="settings" />
        <ion-label>Settings</ion-label>
      </ion-tab-button>
    </ion-tab-bar>
  </ion-tabs>
</template>
