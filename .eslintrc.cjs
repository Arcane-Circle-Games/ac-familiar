/**
 * ESLint config for the Arcane Circle Discord bot.
 *
 * Added 2026-08-02. package.json has advertised `lint` and `lint:fix` scripts
 * with eslint 8 installed for a long time, but no config file existed anywhere
 * up the tree, so both scripts exited 2 ("couldn't find a configuration file")
 * and nothing was ever linted.
 *
 * eslintrc format, not flat config: eslint 8.55 is what's installed, and the
 * scripts pass `--ext .ts`, which flat config rejects.
 *
 * Baseline is green on the tree as of this commit, so CI can enforce it from
 * day one. Rules the existing code deliberately violates are set to 'warn'
 * rather than turned off — they still surface in output, they just don't fail
 * the build on pre-existing code.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  rules: {
    // Type-checking already covers unused values via tsconfig's noUnusedLocals
    // and noUnusedParameters; keep the lint copy as a warning and honour the
    // underscore convention for intentionally-unused args.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // Widespread in the existing Discord/webhook payload types. Worth chipping
    // away at, not worth blocking a PR over.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // The transcription services lazy-require their optional dependencies
    // (@deepgram/sdk, whisper bindings) so the bot still boots when they are
    // not installed. That is the point of optionalDependencies — a static
    // import would break startup.
    '@typescript-eslint/no-var-requires': 'warn',

    // `callback: Function` in the Opus transform stream, and one documented
    // @ts-ignore on @discordjs/opus's types.
    '@typescript-eslint/ban-types': 'warn',
    '@typescript-eslint/ban-ts-comment': 'warn',

    // `try { await fs.unlink(partialDownload) } catch {}` is correct cleanup —
    // there is nothing to do if the partial file is already gone.
    'no-empty': ['error', { allowEmptyCatch: true }],

    // `while (true)` around a stream reader that breaks on done.
    'no-constant-condition': ['error', { checkLoops: false }],

    // It's a bot; logging to stdout is how it talks.
    'no-console': 'off',
  },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/'],
};
