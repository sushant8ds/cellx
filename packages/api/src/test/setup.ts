import * as dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config();

// Provide a dummy DATABASE_URL so pool.ts can be imported in unit tests
// that mock pool.query. Tests that need a real DB will override this.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_placeholder';
}

let client: Client | null = null;

export async function getTestDb(): Promise<Client> {
  if (client) return client;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.end();
    client = null;
  }
}
