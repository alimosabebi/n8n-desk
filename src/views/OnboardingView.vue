<script setup lang="ts">
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonButton, IonInput, IonSpinner, IonIcon, IonText,
  IonButtons,
} from '@ionic/vue'
import { arrowBack } from 'ionicons/icons'
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { checkmarkCircle, alertCircle, colorPalette, lockClosed } from 'ionicons/icons'
import { useAuth } from '@/composables/useAuth'
import { useAuthStore } from '@/stores/auth'
import { useInstancesStore } from '@/stores/instances'
import { createApiClient } from '@/services/n8n-api'
import type { ValidateInstanceResult } from '@/types/auth'

const router = useRouter()
const { t } = useI18n()
const { login, registerInstance } = useAuth()
const authStore = useAuthStore()
const instancesStore = useInstancesStore()

// --- Back navigation (only when user already has instances) ---
const canGoBack = computed(() => instancesStore.hasInstances)

function goBack(): void {
  router.back()
}

// --- Step state ---
// Steps: 1=URL, 2=Credential Login, 3=OAuth (conditional), 4=Done
// For chatUsers or instances without OAuth, step 3 is skipped (totalSteps=3)
const currentStep = ref<1 | 2 | 3 | 4>(1)
const needsOAuth = ref(false)
const totalSteps = computed(() => needsOAuth.value ? 4 : 3)

/** Map the visual step number based on whether OAuth is needed */
function doneStep(): 3 | 4 {
  return needsOAuth.value ? 4 : 3
}

// --- Step 1: URL input ---
const instanceUrl = ref('')
const urlError = ref<string | null>(null)
const isValidating = ref(false)

// --- Shared instance state (set during validation) ---
const validatedInstanceId = ref<string | null>(null)
const validatedHostname = ref('')
const hasOAuthSupport = ref(false)

// --- Step 2: Credential login ---
const credEmail = ref('')
const credPassword = ref('')
const credMfaCode = ref('')
const isMfaRequired = ref(false)
const isCredLoggingIn = ref(false)
const credError = ref<string | null>(null)

// --- Step 3: OAuth sign-in (conditional) ---
const isSigningIn = ref(false)
const signInError = ref<string | null>(null)

// --- Step 4 (or 3 for chatUsers): Connected ---
const instanceLabel = ref('')
const instanceColor = ref('#ff6d5a')
const agentCount = ref<number | null>(null)
const isDiscovering = ref(false)

const PRESET_COLORS = [
  '#ff6d5a', // orange-red
  '#7c3aed', // purple
  '#0ea5e9', // sky blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
]

const stepLabel = computed(() => {
  switch (currentStep.value) {
    case 1: return t('onboarding.stepConnect')
    case 2: return t('onboarding.stepSignIn')
    case 3: return needsOAuth.value ? t('onboarding.stepAuthorize') : t('onboarding.stepDone')
    case 4: return t('onboarding.stepDone')
    default: return ''
  }
})

// --- Step 1: Validate URL ---
function normalizeUrl(raw: string): string {
  let url = raw.trim()
  // Add protocol if missing
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url
  }
  // Remove trailing slashes
  return url.replace(/\/+$/, '')
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function validateAndConnect(): Promise<void> {
  urlError.value = null
  const url = normalizeUrl(instanceUrl.value)

  if (!instanceUrl.value.trim()) {
    urlError.value = t('onboarding.errors.invalidUrl')
    return
  }

  if (!isValidUrl(url)) {
    urlError.value = t('onboarding.errors.invalidUrl')
    return
  }

  isValidating.value = true

  try {
    // Validate via IPC (handles .well-known check + instance directory creation)
    let result: ValidateInstanceResult

    if (window.n8nDesk) {
      result = await window.n8nDesk.auth.validateInstance(url)
    } else {
      // Fallback for browser dev mode — direct fetch
      try {
        const response = await fetch(`${url}/.well-known/oauth-authorization-server`, {
          signal: AbortSignal.timeout(10000),
        })
        if (!response.ok) {
          urlError.value = t('onboarding.errors.notN8n')
          return
        }
        const metadata = await response.json()
        if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
          urlError.value = t('onboarding.errors.notN8n')
          return
        }
        // In browser dev mode, create a synthetic result
        result = { success: true, instanceId: 'dev', hostname: new URL(url).hostname, hasOAuthSupport: true }
      } catch {
        urlError.value = t('onboarding.errors.unreachable')
        return
      }
    }

    if (!result.success) {
      if (result.errorCode === 'unreachable') {
        urlError.value = t('onboarding.errors.unreachable')
      } else {
        urlError.value = result.error ?? t('onboarding.errors.notN8n')
      }
      return
    }

    // URL is valid — prepare for credential login
    instanceUrl.value = url
    validatedInstanceId.value = result.instanceId
    validatedHostname.value = result.hostname
    hasOAuthSupport.value = result.hasOAuthSupport
    instanceLabel.value = result.hostname
    currentStep.value = 2
  } catch {
    urlError.value = t('onboarding.errors.unreachable')
  } finally {
    isValidating.value = false
  }
}

