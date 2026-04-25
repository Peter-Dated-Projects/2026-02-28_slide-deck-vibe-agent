/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary
 * information of Freedom, LLC ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in accordance
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import * as Y from 'yjs';
import { dbService as db, storageService } from '../core/container';
import { crdtDocManager } from '../core/crdt/docManager';
import {
    getElements,
    readSlideOrder,
    readTheme,
    type ElementShape,
    type ThemeShape,
} from '../core/crdt/schema';
import { getProjectOwner } from './projectDeck';

const CANVAS_W = 1920;
const CANVAS_H = 1080;

const inFlightJobs = new Map<string, Promise<string>>();

const getPreviewKey = (userId: string, projectId: string): string =>
    `users/${userId}/previews/${projectId}.jpg`;

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const escapeAttr = (value: string): string => escapeHtml(value);

const serializeStyle = (overrides?: Record<string, string>): string => {
    if (!overrides) return '';
    return Object.entries(overrides)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
};

interface RenderableElement extends ElementShape {
    id: string;
}

const collectSlideElements = (doc: Y.Doc, slideId: string): RenderableElement[] => {
    const elements = getElements(doc);
    const result: RenderableElement[] = [];
    for (const [id, yEl] of elements) {
        if ((yEl.get('slide_id') as string) !== slideId) continue;
        result.push({
            id,
            type: (yEl.get('type') as ElementShape['type']) ?? 'text',
            slide_id: slideId,
            x: (yEl.get('x') as number) ?? 0,
            y: (yEl.get('y') as number) ?? 0,
            w: (yEl.get('w') as number) ?? 0,
            h: (yEl.get('h') as number) ?? 0,
            content: yEl.get('content'),
            styleOverrides: yEl.get('styleOverrides') as Record<string, string> | undefined,
        });
    }
    return result;
};

const renderElement = (el: RenderableElement): string => {
    const baseStyle =
        `position:absolute;left:${el.x}px;top:${el.y}px;` +
        `width:${el.w}px;height:${el.h}px;`;
    const overrideStyle = serializeStyle(el.styleOverrides);
    const styleAttr = `${baseStyle}${overrideStyle ? overrideStyle + ';' : ''}`;
    const content = (el.content ?? {}) as Record<string, unknown>;

    if (el.type === 'text') {
        const html = typeof content.html === 'string' ? content.html : '';
        return `<div style="${styleAttr}overflow:hidden;display:flex;flex-direction:column;justify-content:center;">${html}</div>`;
    }
    if (el.type === 'image') {
        const url = typeof content.url === 'string' ? content.url : '';
        const alt = typeof content.alt === 'string' ? content.alt : '';
        if (!url) return '';
        return `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" style="${styleAttr}object-fit:cover;" />`;
    }
    if (el.type === 'shape') {
        const fill = typeof content.fill === 'string' ? content.fill : '#cccccc';
        const radius = typeof content.borderRadius === 'string' ? content.borderRadius : '0';
        return `<div style="${styleAttr}background:${escapeAttr(fill)};border-radius:${escapeAttr(radius)};"></div>`;
    }
    return '';
};

const renderSlideHtml = (theme: ThemeShape, elements: RenderableElement[]): string => {
    const themeVars = Object.entries(theme.variables)
        .map(([k, v]) => `${k}:${v}`)
        .join(';');
    const bg = theme.variables['--vibe-bg'] ?? '#ffffff';
    const fg = theme.variables['--vibe-fg'] ?? '#111111';
    const elementsHtml = elements.map(renderElement).join('\n  ');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  :root { ${themeVars} }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${CANVAS_W}px;
    height: ${CANVAS_H}px;
    background: ${bg};
    color: ${fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    position: relative;
    overflow: hidden;
  }
</style>
</head>
<body>
  ${elementsHtml}
</body>
</html>`;
};

const renderJpegViaWorker = async (html: string): Promise<Buffer> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-render-'));
    const htmlPath = path.join(tempDir, 'deck.html');
    const outputPath = path.join(tempDir, 'preview.jpg');
    const workerPath = path.resolve(__dirname, './previewRenderer.worker.cjs');

    await fs.writeFile(htmlPath, html, { encoding: 'utf-8' });

    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(
                process.env.NODE_EXECUTABLE || 'node',
                [workerPath, htmlPath, outputPath],
                { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
            );
            let stderr = '';
            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(`Preview worker failed with code ${code}. ${stderr.trim()}`));
            });
        });
        return await fs.readFile(outputPath);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
};

export const generatePreviewForProject = async (projectId: string): Promise<string> => {
    const existing = inFlightJobs.get(projectId);
    if (existing) return existing;

    const job = (async () => {
        const userId = await getProjectOwner(projectId);
        const doc = await crdtDocManager.readDoc(projectId);
        const theme = readTheme(doc);
        const slideOrder = readSlideOrder(doc);
        const firstSlide = slideOrder[0];
        const elements = firstSlide ? collectSlideElements(doc, firstSlide) : [];

        const html = renderSlideHtml(theme, elements);
        const jpeg = await renderJpegViaWorker(html);

        const previewKey = getPreviewKey(userId, projectId);
        await storageService.uploadFile(previewKey, jpeg, 'image/jpeg');
        await db.query('UPDATE projects SET preview_url = $2 WHERE id = $1', [
            projectId,
            previewKey,
        ]);
        return previewKey;
    })().finally(() => {
        inFlightJobs.delete(projectId);
    });

    inFlightJobs.set(projectId, job);
    return job;
};
