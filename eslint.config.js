import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // injection-sink rules guard the shipped code; dev tools (tools/) test these sinks on purpose
    files: ['src/**/*.ts'],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'write', message: 'Never use document.write.' },
        { object: 'document', property: 'writeln', message: 'Never use document.writeln.' },
        { property: 'insertAdjacentHTML', message: 'Build DOM nodes instead of HTML strings.' },
        { property: 'createContextualFragment', message: 'Build DOM nodes instead of HTML strings.' },
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
        {
          selector: "AssignmentExpression[left.property.name='srcdoc']",
          message: 'No srcdoc: iframes are not used.',
        },
        {
          selector: "AssignmentExpression[left.property.name='cssText']",
          message: 'Use style.setProperty with trusted values instead of cssText.',
        },
        {
          selector: "NewExpression[callee.name='DOMParser']",
          message: 'Do not parse HTML strings.',
        },
        {
          selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(on|style$|href$|src$)/]",
          message: 'Set event handlers / URLs / styles through typed properties, not setAttribute.',
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node scripts that drive a headless browser: both environments' globals apply
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        PointerEvent: 'readonly',
      },
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'shots/**'] },
);
