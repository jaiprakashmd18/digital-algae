import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// In some CI/sandbox images a matching Playwright browser is pre-installed
// at a fixed path; otherwise Playwright's own download is used.
const PRESET = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = existsSync(PRESET) ? { executablePath: PRESET } : {};
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    launchOptions,
    trace: 'retain-on-failure',
  },
  // Default: the local demo build (no credentials). Set E2E_BASE_URL to run
  // against a deployed site with a live Supabase backend.
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `npx vite build --mode e2e && npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_DEMO_MODE: 'true', VITE_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions }, testIgnore: /mobile\.spec\.js/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions }, testMatch: /mobile\.spec\.js/ },
  ],
});