// --- Step 2: Credential Login ---
async function submitCredentials(): Promise<void> {
  if (!validatedInstanceId.value) return
  credError.value = null
  isCredLoggingIn.value = true

  try {
    const result = await authStore.credentialLogin(validatedInstanceId.value, {
      email: credEmail.value,
      password: credPassword.value,
      mfaCode: isMfaRequired.value ? credMfaCode.value : undefined,
    })

    if (result.success) {
      // Register instance in stores
      await registerInstance(validatedInstanceId.value!)

      // Read the instance to get its assigned color
      const instance = instancesStore.instances.find((i) => i.id === validatedInstanceId.value)
      if (instance) {
        instanceColor.value = instance.color
        instanceLabel.value = instance.label
      }

      // Determine if OAuth is needed based on role and OAuth support
      const isFullAccess = authStore.isFullAccess
      needsOAuth.value = isFullAccess && hasOAuthSupport.value

      if (needsOAuth.value) {
        // Full-access user → proceed to OAuth step
        currentStep.value = 3
        void startSignIn()
      } else {
        // chatUser or no OAuth → skip to Done
        goToConnected()
      }
    } else {
      if (result.errorCode === 'mfa_required') {
        isMfaRequired.value = true
        credError.value = null // Clear error, show MFA input instead
      } else {
        credError.value = result.error || t('onboarding.errors.credentialsFailed')
      }
    }
  } catch {
    credError.value = t('onboarding.errors.credentialsFailed')
  } finally {
    isCredLoggingIn.value = false
  }
}

// --- Step 3: OAuth Sign-In (conditional, only for full-access users) ---
async function startSignIn(options?: { forceLocalhost?: boolean }): Promise<void> {
  signInError.value = null
  isSigningIn.value = true

  try {
    const result = await login(instanceUrl.value, options)

    if (result.success) {
      goToConnected()
    } else {
      if (result.errorCode === 'auth_timeout') {
        signInError.value = t('onboarding.errors.authTimeout')
      } else if (result.errorCode === 'auth_cancelled') {
        signInError.value = t('onboarding.errors.authCancelled')
      } else {
        signInError.value = result.error || t('onboarding.errors.authFailed')
      }
    }
  } catch {
    signInError.value = t('onboarding.errors.authFailed')
  } finally {
    isSigningIn.value = false
  }
}

function skipOAuth(): void {
  // User chose to skip OAuth — they'll have Chat-only until they authorize later
  needsOAuth.value = false
  goToConnected()
}

function goToConnected(): void {
  currentStep.value = doneStep()
  void discoverAgents()
}

// --- Done step: Agent Discovery ---
async function discoverAgents(): Promise<void> {
  isDiscovering.value = true
  try {
    const client = createApiClient()
    if (!client) return

    // Try to fetch ChatHub agents
    try {
      const agents = await client.get<{ data: unknown[] }>('/chat/agents')
      agentCount.value = agents?.data?.length ?? 0
    } catch {
      // ChatHub might not be available — that's OK
      agentCount.value = 0
    }
  } finally {
    isDiscovering.value = false
  }
}

async function updateInstanceAndFinish(): Promise<void> {
  if (validatedInstanceId.value) {
    await instancesStore.updateInstance(validatedInstanceId.value, {
      label: instanceLabel.value,
      color: instanceColor.value,
    })
  }
  router.replace('/chat')
}

function retryWithLocalhost(): void {
  isSigningIn.value = false
  void startSignIn({ forceLocalhost: true })
}

function goBackToStep1(): void {
  currentStep.value = 1
  signInError.value = null
  credError.value = null
  urlError.value = null
}

