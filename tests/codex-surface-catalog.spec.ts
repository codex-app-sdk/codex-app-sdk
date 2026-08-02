import { describe, expect, it, vi } from 'vitest';
import type { v2 } from '../src/codex';
import {
  boundedImageDataUrl,
  catalogIconMimeType,
  codexModelToSurfaceModel,
  firstLocalPluginIcon,
  safeRemoteImageUrl,
  surfacePlugin,
  surfaceSkill,
  surfaceSkills,
} from '../src/node/codex-surface-catalog';

describe('Codex surface catalog codecs', () => {
  it('maps every model catalog field', () => {
    const model = {
      id: 'model-id',
      model: 'gpt-model',
      displayName: 'GPT Model',
      description: 'Description',
      hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }],
      defaultReasoningEffort: 'medium',
      isDefault: true,
      inputModalities: ['text', 'image'],
      serviceTiers: [{ id: 'priority', displayName: 'Priority' }],
      supportsPersonality: true,
      upgrade: 'next-model',
      upgradeInfo: { message: 'Upgrade available' },
    } as unknown as v2.Model;

    expect(codexModelToSurfaceModel(model)).toStrictEqual({
      id: 'model-id',
      model: 'gpt-model',
      displayName: 'GPT Model',
      description: 'Description',
      hidden: false,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: 'medium',
      isDefault: true,
      providerMetadata: {
        inputModalities: ['text', 'image'],
        serviceTiers: model.serviceTiers,
        supportsPersonality: true,
        upgrade: 'next-model',
        upgradeInfo: model.upgradeInfo,
      },
    });
  });

  it('filters disabled skills and resolves only declared icons', async () => {
    const loadIcon = vi.fn(async (path: string) => `data:${path}`);
    const enabled = skill({
      interface: {
        displayName: 'Commit and Push',
        shortDescription: 'Interface summary',
        iconSmall: '/icons/small.svg',
        iconLarge: '/icons/large.png',
        brandColor: '#00aaff',
        defaultPrompt: 'Ship it',
      },
    });
    const disabled = skill({ name: 'disabled', enabled: false });

    await expect(surfaceSkills([enabled, disabled], loadIcon)).resolves.toStrictEqual([{
      name: 'cp',
      description: 'Commit and push',
      shortDescription: 'Legacy summary',
      displayName: 'Commit and Push',
      iconSmall: 'data:/icons/small.svg',
      iconLarge: 'data:/icons/large.png',
      brandColor: '#00aaff',
      defaultPrompt: 'Ship it',
      path: '/skills/cp/SKILL.md',
      scope: 'user',
      enabled: true,
    }]);
    expect(loadIcon).toHaveBeenCalledTimes(2);

    await expect(surfaceSkill(skill({ shortDescription: undefined, interface: {
      shortDescription: 'Interface fallback',
    } }), loadIcon)).resolves.toMatchObject({
      shortDescription: 'Interface fallback',
      iconSmall: undefined,
      iconLarge: undefined,
    });
    await expect(surfaceSkill(skill({ shortDescription: undefined, interface: undefined }), loadIcon))
      .resolves.toMatchObject({ shortDescription: undefined, displayName: undefined });
  });

  it('prefers safe remote plugin art and omits blank optional metadata', async () => {
    const loadIcon = vi.fn(async () => 'data:local');
    const plugin = await surfacePlugin(pluginSummary({
      displayName: '  Gmail  ',
      shortDescription: '  Mail tools  ',
      longDescription: '  Long description  ',
      brandColor: '  #ff0000  ',
      composerIconUrl: 'https://cdn.example.com/composer.png',
      logoUrl: 'https://cdn.example.com/logo.png',
      logoUrlDark: 'https://cdn.example.com/dark.png',
    }), loadIcon);

    expect(plugin).toStrictEqual({
      id: 'plugin-1',
      name: 'gmail',
      displayName: 'Gmail',
      shortDescription: 'Mail tools',
      longDescription: 'Long description',
      brandColor: '#ff0000',
      iconUrl: 'https://cdn.example.com/composer.png',
      iconUrlDark: 'https://cdn.example.com/composer.png',
      enabled: true,
    });
    expect(loadIcon).not.toHaveBeenCalled();

    await expect(surfacePlugin(pluginSummary({
      displayName: ' ',
      shortDescription: ' ',
      longDescription: null,
      brandColor: null,
    }), loadIcon)).resolves.toStrictEqual({
      id: 'plugin-1',
      name: 'gmail',
      displayName: 'gmail',
      iconUrl: 'data:local',
      iconUrlDark: 'data:local',
      enabled: true,
    });
  });

  it('falls back across local light and dark plugin icons', async () => {
    const loadIcon = vi.fn(async (path: string) => (
      path.endsWith('logo.svg') ? `data:${path}` : undefined
    ));
    const plugin = await surfacePlugin(pluginSummary({
      composerIcon: '/icons/missing.svg',
      logo: '/icons/logo.svg',
      logoDark: '/icons/dark-missing.svg',
      composerIconUrl: 'http://unsafe.example/icon.png',
      logoUrl: 'not a url',
      logoUrlDark: null,
    }), loadIcon);
    expect(plugin).toMatchObject({
      iconUrl: 'data:/icons/logo.svg',
      iconUrlDark: 'data:/icons/logo.svg',
    });
    expect(loadIcon.mock.calls.map(([path]) => path)).toStrictEqual([
      '/icons/missing.svg',
      '/icons/logo.svg',
      '/icons/missing.svg',
      '/icons/dark-missing.svg',
      '/icons/logo.svg',
    ]);

    await expect(firstLocalPluginIcon([null, undefined, '/missing'], async () => undefined))
      .resolves.toBeUndefined();
  });

  it.each([
    ['https://example.com/icon.png', 'https://example.com/icon.png'],
    ['  https://example.com/icon.png  ', 'https://example.com/icon.png'],
    ['http://example.com/icon.png', undefined],
    ['file:///tmp/icon.png', undefined],
    ['not a url', undefined],
    [' ', undefined],
    [null, undefined],
    [undefined, undefined],
  ])('accepts only remote HTTPS image URLs %#', (value, expected) => {
    expect(safeRemoteImageUrl(value)).toBe(expected);
  });

  it.each([
    ['icon.avif', 'image/avif'],
    ['icon.BMP', 'image/bmp'],
    ['icon.gif', 'image/gif'],
    ['icon.ico', 'image/x-icon'],
    ['icon.jpeg', 'image/jpeg'],
    ['icon.jpg', 'image/jpeg'],
    ['icon.png', 'image/png'],
    ['icon.svg', 'image/svg+xml'],
    ['icon.webp', 'image/webp'],
    ['icon.txt', undefined],
    ['icon', undefined],
  ])('recognizes catalog icon MIME type for %s', (path, expected) => {
    expect(catalogIconMimeType(path)).toBe(expected);
  });

  it('validates, normalizes, and bounds image base64 data', () => {
    expect(boundedImageDataUrl('image/png', ' AQIDBA== ')).toBe('data:image/png;base64,AQIDBA==');
    expect(boundedImageDataUrl('image/png', 'AQI')).toBe('data:image/png;base64,AQI=');
    expect(boundedImageDataUrl('image/png', '')).toBeUndefined();
    expect(boundedImageDataUrl('image/png', '%%%')).toBeUndefined();
    expect(boundedImageDataUrl('image/png', 'A')).toBeUndefined();
    expect(boundedImageDataUrl('image/png', 'AQI==')).toBeUndefined();
    expect(boundedImageDataUrl('image/png', 'A'.repeat(349_528))).toBeUndefined();
  });
});

function skill(overrides: Partial<v2.SkillMetadata> = {}): v2.SkillMetadata {
  return {
    name: 'cp',
    description: 'Commit and push',
    shortDescription: 'Legacy summary',
    path: '/skills/cp/SKILL.md',
    scope: 'user',
    enabled: true,
    ...overrides,
  };
}

function pluginSummary(interfaceOverrides: Partial<v2.PluginInterface>): v2.PluginSummary {
  return {
    id: 'plugin-1',
    name: 'gmail',
    enabled: true,
    interface: {
      displayName: 'Gmail',
      shortDescription: null,
      longDescription: null,
      developerName: null,
      category: null,
      capabilities: [],
      websiteUrl: null,
      privacyPolicyUrl: null,
      termsOfServiceUrl: null,
      defaultPrompt: null,
      brandColor: null,
      composerIcon: '/icons/composer.svg',
      composerIconUrl: null,
      logo: '/icons/logo.svg',
      logoDark: '/icons/logo-dark.svg',
      logoUrl: null,
      logoUrlDark: null,
      screenshots: [],
      screenshotUrls: [],
      ...interfaceOverrides,
    },
  } as unknown as v2.PluginSummary;
}
