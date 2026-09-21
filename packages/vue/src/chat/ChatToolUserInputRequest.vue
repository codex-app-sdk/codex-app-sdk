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
    class="codex-chat-theme chat-tool-user-input"
    :class="{ 'chat-tool-user-input--resolved': cancelled || answered }"
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

    <div v-else-if="historical" class="chat-tool-user-input__summary">
      <ChatToolCallTitle title="Previous user question" :icon="SquareDashed" />
      <div v-for="question in questions" :key="question.id" class="chat-tool-user-input__answer">
        <span class="chat-tool-user-input__answer-label">{{ question.question }}</span>
      </div>
    </div>

    <template v-else-if="currentQuestion">
      <header class="chat-tool-user-input__header">
        <div class="chat-tool-user-input__heading">
          <span
            v-if="currentQuestion.header.trim() !== currentQuestion.question.trim()"
            class="chat-tool-user-input__tag"
          >{{ currentQuestion.header }}</span>
          <span class="chat-tool-user-input__question">{{ currentQuestion.question }}</span>
        </div>
        <div
          v-if="questions.length > 1"
          class="chat-tool-user-input__progress"
          aria-label="Question progress"
        >
          <span
            v-for="(_, index) in questions"
            :key="index"
            class="chat-tool-user-input__progress-dot"
            :class="{ 'chat-tool-user-input__progress-dot--active': index === currentIndex }"
          />
          <span class="chat-tool-user-input__index">
            {{ currentIndex + 1 }} / {{ questions.length }}
          </span>
        </div>
      </header>

      <div class="chat-tool-user-input__options">
        <textarea
          v-if="isFreeTextOnly(currentQuestion)"
          v-focus
          v-model="otherTexts[currentQuestion.id]"
          autofocus
          class="chat-tool-user-input__other-input chat-tool-user-input__other-input--direct"
          :placeholder="currentQuestion.isSecret ? 'Enter private answer' : 'Type your answer...'"
          rows="2"
          :type="currentQuestion.isSecret ? 'password' : 'text'"
          @keydown.stop
        />

        <template v-else>
          <button
            v-for="option in currentQuestion.options ?? []"
            :key="option.label"
            :aria-label="option.label"
            :aria-pressed="isSelected(currentQuestion.id, option.label)"
            class="chat-tool-user-input__option"
            :class="{ 'chat-tool-user-input__option--selected': isSelected(currentQuestion.id, option.label) }"
            type="button"
            @click="toggleOption(currentQuestion, option.label)"
          >
            <span class="chat-tool-user-input__option-copy">
              <span class="chat-tool-user-input__option-heading">
                <span class="chat-tool-user-input__option-label">{{ displayOptionLabel(option.label) }}</span>
                <span v-if="isRecommendedOption(option.label)" class="chat-tool-user-input__recommended">Recommended</span>
              </span>
              <span v-if="option.description" class="chat-tool-user-input__option-description">{{ option.description }}</span>
            </span>
          </button>

          <div
            v-if="currentQuestion.isOther"
            class="chat-tool-user-input__option chat-tool-user-input__option--other"
            :class="{ 'chat-tool-user-input__option--selected': isOtherSelected(currentQuestion.id) }"
            role="button"
            :aria-pressed="isOtherSelected(currentQuestion.id)"
            tabindex="0"
            @click="toggleOther(currentQuestion)"
            @keydown.enter.prevent="toggleOther(currentQuestion)"
            @keydown.space.prevent="toggleOther(currentQuestion)"
          >
            <span class="chat-tool-user-input__option-copy">
              <span class="chat-tool-user-input__option-label">Other</span>
            </span>
            <textarea
              v-if="isOtherSelected(currentQuestion.id)"
              v-model="otherTexts[currentQuestion.id]"
              class="chat-tool-user-input__other-input"
              :placeholder="currentQuestion.isSecret ? 'Enter private answer' : 'Type your answer...'"
              rows="2"
              :type="currentQuestion.isSecret ? 'password' : 'text'"
              @click.stop
              @focus="selectOther(currentQuestion)"
              @input="selectOther(currentQuestion)"
              @keydown.stop
            />
          </div>
        </template>
      </div>

      <footer class="chat-tool-user-input__actions">
        <button
          class="chat-tool-user-input__button chat-tool-user-input__button--primary"
          :disabled="!canProceed"
          type="button"
          @click="isLastQuestion ? submit() : next()"
        >
          {{ isLastQuestion ? 'Send' : 'Next' }}
        </button>
        <button
          v-if="currentIndex > 0"
          class="chat-tool-user-input__button"
          type="button"
          @click="back"
        >
          Back
        </button>
        <button class="chat-tool-user-input__button" type="button" @click="cancel">
          Cancel
        </button>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { AskUserAnswers, AskUserQuestion } from './contracts'
import { SquareCheck, SquareDashed, SquareX } from '../icons/app-icons'
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
const otherSelected = reactive<Record<string, boolean>>({})
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
const canProceed = computed(() => {
  const question = currentQuestion.value
  if (!question || !hasAnswerFor(question)) {
    return false
  }

  return !isLastQuestion.value || questions.value.every((entry) => hasAnswerFor(entry))
})

const vFocus = {
  mounted(element: HTMLTextAreaElement) {
    window.setTimeout(() => element.focus(), 0)
  },
}

function isFreeTextOnly(question: AskUserQuestion) {
  return question.options === null
}

