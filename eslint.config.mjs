import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['out', 'dist', '**/*.d.ts'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 6,
        sourceType: 'module'
      }
    },
    rules: {
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      semi: 'warn'
    }
  }
];
