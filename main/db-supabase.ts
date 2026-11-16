/**
 * Supabase & PostgreSQL Database Client for Flo POS
 * Provides connection pooling, parameterized query execution, and transaction helpers.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let pool: Pool | null = null;
let supabaseClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))
  );
}

export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!url || !key) {
    throw new Error('Supabase client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set.');
  }

  supabaseClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

export function getPostgresPool(): Pool {
  if (pool) return pool;

  const connectionString =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    throw new Error('PostgreSQL Pool requires DATABASE_URL or SUPABASE_DB_URL to be set in environment.');
  }

  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on('error', (err) => {
    console.error('[Supabase/PG Pool Error]:', err);
  });

  return pool;
}

export async function query<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
  const p = getPostgresPool();
  return p.query<T>(sql, params);
}

export async function queryOne<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<T | null> {
  const res = await query<T>(sql, params);
  return res.rows[0] ?? null;
}

export async function queryAll<T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<T[]> {
  const res = await query<T>(sql, params);
  return res.rows;
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const p = getPostgresPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeSupabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
