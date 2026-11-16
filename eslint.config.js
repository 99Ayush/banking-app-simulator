module.exports = [
    {
        files: ["src/**/*.js", "tests/**/*.js", "scripts/**/*.js", "server.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                Buffer: "readonly",
                AbortSignal: "readonly",
                URL: "readonly",
                console: "readonly",
                process: "readonly",
                module: "readonly",
                require: "readonly",
                exports: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                describe: "readonly",
                test: "readonly",
                expect: "readonly",
                beforeAll: "readonly",
                afterAll: "readonly",
                beforeEach: "readonly",
                afterEach: "readonly",
                jest: "readonly",
                clearTimeout: "readonly",
                setTimeout: "readonly"
            }
        },
        rules: {
            "no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_"
                }
            ],
            "no-undef": "error"
        }
    }
]
