// @ts-check
import prettier from 'eslint-config-prettier'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    name: 'blinq/ignores',
    ignores: [
      '.claude/**',
      'public/vendor/**',
      'server/database/migrations/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    name: 'blinq/rules',
    rules: {
      // Rendering raw HTML is forbidden (XSS). Render text; see docs/SECURITY.md.
      'vue/no-v-html': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Only declared dependencies may be imported ($HOME on the dev machine has an unrelated node_modules).
      'import/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.test.ts',
            '**/*.spec.ts',
            'tests/**',
            'scripts/**',
            '*.config.{ts,mjs,js}',
            'server/database/migrate*.ts',
          ],
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'lucide-vue-next', message: 'Use @lucide/vue.' },
            { name: 'radix-vue', message: 'Use reka-ui.' },
            { name: 'vaul-vue', message: 'The shadcn Drawer uses reka-ui.' },
            { name: 'vee-validate', message: 'Use @tanstack/vue-form with shadcn Field and shared zod schemas.' },
            { name: '@vee-validate/zod', message: 'Use @tanstack/vue-form with shadcn Field and shared zod schemas.' },
          ],
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    name: 'blinq/shadcn-generated',
    files: ['app/components/ui/**'],
    rules: { 'no-console': 'off', 'vue/require-default-prop': 'off' },
  },
  {
    name: 'blinq/scripts',
    files: ['scripts/**', 'server/cli.ts', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
)
