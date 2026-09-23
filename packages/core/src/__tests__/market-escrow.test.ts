import { describe, it, expect } from "vitest";
import { createEscrow } from "../market/escrow";

describe("escrow — x402-style bounty settlement", () => {
  it("locks a bounty when a bid is accepted", () => {
    const escrow = createEscrow();
    const lock = escrow.lockBounty({
      errandId: "err_1",
      posterId: "poster-alice",
      runnerId: "runner-bob",
      amount: "2.50",
    });

    expect(lock.id).toMatch(/^esc_/);
    expect(lock.status).toBe("locked");
    expect(lock.currency).toBe("USDC");
    expect(lock.expiresAt).toBeGreaterThan(lock.createdAt);
    expect(escrow.get(lock.id)).toEqual(lock);
  });

  it("releases the bounty to the runner on settlement", () => {
    const escrow = createEscrow();
    const lock = escrow.lockBounty({
      errandId: "err_1",
      posterId: "poster-alice",
      runnerId: "runner-bob",
      amount: "2.50",
    });

    const released = escrow.release(lock.id);
    expect(released.status).toBe("released");
    expect(escrow.get(lock.id)?.status).toBe("released");
  });

  it("refuses to release twice", () => {
    const escrow = createEscrow();
    const lock = escrow.lockBounty({
      errandId: "err_1",
      posterId: "poster-alice",
      runnerId: "runner-bob",
      amount: "2.50",
    });
    escrow.release(lock.id);
    expect(() => escrow.release(lock.id)).toThrow(/cannot release/);
  });

  it("refunds an expired lock to the poster", () => {
    let t = 1_000_000;
    const escrow = createEscrow({ now: () => t, defaultTimeoutMs: 1_000 });
    const lock = escrow.lockBounty({
      errandId: "err_1",
      posterId: "poster-alice",
      runnerId: "runner-bob",
      amount: "2.50",
    });

    // Not expired yet — refund refused.
    expect(() => escrow.refund(lock.id)).toThrow(/not expired/);

    // Past expiry — refund succeeds.
    t += 2_000;
    const refunded = escrow.refund(lock.id);
    expect(refunded.status).toBe("refunded");
  });

  it("sweepExpired refunds all expired locks at once", () => {
    let t = 1_000_000;
    const escrow = createEscrow({ now: () => t, defaultTimeoutMs: 1_000 });
    const a = escrow.lockBounty({
      errandId: "err_a",
      posterId: "p",
      runnerId: "r",
      amount: "1.00",
    });
    const b = escrow.lockBounty({
      errandId: "err_b",
      posterId: "p",
      runnerId: "r",
      amount: "1.00",
      timeoutMs: 60_000, // still fresh
    });

    t += 5_000;
    const swept = escrow.sweepExpired();
    expect(swept.map((l) => l.id)).toEqual([a.id]);
    expect(escrow.get(a.id)?.status).toBe("refunded");
    expect(escrow.get(b.id)?.status).toBe("locked");
  });

  it("rejects invalid bounty amounts", () => {
    const escrow = createEscrow();
    expect(() =>
      escrow.lockBounty({
        errandId: "err_1",
        posterId: "p",
        runnerId: "r",
        amount: "0",
      })
    ).toThrow(/invalid bounty amount/);
    expect(() =>
      escrow.lockBounty({
        errandId: "err_1",
        posterId: "p",
        runnerId: "r",
        amount: "free",
      })
    ).toThrow(/invalid bounty amount/);
  });

  it("lists locks per errand and restores persisted locks", () => {
    const escrow = createEscrow();
    const lock = escrow.lockBounty({
      errandId: "err_9",
      posterId: "p",
      runnerId: "r",
      amount: "3.00",
      currency: "USDC",
    });
    expect(escrow.listByErrand("err_9")).toHaveLength(1);
    expect(escrow.listByErrand("nope")).toHaveLength(0);

    // Simulate a CLI restart: hydrate a fresh escrow from disk.
    const fresh = createEscrow();
    const restored = fresh.restore({ ...lock });
    expect(restored.id).toBe(lock.id);
    expect(fresh.release(lock.id).status).toBe("released");
  });
});
