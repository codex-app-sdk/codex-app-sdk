// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  computeMessageBlocks,
  groupAssistantWorkBlocks,
  groupToolBlocks,
  stripMessageContext,
} from '../../src/chat/message-blocks';
import type { Message, MessageToolCall } from '../../src/chat/types';

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
  it('renders explicit HTML artifacts without interpreting their contents as chat markup', () => {
    const source = '<button>Try me</button>\n<script>const example = "<follow-up>not a suggestion</follow-up> ![not media](x.png)";</script>\n';
    expect(computeMessageBlocks({ role: 'assistant', content: '', parts: [
      { type: 'text', phase: 'final_answer', content: `Before\n<artifact title="Demo">\n\`\`\`html\n${source}\`\`\`\n</artifact>\nAfter` },
    ] })).toStrictEqual([
      { type: 'text', content: 'Before\n', phase: 'final_answer' },
      { type: 'html', source, title: 'Demo', complete: true, phase: 'final_answer' },
      { type: 'text', content: '\nAfter', phase: 'final_answer' },
    ]);
  });

  it('keeps streamed HTML append-only across split closing fences and finalization', () => {
    const source = '<!doctype html><html><body><p>Hello</p></body></html>\n';
    for (const ending of ['', '`', '``', '```']) {
      const blocks = computeMessageBlocks({ role: 'assistant', streaming: true, content: `\`\`\`html\n${source}${ending}` });
      expect(blocks).toStrictEqual([{ type: 'html', source, complete: ending === '```' }]);
    }
    expect(computeMessageBlocks({ role: 'assistant', content: `\`\`\`html\n${source}` }))
      .toStrictEqual([{ type: 'html', source, complete: true }]);
    for (const ending of ['', '</art', '</artifact>']) {
      expect(computeMessageBlocks({ role: 'assistant', streaming: true, content: `<artifact title='Live'><div>Hi</div>${ending}` }))
        .toStrictEqual([{ type: 'html', source: '<div>Hi</div>', title: 'Live', complete: ending === '</artifact>' }]);
    }
  });

  it('leaves ordinary snippets, quoted artifacts and user HTML as inert text', () => {
    for (const content of ['```html\n<button>Example</button>\n```', '```xml\n<artifact><button>Example</button></artifact>\n```', '<artifact>Just markdown</artifact>']) {
      expect(computeMessageBlocks({ role: 'assistant', content })).toStrictEqual([{ type: 'text', content }]);
    }
    const content = '<artifact><button>Example</button></artifact>';
    expect(computeMessageBlocks({ role: 'user', content })).toStrictEqual([{ type: 'user-text', content }]);
  });

  it('recognizes adjacent previews after a fenced code example', () => {
    const blocks = computeMessageBlocks({ role: 'assistant', content: [
      '```js', 'const example = true', '```',
      '```html', '<html><body>First</body></html>', '```',
      '<artifact><button>Second</button></artifact>',
    ].join('\n') });
    expect(blocks).toStrictEqual([
      { type: 'text', content: '```js\nconst example = true\n```\n' },
      { type: 'html', source: '<html><body>First</body></html>\n', complete: true },
      { type: 'html', source: '<button>Second</button>', complete: true },
    ]);
  });

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

  it('groups only explicitly phased assistant work before the final answer', () => {
    const message: Message = {
      role: 'assistant',
      content: 'Checking.\n\nDone.',
      streaming: true,
      parts: [
        { type: 'reasoning', summary: 'Inspecting the source' },
        { type: 'text', content: 'Checking.', phase: 'commentary' },
        { type: 'tool', toolCall: completedTool },
        { type: 'text', content: 'Done.', phase: 'final_answer' },
      ],
      toolCalls: [completedTool],
    };
    const grouped = groupAssistantWorkBlocks(message, computeMessageBlocks(message));

    expect(grouped).toStrictEqual([
      {
        type: 'work-group',
        active: false,
        finalStarted: true,
        blocks: [
          { type: 'text', content: 'Checking.', phase: 'commentary' },
          { type: 'tool-group', toolCalls: [completedTool] },
        ],
      },
      { type: 'text', content: 'Done.', phase: 'final_answer' },
    ]);

    const unphased: Message = {
      role: 'assistant',
      content: 'Claude text',
      parts: [
        { type: 'text', content: 'Claude text' },
        { type: 'tool', toolCall: completedTool },
      ],
      toolCalls: [completedTool],
    };
    const unphasedBlocks = computeMessageBlocks(unphased);
    expect(groupAssistantWorkBlocks(unphased, unphasedBlocks)).toStrictEqual(unphasedBlocks);
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

  it('projects Codex visualization annotations without leaking their delimiters or JSON', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        '\uE200visualize\uE202{"path":"/tmp/backlog.html","title":"Backlog candidates"}\uE201',
        '',
        'Choose one.',
      ].join('\n'),
    })).toStrictEqual([
      { type: 'visualization', path: '/tmp/backlog.html', title: 'Backlog candidates' },
      { type: 'text', content: '\n\nChoose one.' },
    ]);

    expect(computeMessageBlocks({
      role: 'assistant',
      content: '\uE200visualize\uE202not-json\uE201',
    })).toStrictEqual([{ type: 'visualization', title: 'Visualization' }]);
  });

  it('normalizes visualization payloads and ignores annotations inside code fences', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'Before \uE200visualize\uE202{"path":" /tmp/map.html ","title":" Map "}\uE201 after',
    })).toStrictEqual([
      { type: 'text', content: 'Before ' },
      { type: 'visualization', path: '/tmp/map.html', title: 'Map' },
      { type: 'text', content: ' after' },
    ]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '\uE200visualize\uE202{"path":42,"title":"   "}\uE201',
    })).toStrictEqual([{ type: 'visualization', title: 'Visualization' }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '\uE200visualize\uE202{"path":42,"title":"Kept title"}\uE201',
    })).toStrictEqual([{ type: 'visualization', title: 'Kept title' }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '\uE200visualize\uE202{"path":"/tmp/kept.html","title":42}\uE201',
    })).toStrictEqual([{
      type: 'visualization',
      path: '/tmp/kept.html',
      title: 'Visualization',
    }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        '```text',
        '\uE200visualize\uE202{"path":"/tmp/hidden.html","title":"Hidden"}\uE201',
        '```',
      ].join('\n'),
    })).toStrictEqual([{
      type: 'text',
      content: [
        '```text',
        '\uE200visualize\uE202{"path":"/tmp/hidden.html","title":"Hidden"}\uE201',
        '```',
      ].join('\n'),
    }]);
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

  it('keeps user media parts and drops context-only text parts', () => {
    const media = {
      url: 'file:///tmp/user-image.png',
      mimeType: 'image/png',
      title: 'User image',
    };

    expect(computeMessageBlocks({
      role: 'user',
      content: 'ignored fallback',
      parts: [
        { type: 'text', content: '<context>hidden</context>' },
        { type: 'tool', toolCall: completedTool },
        { type: 'media', media },
      ],
    })).toStrictEqual([{ type: 'media', media }]);
  });

  it('projects assistant messages driven only by tools or ordered attachment parts', () => {
    const attachment = {
      kind: 'file' as const,
      name: 'notes.md',
      path: '/tmp/notes.md',
    };

    expect(computeMessageBlocks({
      role: 'assistant',
      content: '',
      toolCalls: [completedTool],
    })).toStrictEqual([{ type: 'tool-group', toolCalls: [completedTool] }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '',
      parts: [{ type: 'attachment', attachment }],
    })).toStrictEqual([{ type: 'attachment', attachment }]);
  });

  it('collects follow-ups across text parts and appends only unanchored tools', () => {
    const trailingTool = { ...runningTool, id: 'tool-trailing' };

    expect(computeMessageBlocks({
      role: 'assistant',
      content: '',
      parts: [
        { type: 'text', content: 'Before <follow-up> First choice </follow-up>' },
        { type: 'tool', toolCall: completedTool },
        {
          type: 'text',
          content: 'After <follow-up>Second choice</follow-up><follow-up>   </follow-up>',
        },
      ],
      toolCalls: [completedTool, trailingTool],
    })).toStrictEqual([
      { type: 'text', content: 'Before ' },
      { type: 'tool-group', toolCalls: [completedTool] },
      { type: 'text', content: 'After ' },
      { type: 'tool-group', toolCalls: [trailingTool] },
      { type: 'follow-ups', prompts: ['First choice', 'Second choice'] },
    ]);
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

  it('repairs unfinished streaming tags without swallowing trailing text', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'Lead <follow-up>Continue',
    })).toStrictEqual([
      { type: 'text', content: 'Lead ' },
      { type: 'follow-ups', prompts: ['Continue'] },
    ]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'Before <tool id="tool-1">trailing',
      toolCalls: [completedTool],
    })).toStrictEqual([
      { type: 'text', content: 'Before ' },
      { type: 'tool-group', toolCalls: [completedTool] },
      { type: 'text', content: 'trailing' },
    ]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'Before <tool id="tool-1">trailing</to',
      toolCalls: [completedTool],
    })).toStrictEqual([
      { type: 'text', content: 'Before ' },
      { type: 'tool-group', toolCalls: [completedTool] },
      { type: 'text', content: 'trailing' },
    ]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'Before <tool id=',
      toolCalls: [completedTool],
    })).toStrictEqual([
      { type: 'text', content: 'Before ' },
      { type: 'tool-group', toolCalls: [completedTool] },
    ]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'Before <tool id="tool-1" junk',
      toolCalls: [completedTool],
    })).toStrictEqual([
      { type: 'text', content: 'Before ' },
      { type: 'tool-group', toolCalls: [completedTool] },
    ]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'Lead <follow-up>Keep </other',
    })).toStrictEqual([
      { type: 'text', content: 'Lead ' },
      { type: 'follow-ups', prompts: ['Keep </other'] },
    ]);
  });

  it('resolves exact tool ids and numeric indices without dropping unmatched tools', () => {
    const secondTool = { ...runningTool, id: 'second-tool' };
    const toolCalls = [completedTool, secondTool];

    expect(computeMessageBlocks({
      role: 'assistant',
      content: '<tool index="1"></tool>',
      toolCalls,
    })).toStrictEqual([{ type: 'tool-group', toolCalls: [secondTool, completedTool] }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '<tool id="second-tool"></tool>',
      toolCalls,
    })).toStrictEqual([{ type: 'tool-group', toolCalls: [secondTool, completedTool] }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '<tool   id="second-tool"',
      toolCalls,
    })).toStrictEqual([{ type: 'tool-group', toolCalls: [secondTool, completedTool] }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '<tool id="missing"></tool>',
      toolCalls,
    })).toStrictEqual([{ type: 'tool-group', toolCalls }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '<tool index="bad"></tool>',
      toolCalls,
    })).toStrictEqual([{ type: 'tool-group', toolCalls }]);
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

  it('ungroups only active MCP or home requests with string request ids', () => {
    const statusTool = (id: string, status: unknown, state = 'running'): MessageToolCall => ({
      ...runningTool,
      id,
      state: state as MessageToolCall['state'],
      status: status as MessageToolCall['status'],
    });
    const missingParams = statusTool('missing-params', '{"source":"mcp","action":"confirm"}');
    const numericRequest = statusTool(
      'numeric-request',
      '{"source":"mcp","params":{"requestId":42}}',
    );
    const completedRequest = statusTool(
      'completed-request',
      '{"source":"mcp","params":{"requestId":"r-complete"}}',
      'completed',
    );
    const malformedStatus = statusTool('malformed', '{not-json');
    const paddedStatus = statusTool(
      'padded',
      ' {"source":"home","params":{"requestId":"r-padded"}}',
    );
    const nonStringStatus = statusTool('non-string', { source: 'mcp' });
    const homeRequest = statusTool(
      'home-request',
      '{"source":"home","params":{"requestId":"r-home"}}',
    );

    expect(groupToolBlocks([
      ...[
        missingParams,
        numericRequest,
        completedRequest,
        malformedStatus,
        paddedStatus,
        nonStringStatus,
      ]
        .map((toolCall) => ({ type: 'tool' as const, toolCall })),
      { type: 'tool', toolCall: homeRequest },
    ])).toStrictEqual([
      {
        type: 'tool-group',
        toolCalls: [
          missingParams,
          numericRequest,
          completedRequest,
          malformedStatus,
          paddedStatus,
          nonStringStatus,
        ],
      },
      { type: 'tool', toolCall: homeRequest },
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

  it('does not treat a literal fenced tool tag as the tool call anchor', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        '```xml',
        '<tool id="tool-1"></tool>',
        '```',
      ].join('\n'),
      toolCalls: [completedTool],
    })).toStrictEqual([
      {
        type: 'text',
        content: [
          '```xml',
          '<tool id="tool-1"></tool>',
          '```',
        ].join('\n'),
      },
      { type: 'tool-group', toolCalls: [completedTool] },
    ]);
  });

  it('parses repeated marker whitespace and preserves exact anchored tool identity', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        'Before',
        '<tool   id="tool-1"></tool>',
        '![ chart ](https://example.com/chart.png   " Chart title ")',
      ].join('\n'),
      toolCalls: [completedTool],
    })).toStrictEqual([
      { type: 'text', content: 'Before\n' },
      { type: 'tool-group', toolCalls: [completedTool] },
      {
        type: 'media',
        media: {
          alt: 'chart',
          prompt: undefined,
          title: 'Chart title',
          url: 'https://example.com/chart.png',
        },
        toolCall: undefined,
      },
    ]);
  });

  it('preserves malformed tool anchors and empty image labels as literal boundaries', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: 'Before <tool id=""></tool>',
      toolCalls: [completedTool],
    })).toStrictEqual([
      { type: 'text', content: 'Before <tool id=""></tool>' },
      { type: 'tool-group', toolCalls: [completedTool] },
    ]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: '![](https://example.com/unlabelled.png)',
    })).toStrictEqual([{
      type: 'media',
      media: {
        alt: undefined,
        prompt: undefined,
        title: undefined,
        url: 'https://example.com/unlabelled.png',
      },
      toolCall: undefined,
    }]);
  });

  it('recognizes exact Mermaid fence syntax at the start of a message', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        '~~~MERMAID theme=neutral',
        '  graph TD; A-->B;  ',
        '~~~',
      ].join('\n'),
    })).toStrictEqual([{ type: 'mermaid', code: 'graph TD; A-->B;' }]);
    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        '```notmermaid',
        'graph TD; A-->B;',
        '```',
      ].join('\n'),
    })).toStrictEqual([{
      type: 'text',
      content: [
        '```notmermaid',
        'graph TD; A-->B;',
        '```',
      ].join('\n'),
    }]);
  });

  it('preserves text boundaries around an embedded Mermaid fence', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        'Intro',
        '```mermaid',
        'graph TD; A-->B;',
        '```',
        'Outro',
      ].join('\n'),
    })).toStrictEqual([
      { type: 'text', content: 'Intro\n' },
      { type: 'mermaid', code: 'graph TD; A-->B;' },
      { type: 'text', content: '\nOutro' },
    ]);
  });

  it('finds Mermaid fences after earlier ordinary fenced code', () => {
    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        '```text',
        'ordinary',
        '```',
        '```mermaid',
        'graph TD; A-->B;',
        '```',
      ].join('\n'),
    })).toStrictEqual([
      { type: 'text', content: ['```text', 'ordinary', '```', ''].join('\n') },
      { type: 'mermaid', code: 'graph TD; A-->B;' },
    ]);
  });

  it('keeps empty and unclosed Mermaid fences as ordinary message text', () => {
    for (const content of [
      ['```mermaid', '', '```'].join('\n'),
      ['```mermaid', 'graph TD; A-->B;'].join('\n'),
    ]) {
      expect(computeMessageBlocks({ role: 'assistant', content })).toStrictEqual([
        { type: 'text', content },
      ]);
    }
  });

  it('does not parse protocol markers inside an unclosed code fence', () => {
    const content = [
      '```text',
      '<tool id="tool-1"></tool>',
      '![hidden](https://example.com/hidden.png)',
      '\uE200visualize\uE202{"path":"/tmp/hidden.html","title":"Hidden"}\uE201',
    ].join('\n');

    expect(computeMessageBlocks({
      role: 'assistant',
      content,
      toolCalls: [completedTool],
    })).toStrictEqual([
      { type: 'text', content },
      { type: 'tool-group', toolCalls: [completedTool] },
    ]);
  });

  it('strips ambient context only at exact protocol heading boundaries', () => {
    expect(stripMessageContext('<context>hidden</context>visible')).toBe('visible');
    expect(stripMessageContext([
      'Prefix ## My request for Codex:',
      'Keep this heading.',
      '<in-app-browser-context>hidden</in-app-browser-context>',
    ].join('\n'))).toBe('Prefix ## My request for Codex:\nKeep this heading.');
    expect(stripMessageContext([
      'Prefix## My request for Codex:',
      'Keep this glued heading.',
      '<in-app-browser-context>hidden</in-app-browser-context>',
    ].join('\n'))).toBe('Prefix## My request for Codex:\nKeep this glued heading.');
    expect(stripMessageContext([
      '## My request for Codex:not a protocol heading',
      '<in-app-browser-context>hidden</in-app-browser-context>',
    ].join('\n'))).toBe('## My request for Codex:not a protocol heading');
    expect(stripMessageContext([
      '## My request for Codex:not-a-protocol-heading',
      '<in-app-browser-context>hidden</in-app-browser-context>',
    ].join('\n'))).toBe('## My request for Codex:not-a-protocol-heading');
    expect(stripMessageContext([
      '<in-app-browser-context>hidden</in-app-browser-context>',
      '## My request for Codex:',
    ].join('\n'))).toBe('');
  });

  it('projects hydrated Markdown data URLs as renderer media', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    expect(computeMessageBlocks({
      role: 'assistant',
      content: `![Current Music album play bar](${dataUrl})`,
    })).toStrictEqual([{
      type: 'media',
      media: {
        alt: 'Current Music album play bar',
        prompt: undefined,
        title: 'Current Music album play bar',
        url: dataUrl,
      },
      toolCall: undefined,
    }]);
  });

  it('correlates image tools through every result URL and prompt source', () => {
    const externalTool: MessageToolCall = {
      ...completedTool,
      args: { prompt: 'ignored argument' },
      function: 'image_generation',
      id: 'external-image',
      result: {
        externalUrl: 'https://example.com/external.png',
        prompt: '  result prompt  ',
      },
    };
    const pathTool: MessageToolCall = {
      ...completedTool,
      args: { prompt: '  argument prompt  ' },
      function: 'image_generation',
      id: 'path-image',
      result: { path: 'file:///tmp/path.png', prompt: '   ' },
    };

    expect(computeMessageBlocks({
      role: 'assistant',
      content: [
        '![external](https://example.com/external.png)',
        '![path](file:///tmp/path.png)',
      ].join('\n'),
      toolCalls: [externalTool, pathTool],
    })).toStrictEqual([
      {
        type: 'media',
        media: {
          alt: 'external',
          prompt: 'result prompt',
          title: 'external',
          url: 'https://example.com/external.png',
        },
        toolCall: externalTool,
      },
      {
        type: 'media',
        media: {
          alt: 'path',
          prompt: 'argument prompt',
          title: 'path',
          url: 'file:///tmp/path.png',
        },
        toolCall: pathTool,
      },
    ]);
  });

  it('does not correlate media with non-image or malformed image results', () => {
    const lookalike = { ...completedTool, id: 'lookalike', result: { url: 'asset://image' } };
    const malformedImages: MessageToolCall[] = [null, 'asset://image', ['asset://image']]
      .map((result, index) => ({
        ...completedTool,
        function: 'image_generation',
        id: `malformed-${index}`,
        result: result as MessageToolCall['result'],
      }));

    expect(computeMessageBlocks({
      role: 'assistant',
      content: '![asset](asset://image)',
      toolCalls: [lookalike, ...malformedImages],
    })).toStrictEqual([
      {
        type: 'media',
        media: {
          alt: 'asset',
          prompt: undefined,
          title: 'asset',
          url: 'asset://image',
        },
        toolCall: undefined,
      },
      { type: 'tool-group', toolCalls: [lookalike, ...malformedImages] },
    ]);
  });

  it('keeps matched image media when its prompt arguments are malformed', () => {
    const invalidArgs: unknown[] = [null, 'prompt', ['prompt'], { prompt: 42 }];
    const toolCalls = invalidArgs.map((args, index): MessageToolCall => ({
      ...completedTool,
      args,
      function: 'image_generation',
      id: `invalid-args-${index}`,
      result: { url: `asset://invalid-${index}` },
    }));

    expect(computeMessageBlocks({
      role: 'assistant',
      content: toolCalls
        .map((_, index) => `![asset ${index}](asset://invalid-${index})`)
        .join('\n'),
      toolCalls,
    })).toStrictEqual(toolCalls.map((toolCall, index) => ({
      type: 'media',
      media: {
        alt: `asset ${index}`,
        prompt: undefined,
        title: `asset ${index}`,
        url: `asset://invalid-${index}`,
      },
      toolCall,
    })));
  });
});
