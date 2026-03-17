import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { chromium, type Page } from 'playwright-core';
import sharp from 'sharp';
import { cacheService, dbService as db, storageService } from '../core/container';
import { config } from '../config';

const DECK_CACHE_PREFIX = 'deck:html:';
const PREVIEW_VIEWPORT = { width: 1920, height: 1080 };
const PREVIEW_OUTPUT = { width: 1280, height: 720 };
const PREVIEW_JPEG_QUALITY = 80;
const PREVIEW_CAPTURE_DELAY_MS = 5000;
const PREVIEW_BROWSER_LAUNCH_TIMEOUT_MS = 45000;
const PREVIEW_CONCURRENCY_LIMIT = 1;
const PREVIEW_DEBUG = process.env.PREVIEW_DEBUG !== 'false' && process.env.PREVIEW_DEBUG !== '0';

const previewJobsByProject = new Map<string, Promise<string>>();
const previewQueue: Array<() => void> = [];
let activePreviewJobs = 0;

const logPreviewDebug = (message: string, details?: Record<string, unknown>) => {
    if (!PREVIEW_DEBUG) return;

    if (details) {
        console.info(`[projectDeck][debug] ${message}`, details);
        return;
    }

    console.info(`[projectDeck][debug] ${message}`);
};

const getCacheKey = (projectId: string) => `${DECK_CACHE_PREFIX}${projectId}`;

const getDefaultHtml = async (): Promise<string> => {
    const defaultHtmlPath = path.resolve(__dirname, '../core/template.html');
    return fs.readFile(defaultHtmlPath, { encoding: 'utf-8' });
};

const getExistingDeckKey = async (projectId: string): Promise<string | null> => {
    const projResult = await db.query(
        'SELECT minio_object_key FROM projects WHERE id = $1 LIMIT 1',
        [projectId]
    );

    const key = projResult.rows[0]?.minio_object_key;
    if (!key || key === 'temp') return null;
    return key;
};

const getProjectOwner = async (projectId: string): Promise<string> => {
    const result = await db.query('SELECT user_id FROM conversations WHERE project_id = $1 LIMIT 1', [projectId]);
    const userId = result.rows[0]?.user_id;
    if (!userId) {
        throw new Error(`Project owner for ${projectId} not found`);
    }
    return userId;
};

const getPreviewKey = (userId: string, projectId: string): string => `users/${userId}/previews/${projectId}.jpg`;

const runWithPreviewSlot = async <T>(task: () => Promise<T>): Promise<T> => {
    if (activePreviewJobs >= PREVIEW_CONCURRENCY_LIMIT) {
        logPreviewDebug('Preview job waiting for queue slot', {
            activePreviewJobs,
            queuedJobs: previewQueue.length + 1,
            concurrencyLimit: PREVIEW_CONCURRENCY_LIMIT
        });
        await new Promise<void>((resolve) => {
            previewQueue.push(resolve);
        });
    }

    activePreviewJobs += 1;
    logPreviewDebug('Preview slot acquired', {
        activePreviewJobs,
        queuedJobs: previewQueue.length,
        concurrencyLimit: PREVIEW_CONCURRENCY_LIMIT
    });

    try {
        return await task();
    } finally {
        activePreviewJobs -= 1;
        const next = previewQueue.shift();
        logPreviewDebug('Preview slot released', {
            activePreviewJobs,
            queuedJobs: previewQueue.length,
            concurrencyLimit: PREVIEW_CONCURRENCY_LIMIT,
            wakingQueuedJob: Boolean(next)
        });
        if (next) {
            next();
        }
    }
};

const waitForVisualStability = async (page: Page): Promise<void> => {
    // Deterministic capture delay: do not poll animations/transitions.
    await page.waitForTimeout(PREVIEW_CAPTURE_DELAY_MS);
};

