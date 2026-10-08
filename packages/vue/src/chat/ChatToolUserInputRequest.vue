<template>
  <span
    v-if="questions.length === 0"
    class="codex-chat-theme chat-message__thinking codex-text-shimmer"
    data-label="Thinking"
  >
    <SquareDashed :size="15" />
    Preparing question...
  </span>

  <section
    v-else
    ref="root"
    class="codex-chat-theme codex-request-card chat-tool-user-input"
    :class="{ 'chat-tool-user-input--resolved': cancelled || answered || historical }"
    :tabindex="interactive ? -1 : undefined"
    @keydown="onCardKeydown"
  >
    <div v-if="cancelled" class="chat-tool-user-input__summary chat-tool-user-input__summary--muted">
      <ChatToolCallTitle title="Cancelled user question" :icon="SquareX" />
    </div>

    <div v-else-if="answered" class="chat-tool-user-input__summary chat-tool-user-input__summary--answered">
      <ChatToolCallTitle title="Answered user question" :icon="SquareCheck" />
      <div
        v-for="question in questions"
        :key="question.id"
        class="chat-tool-user-input__answer"
      >
        <span class="chat-tool-user-input__answer-label">{{ question.header }}</span>
        <span class="chat-tool-user-input__answer-value">{{ answerSummary[question.id] }}</span>
      </div>
    </div>

    <template v-else-if="historical">
      <p v-for="question in questions" :key="question.id" class="chat-tool-user-input__historical-question">
        {{ question.question }}
      </p>
    </template>

    <template v-else-if="currentQuestion">
      <header class="codex-request-header chat-tool-user-input__header">
        <span class="codex-request-eyebrow chat-tool-user-input__eyebrow">
          <MessageQuestionIcon :size="16" aria-hidden="true" />
          <span class="chat-tool-user-input__eyebrow-text">{{ eyebrow }}</span>
        </span>
        <div class="chat-tool-user-input__header-actions">
          <span
            v-if="questions.length > 1"
            class="chat-tool-user-input__index"
            aria-label="Question progress"
          >
            {{ currentIndex + 1 }} / {{ questions.length }}
          </span>
          <button
            class="chat-tool-user-input__dismiss"
            type="button"
            aria-label="Cancel question"
            title="Cancel question"
            @click="cancel"
          >
            <X :size="17" />
          </button>
        </div>
      </header>

      <p class="codex-request-title chat-tool-user-input__question">{{ currentQuestion.question }}</p>
      <p v-if="currentQuestion.multiSelect && options.length > 0" class="codex-request-description chat-tool-user-input__hint">
        Select all that apply
      </p>

      <div
        v-if="options.length > 0"
        class="chat-tool-user-input__options"
        role="group"
        :aria-label="currentQuestion.question"
      >
        <button
          v-for="(option, index) in options"
          :key="option.label"
          :aria-keyshortcuts="index < 9 ? String(index + 1) : undefined"
          :aria-label="option.label"
          :aria-pressed="isSelected(currentQuestion.id, option.label)"
          class="chat-tool-user-input__option"
          :class="{ 'chat-tool-user-input__option--selected': isSelected(currentQuestion.id, option.label) }"
          type="button"
          @click="toggleOption(currentQuestion, option.label)"
        >
          <span class="chat-tool-user-input__key" aria-hidden="true">
            <Check v-if="isSelected(currentQuestion.id, option.label)" :size="14" stroke-width="3" />
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="chat-tool-user-input__option-copy">
            <span class="chat-tool-user-input__option-heading">
              <span class="chat-tool-user-input__option-label">{{ displayOptionLabel(option.label) }}</span>
              <span v-if="isRecommendedOption(option.label)" class="chat-tool-user-input__recommended">Recommended</span>
            </span>
            <span v-if="option.description" class="chat-tool-user-input__option-description">{{ option.description }}</span>
          </span>
        </button>
      </div>

      <footer
        class="chat-tool-user-input__footer"
        :class="{ 'chat-tool-user-input__footer--divided': options.length > 0 }"
      >
        <div v-if="acceptsText" class="chat-tool-user-input__write">
          <PencilIcon class="chat-tool-user-input__write-icon" :size="16" aria-hidden="true" />
          <component
            :is="currentQuestion.isSecret ? 'input' : 'textarea'"
            ref="answerField"
            class="chat-tool-user-input__other-input"
            :class="{ 'chat-tool-user-input__other-input--direct': isFreeTextOnly(currentQuestion) }"
            :aria-label="isFreeTextOnly(currentQuestion) ? currentQuestion.question : 'Other answer'"
            :autocomplete="currentQuestion.isSecret ? 'off' : undefined"
            :placeholder="answerPlaceholder"
            :rows="currentQuestion.isSecret ? undefined : 1"
            :type="currentQuestion.isSecret ? 'password' : undefined"
            :value="otherTexts[currentQuestion.id] ?? ''"
            @input="onAnswerInput(currentQuestion, $event)"
            @keydown="onAnswerKeydown"
          />
        </div>

        <div class="codex-request-footer chat-tool-user-input__actions">
          <button
            v-if="currentIndex > 0"
            class="codex-request-button chat-tool-user-input__button"
            type="button"
            @click="back"
          >
            Back
          </button>
          <button
            class="codex-request-button codex-request-button--primary chat-tool-user-input__button chat-tool-user-input__button--primary"
            :disabled="!canProceed"
            type="button"
            @click="proceed"
          >
            {{ isLastQuestion ? 'Send' : 'Next' }}
          </button>
        </div>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import type { AskUserAnswers, AskUserQuestion } from './contracts'
