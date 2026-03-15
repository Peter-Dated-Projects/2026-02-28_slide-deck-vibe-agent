import * as fs from 'fs/promises';
import * as path from 'path';
import { chromium, type Page } from 'playwright-core';
import sharp from 'sharp';
import { cacheService, dbService as db, storageService } from '../core/container';
import { config } from '../config';

const DECK_CACHE_PREFIX = 'deck:html:';
const PREVIEW_VIEWPORT = { width: 1920, height: 1080 };
const PREVIEW_OUTPUT = { width: 1280, height: 720 };
const PREVIEW_JPEG_QUALITY = 80;
const PREVIEW_ANIMATION_MAX_WAIT_MS = 5000;
const PREVIEW_ANIMATION_POLL_MS = 50;

const getCacheKey = (projectId: string) => `${DECK_CACHE_PREFIX}${projectId}`;

const getDefaultHtml = async (): Promise<string> => {
    const defaultHtmlPath = path.resolve(__dirname, '../../../frontend/public/default.html');
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

const waitForVisualStability = async (page: Page): Promise<void> => {
    // Let initial style/layout updates flush before we inspect animation state.
    await page.waitForTimeout(PREVIEW_ANIMATION_POLL_MS * 2);

    const startedAt = Date.now();
    let hasActiveAnimations = true;

    while (Date.now() - startedAt < PREVIEW_ANIMATION_MAX_WAIT_MS) {
        const activeAnimationCount = await page.evaluate(() => {
            const globalObj = globalThis as any;
            const doc = globalObj.document;

            if (!doc || typeof doc.getAnimations !== 'function') {
                return 0;
            }

            return doc
                .getAnimations({ subtree: true })
                .filter((animation: any) => animation.playState === 'running' || animation.playState === 'pending')
                .length;
        });

        hasActiveAnimations = activeAnimationCount > 0;
        if (!hasActiveAnimations) {
            break;
        }

        await page.waitForTimeout(PREVIEW_ANIMATION_POLL_MS);
    }

    if (hasActiveAnimations) {
        console.warn('[projectDeck] Preview capture timed out waiting for animations/transitions to settle.');
    }
};

const renderPreviewJpeg = async (html: string): Promise<Buffer> => {
    const browser = await chromium.launch({ headless: true });

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
    } catch (error) {
        console.error(`[projectDeck] Failed to refresh preview for project ${projectId}:`, error);
    }
};

export const generatePreviewForProject = async (projectId: string, existingUserId?: string): Promise<string> => {
    const userId = existingUserId || await getProjectOwner(projectId);
    const s3Key = await ensureDeckExistsForProject(projectId, userId);
    const cacheKey = getCacheKey(projectId);
    const cachedHtml = await cacheService.get(cacheKey);

    const html = cachedHtml ?? await storageService.getFileContent(s3Key);
    await refreshPreviewForProject(projectId, userId, html);
    return getPreviewKey(userId, projectId);
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
    return s3Key;
};
