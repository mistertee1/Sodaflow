import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3100', headless: true, locale: 'ar-SD', screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), args: process.env.PLAYWRIGHT_CHROMIUM_ARGS ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS) : [] } },
  webServer: { command: 'npm start', port: 3100, reuseExistingServer: false, env: { PORT: '3100', NODE_ENV: 'production' } },
  reporter: [['list']],
});