import { Check, MessageQuestionIcon, PencilIcon, SquareCheck, SquareDashed, SquareX, X } from '../icons/app-icons'
import ChatToolCallTitle from './ChatToolCallTitle.vue'
import { parseToolStatusDescriptor } from './tool-status'
import type { MessageToolCall } from './types'

// Stryker disable all: Vue compiler macros cannot be wrapped in mutation activation branches.
const props = defineProps<{
  answeredClientRequestIds?: ReadonlySet<string>
  historical?: boolean
  toolCall: MessageToolCall
}>()

const emit = defineEmits<{
  'client-response': [response: { id: string; payload: { answers: AskUserAnswers; cancelled?: boolean } }]
}>()
// Stryker restore all

const currentIndex = ref(0)
const localAnswered = ref(false)
const localCancelled = ref(false)
const selections = reactive<Record<string, string[]>>({})
const root = ref<HTMLElement>()
const answerField = ref<HTMLElement>()
const otherTexts = reactive<Record<string, string>>({})

const descriptor = computed(() => parseToolStatusDescriptor(props.toolCall.status))
const descriptorParams = computed(() => (
  descriptor.value?.params && typeof descriptor.value.params === 'object'
    ? descriptor.value.params
    : {}
))
const requestId = computed(() => {
  const value = descriptorParams.value.requestId
  return typeof value === 'string' ? value : undefined
})
const questions = computed(() => normalizeQuestions(descriptorParams.value.questions))
const currentQuestion = computed(() => questions.value[currentIndex.value])
const isLastQuestion = computed(() => currentIndex.value === questions.value.length - 1)
const resultAnswers = computed<AskUserAnswers>(() => {
  const result = props.toolCall.result as { answers?: AskUserAnswers } | undefined
  return result?.answers && typeof result.answers === 'object' ? result.answers : {}
})
const externallyResolved = computed(() => (
  requestId.value ? props.answeredClientRequestIds?.has(requestId.value) === true : false
))
const answered = computed(() => localAnswered.value || Object.keys(resultAnswers.value).length > 0 || (externallyResolved.value && !localCancelled.value))
const cancelled = computed(() => localCancelled.value || props.toolCall.state === 'canceled')
const answerSummary = computed(() => {
  const summary: Record<string, string> = {}
  for (const question of questions.value) {
    summary[question.id] = formatAnswer(resultAnswers.value[question.id] ?? buildAnswer(question))
  }
  return summary
})
const interactive = computed(() => !cancelled.value && !answered.value && !props.historical && !!currentQuestion.value)
const options = computed(() => currentQuestion.value?.options ?? [])
const acceptsText = computed(() => {
  const question = currentQuestion.value
  return !!question && (isFreeTextOnly(question) || question.isOther === true)
})
const eyebrow = computed(() => {
  const question = currentQuestion.value
  return question && question.header.trim() !== question.question.trim() ? question.header : 'Question'
})
const answerPlaceholder = computed(() => {
  const question = currentQuestion.value
  if (question?.isSecret) {
    return 'Enter private answer'
  }
  return question && isFreeTextOnly(question) ? 'Type your answer...' : 'Or write your own answer...'
})
const canProceed = computed(() => {
  const question = currentQuestion.value
  if (!question || !hasAnswerFor(question)) {
    return false
  }

  return !isLastQuestion.value || questions.value.every((entry) => hasAnswerFor(entry))
})

