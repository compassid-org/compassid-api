module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  rules: {
    // Error handling
    'no-console': 'off', // We use console for debugging, but prefer Winston
    'no-debugger': 'error',
    'no-alert': 'error',

    // Variables
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'prefer-const': 'error',
    'no-var': 'error',

    // Best practices
    'eqeqeq': ['error', 'always'],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',

    // Stylistic
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'comma-trailing': ['error', 'es5'],
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],

    // Import/Export
    'no-duplicate-imports': 'error',

    // Security
    'no-new-require': 'error',

    // Async/Await
    'require-atomic-updates': 'error',
    'prefer-async-await': 'off', // Allow both promises and async/await
  },
  overrides: [
    {
      files: ['**/*.test.js', '**/__tests__/**/*.js'],
      env: {
        jest: true,
      },
    },
  ],
};