function isSelected(questionId: string, label: string) {
  return selections[questionId]?.includes(label) ?? false
}

function isOtherSelected(questionId: string) {
  return otherSelected[questionId] ?? false
}

const recommendedSuffix = /\s*\(Recommended\)\s*$/i

function isRecommendedOption(label: string) {
  return recommendedSuffix.test(label)
}

function displayOptionLabel(label: string) {
  return label.replace(recommendedSuffix, '').trim() || label
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

  selections[questionId] = selections[questionId].includes(label) ? [] : [label]
  otherSelected[questionId] = false
  otherTexts[questionId] = ''
}

function toggleOther(question: AskUserQuestion) {
  if (answered.value || cancelled.value) {
    return
  }

  const questionId = question.id
  otherSelected[questionId] = !otherSelected[questionId]
  if (!question.multiSelect) {
    selections[questionId] = []
  }

  if (!otherSelected[questionId]) {
    otherTexts[questionId] = ''
  }
}

function selectOther(question: AskUserQuestion) {
  if (answered.value || cancelled.value) {
    return
  }

  otherSelected[question.id] = true
  if (!question.multiSelect) {
    selections[question.id] = []
  }
}

function hasAnswerFor(question: AskUserQuestion) {
  return (selections[question.id]?.length ?? 0) > 0 || (
    (isFreeTextOnly(question) || otherSelected[question.id]) && !!otherTexts[question.id]?.trim()
  )
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
  if ((isFreeTextOnly(question) || otherSelected[question.id]) && otherText) {
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

<style scoped>
.chat-message__thinking {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  color: var(--color-text-muted);
}

.chat-tool-user-input {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: min(100%, 46rem);
  container-type: inline-size;
  color: var(--color-text);
}

.chat-tool-user-input--resolved {
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.chat-tool-user-input__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-6);
}

.chat-tool-user-input__heading,
.chat-tool-user-input__options,
.chat-tool-user-input__summary {
  display: flex;
  flex-direction: column;
}

.chat-tool-user-input__heading {
  gap: var(--space-3);
  min-width: 0;
}

.chat-tool-user-input__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: var(--space-3);
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

.chat-tool-user-input__tag {
  width: fit-content;
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--color-primary) 24%, transparent);
  border-radius: var(--radius-full);
  padding: var(--space-1) var(--space-3);
  background: color-mix(in srgb, var(--color-primary-container) 74%, var(--color-surface-lowest));
  color: var(--color-primary);
  font-size: var(--font-size-12);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-16);
}

.chat-tool-user-input__question {
  min-width: 0;
  font-size: var(--font-size-15);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-20);
}

.chat-tool-user-input__progress {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
}

.chat-tool-user-input__index {
  flex: 0 0 auto;
  font-size: var(--font-size-12);
  line-height: var(--line-height-16);
}

.chat-tool-user-input__progress-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-full);
  background: var(--color-border-strong);
  opacity: 0.45;
}

.chat-tool-user-input__progress-dot--active {
  width: 12px;
  background: var(--color-primary);
  opacity: 1;
}

.chat-tool-user-input__answer,
.chat-tool-user-input__option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4) var(--space-6);
  background: var(--color-surface-lowest);
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
  box-sizing: border-box;
  min-width: 0;
  min-height: 94px;
  height: 100%;
  padding: var(--space-4);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.chat-tool-user-input__option:hover {
  border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
}

.chat-tool-user-input__option--selected {
  border-color: color-mix(in srgb, var(--color-primary) 58%, var(--color-border));
  background: color-mix(in srgb, var(--color-primary-container) 66%, var(--color-surface-lowest));
}

.chat-tool-user-input__option-copy {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-2);
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
  line-height: var(--line-height-20);
}

.chat-tool-user-input__recommended {
  border-radius: var(--radius-full);
  padding: 1px var(--space-2);
  background: color-mix(in srgb, var(--color-primary-container) 70%, transparent);
  color: var(--color-primary);
  font-size: var(--font-size-11);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-16);
}

.chat-tool-user-input__option-description,
.chat-tool-user-input__answer-value {
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
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

.chat-tool-user-input__option--other {
  flex-direction: column;
}

.chat-tool-user-input__other-input {
  width: 100%;
  min-width: 0;
  margin-top: var(--space-1);
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-14);
  line-height: var(--line-height-20);
}

.chat-tool-user-input__other-input:focus {
  outline: 1px solid color-mix(in srgb, var(--color-primary) 28%, transparent);
}

.chat-tool-user-input__other-input--direct {
  grid-column: auto;
  margin-top: 0;
}

.chat-tool-user-input__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.chat-tool-user-input__button {
  min-height: 28px;
  border: 0;
  border-radius: var(--radius-md);
  padding: 0 var(--space-4);
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-13);
  font-weight: var(--font-weight-medium);
  cursor: pointer;
}

.chat-tool-user-input__button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.chat-tool-user-input__button--primary:not(:disabled) {
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.chat-tool-user-input__other-input:focus-visible,
.chat-tool-user-input__option:focus-visible,
.chat-tool-user-input__button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: var(--space-1);
}

@container (max-width: 34rem) {
  .chat-tool-user-input__header {
    flex-direction: column;
    gap: var(--space-3);
  }

  .chat-tool-user-input__options {
    grid-template-columns: minmax(0, 1fr);
  }

  .chat-tool-user-input__actions {
    align-items: stretch;
  }

  .chat-tool-user-input__button {
    flex: 1 1 auto;
  }
}
</style>
