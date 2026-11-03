import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test as base } from "@playwright/test";

const execute = promisify(execFile);
const backend = fileURLToPath(new URL("../../../backend/", import.meta.url));

export const test = base.extend<{ isolatedState: void }>({
  isolatedState: [
    async ({ baseURL }, use) => {
      if (!baseURL || !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname))
        throw new Error("Browser fixtures require the local test server.");
      const python = process.env.NOTED_BROWSER_TEST_PYTHON;
      if (!python || !process.env.NOTED_BROWSER_TEST_SCHEMA)
        throw new Error("Run browser tests through python scripts/dev.py test-browser.");
      await execute(python, ["-m", "tests.browser_state"], {
        cwd: backend,
        env: process.env,
        timeout: 20000,
      });
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";
