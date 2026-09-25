import { computed, ref, watch, type Ref } from 'vue'
import type {
  CodexFileSearchItem,
  CodexCommandSummary,
  CodexSkillSummary,
} from './contracts'
import type { CodexSurfacePlugin } from '@codex-app-sdk/core/surface'
import { findActiveFileMention, findActivePluginMention } from './composer-mentions'
import { filterFileSearchItems } from './file-search'
import { filterComposerCommands, findActiveCommandSlash } from './composer-commands'
import { filterComposerSkills, findActiveSkillTrigger, skillInsertText } from './composer-skills'
import { filterComposerPlugins } from './composer-plugins'
import {
  filterComposerMentionGroups,
  type CodexComposerMentionGroup,
  type CodexComposerMentionItem,
} from './composer-mentions-custom'

type ChatComposerSuggestionOptions<Payload = unknown> = {
  caretPosition: Ref<number>
  commands: () => readonly CodexCommandSummary[]
  disabled: () => boolean
  files: () => readonly CodexFileSearchItem[]
  plugins?: () => readonly CodexSurfacePlugin[]
  mentionGroups?: () => readonly CodexComposerMentionGroup<Payload>[]
  onMentionSelected?: (
    item: CodexComposerMentionItem<Payload>,
    group: CodexComposerMentionGroup<Payload>,
  ) => void
  isSending: () => boolean
  onCommandActivated?: (command: CodexCommandSummary) => void
  onCommandSubmitted: (prompt: string) => void
  onTextInserted: (caretPosition: number) => void
  prompt: Ref<string>
  skills: () => readonly CodexSkillSummary[]
  skillsEnabled: () => boolean
  editor: Ref<{
    getSelectionRange: () => { end: number; start: number; valid: boolean }
  } | null>
}

