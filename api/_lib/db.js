// Thin Neon query helper. @neondatabase/serverless talks to Postgres over
// HTTP rather than a persistent TCP connection, which is what avoids
// connection-pool exhaustion under Vercel's many-short-lived-instances model
// (a plain `pg` pool doesn't survive that well).

import { neon } from '@neondatabase/serverless';

let client;

export function sql(strings, ...values) {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    client = neon(connectionString);
  }
  return client(strings, ...values);
}
