import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'write', message: 'Never use document.write.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: 'Use textContent / DOM builders instead of innerHTML.',
        },
        {
          selector: "AssignmentExpression[left.property.name='outerHTML']",
          message: 'Use DOM builders instead of outerHTML.',
        },
      ],
    },
  },
  {
    // Node scripts that drive a headless browser: both environments' globals apply
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        window: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
      },
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'shots/**'] },
);
