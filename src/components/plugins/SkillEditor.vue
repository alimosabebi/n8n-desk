<script setup lang="ts">
import {
  IonInput, IonTextarea, IonToggle, IonButton, IonSpinner,
} from '@ionic/vue'
import { ref, reactive, computed } from 'vue'
import { BookOpen } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { usePluginsStore } from '@/stores/plugins'
import type { LoadedSkill } from '@/types/plugin'

interface Props {
  /** Pre-fill the form for editing an existing skill */
  editSkill?: LoadedSkill
}

const props = defineProps<Props>()

const emit = defineEmits<{
  saved: [name: string]
  cancel: []
}>()

const { t } = useI18n()
const pluginsStore = usePluginsStore()

// --- Form draft ---

const draft = reactive({
  name: props.editSkill?.name ?? '',
  description: props.editSkill?.description ?? '',
  instructions: props.editSkill?.content ?? '',
  disableModelInvocation: props.editSkill?.disableModelInvocation ?? false,
  userInvocable: props.editSkill?.userInvocable ?? true,
  allowedTools: props.editSkill?.allowedTools?.join(', ') ?? '',
})

// --- Validation ---

const nameError = ref<string | null>(null)

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

function isValidKebabCase(name: string): boolean {
  return KEBAB_CASE_REGEX.test(name)
}

function validateName(): void {
  const name = draft.name.trim()
  if (!name) {
    nameError.value = t('plugins.skillEditor.nameRequired')
    return
  }
  if (!isValidKebabCase(name)) {
    nameError.value = t('plugins.skillEditor.nameInvalid')
    return
  }
  nameError.value = null
}

const isFormValid = computed(() => {
  const name = draft.name.trim()
  return name.length > 0 && isValidKebabCase(name)
})

const isEditing = computed(() => !!props.editSkill)

// --- SKILL.md generation ---

function buildSkillMd(): string {
  const lines: string[] = ['---']

  lines.push(`description: ${yamlEscapeString(draft.description.trim())}`)
  lines.push(`disableModelInvocation: ${draft.disableModelInvocation}`)
  lines.push(`userInvocable: ${draft.userInvocable}`)

  const tools = parseAllowedTools()
  if (tools.length > 0) {
    lines.push('allowedTools:')
    for (const tool of tools) {
      lines.push(`  - ${tool}`)
    }
  }

  lines.push('---')
  lines.push('')

  const body = draft.instructions.trim()
  if (body) {
    lines.push(body)
    lines.push('')
  }

  return lines.join('\n')
}

function yamlEscapeString(value: string): string {
  if (!value) return '""'
  // Quote if it contains special YAML characters
  if (/[:#{}[\],&*?|>!%@`'"]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

function parseAllowedTools(): string[] {
  return draft.allowedTools
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

// --- Save ---

const isSaving = ref(false)
const saveError = ref('')

async function handleSave(): Promise<void> {
  validateName()
  if (nameError.value) return

  isSaving.value = true
  saveError.value = ''

  try {
    const content = buildSkillMd()
    await pluginsStore.saveSkill({
      name: draft.name.trim(),
      content,
    })
    emit('saved', draft.name.trim())
  } catch (err: unknown) {
    saveError.value = err instanceof Error
      ? err.message
      : t('plugins.skillEditor.saveFailed')
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div :class="$style.form">
    <div :class="$style.header">
      <BookOpen :size="18" :class="$style.headerIcon" />
      <span :class="$style.headerTitle">
        {{ isEditing ? t('plugins.skillEditor.titleEdit') : t('plugins.skillEditor.title') }}
      </span>
    </div>

    <!-- Name (kebab-case) -->
    <div :class="$style.field">
      <ion-input
        v-model="draft.name"
        :label="t('plugins.skillEditor.name')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.skillEditor.namePlaceholder')"
        :disabled="isEditing"
        :class="{ [$style.inputError]: nameError }"
        @ion-blur="validateName"
      />
      <span v-if="nameError" :class="$style.errorText">{{ nameError }}</span>
      <span v-else :class="$style.fieldHint">{{ t('plugins.skillEditor.nameHint') }}</span>
    </div>

    <!-- Description -->
    <div :class="$style.field">
      <ion-textarea
        v-model="draft.description"
        :label="t('plugins.skillEditor.description')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.skillEditor.descriptionPlaceholder')"
        :rows="2"
        auto-grow
      />
    </div>

    <!-- Instructions (large) -->
    <div :class="$style.field">
      <ion-textarea
        v-model="draft.instructions"
        :label="t('plugins.skillEditor.instructions')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.skillEditor.instructionsPlaceholder')"
        :rows="10"
        auto-grow
      />
      <span :class="$style.fieldHint">{{ t('plugins.skillEditor.instructionsHint') }}</span>
    </div>

    <!-- Toggles -->
    <div :class="$style.toggleField">
      <div :class="$style.toggleInfo">
        <span :class="$style.toggleLabel">{{ t('plugins.skillEditor.userInvocable') }}</span>
        <span :class="$style.toggleHint">{{ t('plugins.skillEditor.userInvocableHint') }}</span>
      </div>
      <ion-toggle
        :checked="draft.userInvocable"
        @ion-change="draft.userInvocable = $event.detail.checked"
      />
    </div>

    <div :class="$style.toggleField">
      <div :class="$style.toggleInfo">
        <span :class="$style.toggleLabel">{{ t('plugins.skillEditor.disableModelInvocation') }}</span>
        <span :class="$style.toggleHint">{{ t('plugins.skillEditor.disableModelInvocationHint') }}</span>
      </div>
      <ion-toggle
        :checked="draft.disableModelInvocation"
        @ion-change="draft.disableModelInvocation = $event.detail.checked"
      />
    </div>

    <!-- Allowed Tools -->
    <div :class="$style.field">
      <ion-input
        v-model="draft.allowedTools"
        :label="t('plugins.skillEditor.allowedTools')"
        fill="outline"
        label-placement="stacked"
        :placeholder="t('plugins.skillEditor.allowedToolsPlaceholder')"
      />
      <span :class="$style.fieldHint">{{ t('plugins.skillEditor.allowedToolsHint') }}</span>
    </div>

    <!-- Error message -->
    <div v-if="saveError" :class="$style.saveError">
      {{ saveError }}
    </div>

    <!-- Actions -->
    <div :class="$style.actions">
      <ion-button
        fill="clear"
        size="default"
        @click="emit('cancel')"
      >
        {{ t('plugins.skillEditor.cancel') }}
      </ion-button>
      <ion-button
        fill="solid"
        size="default"
        :disabled="!isFormValid || isSaving"
        @click="handleSave"
      >
        <ion-spinner v-if="isSaving" name="crescent" style="margin-right: 6px;" />
        {{ isEditing ? t('plugins.skillEditor.save') : t('plugins.skillEditor.create') }}
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

.fieldHint {
  display: block;
  font-size: 12px;
  color: var(--color--text--tint-2);
  margin-top: 4px;
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

.toggleField {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  margin-bottom: var(--spacing--md, 16px);
  border-top: 1px solid var(--n8n-desk--content-bg, var(--color--background));
  border-bottom: 1px solid var(--n8n-desk--content-bg, var(--color--background));
}

.toggleField + .toggleField {
  border-top: none;
  margin-top: calc(-1 * var(--spacing--md, 16px));
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

.saveError {
  font-size: var(--font-size--sm, 13px);
  color: var(--color--danger, #dc2626);
  margin-bottom: var(--spacing--md, 16px);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing--sm, 8px);
}
</style>
