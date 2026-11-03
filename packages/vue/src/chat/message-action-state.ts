import type { InjectionKey, Ref } from 'vue'

export const touchedMessageActionsKey: InjectionKey<Ref<string | number | undefined>> = Symbol('touchedMessageActions')
