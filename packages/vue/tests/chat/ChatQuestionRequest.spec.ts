// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatQuestionRequest from '../../src/chat/ChatQuestionRequest.vue'
import { questionResponsesKey } from '../../src/chat/message-work-state'

describe('ChatQuestionRequest', () => {
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
    const history = mount(ChatQuestionRequest, { props: { request, historical: true } })
    expect(history.text()).toContain('Which framework?')
    expect(history.text()).not.toContain('Previous user question')
    expect(history.find('.chat-tool-call__title').exists()).toBe(false)
    expect(history.get('.chat-tool-user-input').classes()).toContain('chat-tool-user-input--resolved')
    expect(history.find('textarea, button').exists()).toBe(false)
    history.unmount()

    const answeredHistory = mount(ChatQuestionRequest, {
      props: { request, historical: true },
      global: { provide: { [questionResponsesKey as symbol]: new Map([
        [request.id, { answers: { 'question-1': { answers: ['Vue'] } } }],
      ]) } },
    })
    expect(answeredHistory.text()).toContain('Answered user question')
    expect(answeredHistory.text()).toContain('Vue')
    expect(answeredHistory.find('textarea, button').exists()).toBe(false)
    answeredHistory.unmount()

    const wrapper = mount(ChatQuestionRequest, { props: { request } })

    await wrapper.get('[aria-label="Vue"]').trigger('click')

    expect(wrapper.emitted('client-response')).toStrictEqual([[
      { id: request.id, payload: { answers: { 'question-1': { answers: ['Vue'] } } } },
    ]])
  })
})
