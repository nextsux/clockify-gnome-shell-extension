import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        files: ['*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // GJS / GNOME Shell globals
                global: 'readonly',
                log: 'readonly',
                logError: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                console: 'readonly',
            },
        },
        rules: {
            // Allow unused vars prefixed with _ (common GJS pattern for signal args)
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-undef': 'error',
        },
    },
];
