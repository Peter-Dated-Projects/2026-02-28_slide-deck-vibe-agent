import { Pool } from 'pg';
import { config } from '../src/config';

const seedProjects = async () => {
    const email = process.argv[2];

    if (!email) {
        console.error('Usage: bun run scripts/seed-projects.ts <user-email>');
        process.exit(1);
    }

    console.log(`Connecting to database to seed projects for ${email}...`);
    
    const pool = new Pool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
    });

    try {
        // 1. Find user by email
        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        
        if (userRes.rows.length === 0) {
            console.error(`User with email ${email} not found.`);
            process.exit(1);
        }
        
        const userId = userRes.rows[0].id;
        console.log(`Found user: ${userId}`);

        // 2. Generate and Insert 45 Mock Projects
        const count = 45;
        const themes = ['Professional', 'Creative', 'Minimal', 'Dark Mode'];
        
        console.log(`Inserting ${count} mock projects...`);

        for (let i = 0; i < count; i++) {
            // Some are recent, some are older, matching the frontend mock generation logic
            const isRecent = Math.random() > 0.6;
            const daysAgo = isRecent ? Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 30);
            
            const date = new Date();
            date.setDate(date.getDate() - daysAgo);
            const dateStr = date.toISOString();

            const title = `Untitled Project ${i + 1}`;
            const theme = themes[Math.floor(Math.random() * themes.length)];

            // Insert into conversations
            const convRes = await pool.query(
                `INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING id`,
                [userId, title, dateStr, dateStr]
            );
            
            const convId = convRes.rows[0].id;

            // Insert a dummy slide just to store the theme as in the real application lifecycle
            // Since there's no thumbnail URL field in the DB currently, we store it in theme_data to be safe
            // depending on the evolving schema.
            const minioObjectKey = `mock-projects/seed/${i + 1}/thumbnail.jpg`;
            const themeData = JSON.stringify({ theme: theme, preview_url: `https://picsum.photos/seed/${i + 1}/800/450` });

            await pool.query(
                `INSERT INTO slides (conversation_id, minio_object_key, theme_data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)`,
                [convId, minioObjectKey, themeData, dateStr, dateStr]
            );
        }

        console.log('Successfully seeded projects.');

    } catch (e) {
        console.error('Error seeding projects:', e);
        process.exit(1);
    } finally {
        await pool.end();
    }
};

seedProjects();