const renderPreviewJpegViaNodeWorker = async (html: string): Promise<Buffer> => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-render-'));
    const htmlPath = path.join(tempDir, 'deck.html');
    const outputPath = path.join(tempDir, 'preview.jpg');
    const workerPath = path.resolve(__dirname, './previewRenderer.worker.cjs');

    await fs.writeFile(htmlPath, html, { encoding: 'utf-8' });

    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn(process.env.NODE_EXECUTABLE || 'node', [workerPath, htmlPath, outputPath], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

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

const renderPreviewJpeg = async (html: string): Promise<Buffer> => {
    if (typeof (process as any).versions?.bun === 'string') {
        return renderPreviewJpegViaNodeWorker(html);
    }

    const browser = await chromium.launch({
        headless: true,
        timeout: PREVIEW_BROWSER_LAUNCH_TIMEOUT_MS,
        args: ['--disable-gpu', '--disable-dev-shm-usage']
    });

    try {
        const context = await browser.newContext({ viewport: PREVIEW_VIEWPORT });
        const page = await context.newPage();

        await page.setContent(html, { waitUntil: 'networkidle' });
        await waitForVisualStability(page);
        const png = await page.screenshot({ type: 'png', fullPage: false });

        return await sharp(png)
            .resize(PREVIEW_OUTPUT.width, PREVIEW_OUTPUT.height, {
                fit: 'cover',
                position: 'centre'
            })
            .jpeg({ quality: PREVIEW_JPEG_QUALITY, mozjpeg: true })
            .toBuffer();
    } finally {
        await browser.close();
    }
};

const refreshPreviewForProject = async (projectId: string, userId: string, html: string): Promise<void> => {
    try {
        const startedAt = Date.now();
        logPreviewDebug('Refreshing preview started', {
            projectId,
            userId,
            htmlLength: html.length
        });

        const previewKey = getPreviewKey(userId, projectId);
        const jpeg = await renderPreviewJpeg(html);

        await storageService.uploadFile(previewKey, jpeg, 'image/jpeg');
        await db.query(
            `
                UPDATE projects
                SET theme_data = COALESCE(theme_data, '{}'::jsonb) || jsonb_build_object('preview_url', to_jsonb($2::text))
                WHERE id = $1
            `,
            [projectId, previewKey]
        );

        try {
            await db.query(
                'UPDATE projects SET preview_url = $2 WHERE id = $1',
                [projectId, previewKey]
            );
        } catch (error: any) {
            if (error?.code !== '42703') {
                throw error;
            }
        }

        logPreviewDebug('Refreshing preview completed', {
            projectId,
            userId,
            previewKey,
            jpegBytes: jpeg.length,
            elapsedMs: Date.now() - startedAt
        });
    } catch (error) {
        console.error(`[projectDeck] Failed to refresh preview for project ${projectId}:`, error);
        throw error;
    }
};

export const generatePreviewForProject = async (projectId: string, existingUserId?: string): Promise<string> => {
    const existingJob = previewJobsByProject.get(projectId);
    if (existingJob) {
        logPreviewDebug('Reusing in-flight preview job', { projectId });
        return existingJob;
    }

    const previewJob = runWithPreviewSlot(async () => {
        const startedAt = Date.now();
        logPreviewDebug('Preview job started', { projectId });

        const userId = existingUserId || await getProjectOwner(projectId);
        const s3Key = await ensureDeckExistsForProject(projectId, userId);
        const cacheKey = getCacheKey(projectId);
        const cachedHtml = await cacheService.get(cacheKey);

        const html = cachedHtml ?? await storageService.getFileContent(s3Key);
        logPreviewDebug('Preview source HTML resolved', {
            projectId,
            userId,
            s3Key,
            cacheHit: cachedHtml !== null,
            htmlLength: html.length
        });

        await refreshPreviewForProject(projectId, userId, html);

        logPreviewDebug('Preview job completed', {
            projectId,
            userId,
            elapsedMs: Date.now() - startedAt
        });

        return getPreviewKey(userId, projectId);
    }).finally(() => {
        previewJobsByProject.delete(projectId);
        logPreviewDebug('Preview job removed from in-flight map', {
            projectId,
            remainingInFlightJobs: previewJobsByProject.size
        });
    });

    previewJobsByProject.set(projectId, previewJob);
    logPreviewDebug('Preview job registered as in-flight', {
        projectId,
        inFlightJobs: previewJobsByProject.size
    });

    return previewJob;
};

export const ensureDeckExistsForProject = async (projectId: string, existingUserId?: string): Promise<string> => {
    const existingKey = await getExistingDeckKey(projectId);
    if (existingKey) return existingKey;

    const userId = existingUserId || await getProjectOwner(projectId);
    const s3Key = `users/${userId}/${projectId}.html`;
    const defaultHtml = await getDefaultHtml();

    await storageService.uploadFile(s3Key, defaultHtml, 'text/html');
    
    // We'll update the project with this key 
    // (since createProject initialized it with 'temp', or it might be a new project)
    await db.query(
        'UPDATE projects SET minio_object_key = $2 WHERE id = $1',
        [projectId, s3Key]
    );

    await cacheService.set(getCacheKey(projectId), defaultHtml, config.redis.ttlSeconds);
    return s3Key;
};

export const loadDeckHtmlForProject = async (projectId: string): Promise<{ html: string; s3Key: string; cacheHit: boolean }> => {
    const s3Key = await ensureDeckExistsForProject(projectId);
    const cacheKey = getCacheKey(projectId);

    const cachedHtml = await cacheService.get(cacheKey);
    if (cachedHtml !== null) {
        await cacheService.expire(cacheKey, config.redis.ttlSeconds);
        return { html: cachedHtml, s3Key, cacheHit: true };
    }

    const html = await storageService.getFileContent(s3Key);
    await cacheService.set(cacheKey, html, config.redis.ttlSeconds);
    return { html, s3Key, cacheHit: false };
};

export const saveDeckHtmlForProject = async (projectId: string, html: string): Promise<string> => {
    const s3Key = await ensureDeckExistsForProject(projectId);
    await storageService.uploadFile(s3Key, html, 'text/html');
    await cacheService.set(getCacheKey(projectId), html, config.redis.ttlSeconds);

    // Keep project cards in sync with deck edits without blocking chat/tool flow.
    void generatePreviewForProject(projectId).catch((error) => {
        console.error(`[projectDeck] Failed to enqueue preview refresh after save for project ${projectId}:`, error);
    });

    return s3Key;
};
