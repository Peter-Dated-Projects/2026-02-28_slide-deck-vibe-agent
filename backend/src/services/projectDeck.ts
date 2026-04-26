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

import { dbService as db, storageService } from '../core/container';

export const getProjectOwner = async (projectId: string): Promise<string> => {
    const result = await db.query('SELECT user_id FROM conversations WHERE project_id = $1 LIMIT 1', [projectId]);
    const userId = result.rows[0]?.user_id;
    if (!userId) {
        throw new Error(`Project owner for ${projectId} not found`);
    }
    return userId;
};

export const getDesignKey = async (projectId: string, existingUserId?: string): Promise<string> => {
    const userId = existingUserId || await getProjectOwner(projectId);
    return `users/${userId}/${projectId}-design.md`;
};

export const loadDesignForProject = async (projectId: string): Promise<string> => {
    try {
        const key = await getDesignKey(projectId);
        return await storageService.getFileContent(key);
    } catch {
        return `# Presentation design spec\n\n## Intent\n\n## Structure\n\n## Visual language\n\n## Constraints\n`;
    }
};

export const saveDesignForProject = async (projectId: string, md: string): Promise<void> => {
    const key = await getDesignKey(projectId);
    await storageService.uploadFile(key, md, 'text/markdown');
};
