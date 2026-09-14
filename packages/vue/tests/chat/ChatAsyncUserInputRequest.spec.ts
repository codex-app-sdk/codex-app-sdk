// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatAsyncUserInputRequest from '../../src/chat/ChatAsyncUserInputRequest.vue'

describe('ChatAsyncUserInputRequest', () => {
  it('renders a surface request and forwards its answer', async () => {
    const request = {
      id: 'async-question:agent-question',
      kind: 'ask_user' as const,
      conversationId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'agent-question',
      payload: {
        request: {
          itemId: 'agent-question',
          delivery: 'async' as const,
          blocking: false,
          questions: [{
            id: 'question-1',
            header: 'Framework',
            question: 'Which framework?',
            isOther: false,
            isSecret: false,
            options: [{ label: 'Vue', description: '' }],
          }],
        },
      },
    }
    const wrapper = mount(ChatAsyncUserInputRequest, { props: { request } })

    await wrapper.get('[aria-label="Vue"]').trigger('click')
    await wrapper.get('.chat-tool-user-input__button--primary').trigger('click')

    expect(wrapper.emitted('client-response')).toStrictEqual([[
      { id: request.id, payload: { answers: { 'question-1': { answers: ['Vue'] } } } },
    ]])
  })
})
