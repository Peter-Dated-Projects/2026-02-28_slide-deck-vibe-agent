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

/**
 * manage:db — Per-user database and S3 management tool.
 *
 * Usage:
 *   bun run manage:db <user_email> [action]
 *
 * Actions:
 *   clean  (default) — Deletes all conversations (cascades to messages + slides)
 *                      and all S3 files under users/{userId}/ for the given user.
 *
 * Examples:
 *   bun run manage:db peter@example.com
 *   bun run manage:db peter@example.com clean
 */
import { Pool } from 'pg';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { config } from '../src/config';
// ── Args ─────────────────────────────────────────────────────────────────────
const [userEmail, action = 'clean'] = process.argv.slice(2);
if (!userEmail) {
    console.error('❌  Usage: bun run manage:db <user_email> [action]');
    console.error('   Actions: clean');
    process.exit(1);
}
const VALID_ACTIONS = ['clean'];
if (!VALID_ACTIONS.includes(action)) {
    console.error(`❌  Unknown action "${action}". Valid actions: ${VALID_ACTIONS.join(', ')}`);
    process.exit(1);
}
// ── Helpers ───────────────────────────────────────────────────────────────────
const makePool = () =>
    new Pool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
    });
const makeS3 = () =>
    new S3Client({
        endpoint: config.s3.endpoint,
        region: 'us-east-1',
        credentials: {
            accessKeyId: config.s3.accessKey,
            secretAccessKey: config.s3.secretKey,
        },
        forcePathStyle: true,
    });
// ── Actions ───────────────────────────────────────────────────────────────────
async function clean(userId: string, email: string) {
    const pool = makePool();
    const s3 = makeS3();
    // 1. Delete all conversations (cascades messages + slides)
    console.log('\n🗄️  Clearing PostgreSQL data...');
    try {
        const result = await pool.query(
            'DELETE FROM conversations WHERE user_id = $1 RETURNING id',
            [userId]
        );
        console.log(`   Deleted ${result.rowCount} conversation(s) (messages + slides cascade).`);
    } catch (err) {
        console.error('   ❌ Failed to delete conversations:', err);
        await pool.end();
        process.exit(1);
    } finally {
        await pool.end();
    }
    // 2. Delete all S3 objects under users/{userId}/
    console.log('\n🪣  Clearing S3 files...');
    const prefix = `users/${userId}/`;
    let totalDeleted = 0;
    try {
        let continuationToken: string | undefined;
        do {
            const listResp = await s3.send(
                new ListObjectsV2Command({
                    Bucket: config.s3.bucketName,
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                })
            );
            const keys = (listResp.Contents ?? []).map(obj => ({ Key: obj.Key! }));
            if (keys.length > 0) {
                await s3.send(
                    new DeleteObjectsCommand({
                        Bucket: config.s3.bucketName,
                        Delete: { Objects: keys, Quiet: true },
                    })
                );
                totalDeleted += keys.length;
                console.log(`   Deleted batch of ${keys.length} object(s)...`);
            }
            continuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
        } while (continuationToken);
        console.log(`   Total S3 objects deleted: ${totalDeleted}`);
    } catch (err: any) {
        // If bucket doesn't exist, there's nothing to delete — that's fine.
        if (err.name === 'NoSuchBucket' || err.Code === 'NoSuchBucket') {
            console.log('   ⚠️  Bucket does not exist — nothing to delete from S3.');
        } else {
            console.error('   ❌ S3 cleanup failed:', err?.message ?? err);
            process.exit(1);
        }
    }
}
// ── Entry ─────────────────────────────────────────────────────────────────────
const run = async () => {
    const pool = makePool();
    console.log(`\n👤 Looking up user: ${userEmail}`);
    let userId = '';
    try {
        const result = await pool.query<{ id: string }>(
            'SELECT id FROM users WHERE email = $1',
            [userEmail]
        );
        if (result.rows.length === 0) {
            console.error(`❌  No user found with email: ${userEmail}`);
            await pool.end();
            process.exit(1);
        }
        userId = result.rows[0]?.id ?? '';
        console.log(`   Found user ID: ${userId}`);
    } catch (err) {
        console.error('❌  Database error:', err);
        await pool.end();
        process.exit(1);
    } finally {
        await pool.end();
    }
    console.log(`\n⚙️  Running action: ${action}`);
    if (action === 'clean') {
        await clean(userId, userEmail);
    }
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅ ${action} complete for ${userEmail}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
};
run();
