import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4100';

// macOS 27 TCC-protects the app-data directory that the bundled Firefox
// resolves for its default profile. The wrapper starts Firefox with an
// explicit, renamed app identity; Linux CI uses the browser normally.
const firefoxLaunch = {};
if (process.platform === 'darwin') {
  const wrapper = path.resolve('tools/firefox-macos27-wrapper.sh');
  if (fs.existsSync(wrapper)) {
    firefoxLaunch.launchOptions = {
      executablePath: wrapper,
      firefoxUserPrefs: { 'security.sandbox.content.level': 0 },
      env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' }
    };
  }
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['./tests/e2e/reporter.js'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: {
    command: 'node tools/prepare-test-data.js && npm start',
    url: `${BASE_URL}/api/config`,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ...process.env,
      PORT: '4100',
      SPLITTAG_DATA_DIR: path.resolve('.playwright-data')
    }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], browserName: 'chromium' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], browserName: 'firefox', ...firefoxLaunch } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], browserName: 'webkit' } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'], browserName: 'chromium' } }
  ]
});