export function useChatComposerSuggestions<Payload = unknown>(options: ChatComposerSuggestionOptions<Payload>) {
  const openMenu = ref<'at' | 'skill' | 'slash' | null>(null)
  const activeFileIndex = ref(0)
  const activeSkillIndex = ref(0)
  const activePluginIndex = ref(0)
  const activeAtIndex = ref(0)
  const activeSlashIndex = ref(0)
  let dismissedSuggestionContext: string | null = null
  let suggestionsSuspended = false

  const activeFileMention = computed(() => findActiveFileMention(options.prompt.value, options.caretPosition.value))
  const visibleFiles = computed(() => {
    const mention = activeFileMention.value
    if (!mention?.query) {
      return []
    }
    return filterFileSearchItems([...options.files()], mention.query, 5)
  })
  const fileMenuShowsHint = computed(() => (
    activeFileMention.value !== null &&
    !activeFileMention.value.query &&
    options.files().length > 0
  ))
  const fileMenuVisible = computed(() => (
    openMenu.value === 'at' &&
    activeFileMention.value !== null &&
    options.files().length > 0 &&
    !inputDisabled()
  ))
  const activeSkillSlash = computed(() => findActiveSkillTrigger(options.prompt.value, options.caretPosition.value, '$'))
  const activePluginMention = computed(() => findActivePluginMention(options.prompt.value, options.caretPosition.value))
  const visibleSkills = computed(() => filterComposerSkills(
    [...options.skills()],
    activeSkillSlash.value?.query ?? '',
    -1,
    options.plugins?.() ?? [],
  ))
  const skillMenuVisible = computed(() => (
    openMenu.value === 'skill' &&
    options.skillsEnabled() &&
    activeSkillSlash.value !== null &&
    options.skills().length > 0 &&
    !inputDisabled()
  ))
  const visiblePlugins = computed(() => filterComposerPlugins([...(options.plugins?.() ?? [])], activePluginMention.value?.query ?? ''))
  const visibleMentionGroups = computed(() => filterComposerMentionGroups(
    options.mentionGroups?.() ?? [],
    activeFileMention.value?.query ?? '',
  ))
  const visibleLeadingMentionItems = computed(() => visibleMentionGroups.value
    .filter((group) => group.placement !== 'after')
    .flatMap((group) => group.items.map((item) => ({ group, item }))))
  const visibleTrailingMentionItems = computed(() => visibleMentionGroups.value
    .filter((group) => group.placement === 'after')
    .flatMap((group) => group.items.map((item) => ({ group, item }))))
  const pluginMenuVisible = computed(() => false)
  const atItemCount = computed(() => (
    visibleLeadingMentionItems.value.length
    + visiblePlugins.value.length
    + visibleFiles.value.length
    + visibleTrailingMentionItems.value.length
  ))
  const atMenuVisible = computed(() => (
    openMenu.value === 'at' &&
    activeFileMention.value !== null &&
    (atItemCount.value > 0 || fileMenuShowsHint.value) &&
    !inputDisabled()
  ))
  const activeCommandSlash = computed(() => findActiveCommandSlash(options.prompt.value, options.caretPosition.value))
  const visibleSlashCommands = computed(() => filterComposerCommands([...options.commands()], activeCommandSlash.value?.query ?? ''))
  const visibleSlashSkills = computed(() => options.skillsEnabled()
    ? []
    : [])
  const slashItemCount = computed(() => visibleSlashCommands.value.length + visibleSlashSkills.value.length)
  const slashMenuVisible = computed(() => (
    openMenu.value === 'slash' &&
    activeCommandSlash.value !== null &&
    slashItemCount.value > 0 &&
    !inputDisabled()
  ))

  watch([visibleSkills, activeSkillSlash], () => {
    activeSkillIndex.value = 0
  })
  watch([visiblePlugins, activePluginMention], () => {
    activePluginIndex.value = 0
    activeAtIndex.value = 0
  })
  watch(visibleMentionGroups, () => {
    activeAtIndex.value = 0
  })
  watch([visibleSlashCommands, visibleSlashSkills, activeCommandSlash], () => {
    activeSlashIndex.value = 0
  })
  watch([visibleFiles, activeFileMention], () => {
    activeFileIndex.value = 0
  })

  function handleKeydown(event: KeyboardEvent): boolean {
    if (handleMenuKeydown(event, atMenuVisible.value, atItemCount.value, activeAtIndex, () => {
      const leading = visibleLeadingMentionItems.value[activeAtIndex.value]
      if (leading) {
        selectMention(leading.item, leading.group)
        return
      }
      const builtInIndex = activeAtIndex.value - visibleLeadingMentionItems.value.length
      const plugin = visiblePlugins.value[builtInIndex]
      if (plugin) selectPlugin(plugin)
      else {
        const file = visibleFiles.value[builtInIndex - visiblePlugins.value.length]
        if (file) {
          selectFile(file)
          return
        }
        const trailing = visibleTrailingMentionItems.value[
          builtInIndex - visiblePlugins.value.length - visibleFiles.value.length
        ]
        if (trailing) selectMention(trailing.item, trailing.group)
      }
    })) {
      return true
    }

    if (handleMenuKeydown(event, skillMenuVisible.value, visibleSkills.value.length, activeSkillIndex, () => {
      const skill = visibleSkills.value[activeSkillIndex.value]
      if (skill) selectSkill(skill)
    })) {
      return true
    }

    if (slashMenuVisible.value && slashItemCount.value > 0 && event.key === 'Tab'
      && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      selectActiveSlashItem('complete')
      return true
    }

    if (handleMenuKeydown(event, slashMenuVisible.value, slashItemCount.value, activeSlashIndex,
      () => selectActiveSlashItem('execute'))) {
      return true
    }

    return false
  }

  function handleMenuKeydown(
    event: KeyboardEvent,
    visible: boolean,
    itemCount: number,
    activeIndex: Ref<number>,
    selectActive: () => void,
  ): boolean {
    if (!visible) {
      return false
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (itemCount > 0) {
        activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + itemCount) % itemCount
      }
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      dismissedSuggestionContext = suggestionContext()
      close()
      return true
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && itemCount > 0) {
      event.preventDefault()
      selectActive()
      return true
    }
    return false
  }

  function selectFile(file: CodexFileSearchItem): void {
    const mention = activeFileMention.value
    if (!mention || !options.editor.value) {
      return
    }
    insert(`@${file.path} `, mention.start, mention.end)
  }

  function selectSkill(skill: CodexSkillSummary): void {
    const mention = activeSkillSlash.value
    if (mention) {
      insert(`$${skillInsertText(skill)} `, mention.start, mention.end)
    }
  }

  function selectPlugin(plugin: CodexSurfacePlugin): void {
    const mention = activePluginMention.value
    if (mention) {
      insert(`@${plugin.name || plugin.id} `, mention.start, mention.end)
    }
  }

  function selectMention(
    item: CodexComposerMentionItem<Payload>,
    group: CodexComposerMentionGroup<Payload>,
  ): void {
    const mention = activeFileMention.value
    if (!mention) return
    insert(`@${item.value} `, mention.start, mention.end)
    const catalogGroup = options.mentionGroups?.().find((candidate) => candidate.id === group.id) ?? group
    options.onMentionSelected?.(item, catalogGroup)
  }

  function selectSlashSkill(skill: CodexSkillSummary): void {
    const mention = activeCommandSlash.value
    if (mention) {
      insert(`/${skillInsertText(skill)} `, mention.start, mention.end)
    }
  }

  function selectCommand(command: CodexCommandSummary): void {
    handleCommand(command, 'default')
  }

  function handleCommand(command: CodexCommandSummary, action: 'default' | 'execute' | 'complete'): void {
    const mention = activeCommandSlash.value
    if (!mention || !options.editor.value) {
      return
    }

    const slashCommand = `/${command.slashName ?? command.name}`
    if (command.composerMode) {
      options.prompt.value = `${options.prompt.value.slice(0, mention.start)}${options.prompt.value.slice(mention.end)}`
      options.caretPosition.value = mention.start
      close()
      options.onCommandActivated?.(command)
      options.onTextInserted(mention.start)
      return
    }
    if (action === 'execute' || (action === 'default' && command.submitOnSelect)) {
      options.prompt.value = ''
      options.caretPosition.value = 0
      close()
      options.onCommandSubmitted(slashCommand)
      return
    }
    insert(`${slashCommand} `, mention.start, mention.end)
  }

  function selectActiveSlashItem(action: 'execute' | 'complete'): void {
    const command = visibleSlashCommands.value[activeSlashIndex.value]
    if (command) {
      handleCommand(command, action)
      return
    }
    const skill = visibleSlashSkills.value[activeSlashIndex.value - visibleSlashCommands.value.length]
    if (skill) {
      selectSlashSkill(skill)
    }
  }

  function insert(value: string, start: number, end: number): void {
    options.prompt.value = `${options.prompt.value.slice(0, start)}${value}${options.prompt.value.slice(end)}`
    const nextCaret = start + value.length
    options.caretPosition.value = nextCaret
    close()
    options.onTextInserted(nextCaret)
  }

  function updateCaretPosition(range?: { end: number }): void {
    options.caretPosition.value = range?.end
      ?? options.editor.value?.getSelectionRange().end
      ?? options.prompt.value.length
    sync()
  }

  function closeSoon(): void {
    window.setTimeout(close, 120)
  }

  function close(): void {
    openMenu.value = null
  }

  function suspend(): void {
    suggestionsSuspended = true
    close()
  }

  function resume(): void {
    suggestionsSuspended = false
  }

  function sync(): void {
    if (suggestionsSuspended) {
      close()
      return
    }
    const context = suggestionContext()
    if (dismissedSuggestionContext !== null) {
      if (context === dismissedSuggestionContext) {
        close()
        return
      }
      dismissedSuggestionContext = null
    }
    if (activeFileMention.value !== null) {
      openMenu.value = 'at'
      return
    }
    if (activeSkillSlash.value !== null) {
      openMenu.value = 'skill'
      return
    }
    if (activeCommandSlash.value !== null) {
      openMenu.value = 'slash'
      return
    }
    close()
  }

  function suggestionContext(): string {
    return `${options.prompt.value}\u0000${options.caretPosition.value}`
  }

  function inputDisabled(): boolean {
    return options.disabled() && !options.isSending()
  }

  return {
    activeAtIndex,
    activeFileIndex,
    activeSkillIndex,
    activePluginIndex,
    activeSlashIndex,
    atMenuVisible,
    close,
    closeSoon,
    resume,
    fileMenuShowsHint,
    fileMenuVisible,
    handleKeydown,
    selectCommand,
    selectFile,
    selectSkill,
    selectPlugin,
    selectMention,
    selectSlashSkill,
    skillMenuVisible,
    pluginMenuVisible,
    slashMenuVisible,
    suspend,
    sync,
    updateCaretPosition,
    visibleFiles,
    visibleSkills,
    visiblePlugins,
    visibleMentionGroups,
    visibleSlashCommands,
    visibleSlashSkills,
  }
}
