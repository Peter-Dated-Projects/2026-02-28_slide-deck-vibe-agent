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

import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { config } from '../src/config';
const initDb = async () => {
    console.log('Connecting to database...');
    // We connect to the default 'postgres' database first to drop/create our target db
    const rootPool = new Pool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: 'postgres', 
    });
    try {
        console.log(`Checking if database ${config.db.database} exists...`);
        const res = await rootPool.query(`SELECT datname FROM pg_database WHERE datname = '${config.db.database}'`);
        if (res.rowCount && res.rowCount > 0) {
            console.log(`Dropping database ${config.db.database}...`);
            // Terminate existing connections before dropping
            await rootPool.query(`
                SELECT pg_terminate_backend(pg_stat_activity.pid)
                FROM pg_stat_activity
                WHERE pg_stat_activity.datname = '${config.db.database}'
                AND pid <> pg_backend_pid();
            `);
            await rootPool.query(`DROP DATABASE ${config.db.database}`);
        }
        console.log(`Creating database ${config.db.database}...`);
        await rootPool.query(`CREATE DATABASE ${config.db.database}`);
        console.log(`Database ${config.db.database} created successfully.`);
    } catch (e) {
        console.error('Error recreating database:', e);
        process.exit(1);
    } finally {
        await rootPool.end();
    }
    console.log('Applying schema...');
    // Now connect to the newly created database to apply our init.sql
    const appPool = new Pool({
         host: config.db.host,
         port: config.db.port,
         user: config.db.user,
         password: config.db.password,
         database: config.db.database,
    });
    try {
        const sqlPath = path.resolve(__dirname, '../../db/init.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');
        await appPool.query(sql);
        console.log('Schema applied successfully.');
        console.log('Inserting default seed data...');
        // Insert a test user
        const userRes = await appPool.query(
             `INSERT INTO users (email, google_id, name) VALUES ('test@vibeslide.com', 'test-google-id-123', 'Test User') RETURNING id`
        );
        const userId = userRes.rows[0].id;
        console.log(`Inserted test user: test@vibeslide.com [ID: ${userId}]`);
        // Insert a test conversation
        const convRes = await appPool.query(
            `INSERT INTO conversations (user_id, title) VALUES ($1, 'My First Pitch Deck') RETURNING id`,
            [userId]
        );
        const convId = convRes.rows[0].id;
        console.log(`Inserted test conversation for user. [ID: ${convId}]`);
        // Insert test messages
        await appPool.query(
            `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', '{"text": "Create a pitch deck for a new AI startup."}')`,
            [convId]
        );
        console.log('Database initialization complete!');
    } catch (error) {
         console.error('Failed to initialize schema or insert seed data:', error);
         process.exit(1);
    } finally {
         await appPool.end();
    }
};
initDb();
