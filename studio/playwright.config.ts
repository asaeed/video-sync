import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4316",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1600, height: 1000 },
    launchOptions: { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
    screenshot: "only-on-failure",
  },
});
