// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { computeMessageBlocks, groupToolBlocks, stripMessageContext } from '../../../packages/vue/src/chat/message-blocks';
import type { Message, MessageToolCall } from '../../../packages/vue/src/chat/types';

const completedTool: MessageToolCall = {
  args: { command: 'npm test' },
  done: true,
  function: 'shell',
  id: 'tool-1',
  result: { output: 'passed' },
  state: 'completed',
  status: 'completed',
};

const runningTool: MessageToolCall = {
  args: { path: 'src/main.ts' },
  done: false,
  function: 'read_file',
  id: 'tool-2',
  result: undefined,
  state: 'running',
  status: '{"source":"codex","action":"read","phase":"running","params":{"addedLines":2,"removedLines":1}}',
};

describe('message block computation', () => {
  it('strips hidden context from user messages', () => {
    expect(stripMessageContext('<context>secret</context>\nvisible')).toBe('visible');
    expect(computeMessageBlocks({ role: 'user', content: '<context>x</context>\nhello' })).toStrictEqual([
      { type: 'user-text', content: 'hello' },
    ]);
  });

  it('hides complete ambient browser context blocks without swallowing malformed user text', () => {
    const content = [
      '## My request for Codex:',
      'Find me a rental car.',
      '',
      '<in-app-browser-context source="ambient-ui-state">',
      'This block is automatically supplied ambient UI state.',
      'Current URL: https://www.skyscanner.com/car-rental',
      '</in-app-browser-context>',
    ].join('\n');

    expect(stripMessageContext(content)).toBe('Find me a rental car.');
    expect(computeMessageBlocks({ role: 'user', content })).toStrictEqual([
      { type: 'user-text', content: 'Find me a rental car.' },
    ]);
    expect(stripMessageContext([
      '<in-app-browser-context source="ambient-ui-state">first</in-app-browser-context>',
      'Visible',
      '<in-app-browser-context>second</in-app-browser-context>',
    ].join('\n'))).toBe('Visible');

    const malformed = 'Keep this <in-app-browser-context source="ambient-ui-state">unfinished text';
    expect(stripMessageContext(malformed)).toBe(malformed);
    expect(stripMessageContext('<in-app-browser-contextual>literal</in-app-browser-contextual>'))
      .toBe('<in-app-browser-contextual>literal</in-app-browser-contextual>');
    expect(stripMessageContext('## My request for Codex:\nKeep this ordinary heading'))
      .toBe('## My request for Codex:\nKeep this ordinary heading');
    expect(stripMessageContext([
      '# Files mentioned by the user:',
      '## My request for Codex:',
      'Visible request.',
      '<in-app-browser-context source="ambient-ui-state">hidden</in-app-browser-context>',
      '## My request for Codex:',
      'This later heading belongs to the user.',
    ].join('\n'))).toBe([
      '# Files mentioned by the user:',
      'Visible request.',
      '## My request for Codex:',
      'This later heading belongs to the user.',
    ].join('\n'));
  });

  it('returns no blocks for empty assistant messages without tools', () => {
    expect(computeMessageBlocks({ role: 'user', content: '' })).toStrictEqual([]);
    expect(computeMessageBlocks({ role: 'assistant', content: '' })).toStrictEqual([]);
  });

  it('extracts text, follow-ups, mermaid, images, anchored tools, and grouped trailing tools', () => {
    const blocks = computeMessageBlocks({
      role: 'assistant',
      content: [
        'Here is the result.',
        '<tool id="tool-1"></tool>',
        '```mermaid',
        'graph TD; A-->B;',
        '```',
        '![chart](file:///tmp/chart.png "Chart")',
        '<follow-up>Open the diff</follow-up>',
      ].join('\n'),
      toolCalls: [completedTool, runningTool],
    });

    expect(blocks.map((block) => block.type)).toStrictEqual([
      'text',
      'tool-group',
      'mermaid',
      'media',
      'tool-group',
      'follow-ups',
    ]);
    expect(blocks.at(-1)).toStrictEqual({ type: 'follow-ups', prompts: ['Open the diff'] });
  });

  it('uses ordered message parts to place Codex tool calls between text chunks', () => {
    const blocks = computeMessageBlocks({
      role: 'assistant',
      content: 'Before the read.\n\nAfter the read.',
      parts: [
        { type: 'text', content: 'Before the read.' },
        { type: 'tool', toolCall: completedTool },
        { type: 'text', content: 'After the read.' },
      ],
      toolCalls: [completedTool],
    });

    expect(blocks).toStrictEqual([
      { type: 'text', content: 'Before the read.' },
      { type: 'tool-group', toolCalls: [completedTool] },
      { type: 'text', content: 'After the read.' },
    ]);
  });

  it('keeps first-class generated media independent from technical tool blocks', () => {
    const media = {
      url: 'file:///tmp/generated.png',
      mimeType: 'image/png',
      prompt: 'Draw a route map',
      title: 'Generated image',
    };
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '',
      parts: [
        { type: 'tool', toolCall: completedTool },
        { type: 'media', media },
      ],
      toolCalls: [completedTool],
    })).toStrictEqual([
      { type: 'tool-group', toolCalls: [completedTool] },
      { type: 'media', media },
    ]);
  });

  it('keeps user text and attachment previews in their original order', () => {
    const image = {
      kind: 'image' as const,
      name: 'diagram.png',
      url: 'data:image/png;base64,cG5n',
    };
    const file = {
      kind: 'file' as const,
      name: 'notes.md',
      path: '/tmp/notes.md',
    };

    expect(computeMessageBlocks({
      role: 'user',
      content: 'Visible text only',
      parts: [
        { type: 'text', content: '<context>hidden</context>\nFirst' },
        { type: 'attachment', attachment: image },
        { type: 'text', content: 'Second' },
        { type: 'attachment', attachment: file },
      ],
    })).toStrictEqual([
      { type: 'user-text', content: 'First' },
      { type: 'attachment', attachment: image },
      { type: 'user-text', content: 'Second' },
      { type: 'attachment', attachment: file },
    ]);

    expect(computeMessageBlocks({
      role: 'user',
      content: '',
      parts: [{ type: 'attachment', attachment: file }],
    })).toStrictEqual([{ type: 'attachment', attachment: file }]);
  });

  it('completes partial streaming follow-up and tool tags', () => {
    const blocks = computeMessageBlocks({
      role: 'assistant',
      content: 'Pick one <follow-up>Continue</',
      streaming: true,
    } as Message);

    expect(blocks).toStrictEqual([
      { type: 'text', content: 'Pick one ' },
      { type: 'follow-ups', prompts: ['Continue'] },
    ]);

    expect(computeMessageBlocks({
      role: 'assistant',
      content: '<tool index="0"',
      toolCalls: [completedTool],
    }).map((block) => block.type)).toStrictEqual(['tool-group']);

    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'broken <tool',
      toolCalls: [completedTool],
    }).map((block) => block.type)).toStrictEqual(['text', 'tool-group']);

    expect(computeMessageBlocks({
      role: 'assistant',
      content: '<tool index="bad"></tool>',
      toolCalls: [completedTool],
    }).map((block) => block.type)).toStrictEqual(['tool-group']);
  });

  it('keeps ask-user and running confirmation-style tools ungrouped', () => {
    const askTool: MessageToolCall = {
      ...runningTool,
      function: 'ask_user_question',
      id: 'ask',
      status: 'running',
    };
    const mcpTool: MessageToolCall = {
      ...runningTool,
      id: 'mcp',
      status: '{"source":"mcp","action":"confirm","phase":"pending","params":{"requestId":"r1"}}',
    };
    const planTool: MessageToolCall = {
      ...runningTool,
      id: 'plan',
      function: 'plan',
      status: '{"source":"codex","action":"plan","phase":"running","params":{"addedLines":2,"operation":"write"}}',
    };

    expect(groupToolBlocks([
      { type: 'tool', toolCall: completedTool },
      { type: 'tool', toolCall: planTool },
      { type: 'tool', toolCall: askTool },
      { type: 'tool', toolCall: mcpTool },
    ])).toStrictEqual([
      { type: 'tool-group', toolCalls: [completedTool] },
      { type: 'tool', toolCall: planTool },
      { type: 'tool', toolCall: askTool },
      { type: 'tool', toolCall: mcpTool },
    ]);
  });

  it('ignores special blocks inside code fences and handles media tool prompts', () => {
    const imageTool: MessageToolCall = {
      args: { prompt: 'draw app' },
      done: true,
      function: 'image_generation',
      id: 'image-tool',
      result: { url: 'https://example.com/image.png' },
      state: 'completed',
      status: 'completed',
    };

    const blocks = computeMessageBlocks({
      role: 'assistant',
      content: [
        '```',
        '<tool id="image-tool"></tool>',
        '![ignored](https://example.com/ignored.png)',
        '```',
        '![actual](https://example.com/image.png)',
      ].join('\n'),
      toolCalls: [imageTool],
    });

    expect(blocks.map((block) => block.type)).toStrictEqual(['text', 'media']);
    expect(blocks[1]).toStrictEqual({
      type: 'media',
      media: {
        alt: 'actual',
        prompt: 'draw app',
        title: 'actual',
        url: 'https://example.com/image.png',
      },
      toolCall: imageTool,
    });
  });
});