function goBackToStep2(): void {
  currentStep.value = 2
  signInError.value = null
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons v-if="canGoBack" slot="start">
          <ion-button fill="clear" @click="goBack">
            <ion-icon slot="icon-only" :icon="arrowBack" />
          </ion-button>
        </ion-buttons>
        <ion-title>{{ t('onboarding.connectToN8n') }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <div class="onboarding-container">
        <!-- Step indicator -->
        <div class="step-indicator">
          <div
            v-for="step in totalSteps"
            :key="step"
            class="step-dot"
            :class="{ 'step-dot--active': currentStep >= step }"
          />
        </div>

        <p class="step-label">{{ stepLabel }}</p>

        <!-- Step 1: URL Input -->
        <div v-if="currentStep === 1" class="step-content">
          <h2 class="step-title">{{ t('onboarding.stepConnectTitle') }}</h2>
          <p class="step-description">{{ t('onboarding.urlHelp') }}</p>

          <ion-input
            v-model="instanceUrl"
            :label="t('onboarding.urlLabel')"
            :placeholder="t('onboarding.urlPlaceholder')"
            fill="outline"
            label-placement="stacked"
            type="url"
            :class="{ 'ion-invalid': urlError, 'ion-touched': urlError }"
            :error-text="urlError ?? undefined"
            @keyup.enter="validateAndConnect"
          />

          <ion-button
            expand="block"
            :disabled="isValidating || !instanceUrl.trim()"
            class="action-button"
            @click="validateAndConnect"
          >
            <ion-spinner v-if="isValidating" name="crescent" />
            <span v-else>{{ t('onboarding.connectButton') }}</span>
          </ion-button>
        </div>

        <!-- Step 2: Credential Login -->
        <div v-if="currentStep === 2" class="step-content">
          <div class="credentials-header">
            <ion-icon :icon="lockClosed" class="credentials-icon" />
            <h2 class="step-title">{{ t('onboarding.stepSignInTitle', { hostname: validatedHostname }) }}</h2>
          </div>
          <p class="step-description">{{ t('onboarding.credentialsHelp') }}</p>

          <ion-input
            v-model="credEmail"
            :label="t('onboarding.emailLabel')"
            :placeholder="t('onboarding.emailPlaceholder')"
            fill="outline"
            label-placement="stacked"
            type="email"
            autocomplete="email"
            @keyup.enter="submitCredentials"
          />

          <ion-input
            v-model="credPassword"
            :label="t('onboarding.passwordLabel')"
            fill="outline"
            label-placement="stacked"
            type="password"
            autocomplete="current-password"
            @keyup.enter="submitCredentials"
          />

          <ion-input
            v-if="isMfaRequired"
            v-model="credMfaCode"
            :label="t('onboarding.mfaLabel')"
            :placeholder="t('onboarding.mfaPlaceholder')"
            fill="outline"
            label-placement="stacked"
            type="text"
            inputmode="numeric"
            :maxlength="6"
            @keyup.enter="submitCredentials"
          />

          <div v-if="credError" class="cred-error">
            <ion-icon :icon="alertCircle" color="danger" />
            <ion-text color="danger">
              <p>{{ credError }}</p>
            </ion-text>
          </div>

          <ion-button
            expand="block"
            :disabled="isCredLoggingIn || !credEmail.trim() || !credPassword.trim()"
            class="action-button"
            @click="submitCredentials"
          >
            <ion-spinner v-if="isCredLoggingIn" name="crescent" />
            <span v-else>{{ t('onboarding.signInButton') }}</span>
          </ion-button>

          <button class="back-link" @click="goBackToStep1">
            {{ t('onboarding.changeUrl') }}
          </button>
        </div>

        <!-- Step 3: OAuth Authorization (only for full-access users) -->
        <div v-if="currentStep === 3 && needsOAuth" class="step-content">
          <h2 class="step-title">{{ t('onboarding.stepAuthorizeTitle') }}</h2>
          <p class="step-description">{{ t('onboarding.authorizeHelp') }}</p>

          <div v-if="isSigningIn" class="signing-in">
            <ion-spinner name="crescent" class="sign-in-spinner" />
            <p class="sign-in-text">{{ t('onboarding.authorizing', { hostname: validatedHostname }) }}</p>
            <p class="sign-in-hint">{{ t('onboarding.signInHint') }}</p>
            <button class="trouble-link" @click="retryWithLocalhost">
              {{ t('onboarding.havingTrouble') }} {{ t('onboarding.tryBrowserVerification') }}
            </button>
          </div>

          <div v-if="signInError" class="sign-in-error">
            <ion-icon :icon="alertCircle" color="danger" class="error-icon" />
            <ion-text color="danger">
              <p>{{ signInError }}</p>
            </ion-text>
            <div class="error-actions">
              <ion-button @click="startSignIn" :disabled="isSigningIn">
                {{ t('onboarding.tryAgain') }}
              </ion-button>
              <ion-button fill="outline" @click="skipOAuth">
                {{ t('onboarding.skipForNow') }}
              </ion-button>
            </div>
          </div>

          <div v-if="!isSigningIn && !signInError" class="oauth-actions">
            <button class="skip-link" @click="skipOAuth">
              {{ t('onboarding.skipForNow') }}
            </button>
          </div>
        </div>

        <!-- Done step (step 3 for chatUsers, step 4 for full-access) -->
        <div v-if="currentStep === doneStep()" class="step-content">
          <div class="connected-header">
            <ion-icon :icon="checkmarkCircle" color="success" class="connected-icon" />
            <h2 class="step-title">{{ t('onboarding.connected') }}</h2>
          </div>
          <p class="step-description">
            {{ authStore.isFullAccess ? t('onboarding.connectedFullAccess') : t('onboarding.connectedChatOnly') }}
          </p>

          <ion-input
            v-model="instanceLabel"
            :label="t('onboarding.instanceLabel')"
            fill="outline"
            label-placement="stacked"
          />

          <div class="color-picker">
            <label class="color-label">{{ t('onboarding.instanceColor') }}</label>
            <div class="color-dots">
              <button
                v-for="color in PRESET_COLORS"
                :key="color"
                class="color-dot"
                :class="{ 'color-dot--selected': instanceColor === color }"
                :style="{ background: color }"
                @click="instanceColor = color"
              />
            </div>
          </div>

          <div v-if="isDiscovering" class="agent-discovery">
            <ion-spinner name="dots" />
            <span>{{ t('onboarding.discoveringAgents') }}</span>
          </div>
          <div v-else-if="agentCount !== null" class="agent-count">
            <ion-icon :icon="colorPalette" />
            <span>{{ t('onboarding.foundAgents', { count: agentCount }, agentCount) }}</span>
          </div>

          <ion-button
            expand="block"
            class="action-button"
            @click="updateInstanceAndFinish"
          >
            {{ t('onboarding.getStarted') }}
          </ion-button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped lang="scss">
.onboarding-container {
  max-width: 440px;
  margin: 0 auto;
  padding-top: var(--spacing--xl);
}

.step-indicator {
  display: flex;
  justify-content: center;
  gap: var(--spacing--xs);
  margin-bottom: var(--spacing--sm);
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color--neutral-500);
  transition: background 0.2s ease;

  &--active {
    background: var(--color--primary);
  }
}

.step-label {
  text-align: center;
  color: var(--color--text--tint-1);
  font-size: var(--font-size--2xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--spacing--lg);
}

.step-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--md);
}

