/**
 * sync:db — Ensures every user in PostgreSQL has an S3 folder initialized.
 *
 * For each user, it tries to upload a 0-byte `.keep` file to:
 *   users/{userId}/.keep
 *
 * The MinioProvider already auto-creates the bucket if it doesn't exist,
 * so this script handles both "missing bucket" and "missing folder" scenarios.
 *
 * Usage:
 *   bun run sync:db
 */

import { Pool } from 'pg';
import { config } from '../src/config';
import { storageService } from '../src/core/container';

const syncS3Users = async () => {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
    });

    console.log('🔍 Fetching all users from PostgreSQL...');

    let users: { id: string; email: string }[];
    try {
        const result = await pool.query<{ id: string; email: string }>(
            'SELECT id, email FROM users ORDER BY created_at ASC'
        );
        users = result.rows;
        console.log(`   Found ${users.length} user(s).`);
    } catch (err) {
        console.error('❌ Failed to query users:', err);
        await pool.end();
        process.exit(1);
    } finally {
        await pool.end();
    }

    if (users.length === 0) {
        console.log('✅ No users to sync. Exiting.');
        return;
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;

    console.log('\n📦 Syncing S3 folders...\n');

    for (const user of users) {
        const key = `users/${user.id}/.keep`;
        try {
            // uploadFile will auto-create the bucket if needed (via ensureBucketExists),
            // so uploading the .keep marker is sufficient to "initialize" the folder.
            await storageService.uploadFile(key, '', 'text/plain');
            console.log(`  ✅ [${user.email}] → uploaded ${key}`);
            created++;
        } catch (err: any) {
            console.error(`  ❌ [${user.email}] → failed to upload ${key}:`, err?.message ?? err);
            failed++;
        }
    }

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━
  Sync complete
  ✅ Created / updated : ${created}
  ⚠️  Skipped           : ${skipped}
  ❌ Failed            : ${failed}
━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

    if (failed > 0) {
        process.exit(1);
    }
};

syncS3Users();
