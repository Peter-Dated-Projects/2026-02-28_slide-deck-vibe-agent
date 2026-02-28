import { Pool } from 'pg';
import { config } from '../config';

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('executed query', { text, duration, rows: res.rowCount });
  return res;
};

export const getClient = async () => {
  const client = await pool.connect();
  const query = client.query;
  const release = client.release;
  // Make sure we release the client
  const timeout = setTimeout(() => {
    console.error('A client has been checked out for more than 5 seconds!');
    console.error(`The last executed query on this client was: ${(client as any).lastQuery}`);
  }, 5000);
  // Monkey patch the query method to keep track of the last query executed
  client.query = ((...args: any) => {
    (client as any).lastQuery = args;
    return query.apply(client, args as any);
  }) as any;
  client.release = () => {
    clearTimeout(timeout);
    // set the methods back to their original state
    client.query = query;
    client.release = release;
    return release.apply(client);
  };
  return client;
};