.step-title {
  font-size: var(--font-size--lg);
  font-weight: var(--font-weight--bold);
  color: var(--color--text);
  margin: 0;
  text-align: center;
}

.step-description {
  color: var(--color--text--tint-1);
  text-align: center;
  font-size: var(--font-size--sm);
  margin: 0;
}

.action-button {
  margin-top: var(--spacing--sm);
}

// Step 2
.credentials-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing--xs);
}

.credentials-icon {
  font-size: 40px;
  color: var(--color--primary);
}

.cred-error {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);

  p {
    margin: 0;
    font-size: var(--font-size--sm);
  }
}

.back-link,
.skip-link {
  margin-top: var(--spacing--xs);
  background: none;
  border: none;
  color: var(--color--text--tint-1);
  font-size: var(--font-size--2xs);
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  align-self: center;

  &:hover {
    color: var(--color--primary);
  }
}

// Step 3 (OAuth)
.signing-in {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing--sm);
  padding: var(--spacing--xl) 0;
}

.sign-in-spinner {
  width: 48px;
  height: 48px;
  color: var(--color--primary);
}

.sign-in-text {
  color: var(--color--text);
  font-size: var(--font-size--md);
  margin: 0;
}

.sign-in-hint {
  color: var(--color--text--tint-1);
  font-size: var(--font-size--sm);
  margin: 0;
}

.trouble-link {
  margin-top: var(--spacing--sm);
  background: none;
  border: none;
  color: var(--color--text--tint-1);
  font-size: var(--font-size--2xs);
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  align-self: center;

  &:hover {
    color: var(--color--primary);
  }
}

.sign-in-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing--sm);
  padding: var(--spacing--lg) 0;
}

.error-icon {
  font-size: 40px;
}

.error-actions {
  display: flex;
  gap: var(--spacing--sm);
  margin-top: var(--spacing--sm);
}

.oauth-actions {
  display: flex;
  justify-content: center;
}

// Done step
.connected-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing--xs);
}

.connected-icon {
  font-size: 48px;
}

.color-picker {
  display: flex;
  flex-direction: column;
  gap: var(--spacing--xs);
}

.color-label {
  font-size: var(--font-size--sm);
  color: var(--color--text--tint-1);
}

.color-dots {
  display: flex;
  gap: var(--spacing--sm);
}

.color-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;

  &:hover {
    transform: scale(1.1);
  }

  &--selected {
    border-color: var(--color--text);
    transform: scale(1.15);
  }
}

.agent-discovery {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);
  color: var(--color--text--tint-1);
  font-size: var(--font-size--sm);
}

.agent-count {
  display: flex;
  align-items: center;
  gap: var(--spacing--xs);
  color: var(--color--text--tint-1);
  font-size: var(--font-size--sm);
}
</style>
