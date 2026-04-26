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

import express, { Router, type Response } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { storageService } from '../core/container';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
};

export const uploadsRouter = Router();

uploadsRouter.post(
    '/uploads',
    requireAuth,
    express.raw({ type: Object.keys(ALLOWED_MIME), limit: MAX_UPLOAD_BYTES }),
    async (req: AuthRequest, res: Response): Promise<void> => {
        try {
            const userId = req.user!.userId;
            const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
            const ext = ALLOWED_MIME[contentType];
            if (!ext) {
                res.status(415).json({ error: `Unsupported Content-Type: ${contentType || '(missing)'}` });
                return;
            }
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                res.status(400).json({ error: 'Empty upload body' });
                return;
            }

            const key = `users/${userId}/uploads/${randomUUID()}.${ext}`;
            await storageService.uploadFile(key, req.body, contentType);
            const url = await storageService.getFileUrl(key);

            res.json({ url, key, contentType, size: req.body.length });
        } catch (err) {
            console.error('[uploads] failed:', err);
            res.status(500).json({ error: 'Upload failed' });
        }
    },
);
