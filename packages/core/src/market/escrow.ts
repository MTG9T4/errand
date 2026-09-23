/**
 * x402-style escrow for the Errand marketplace.
 *
 * This module is the **settlement adapter**: it models the exact lifecycle a
 * real x402 payment rail performs, but backed by an in-memory ledger so the
 * marketplace can run, demo, and test without touching a chain.
 *
 * Lifecycle:
 *   1. A runner's bid is accepted  -> `lockBounty`  (funds leave the poster)
 *   2. The errand is verified done -> `release`     (funds go to the runner)
 *   3. The errand times out        -> `refund`      (funds return to the poster)
 *
 * To settle on a real rail, swap the body of `lockBounty` / `release` /
 * `refund` for x402 `POST /settle` calls — the interface stays identical,
 * which is the whole point of keeping settlement behind this adapter.
 */

export type EscrowStatus = "locked" | "released" | "refunded";

export interface EscrowLock {
  /** Unique lock id (e.g. "esc_01…"). */
  id: string;
  /** The errand this bounty is attached to. */
  errandId: string;
  /** Who posted (and funded) the errand. */
  posterId: string;
  /** The runner whose bid was accepted. */
  runnerId: string;
  /** Decimal amount string, e.g. "2.50". Strings avoid float rounding. */
  amount: string;
  /** Settlement currency, e.g. "USDC". */
  currency: string;
  status: EscrowStatus;
  createdAt: number;
  /** Unix ms after which the lock may be refunded to the poster. */
  expiresAt: number;
}

export interface LockBountyParams {
  errandId: string;
  posterId: string;
  runnerId: string;
  amount: string;
  currency?: string;
  /** Override for this lock; defaults to the escrow's defaultTimeoutMs. */
  timeoutMs?: number;
}

export interface EscrowConfig {
  /** Default lock lifetime. Defaults to 24h. */
  defaultTimeoutMs?: number;
  /** Injectable clock (unix ms). Defaults to Date.now. Useful for tests. */
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export function createEscrow(config: EscrowConfig = {}) {
  const locks = new Map<string, EscrowLock>();
  const now = config.now ?? Date.now;
  const defaultTimeoutMs = config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  let seq = 0;

  function nextId(): string {
    seq += 1;
    return `esc_${now().toString(36)}_${seq.toString(36)}`;
  }

  /** Lock a poster's bounty when a runner's bid is accepted. */
  function lockBounty(params: LockBountyParams): EscrowLock {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`escrow: invalid bounty amount "${params.amount}"`);
    }
    const lock: EscrowLock = {
      id: nextId(),
      errandId: params.errandId,
      posterId: params.posterId,
      runnerId: params.runnerId,
      amount: params.amount,
      currency: params.currency ?? "USDC",
      status: "locked",
      createdAt: now(),
      expiresAt: now() + (params.timeoutMs ?? defaultTimeoutMs),
    };
    locks.set(lock.id, lock);
    return { ...lock };
  }

  function mustGet(lockId: string): EscrowLock {
    const lock = locks.get(lockId);
    if (!lock) throw new Error(`escrow: unknown lock "${lockId}"`);
    return lock;
  }

  /**
   * Release a locked bounty to the runner. Called when the errand is
   * verified complete. This is the settlement call — on a live x402 rail
   * this is where the on-chain transfer happens.
   */
  function release(lockId: string): EscrowLock {
    const lock = mustGet(lockId);
    if (lock.status !== "locked") {
      throw new Error(`escrow: cannot release lock "${lockId}" (status: ${lock.status})`);
    }
    lock.status = "released";
    return { ...lock };
  }

  /**
   * Refund a locked bounty to the poster. Intended for timed-out errands;
   * only locks past their expiry may be refunded.
   */
  function refund(lockId: string): EscrowLock {
    const lock = mustGet(lockId);
    if (lock.status !== "locked") {
      throw new Error(`escrow: cannot refund lock "${lockId}" (status: ${lock.status})`);
    }
    if (now() < lock.expiresAt) {
      throw new Error(
        `escrow: lock "${lockId}" has not expired yet (expires ${new Date(lock.expiresAt).toISOString()})`
      );
    }
    lock.status = "refunded";
    return { ...lock };
  }

  function get(lockId: string): EscrowLock | undefined {
    const lock = locks.get(lockId);
    return lock ? { ...lock } : undefined;
  }

  function listByErrand(errandId: string): EscrowLock[] {
    return [...locks.values()]
      .filter((l) => l.errandId === errandId)
      .map((l) => ({ ...l }));
  }

  /** Refund every expired, still-locked bounty. Returns the refunded locks. */
  function sweepExpired(): EscrowLock[] {
    const refunded: EscrowLock[] = [];
    for (const lock of locks.values()) {
      if (lock.status === "locked" && now() >= lock.expiresAt) {
        lock.status = "refunded";
        refunded.push({ ...lock });
      }
    }
    return refunded;
  }

  /**
   * Re-insert a previously persisted lock (e.g. hydrated from disk by the
   * CLI). The lock keeps its original id and timestamps.
   */
  function restore(lock: EscrowLock): EscrowLock {
    if (locks.has(lock.id)) {
      throw new Error(`escrow: lock "${lock.id}" already exists`);
    }
    locks.set(lock.id, { ...lock });
    return { ...lock };
  }

  return { lockBounty, release, refund, get, listByErrand, sweepExpired, restore };
}

export type Escrow = ReturnType<typeof createEscrow>;
