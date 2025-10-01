// .eslintrc.cjs
/* eslint-env node */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import', 'unused-imports'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier', // keep this last to disable conflicting rules
  ],
  settings: {
    'import/resolver': {
      typescript: { project: ['./tsconfig.json'] },
      node: { extensions: ['.js', '.ts'] },
    },
  },
  rules: {
    // General hygiene
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'no-duplicate-imports': 'error',

    // Import sanity
    'import/order': [
      'warn',
      {
        groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],

    // Kill unused imports/vars early (TS-aware)
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],

    // TS specifics
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    '@typescript-eslint/no-unused-vars': 'off', // handled by unused-imports plugin
    '@typescript-eslint/no-explicit-any': 'off', // relax for commands glue
    '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-ignore': 'allow-with-description' }],
  },
  overrides: [
    {
      files: ['**/ui/**', '**/commands/**', '**/services/**'],
      rules: {
        'no-console': 'off', // allow logs in app code
      },
    },
  ],
};
