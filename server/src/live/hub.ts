import type { Db } from '../db/client.js'
import type { Snapshot } from '../shared/types.js'
import { buildSnapshot } from './snapshot.js'

export type Sender = (snapshot: Snapshot) => void

const BOUND_WINDOW_MS = 60_000

export class Hub {
  private subs = new Map<number, Set<Sender>>()
  private versions = new Map<number, number>()
  private heartbeats = new Map<number, number>()

  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  snapshot(eventId: number): Promise<Snapshot> {
    return buildSnapshot(this.db, eventId, {
      nowMs: this.now(),
      isBound: id => this.isBound(id),
    })
  }

  async subscribe(eventId: number, send: Sender): Promise<() => void> {
    let set = this.subs.get(eventId)
    if (!set) {
      set = new Set()
      this.subs.set(eventId, set)
    }
    set.add(send)
    try {
      send(await this.snapshot(eventId))
    } catch {
      set.delete(send)
    }
    return () => { set.delete(send) }
  }

  async broadcast(eventId: number): Promise<Snapshot> {
    const version = (this.versions.get(eventId) ?? 0) + 1
    this.versions.set(eventId, version)
    const snap = await this.snapshot(eventId)
    const set = this.subs.get(eventId)
    if (set) {
      const dead: Sender[] = []
      for (const send of set) {
        try {
          send(snap)
        } catch {
          dead.push(send)
        }
      }
      for (const send of dead) set.delete(send)
    }
    return snap
  }

  heartbeat(matId: number): void {
    this.heartbeats.set(matId, this.now())
  }

  isBound(matId: number): boolean {
    const t = this.heartbeats.get(matId)
    return t !== undefined && this.now() - t < BOUND_WINDOW_MS
  }

  subscriberCount(eventId: number): number {
    return this.subs.get(eventId)?.size ?? 0
  }
}
