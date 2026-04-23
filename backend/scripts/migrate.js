const { Client } = require('pg');

async function migrate() {
    const client = new Client({
        host: 'localhost',
        port: 5432,
        user: 'vibe',
        password: 'vibe_password',
        database: 'vibe_db'
    });

    try {
        await client.connect();
        
        await client.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS edit_log TEXT;`);
        console.log('Added edit_log to conversations');
        
        await client.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS summary TEXT;`);
        console.log('Added summary to conversations');
        
        await client.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_compressed BOOLEAN DEFAULT FALSE;`);
        console.log('Added is_compressed to messages');
        
    } catch (err) {
        console.error('Migration failed', err);
    } finally {
        await client.end();
    }
}

migrate();
