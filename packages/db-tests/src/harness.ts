/**
 * Test harness: boots an embedded Postgres (PGlite), applies the Supabase shim
 * and every migration in `supabase/migrations` in order, and lets tests run SQL
 * as a specific signed-in user — exactly as PostgREST would, with RLS active.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../../supabase/migrations');

export type Querier = Pick<Transaction, 'query' | 'exec'>;

export interface RegisterSchoolOptions {
  name?: string;
  institutionType?: string;
  academicStructure?: string;
  email?: string;
  planCode?: string;
  country?: string;
}

export class TestDatabase {
  private emailCounter = 0;

  constructor(readonly pg: PGlite) {}

  /** Runs SQL as the database owner (bypasses RLS) — for fixtures and assertions only. */
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pg.query<T>(sql, params);
    return result.rows;
  }

  /** Runs `fn` inside a transaction as `authenticated` (or `anon` when userId is null). */
  async as<T>(userId: string | null, fn: (q: Querier) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
      return fn(tx);
    });
  }

  /** Convenience: run one query as a user and return its rows. */
  async rows<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.as(userId, async (q) => (await q.query<T>(sql, params)).rows);
  }

  uniqueEmail(prefix = 'user'): string {
    this.emailCounter += 1;
    return `${prefix}.${this.emailCounter}.${Date.now()}@klasora.test`;
  }

  /** Creates an auth user (the profile is created by the auth trigger). */
  async createUser(
    options: { email?: string; confirmed?: boolean; firstName?: string; lastName?: string } = {},
  ): Promise<{ id: string; email: string }> {
    const email = options.email ?? this.uniqueEmail();
    const [row] = await this.admin<{ id: string }>(
      `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
       values ($1, $2, $3::jsonb) returning id`,
      [
        email,
        options.confirmed === false ? null : new Date().toISOString(),
        JSON.stringify({ first_name: options.firstName ?? 'Test', last_name: options.lastName ?? 'User' }),
      ],
    );
    return { id: row!.id, email };
  }

  /** Registers a school through the public RPC, as the given user. */
  async registerSchool(userId: string, options: RegisterSchoolOptions = {}): Promise<string> {
    const [row] = await this.rows<{ id: string }>(
      userId,
      `select public.register_school(
         p_name => $1,
         p_institution_type => $2::public.institution_type,
         p_academic_structure => $3::public.academic_structure,
         p_email => $4,
         p_phone => '+234 803 000 0000',
         p_country => $5,
         p_state => 'Lagos',
         p_city => 'Ikeja',
         p_address => '12 Demo Avenue, Ikeja',
         p_website => null,
         p_plan_code => $6
       ) as id`,
      [
        options.name ?? 'Demo Academy',
        options.institutionType ?? 'primary_secondary',
        options.academicStructure ?? 'sectioned_school',
        options.email ?? 'office@demo-academy.test',
        options.country ?? 'NG',
        options.planCode ?? 'starter',
      ],
    );
    return row!.id;
  }

  async roleId(schoolId: string, roleKey: string): Promise<string> {
    const [row] = await this.admin<{ id: string }>(
      `select id from public.roles where school_id = $1 and role_key = $2`,
      [schoolId, roleKey],
    );
    if (!row) throw new Error(`No ${roleKey} role in school ${schoolId}`);
    return row.id;
  }

  /** Invites `email` with `roleId` as `inviterId` and returns the raw token. */
  async invite(inviterId: string, schoolId: string, email: string, roleId: string): Promise<string> {
    const [row] = await this.rows<{ token: string }>(
      inviterId,
      `select token from public.create_invitation($1, $2, $3)`,
      [schoolId, email, roleId],
    );
    return row!.token;
  }

  /** Creates a confirmed user and makes them an active member with the given built-in role. */
  async addMember(ownerId: string, schoolId: string, roleKey: string): Promise<{ id: string; email: string }> {
    const user = await this.createUser();
    const token = await this.invite(ownerId, schoolId, user.email, await this.roleId(schoolId, roleKey));
    await this.rows(user.id, `select public.accept_invitation($1)`, [token]);
    return user;
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite();
  await pg.exec(readFileSync(path.join(here, 'supabase-shim.sql'), 'utf8'));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      await pg.exec(readFileSync(path.join(migrationsDir, file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return new TestDatabase(pg);
}

/** Extracts the SQLSTATE from a thrown database error. */
export function sqlState(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/** Asserts that `promise` rejects with the given SQLSTATE and returns the error message. */
export async function expectSqlError(promise: Promise<unknown>, code: string): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const actual = sqlState(error);
    if (actual !== code) {
      throw new Error(`Expected SQLSTATE ${code} but got ${actual}: ${(error as Error).message}`);
    }
    return (error as Error).message;
  }
  throw new Error(`Expected SQLSTATE ${code} but the statement succeeded`);
}
