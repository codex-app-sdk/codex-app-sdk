import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Codex App SDK',
  titleTemplate: ':title · Codex App SDK',
  description: 'Build complete desktop Codex experiences without rebuilding the app-server runtime, IPC, and conversation UI.',
  lang: 'en-US',
  base: '/codex-app-sdk/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://nbonamy.github.io/codex-app-sdk/',
  },
  head: [
    ['meta', { name: 'theme-color', content: '#0b7a65' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Codex App SDK' }],
    ['meta', {
      property: 'og:description',
      content: 'A modular runtime, Electron and web bridges, and Vue conversation kit for Codex app-server.',
    }],
    ['link', { rel: 'icon', href: '/codex-app-sdk/logo.svg', type: 'image/svg+xml' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Codex App SDK',
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Components', link: '/guide/vue' },
      { text: 'API', link: '/api/' },
      { text: 'Samples', link: '/guide/samples' },
      { text: 'GitHub', link: 'https://github.com/nbonamy/codex-app-sdk' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          collapsed: false,
          items: [
            { text: 'Why Codex App SDK', link: '/guide/' },
            { text: 'Scaffold an application', link: '/guide/scaffolding' },
            { text: 'Tour the generated app', link: '/guide/quick-start' },
            { text: 'Add app-owned panels', link: '/guide/app-ui' },
            { text: 'Add an MCP server', link: '/guide/mcp' },
            { text: 'Add a backend service', link: '/guide/backend' },
            { text: 'Install in an existing app', link: '/guide/installation' },
            { text: 'Architecture', link: '/guide/architecture' },
          ],
        },
        {
          text: 'Conversation experience',
          collapsed: false,
          items: [
            { text: 'The surface runtime', link: '/guide/surface' },
            { text: 'Concurrent conversations', link: '/guide/conversations' },
            { text: 'Authentication', link: '/guide/authentication' },
            { text: 'Electron integration', link: '/guide/electron' },
            { text: 'Web integration', link: '/guide/web' },
            { text: 'Vue conversation kit', link: '/guide/vue' },
            { text: 'Conversation pane integration', link: '/guide/conversation-pane' },
            { text: 'Composer & input', link: '/guide/composer' },
            { text: 'Messages & tool calls', link: '/guide/messages-tools' },
            { text: 'History & performance', link: '/guide/history' },
          ],
        },
        {
          text: 'Customize and extend',
          collapsed: false,
          items: [
            { text: 'Presentation & theming', link: '/guide/presentation' },
            { text: 'Vue providers', link: '/guide/vue-providers' },
            { text: 'Extensions & dynamic tools', link: '/guide/extensions' },
            { text: 'Native capabilities', link: '/guide/native-capabilities' },
            { text: 'Semantic events', link: '/guide/events' },
            { text: 'Remote control', link: '/guide/remote-control' },
          ],
        },
        {
          text: 'Ship with confidence',
          collapsed: false,
          items: [
            { text: 'Security boundary', link: '/guide/security' },
            { text: 'Samples', link: '/guide/samples' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
            { text: 'Development', link: '/guide/development' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API reference',
          collapsed: false,
          items: [
            { text: 'Entry points', link: '/api/' },
            { text: 'Node runtime', link: '/api/node' },
            { text: 'Electron bridge', link: '/api/electron' },
            { text: 'Web transport', link: '/api/web' },
            { text: 'Vue kit', link: '/api/vue' },
            { text: 'Surface contracts', link: '/api/surface' },
            { text: 'Semantic events', link: '/api/events' },
            { text: 'Low-level client', link: '/api/codex' },
            { text: 'JSON-RPC inventory', link: '/api/json-rpc' },
          ],
        },
      ],
    },
    search: {
      provider: 'local',
      options: {
        detailedView: true,
      },
    },
    outline: {
      level: [2, 3],
      label: 'On this page',
    },
    editLink: {
      pattern: 'https://github.com/nbonamy/codex-app-sdk/edit/main/docs/:path',
      text: 'Improve this page',
    },
    docFooter: {
      prev: 'Previous',
      next: 'Next',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/nbonamy/codex-app-sdk' },
    ],
    footer: {
      message: 'Released under the Apache License 2.0.',
      copyright: 'Copyright © 2026-present Nicolas Bonamy',
    },
  },
  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
  },
});