// A free-text question focuses its field. A choice question focuses the card so number keys and Enter work
// immediately, unless the user already moved focus somewhere deliberate (e.g. a transcript-hosted card).
function focusEntry() {
  void nextTick(() => window.setTimeout(() => {
    const question = currentQuestion.value
    if (!interactive.value || !question) {
      return
    }
    if (isFreeTextOnly(question)) {
      answerField.value?.focus()
    } else if (!document.activeElement || document.activeElement === document.body) {
      root.value?.focus()
    }
  }, 0))
}

onMounted(focusEntry)
watch(currentIndex, focusEntry)

function isFreeTextOnly(question: AskUserQuestion) {
  return question.options === null
}

const recommendedSuffix = /\s*\(recommended\)\s*$/i

function displayOptionLabel(label: string) {
  return label.replace(recommendedSuffix, '').trim() || label
}

function isRecommendedOption(label: string) {
  return recommendedSuffix.test(label)
}

function isSelected(questionId: string, label: string) {
  return selections[questionId]?.includes(label) ?? false
}

function toggleOption(question: AskUserQuestion, label: string) {
  if (answered.value || cancelled.value) {
    return
  }

  const questionId = question.id
  selections[questionId] ??= []
  if (question.multiSelect) {
    const index = selections[questionId].indexOf(label)
    if (index >= 0) {
      selections[questionId].splice(index, 1)
    } else {
      selections[questionId].push(label)
    }
    return
  }

  // A single choice answers the question: move on (or submit) without a second confirmation.
  selections[questionId] = [label]
  otherTexts[questionId] = ''
  proceed()
}

function onAnswerInput(question: AskUserQuestion, event: Event) {
  if (answered.value || cancelled.value) {
    return
  }

  const text = (event.target as HTMLInputElement | HTMLTextAreaElement).value
  otherTexts[question.id] = text
  if (!question.multiSelect && text.trim()) {
    selections[question.id] = []
  }
}

function hasAnswerFor(question: AskUserQuestion) {
  return (selections[question.id]?.length ?? 0) > 0 || !!otherTexts[question.id]?.trim()
}

function onCardKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || !interactive.value) {
    return
  }

  const question = currentQuestion.value
  if (question && /^[1-9]$/.test(event.key)) {
    const option = question.options?.[Number(event.key) - 1]
    if (option) {
      event.preventDefault()
      toggleOption(question, option.label)
    }
    return
  }

  if (event.key === 'Enter' && event.target === root.value && canProceed.value) {
    event.preventDefault()
    proceed()
  }
}

function onAnswerKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key !== 'Enter' || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return
  }

  event.preventDefault()
  if (canProceed.value) {
    proceed()
  }
}

function proceed() {
  if (isLastQuestion.value) {
    submit()
  } else {
    next()
  }
}

function next() {
  if (canProceed.value) {
    currentIndex.value += 1
  }
}

function back() {
  if (currentIndex.value > 0) {
    currentIndex.value -= 1
  }
}

function submit() {
  if (!requestId.value || answered.value || cancelled.value || !canProceed.value) {
    return
  }

  const answers = questions.value.reduce<AskUserAnswers>((acc, question) => {
    acc[question.id] = buildAnswer(question)
    return acc
  }, {})

  localAnswered.value = true
  emit('client-response', {
    id: requestId.value,
    payload: { answers },
  })
}

function cancel() {
  if (!requestId.value || answered.value || cancelled.value) {
    return
  }

  localCancelled.value = true
  emit('client-response', {
    id: requestId.value,
    payload: {
      answers: {},
      cancelled: true,
    },
  })
}

function buildAnswer(question: AskUserQuestion): { answers: string[] } {
  const answers = [...(selections[question.id] ?? [])]
  const otherText = otherTexts[question.id]?.trim()
  if ((isFreeTextOnly(question) || question.isOther) && otherText) {
    answers.push(otherText)
  }
  return { answers }
}

function formatAnswer(answer: { answers: string[] }) {
  return answer.answers.filter(Boolean).join(', ') || '-'
}

function normalizeQuestions(value: unknown): AskUserQuestion[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((question): question is AskUserQuestion => {
    return Boolean(
      question &&
      typeof question === 'object' &&
      'id' in question &&
      typeof question.id === 'string' &&
      'question' in question &&
      typeof question.question === 'string'
    )
  }).map((question) => ({
    ...question,
    header: question.header || question.question,
    isOther: question.isOther ?? false,
    isSecret: question.isSecret ?? false,
    options: Array.isArray(question.options) ? question.options : null,
  }))
}
</script>

<style scoped src="./request-controls.css"></style>
<style scoped>
.chat-message__thinking {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-text-muted);
}

.chat-tool-user-input:focus {
  outline: none;
}

