import * as fs from 'fs/promises';
import * as path from 'path';
import { cacheService, dbService as db, storageService } from '../core/container';
import { config } from '../config';

const DECK_CACHE_PREFIX = 'deck:html:';

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
