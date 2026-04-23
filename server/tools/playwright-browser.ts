import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { emit } from "../../app/lib/event-bus.server";
import { createTask } from "../db/queries";
import { kanbanTaskPayload } from "../lib/kanban-task-payload";
import { emitToolLog } from "../lib/tool-log";
import { projectWorkspace } from "../workspace/paths";

import type { Browser, Page } from "playwright";

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

const globalForPW = globalThis as unknown as {
  __olympusBrowser?: Browser;
  __olympusPage?: Page;
  __olympusConsoleErrors?: string[];
};

// collected console errors and uncaught page exceptions since the last goto.
// reset on every goto so each navigation gets a fresh slate.
function getConsoleErrors(): string[] {
  return (globalForPW.__olympusConsoleErrors ??= []);
}
function resetConsoleErrors(): void {
  globalForPW.__olympusConsoleErrors = [];
}
function pushConsoleError(msg: string): void {
  getConsoleErrors().push(msg);
}

async function ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
  if (globalForPW.__olympusBrowser && globalForPW.__olympusPage) {
    return {
      browser: globalForPW.__olympusBrowser,
      page: globalForPW.__olympusPage,
    };
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS === "true",
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // capture JS console errors and uncaught exceptions so goto can surface them
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      pushConsoleError(`[console.error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    pushConsoleError(`[uncaught] ${err.message}`);
  });

  globalForPW.__olympusBrowser = browser;
  globalForPW.__olympusPage = page;
  return { browser, page };
}

const DESCRIPTION = [
  "Drive a Chromium browser for UI QA / manual testing of the generated product.",
  "",
  "Common actions:",
  "- `goto` (url)                     — navigate to a URL. Waits for domcontentloaded, then waits an extra 1 s for JS to execute. ALWAYS check the `consoleErrors` array in the response — any JS crash (e.g. 'React is not defined', 'Cannot read properties of undefined') will appear there. If consoleErrors is non-empty, the page is broken and you MUST file a bug before continuing.",
  "- `click` (selector)               — click an element.",
  "- `fill` (selector, value)         — type into an input / textarea / contenteditable.",
  "- `select` (selector, value)       — select an <option> by value.",
  '- `press` (selector?, value)       — press a keyboard key (e.g. "Enter", "Escape", "Tab"). If `selector` is given, press on that element; otherwise page.keyboard.',
  "- `text` (selector)                — read innerText of the first matching element.",
  "- `get_url`                        — return the current page URL.",
  "- `wait_for_selector` (selector, timeout?) — wait until an element appears (default 5000 ms).",
  "- `wait` (timeout)                 — sleep `timeout` ms (use sparingly; prefer `wait_for_selector`).",
  "- `screenshot`                     — full-page screenshot written to `.software-house/screenshots/<ts>.png` inside the workspace.",
  "- `report_incident` (title, description) — file a new CTO triage ticket with the bug details. The CTO decides how to delegate the fix.",
  '- `evaluate` (value)              — run JavaScript in the page and return the result. `value` is the JS expression (e.g. "document.title" or "localStorage.getItem(\'todos\')").',
  "- `html` (selector?)              — return outerHTML of the matched element, or the full <body> if no selector. Use when a click/fill fails to understand what is actually in the DOM.",
  "- `check` (selector)              — check a checkbox or radio input.",
  "- `uncheck` (selector)            — uncheck a checkbox input.",
  "",
  "The browser instance is persistent across calls within a task — state, cookies, and open pages survive until the task completes.",
].join("\n");

export function buildPlaywrightBrowserTool(ctx: ToolCtx) {
  return createTool({
    id: "playwright_browser",
    description: DESCRIPTION,
    inputSchema: z.object({
      action: z.enum([
        "goto",
        "click",
        "fill",
        "select",
        "press",
        "screenshot",
        "text",
        "get_url",
        "wait_for_selector",
        "wait",
        "report_incident",
        "evaluate",
        "html",
        "check",
        "uncheck",
      ]),
      url: z.string().optional().describe("For `goto`."),
      selector: z
        .string()
        .optional()
        .describe(
          "CSS / text selector. Required for click/fill/select/text/wait_for_selector.",
        ),
      value: z
        .string()
        .optional()
        .describe(
          'Input value for `fill`/`select`, or the key name for `press` (e.g. "Enter").',
        ),
      timeout: z
        .number()
        .optional()
        .describe(
          "Milliseconds. Applies to `wait_for_selector` (default 5000) and `wait`.",
        ),
      title: z
        .string()
        .optional()
        .describe("For `report_incident`: short bug title."),
      description: z
        .string()
        .optional()
        .describe("For `report_incident`: detailed bug description."),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const started = Date.now();
      emitToolLog(ctx, {
        kind: "browser",
        action: input.action,
        url: input.url,
        summary: input.selector ?? input.value ?? input.title,
      });
      try {
        if (input.action === "report_incident") {
          if (!input.title) return { ok: false, error: "title required" };
          const task = await createTask({
            projectId: ctx.projectId,
            role: "cto",
            title: `[QA incident] ${input.title}`,
            description: buildIncidentDescription(
              ctx,
              input.title,
              input.description,
            ),
            status: "todo",
          });
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: "task-update",
            payload: { ...kanbanTaskPayload(task), source: "qa" },
          });
          return { ok: true, data: { incidentId: task.id } };
        }

        if (input.action === "wait") {
          const ms = Math.max(0, Math.min(input.timeout ?? 1000, 30_000));
          await new Promise((done) => setTimeout(done, ms));
          return { ok: true, data: { waited: ms } };
        }

        const { page } = await ensureBrowser();

        if (input.action === "goto") {
          if (!input.url) return { ok: false, error: "url required" };
          // reset error buffer so this navigation gets a fresh slate
          resetConsoleErrors();
          await page.goto(input.url, { waitUntil: "domcontentloaded" });
          // brief wait for JS frameworks to initialise and throw any startup errors
          await page.waitForTimeout(1000);
          const consoleErrors = getConsoleErrors().slice();
          const pageTitle = await page.title();
          emitToolLog(ctx, {
            kind: "browser",
            action: consoleErrors.length > 0 ? "goto.errors" : "goto.ok",
            url: input.url,
            ok: consoleErrors.length === 0,
            summary:
              consoleErrors.length > 0
                ? `${consoleErrors.length} JS error(s): ${consoleErrors[0]}`
                : `title="${pageTitle}"`,
          });
          return {
            ok: true,
            data: {
              title: pageTitle,
              url: page.url(),
              consoleErrors,
              // surface a top-level flag so the model can't miss it
              hasErrors: consoleErrors.length > 0,
            },
          };
        }
        if (input.action === "click") {
          if (!input.selector) return { ok: false, error: "selector required" };
          await page.click(input.selector);
          return { ok: true };
        }
        if (input.action === "fill") {
          if (!input.selector) return { ok: false, error: "selector required" };
          await page.fill(input.selector, input.value ?? "");
          return { ok: true };
        }
        if (input.action === "select") {
          if (!input.selector) return { ok: false, error: "selector required" };
          if (!input.value) return { ok: false, error: "value required" };
          await page.selectOption(input.selector, input.value);
          return { ok: true };
        }
        if (input.action === "press") {
          const key = input.value;
          if (!key)
            return {
              ok: false,
              error: 'value (key name) required, e.g. "Enter"',
            };
          if (input.selector) {
            await page.press(input.selector, key);
          } else {
            await page.keyboard.press(key);
          }
          return { ok: true };
        }
        if (input.action === "text") {
          if (!input.selector) return { ok: false, error: "selector required" };
          const text = await page.locator(input.selector).first().innerText();
          return { ok: true, data: text };
        }
        if (input.action === "get_url") {
          return {
            ok: true,
            data: { url: page.url(), title: await page.title() },
          };
        }
        if (input.action === "wait_for_selector") {
          if (!input.selector) return { ok: false, error: "selector required" };
          await page.waitForSelector(input.selector, {
            timeout: input.timeout ?? 5000,
          });
          return { ok: true };
        }
        if (input.action === "evaluate") {
          if (!input.value)
            return { ok: false, error: "value (JS expression) required" };
          const result = await page.evaluate(input.value);
          return { ok: true, data: result };
        }
        if (input.action === "html") {
          if (input.selector) {
            const el = page.locator(input.selector).first();
            const outerHTML = await el.evaluate(
              (node) => (node as Element).outerHTML,
            );
            return { ok: true, data: outerHTML };
          }
          const body = await page.evaluate(() => document.body.outerHTML);
          return { ok: true, data: body };
        }
        if (input.action === "check") {
          if (!input.selector) return { ok: false, error: "selector required" };
          await page.check(input.selector);
          return { ok: true };
        }
        if (input.action === "uncheck") {
          if (!input.selector) return { ok: false, error: "selector required" };
          await page.uncheck(input.selector);
          return { ok: true };
        }

        const dir = resolve(
          projectWorkspace(ctx.projectSlug),
          ".software-house/screenshots",
        );
        await mkdir(dir, { recursive: true });
        const file = resolve(dir, `${Date.now()}.png`);
        const buffer = await page.screenshot({ fullPage: true });
        await writeFile(file, buffer);
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: "workspace-change",
          payload: { path: file, bytes: buffer.length },
        });
        emitToolLog(ctx, {
          kind: "browser",
          action: "screenshot.done",
          path: file,
          ok: true,
          ms: Date.now() - started,
        });
        return { ok: true, data: { path: file } };
      } catch (err) {
        const base = err instanceof Error ? err.message : String(err);
        const context = input.selector
          ? ` [selector: ${input.selector}]`
          : input.url
            ? ` [url: ${input.url}]`
            : "";
        const error = `${base}${context}`;
        emitToolLog(ctx, {
          kind: "browser",
          action: `${input.action}.error`,
          ok: false,
          ms: Date.now() - started,
          summary: error,
        });
        return { ok: false, error };
      }
    },
  });
}

function buildIncidentDescription(
  ctx: ToolCtx,
  title: string,
  description?: string,
): string {
  const lines = [
    `QA incident reported by ${ctx.role}${ctx.taskId ? ` (task ${ctx.taskId})` : ""}.`,
    "",
    `## Title`,
    title,
    "",
    "## Details",
    description?.trim() || "(no details provided)",
    "",
    "## Expected CTO action",
    "1. Review PLAN.md / ARCHITECTURE.md / REQUIREMENTS.md to understand the intended behaviour.",
    "2. Decide whether this is a bug, missing feature, or spec ambiguity.",
    "3. Delegate the fix via `create_task` to PM (if the spec is wrong) or Architect (if the architecture is wrong). Never write code yourself.",
  ];
  return lines.join("\n");
}