.chat-tool-user-input--resolved {
  container-type: normal;
  width: 100%;
  max-height: none;
  overflow: visible;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.chat-tool-user-input__historical-question {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.chat-tool-user-input__options,
.chat-tool-user-input__summary {
  display: flex;
  flex-direction: column;
}

.chat-tool-user-input__options {
  gap: var(--space-1);
}

.chat-tool-user-input__summary {
  gap: var(--space-2);
  color: var(--color-text-muted);
}

.chat-tool-user-input__summary--muted {
  opacity: 0.72;
}

.chat-tool-user-input__summary--answered {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.chat-tool-user-input__eyebrow-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-tool-user-input__header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-3);
}

.chat-tool-user-input__dismiss {
  display: inline-grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: var(--radius-full);
  padding: 0;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.chat-tool-user-input__dismiss:hover {
  background: var(--color-surface-base);
  color: var(--color-text);
}

.chat-tool-user-input__hint {
  margin-top: calc(var(--space-2) * -1);
}

.chat-tool-user-input__index {
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-variant-numeric: tabular-nums;
  line-height: var(--line-height-16);
}

.chat-tool-user-input__answer,
.chat-tool-user-input__option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  width: 100%;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

.chat-tool-user-input__answer {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
  min-width: 0;
  margin-top: var(--space-2);
  border: 0;
  padding: 0 0 0 var(--space-10);
  box-sizing: border-box;
  background: transparent;
}

.chat-tool-user-input__option {
  cursor: pointer;
  transition: background 0.15s ease;
}

.chat-tool-user-input__option:hover {
  background: var(--color-surface-base);
}

.chat-tool-user-input__option--selected,
.chat-tool-user-input__option--selected:hover {
  background: color-mix(in srgb, var(--color-primary-container) 50%, var(--color-surface-base));
}

.chat-tool-user-input__key {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-md);
  background: var(--color-surface-base);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-variant-numeric: tabular-nums;
  font-weight: var(--font-weight-medium);
  line-height: 1;
  transition: background 0.15s ease, color 0.15s ease;
}

.chat-tool-user-input__option:hover .chat-tool-user-input__key,
.chat-tool-user-input__option:focus-visible .chat-tool-user-input__key {
  background: color-mix(in srgb, var(--color-primary-container) 74%, var(--color-surface-lowest));
  color: var(--color-primary);
}

.chat-tool-user-input__option--selected .chat-tool-user-input__key,
.chat-tool-user-input__option--selected:hover .chat-tool-user-input__key,
.chat-tool-user-input__option--selected:focus-visible .chat-tool-user-input__key {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.chat-tool-user-input__option-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.chat-tool-user-input__option-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.chat-tool-user-input__option-label {
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-22);
}

.chat-tool-user-input__recommended {
  border-radius: var(--radius-full);
  padding: 0 var(--space-3);
  background: var(--color-surface-base);
  color: var(--color-text-muted);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-regular);
  line-height: var(--line-height-20);
}

.chat-tool-user-input__option-description,
.chat-tool-user-input__answer-value {
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
}

.chat-tool-user-input__answer-label {
  color: var(--color-text);
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
}

.chat-tool-user-input__answer-label,
.chat-tool-user-input__answer-value {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.chat-tool-user-input__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4);
}

.chat-tool-user-input__footer--divided {
  border-top: 1px solid var(--color-border);
  /* Match the card's own bottom padding so the field sits centered between the divider and the card edge. */
  padding-top: var(--space-6);
}

.chat-tool-user-input__write {
  display: flex;
  flex: 1 1 14rem;
  min-width: 0;
  align-items: flex-start;
  gap: var(--space-4);
  padding: 0 var(--space-4);
}

.chat-tool-user-input__write-icon {
  flex: 0 0 auto;
  margin-top: 8px;
  color: var(--color-text-muted);
}

.chat-tool-user-input__other-input {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  max-height: 9rem;
  box-sizing: border-box;
  field-sizing: content;
  resize: none;
  overflow-y: auto;
  border: 0;
  padding: 5px 0;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}

.chat-tool-user-input__other-input::placeholder {
  color: var(--color-text-muted);
}

.chat-tool-user-input__other-input:focus {
  outline: none;
}

.chat-tool-user-input__actions {
  flex: 0 0 auto;
  justify-content: flex-end;
  margin-left: auto;
}

.chat-tool-user-input__option:focus-visible,
.chat-tool-user-input__dismiss:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: var(--space-1);
}

@container (max-width: 32rem) {
  .chat-tool-user-input__option {
    padding: var(--space-3);
  }
}
</style>
