import { describe, expect, it } from 'vitest';
import type { CodexSurfaceSkill, SurfaceMessage, SurfaceMessageToolPart } from '../src/surface';
import {
  argumentsPreview,
  errorMessage,
  findPendingMcpToolPart,
  isRecord,
  mcpElicitationResponse,
  mergeSkillInputs,
  normalizedConversationId,
  normalizeReviewTarget,
  parseGoalSlashCommand,
  parsePlanSlashCommand,
  parseReviewSlashCommand,
  persistSupports,
  promptSkillInputsFromText,
  stringValue,
  validateSkillInputs,
} from '../src/node/codex-surface-prompts';

describe('Codex surface prompt policy', () => {
  it('parses built-in plan, goal, and review commands precisely', () => {
    expect(parsePlanSlashCommand('hello')).toBeNull();
    expect(parsePlanSlashCommand(' /plan ')).toStrictEqual({ prompt: null });
    expect(parsePlanSlashCommand('/plan  investigate this\ncarefully ')).toStrictEqual({
      prompt: 'investigate this\ncarefully',
    });

    expect(parseGoalSlashCommand('/goals')).toBeNull();
    expect(parseGoalSlashCommand('/goal')).toStrictEqual({ action: 'show' });
    expect(parseGoalSlashCommand('/goal CLEAR')).toStrictEqual({ action: 'clear' });
    expect(parseGoalSlashCommand('/goal Edit')).toStrictEqual({ action: 'edit' });
    expect(parseGoalSlashCommand('/goal pause')).toStrictEqual({ action: 'unsupported' });
    expect(parseGoalSlashCommand('/goal RESUME')).toStrictEqual({ action: 'unsupported' });
    expect(parseGoalSlashCommand('/goal ship the SDK')).toStrictEqual({ action: 'set', objective: 'ship the SDK' });

    expect(parseReviewSlashCommand('/reviews')).toBeNull();
    expect(parseReviewSlashCommand('/review')).toStrictEqual({ type: 'uncommittedChanges' });
    expect(parseReviewSlashCommand('/review focus on auth')).toStrictEqual({
      type: 'custom',
      instructions: 'focus on auth',
    });
    expect(normalizeReviewTarget({ type: 'commit', sha: 'abc' })).toStrictEqual({
      type: 'commit',
      sha: 'abc',
      title: null,
    });
    expect(normalizeReviewTarget({ type: 'baseBranch', branch: 'main' })).toStrictEqual({
      type: 'baseBranch',
      branch: 'main',
    });
  });

  it('derives, validates, and deduplicates catalog-backed skill inputs', () => {
    const catalog: CodexSurfaceSkill[] = [
      { name: 'cp', path: '/skills/cp/SKILL.md', enabled: true },
      { name: 'review', path: '/skills/review/SKILL.md', enabled: true },
      { name: 'disabled', path: '/skills/disabled/SKILL.md', enabled: false },
      { name: 'pathless', path: '', enabled: true },
    ];

    expect(promptSkillInputsFromText('$cp /review $cp email+review@example.com /disabled $pathless', catalog))
      .toStrictEqual([
        { name: 'cp', path: '/skills/cp/SKILL.md' },
        { name: 'review', path: '/skills/review/SKILL.md' },
      ]);
    expect(validateSkillInputs([{ name: 'cp', path: '/skills/cp/SKILL.md' }], catalog))
      .toStrictEqual([{ name: 'cp', path: '/skills/cp/SKILL.md' }]);
    expect(() => validateSkillInputs([{ name: 'cp', path: '/wrong' }], catalog))
      .toThrow("Skill 'cp' is not an enabled skill in the Codex catalog");
    expect(() => validateSkillInputs([{ name: 'disabled', path: '/skills/disabled/SKILL.md' }], catalog))
      .toThrow("Skill 'disabled' is not an enabled skill in the Codex catalog");
    expect(mergeSkillInputs(
      [{ name: 'cp', path: '/skills/cp/SKILL.md' }],
      [{ name: 'cp', path: '/skills/cp/SKILL.md' }, { name: 'cp', path: '/other/SKILL.md' }],
    )).toStrictEqual([
      { name: 'cp', path: '/skills/cp/SKILL.md' },
      { name: 'cp', path: '/other/SKILL.md' },
    ]);
  });

  it('matches pending MCP tools by metadata, title, suffix, or unambiguous fallback', () => {
    const metadataMatch = runningMcp('metadata', 'Friendly title', { server: 'gmail', tool: 'search' });
    const titleMatch = runningMcp('title', 'drive.read');
    const suffixMatch = runningMcp('suffix', 'mcp.calendar.create');
    const messages: SurfaceMessage[] = [{
      id: 'assistant',
      role: 'assistant',
      status: 'streaming',
      metadata: { turnId: 'turn-1' },
      parts: [metadataMatch, titleMatch, suffixMatch, { type: 'text', text: 'working' }],
    }];

    expect(findPendingMcpToolPart(messages, 'turn-1', 'gmail', 'search')).toBe(metadataMatch);
    expect(findPendingMcpToolPart(messages, 'turn-1', 'drive', 'read')).toBe(titleMatch);
    expect(findPendingMcpToolPart(messages, 'turn-1', 'calendar', 'create')).toBe(suffixMatch);
    expect(findPendingMcpToolPart(messages, 'turn-1', 'none', 'missing')).toBeNull();
    expect(findPendingMcpToolPart([{ ...messages[0]!, parts: [metadataMatch] }], 'turn-1', 'none', 'missing'))
      .toBe(metadataMatch);
    expect(findPendingMcpToolPart(messages, 'another-turn', 'gmail', 'search')).toBeNull();
  });

  it('formats MCP argument metadata and persistence capabilities safely', () => {
    expect(argumentsPreview({
      tool_params_display: [
        { name: 'query', display_name: 'Search', value: 'in:inbox' },
        { name: 'limit', value: 10 },
        null,
        { value: 'ignored' },
      ],
    })).toBe('Search: in:inbox\nlimit: 10');
    expect(argumentsPreview({ tool_params_display: [], tool_params: { query: 'fallback' } }))
      .toBe('{\n  "query": "fallback"\n}');
    expect(argumentsPreview({})).toBe('');
    expect(persistSupports('always', 'always')).toBe(true);
    expect(persistSupports(['session', 'always'], 'session')).toBe(true);
    expect(persistSupports(null, 'session')).toBe(false);
    expect(stringValue('  value  ')).toBe('value');
    expect(stringValue('   ')).toBeNull();
    expect(stringValue(3)).toBeNull();
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('boom')).toBe('boom');
    expect(normalizedConversationId(' thread-1 ')).toBe('thread-1');
    expect(() => normalizedConversationId('  ')).toThrow('Conversation id cannot be empty');
  });

  it('maps every MCP elicitation decision to the wire response', () => {
    expect(mcpElicitationResponse('allow')).toStrictEqual({ action: 'accept', content: null, _meta: null });
    expect(mcpElicitationResponse('allow_conversation')).toStrictEqual({
      action: 'accept', content: null, _meta: { persist: 'session' },
    });
    expect(mcpElicitationResponse('always_allow')).toStrictEqual({
      action: 'accept', content: null, _meta: { persist: 'always' },
    });
    expect(mcpElicitationResponse('deny')).toStrictEqual({ action: 'decline', content: null, _meta: null });
  });
});

function runningMcp(
  id: string,
  title: string,
  metadata?: Record<string, unknown>,
): SurfaceMessageToolPart {
  return { type: 'tool', id, title, kind: 'mcp', status: 'running', metadata };
}
