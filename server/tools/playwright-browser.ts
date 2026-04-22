import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { emit } from '../../app/lib/event-bus.server';
import { createTask } from '../db/queries';
import { kanbanTaskPayload } from '../lib/kanban-task-payload';
import { emitToolLog } from '../lib/tool-log';
import { projectWorkspace } from '../workspace/paths';

import type { Browser, Page } from 'playwright';

interface ToolCtx {
  projectId: string;
  projectSlug: string;
  role: string;
  taskId?: string;
}

const globalForPW = globalThis as unknown as {
  __olympusBrowser?: Browser;
  __olympusPage?: Page;
};

async function ensureBrowser(): Promise<{ browser: Browser; page: Page }> {
  if (globalForPW.__olympusBrowser && globalForPW.__olympusPage) {
    return { browser: globalForPW.__olympusBrowser, page: globalForPW.__olympusPage };
  }
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  globalForPW.__olympusBrowser = browser;
  globalForPW.__olympusPage = page;
  return { browser, page };
}

export function buildPlaywrightBrowserTool(ctx: ToolCtx) {
  return createTool({
    id: 'playwright_browser',
    description:
      'Drive a headful Chromium browser for QA. Supports navigate, click, fill, screenshot, and incident reporting.',
    inputSchema: z.object({
      action: z.enum([
        'goto',
        'click',
        'fill',
        'select',
        'screenshot',
        'text',
        'get_url',
        'wait_for_selector',
        'report_incident',
      ]),
      url: z.string().optional(),
      selector: z.string().optional(),
      value: z.string().optional(),
      /** timeout in ms for wait_for_selector (default 5000) */
      timeout: z.number().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      const started = Date.now();
      emitToolLog(ctx, {
        kind: 'browser',
        action: input.action,
        url: input.url,
        summary: input.selector ?? input.value ?? input.title,
      });
      try {
        if (input.action === 'report_incident') {
          if (!input.title) return { ok: false, error: 'title required' };
          const task = await createTask({
            projectId: ctx.projectId,
            role: 'cto',
            title: input.title,
            description: input.description ?? '',
            status: 'todo',
          });
          emit({
            projectId: ctx.projectId,
            role: ctx.role,
            taskId: ctx.taskId,
            type: 'task-update',
            payload: { ...kanbanTaskPayload(task), source: 'qa' },
          });
          return { ok: true, data: { incidentId: task.id } };
        }

        const { page } = await ensureBrowser();
        if (input.action === 'goto') {
          if (!input.url) return { ok: false, error: 'url required' };
          await page.goto(input.url, { waitUntil: 'domcontentloaded' });
          return { ok: true, data: { title: await page.title() } };
        }
        if (input.action === 'click') {
          if (!input.selector) return { ok: false, error: 'selector required' };
          await page.click(input.selector);
          return { ok: true };
        }
        if (input.action === 'fill') {
          if (!input.selector) return { ok: false, error: 'selector required' };
          await page.fill(input.selector, input.value ?? '');
          return { ok: true };
        }
        if (input.action === 'select') {
          if (!input.selector) return { ok: false, error: 'selector required' };
          if (!input.value) return { ok: false, error: 'value required' };
          await page.selectOption(input.selector, input.value);
          return { ok: true };
        }
        if (input.action === 'text') {
          if (!input.selector) return { ok: false, error: 'selector required' };
          const text = await page.locator(input.selector).first().innerText();
          return { ok: true, data: text };
        }
        if (input.action === 'get_url') {
          return { ok: true, data: { url: page.url() } };
        }
        if (input.action === 'wait_for_selector') {
          if (!input.selector) return { ok: false, error: 'selector required' };
          await page.waitForSelector(input.selector, { timeout: input.timeout ?? 5000 });
          return { ok: true };
        }

        const dir = resolve(projectWorkspace(ctx.projectSlug), '.software-house/screenshots');
        await mkdir(dir, { recursive: true });
        const file = resolve(dir, `${Date.now()}.png`);
        const buffer = await page.screenshot({ fullPage: true });
        await writeFile(file, buffer);
        emit({
          projectId: ctx.projectId,
          role: ctx.role,
          taskId: ctx.taskId,
          type: 'workspace-change',
          payload: { path: file, bytes: buffer.length },
        });
        emitToolLog(ctx, {
          kind: 'browser',
          action: 'screenshot.done',
          path: file,
          ok: true,
          ms: Date.now() - started,
        });
        return { ok: true, data: { path: file } };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        emitToolLog(ctx, {
          kind: 'browser',
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
