import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        AbortSignal: 'readonly',
        AbortController: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: [
      'node_modules/**',
      'output/**',
      'free-nextjs-admin-dashboard-main/**',
      'Scrapper_directories/**',
      'Scrapegraph-ai-main/**',
      'Agent-Reach-main/**',
      'storage/**',
      'scrapy-scraper/**',
    ],
  },
];
