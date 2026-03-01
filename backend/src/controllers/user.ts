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
            'SELECT id, email, name, age, profile_picture, settings, created_at FROM users WHERE id = $1',
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
        const query = `UPDATE users SET ${updateQueryPart.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING id, email, name, age, profile_picture, settings, created_at`;

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
