<script setup lang="ts">
import {
  IonInput, IonTextarea, IonToggle, IonButton, IonSpinner,
} from '@ionic/vue'
import { ref, reactive, computed } from 'vue'
import { Plus, Minus, Server, CheckCircle2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'
import type { StandaloneMcpServer } from '@/types/plugin'

interface Props {
  /** Pre-fill the form for editing an existing server */
  editServer?: StandaloneMcpServer
}

const props = defineProps<Props>()

const emit = defineEmits<{
  saved: [server: StandaloneMcpServer]
  cancel: []
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()

// --- Form draft ---

interface HeaderRow {
  name: string
  value: string
}

const draft = reactive({
  name: props.editServer?.name ?? '',
  url: props.editServer?.url ?? '',
  description: props.editServer?.description ?? '',
  requireApproval: props.editServer?.requireApproval ?? true,
})

const headers = ref<HeaderRow[]>(
  props.editServer?.headerNames?.length
    ? props.editServer.headerNames.map((name) => ({ name, value: '' }))
    : [],
)

// --- Validation ---

const urlError = ref<string | null>(null)

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const isFormValid = computed(() => {
  return draft.url.trim().length > 0 && isValidUrl(draft.url.trim())
})

function validateUrl(): void {
  const url = draft.url.trim()
  if (!url) {
    urlError.value = t('plugins.addServer.urlRequired')
    return
  }
  if (!isValidUrl(url)) {
    urlError.value = t('plugins.addServer.urlInvalid')
    return
  }
  urlError.value = null
}

// --- Header rows ---

function addHeaderRow(): void {
  headers.value.push({ name: '', value: '' })
}

function removeHeaderRow(index: number): void {
  headers.value.splice(index, 1)
}

// --- Test connection ---

const testStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle')
const testError = ref('')
const discoveredToolCount = ref(0)

function buildHeadersRecord(): Record<string, string> {
  const record: Record<string, string> = {}
  for (const row of headers.value) {
    const name = row.name.trim()
    const value = row.value.trim()
    if (name && value) {
      record[name] = value
    }
  }
  return record
}

async function testConnection(): Promise<void> {
  validateUrl()
  if (urlError.value) return

  testStatus.value = 'testing'
  testError.value = ''
  discoveredToolCount.value = 0

  try {
    const tools = await pluginsStore.testServer(
      draft.url.trim(),
      buildHeadersRecord(),
    )
    discoveredToolCount.value = tools.length
    testStatus.value = 'success'
  } catch (err: unknown) {
    testStatus.value = 'error'
    testError.value = err instanceof Error
      ? err.message
      : t('plugins.addServer.testFailed')
  }
}

// --- Save ---

const isSaving = ref(false)

async function handleSave(): Promise<void> {
  validateUrl()
  if (urlError.value) return

  isSaving.value = true

  try {
    const headerNames = headers.value
      .map((h) => h.name.trim())
      .filter((n) => n.length > 0)

    if (props.editServer) {
      // Update existing server
      await pluginsStore.updateServer(props.editServer.id, {
        name: draft.name.trim() || draft.url.trim(),
        url: draft.url.trim(),
        description: draft.description.trim() || undefined,
        headerNames: headerNames.length > 0 ? headerNames : undefined,
        requireApproval: draft.requireApproval,
      })
      emit('saved', {
        ...props.editServer,
        name: draft.name.trim() || draft.url.trim(),
        url: draft.url.trim(),
        description: draft.description.trim(),
        headerNames,
        requireApproval: draft.requireApproval,
      })
    } else {
      // Add new server
      const server = await pluginsStore.addServer({
        name: draft.name.trim() || draft.url.trim(),
        url: draft.url.trim(),
        description: draft.description.trim() || undefined,
        headerNames: headerNames.length > 0 ? headerNames : undefined,
        enabled: true,
        requireApproval: draft.requireApproval,
      })

      // Store header secret values in keychain
      for (const row of headers.value) {
        const name = row.name.trim()
        const value = row.value.trim()
        if (name && value) {
          await pluginsStore.setSecret('server', server.id, name, value)
        }
      }

      emit('saved', server)
    }
  } catch (err: unknown) {
    testStatus.value = 'error'
    testError.value = err instanceof Error
      ? err.message
      : t('plugins.addServer.saveFailed')
  } finally {
    isSaving.value = false
  }
}

const isEditing = computed(() => !!props.editServer)
</script>

<template>
  <div :class="$style.form">
    <div :class="$style.header">
      <Server :size="18" :class="$style.headerIcon" />
      <span :class="$style.headerTitle">
        {{ isEditing ? t('plugins.addServer.titleEdit') : t('plugins.addServer.title') }}
      </span>
    </div>

    <!-- Name -->
    <div :class="$style.field">
      <ion-input
        v-model="draft.name"
        :label="t('plugins.addServer.name')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.addServer.namePlaceholder')"
      />
    </div>

    <!-- URL (required) -->
    <div :class="$style.field">
      <ion-input
        v-model="draft.url"
        :label="t('plugins.addServer.url')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.addServer.urlPlaceholder')"
        type="url"
        required
        :class="{ [$style.inputError]: urlError }"
        @ion-blur="validateUrl"
      />
      <span v-if="urlError" :class="$style.errorText">{{ urlError }}</span>
    </div>

    <!-- Description -->
    <div :class="$style.field">
      <ion-textarea
        v-model="draft.description"
        :label="t('plugins.addServer.description')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.addServer.descriptionPlaceholder')"
        :rows="2"
        auto-grow
      />
    </div>

    <!-- Headers -->
    <div :class="$style.field">
      <label :class="$style.fieldLabel">{{ t('plugins.addServer.headers') }}</label>
      <p :class="$style.fieldHint">{{ t('plugins.addServer.headersHint') }}</p>

      <div
        v-for="(row, index) in headers"
        :key="index"
        :class="$style.headerRow"
      >
        <ion-input
          v-model="row.name"
          :label="t('plugins.addServer.headerName')"
          fill="outline"
          label-placement="stacked"
          :placeholder="t('plugins.addServer.headerNamePlaceholder')"
          :class="$style.headerInput"
        />
        <ion-input
          v-model="row.value"
          :label="t('plugins.addServer.headerValue')"
          fill="outline"
          label-placement="stacked"
          :placeholder="t('plugins.addServer.headerValuePlaceholder')"
          type="password"
          :class="$style.headerInput"
        />
        <ion-button
          fill="clear"
          size="small"
          color="danger"
          :class="$style.removeBtn"
          :title="t('plugins.addServer.removeHeader')"
          @click="removeHeaderRow(index)"
        >
          <Minus :size="16" />
        </ion-button>
      </div>

      <ion-button
        fill="clear"
        size="small"
        :class="$style.addHeaderBtn"
        @click="addHeaderRow"
      >
        <Plus :size="14" style="margin-right: 4px;" />
        {{ t('plugins.addServer.addHeader') }}
      </ion-button>
    </div>

    <!-- Require Approval toggle -->
    <div :class="$style.toggleField">
      <div :class="$style.toggleInfo">
        <span :class="$style.toggleLabel">{{ t('plugins.addServer.requireApproval') }}</span>
        <span :class="$style.toggleHint">{{ t('plugins.addServer.requireApprovalHint') }}</span>
      </div>
      <ion-toggle
        :checked="draft.requireApproval"
        @ion-change="draft.requireApproval = $event.detail.checked"
      />
    </div>

    <!-- Test Connection -->
    <div :class="$style.testSection">
      <ion-button
        fill="outline"
        size="small"
        :disabled="!isFormValid || testStatus === 'testing'"
        @click="testConnection"
      >
        <ion-spinner v-if="testStatus === 'testing'" name="crescent" style="margin-right: 6px;" />
        {{ t('plugins.addServer.testConnection') }}
      </ion-button>
      <span v-if="testStatus === 'success'" :class="$style.testSuccess">
        <CheckCircle2 :size="14" style="margin-right: 4px;" />
        {{ t('plugins.addServer.toolsDiscovered', { count: discoveredToolCount }) }}
      </span>
      <span v-if="testStatus === 'error'" :class="$style.testError">
        {{ testError }}
      </span>
    </div>

    <!-- Actions -->
    <div :class="$style.actions">
      <ion-button
        fill="clear"
        size="default"
        @click="emit('cancel')"
      >
        {{ t('plugins.addServer.cancel') }}
      </ion-button>
      <ion-button
        fill="solid"
        size="default"
        :disabled="!isFormValid || isSaving"
        @click="handleSave"
      >
        <ion-spinner v-if="isSaving" name="crescent" style="margin-right: 6px;" />
        {{ isEditing ? t('plugins.addServer.save') : t('plugins.addServer.add') }}
      </ion-button>
    </div>
  </div>
</template>

<style lang="scss" module>
.form {
  max-width: 520px;
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--spacing--lg, 20px);
}

.headerIcon {
  color: var(--color--primary, #ff6d5a);
}

.headerTitle {
  font-size: 16px;
  font-weight: 600;
  color: var(--color--text--shade-1);
}

.field {
  margin-bottom: var(--spacing--md, 16px);
}

.fieldLabel {
  display: block;
  font-size: var(--font-size--sm, 13px);
  font-weight: 500;
  color: var(--color--text--tint-1);
  margin-bottom: var(--spacing--xs, 4px);
}

.fieldHint {
  font-size: 12px;
  color: var(--color--text--tint-2);
  margin: 0 0 var(--spacing--xs, 4px);
}

.inputError {
  --border-color: var(--color--danger, #dc2626);
}

.errorText {
  display: block;
  font-size: 12px;
  color: var(--color--danger, #dc2626);
  margin-top: 4px;
}

.headerRow {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: var(--spacing--xs, 4px);
}

.headerInput {
  flex: 1;
  min-width: 0;
}

.removeBtn {
  --padding-start: 6px;
  --padding-end: 6px;
  --padding-top: 4px;
  --padding-bottom: 4px;
  min-height: 28px;
  flex-shrink: 0;
  margin-bottom: 2px;
}

.addHeaderBtn {
  --padding-start: 4px;
  --padding-end: 8px;
  font-size: 13px;
}

.toggleField {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  margin-bottom: var(--spacing--md, 16px);
  border-top: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-bottom: 1px solid var(--n8n-desk--content-bg, var(--color--background));
}

.toggleInfo {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggleLabel {
  font-size: 14px;
  font-weight: 500;
  color: var(--color--text--shade-1);
}

.toggleHint {
  font-size: 12px;
  color: var(--color--text--tint-2);
}

.testSection {
  display: flex;
  align-items: center;
  gap: var(--spacing--sm, 8px);
  margin-bottom: var(--spacing--lg, 20px);
  flex-wrap: wrap;
}

.testSuccess {
  display: inline-flex;
  align-items: center;
  font-size: var(--font-size--sm, 13px);
  color: var(--color--success, #10b981);
}

.testError {
  font-size: var(--font-size--sm, 13px);
  color: var(--color--danger, #dc2626);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing--sm, 8px);
}
</style>
