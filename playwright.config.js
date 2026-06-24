// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    testMatch: /.*\.spec\.js/,
    timeout: 60 * 1000,
    maxFailures: 0,
    expect: { timeout: 5000 },
    outputDir: 'test-results',
    reporter: [
        ['list'],
        ['html', { outputFolder: 'test-report', open: 'never' }]
    ],
    use: {
        headless: true,
        viewport: { width: 1280, height: 720 },
        bypassCSP: true,
        // Set PLAYWRIGHT_PROXY=http://host:port if you need a proxy.
        // Default to local proxy at 127.0.0.1:10808 when not specified.
        proxy: { server: process.env.PLAYWRIGHT_PROXY || 'http://127.0.0.1:10808' },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        launchOptions: {
            args: [
                '--disable-blink-features=AutomationControlled'
            ]
        },
        screenshot: 'off',
        video: 'off',
        actionTimeout: 5000
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' }
        }
    ]
});
