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

import type { Request, Response } from 'express';
import { dbService as db } from '../core/container';
// Type definitions to enforce type checking
export interface UserSettings {
    theme: 'light' | 'night';
    billing: any; // TBD
    registered_domains: string[];
}
export interface UserUpdatePayload {
    name?: string;
    age?: number;
    settings?: UserSettings;
}
// Simple runtime type checker for settings since we don't have zod or class-validator yet
function isValidSettings(settings: any): settings is UserSettings {
    if (!settings || typeof settings !== 'object') return false;
    // Enforce theme (day/night)
    if (settings.theme !== 'light' && settings.theme !== 'night') return false;
    // Check registered_domains (must be array)
    if (settings.registered_domains && !Array.isArray(settings.registered_domains)) return false;
    return true;
}
export const getMe = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const result = await db.query(
            'SELECT id, email, name, first_name, last_name, phone, field, is_profile_complete, age, profile_picture, settings, created_at FROM users WHERE id = $1',
            [userId]
        );
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const updateMe = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const payload: UserUpdatePayload = req.body;
        let updateQueryPart = [];
        let queryParams: any[] = [];
        let paramIndex = 1;
        if (payload.name !== undefined) {
            updateQueryPart.push(`name = $${paramIndex++}`);
            queryParams.push(payload.name);
        }
        if (payload.age !== undefined) {
            updateQueryPart.push(`age = $${paramIndex++}`);
            queryParams.push(payload.age);
        }
        if (payload.settings !== undefined) {
            if (!isValidSettings(payload.settings)) {
                res.status(400).json({ error: 'Invalid settings format. Theme must be light or night, and registered_domains must be an array.' });
                return;
            }
            updateQueryPart.push(`settings = $${paramIndex++}`);
            queryParams.push(payload.settings);
        }
        if (updateQueryPart.length === 0) {
            res.status(400).json({ error: 'No fields to update' });
            return;
        }
        queryParams.push(userId);
        const query = `UPDATE users SET ${updateQueryPart.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING id, email, name, first_name, last_name, phone, field, is_profile_complete, age, profile_picture, settings, created_at`;
        const result = await db.query(query, queryParams);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
export const updateProfile = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const { first_name, last_name, phone, field } = req.body;
        if (!first_name || !last_name || !field) {
            res.status(400).json({ error: 'first_name, last_name, and field are required' });
            return;
        }
        const query = `
            UPDATE users 
            SET first_name = $1, last_name = $2, phone = $3, field = $4, is_profile_complete = TRUE, updated_at = CURRENT_TIMESTAMP 
            WHERE id = $5 
            RETURNING id, email, name, first_name, last_name, phone, field, is_profile_complete, profile_picture, settings, created_at, age
        `;
        const result = await db.query(query, [first_name, last_name, phone || null, field, userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ user: result.rows[0] });
    } catch (error) {
        console.error('Error updating user profile:', error);
        res.status(500).json({ error: 'Internal server error while updating profile' });
    }
};
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = (req as any).user?.userId;
        if (!userId) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
        if (result.rows.length === 0) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.clearCookie('refreshToken');
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
