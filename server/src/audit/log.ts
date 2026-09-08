import { eq } from 'drizzle-orm'
import type { DbLike } from '../db/client.js'
import { auditLog, mats } from '../db/schema.js'
import type { TokenPayload } from '../auth/tokens.js'
import type { AuditAction, AuditActor, AuditDetail } from '../shared/types.js'

export interface AuditInput {
  eventId: number
  matchId?: number | null
  actor: AuditActor
  action: AuditAction
  detail?: AuditDetail
  at?: string
}

/**
 * One row per write, inserted inside the transaction of the write it describes, so a
 * change that rolls back leaves no claim that it happened.
 */
export async function recordAudit(db: DbLike, row: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    eventId: row.eventId,
    matchId: row.matchId ?? null,
    actor: row.actor,
    action: row.action,
    detail: row.detail ?? {},
    at: row.at ?? new Date().toISOString(),
  }).run()
}

// A mat token is the tablet scoring that mat. Any other token is the console, and the
// server's own sweeps carry none at all. The entries routes pass 'desk' rather than
// calling this, because the desk holds an admin token like every other console screen.
export function actorOf(auth: TokenPayload | null, matNumber?: number | null): AuditActor {
  if (auth === null) return 'system'
  if (auth.role === 'admin') return 'admin'
  return matNumber == null ? 'mat' : `mat:${matNumber}`
}

export async function matNumberOf(db: DbLike, auth: TokenPayload | null): Promise<number | null> {
  if (auth?.role !== 'mat') return null
  const row = await db.select({ number: mats.number }).from(mats).where(eq(mats.id, auth.matId)).get()
  return row?.number ?? null
}

// The match log has carried provenance in its id prefixes since the first release. Undo
// reads it back so the row recording a deletion names whoever wrote the thing deleted,
// and migration 0007's backfill maps the same three prefixes.
export function actorOfMatchEventId(id: string, fallback: AuditActor): AuditActor {
  if (id.startsWith('entry:')) return 'desk'
  if (id.startsWith('admin:')) return 'admin'
  if (id.startsWith('expiry:')) return 'system'
  return fallback
}
