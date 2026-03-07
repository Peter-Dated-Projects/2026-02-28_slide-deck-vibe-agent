import type { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { dbService as db, storageService } from '../core/container';
import crypto from 'crypto';

const client = new OAuth2Client(config.auth.googleClientId);

const generateAccessToken = (userId: string) => {
  return jwt.sign({ userId }, config.auth.jwtSecret || 'secret', { expiresIn: '15m' });
};

const generateRefreshToken = () => {
  return crypto.randomBytes(40).toString('hex');
};

export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;
    if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
    }

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: config.auth.googleClientId,
    });
    
    const payload = ticket.getPayload();
    if (!payload?.email || !payload?.sub) {
        res.status(400).json({ error: 'Invalid Google token payload' });
        return;
    }

    const email = payload.email;
    const googleId = payload.sub;
    const name = payload.name || 'Unknown User';
    const profile_picture = payload.picture || null;

    // Find or create user
    const userResult = await db.query('SELECT id, email, name, first_name, last_name, phone, field, is_profile_complete, profile_picture, settings, created_at, age FROM users WHERE google_id = $1 OR email = $2', [googleId, email]);
    let user;

    if (userResult.rows?.length > 0) {
        user = userResult.rows[0];
        
        // Check for stale abandoned setup session
        if (!user.is_profile_complete) {
            const createdAt = new Date(user.created_at).getTime();
            const now = Date.now();
            const timeDiffMinutes = (now - createdAt) / (1000 * 60);

            if (timeDiffMinutes > 2) {
                // Delete stale record and recreate
                await db.query('DELETE FROM users WHERE id = $1', [user.id]);
                
                const insertResult = await db.query(
                    'INSERT INTO users (email, google_id, name, profile_picture) VALUES ($1, $2, $3, $4) RETURNING id, email, name, first_name, last_name, phone, field, is_profile_complete, profile_picture, settings, created_at, age',
                    [email, googleId, name, profile_picture]
                );
                user = insertResult.rows[0];
                // Initialize user's S3 folder for the recreated user
                await storageService.uploadFile(`users/${user.id}/.keep`, '', 'text/plain').catch(() => {});
            } else {
                 // update google id if they signed up with email first (if we had email signup)
                 if (!user.google_id) {
                     await db.query('UPDATE users SET google_id = $1, name = $2, profile_picture = $3 WHERE id = $4', [googleId, name, profile_picture, user.id]);
                 }
            }
        } else {
            // update google id if they signed up with email first (if we had email signup)
            if (!user.google_id) {
                 await db.query('UPDATE users SET google_id = $1, name = $2, profile_picture = $3 WHERE id = $4', [googleId, name, profile_picture, user.id]);
            }
        }
    } else {
        const insertResult = await db.query(
            'INSERT INTO users (email, google_id, name, profile_picture) VALUES ($1, $2, $3, $4) RETURNING id, email, name, first_name, last_name, phone, field, is_profile_complete, profile_picture, settings, created_at, age',
            [email, googleId, name, profile_picture]
        );
        user = insertResult.rows[0];
        // Initialize user's S3 folder
        await storageService.uploadFile(`users/${user.id}/.keep`, '', 'text/plain').catch(() => {});
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken();

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await db.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshToken, expiresAt]
    );

    // Set HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
        accessToken,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            first_name: user.first_name,
            last_name: user.last_name,
            phone: user.phone,
            field: user.field,
            is_profile_complete: user.is_profile_complete,
            profile_picture: user.profile_picture,
            settings: user.settings,
            age: user.age,
            created_at: user.created_at
        }
    });
  } catch (error) {
    console.error('Google Auth Error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
    try {
        const { refreshToken } = req.cookies;
        
        if (!refreshToken) {
            res.status(401).json({ error: 'Refresh token required' });
            return;
        }

        const result = await db.query(
            'SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND revoked = FALSE AND expires_at > NOW()',
            [refreshToken]
        );

        if (result.rows.length === 0) {
            res.status(401).json({ error: 'Invalid or expired refresh token' });
            return;
        }

        const userId = result.rows[0].user_id;

        // Revoke old token (rotation)
        await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [refreshToken]);

        // Generate new tokens
        const newAccessToken = generateAccessToken(userId);
        const newRefreshToken = generateRefreshToken();

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

         await db.query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [userId, newRefreshToken, expiresAt]
        );

        res.cookie('refreshToken', newRefreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        res.json({ accessToken: newAccessToken });
    } catch (error) {
        console.error('Refresh Token Error:', error);
        res.status(401).json({ error: 'Token refresh failed' });
    }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
    const { refreshToken } = req.cookies;
    if (refreshToken) {
        await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [refreshToken]);
    }
    
    res.clearCookie('refreshToken');
    res.json({ success: true });
};
