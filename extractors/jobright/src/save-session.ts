/**
 * Run this once to save your Jobright login session:
 *   node --loader ts-node/esm src/save-session.ts
 *
 * It opens a real browser window. Log in to jobright.ai, then press Enter
 * in the terminal. The session is saved to ~/.job-ops/jobright-session.json
 * and will be used automatically by the extractor.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";
import { chromium } from "playwright";

const DEFAULT_SESSION_PATH = join(homedir(), ".job-ops", "jobright-session.json");
const SESSION_PATH = process.env.JOBRIGHT_SESSION_FILE ?? DEFAULT_SESSION_PATH;

async function waitForEnter(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log("Launching browser — log in to jobright.ai, then come back here and press Enter.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://jobright.ai/sign-in", { waitUntil: "domcontentloaded" });

  await waitForEnter("\nPress Enter once you are logged in to jobright.ai...");

  // Save full browser state (cookies + localStorage)
  const state = await context.storageState();
  await browser.close();

  await mkdir(join(homedir(), ".job-ops"), { recursive: true });
  await writeFile(SESSION_PATH, JSON.stringify(state, null, 2), "utf-8");

  console.log(`\nSession saved to: ${SESSION_PATH}`);
  console.log("The jobright extractor will now use your personalized recommendations.");
}

main().catch((err) => {
  console.error("Failed to save session:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
