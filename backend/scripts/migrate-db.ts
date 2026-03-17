import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { config } from '../src/config';

const MIGRATION_NAME = 'db/migration.sql';

const run = async () => {
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
    });

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const alreadyApplied = await pool.query(
            'SELECT 1 FROM schema_migrations WHERE name = $1 LIMIT 1',
            [MIGRATION_NAME],
        );

        if ((alreadyApplied.rowCount ?? 0) > 0) {
            console.log(`Migration already applied: ${MIGRATION_NAME}`);
            return;
        }

        const migrationPath = path.resolve(__dirname, '../../db/migration.sql');
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        await pool.query(migrationSql);
        await pool.query('INSERT INTO schema_migrations (name) VALUES ($1)', [MIGRATION_NAME]);

        console.log(`Migration applied successfully: ${MIGRATION_NAME}`);
    } catch (error) {
        console.error('Failed to run database migration:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
};

void run();
