import { describe, it, expect } from "vitest";
import { createReputationLedger, rankBids } from "../market/reputation";

describe("reputation ledger", () => {
  it("gives unknown runners a mild prior instead of zero", () => {
    const ledger = createReputationLedger();
    const score = ledger.getScore("never-seen");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });

  it("rewards completions and punishes failures", () => {
    const ledger = createReputationLedger();
    const good = "runner-good";
    const bad = "runner-bad";

    for (let i = 0; i < 10; i++) ledger.recordCompletion(good, 5_000);
    for (let i = 0; i < 8; i++) ledger.recordFailure(bad);
    ledger.recordCompletion(bad, 5_000);
    ledger.recordCompletion(bad, 5_000);

    expect(ledger.getScore(good)).toBeGreaterThan(ledger.getScore(bad));
    expect(ledger.getScore(good)).toBeGreaterThan(0.5);
  });

  it("prefers faster runners at equal success rates", () => {
    const ledger = createReputationLedger();
    for (let i = 0; i < 10; i++) ledger.recordCompletion("fast", 2_000);
    for (let i = 0; i < 10; i++) ledger.recordCompletion("slow", 600_000);

    expect(ledger.getScore("fast")).toBeGreaterThan(ledger.getScore("slow"));
  });

  it("keeps scores within [0, 1]", () => {
    const ledger = createReputationLedger();
    for (let i = 0; i < 100; i++) ledger.recordCompletion("pro", 1_000);
    for (let i = 0; i < 100; i++) ledger.recordFailure("flop");
    expect(ledger.getScore("pro")).toBeLessThanOrEqual(1);
    expect(ledger.getScore("flop")).toBeGreaterThanOrEqual(0);
  });
});

describe("rankBids", () => {
  it("returns an empty ranking for no bids", () => {
    const ledger = createReputationLedger();
    expect(rankBids([], ledger)).toEqual([]);
  });

  it("ranks a lone bid first", () => {
    const ledger = createReputationLedger();
    const [only] = rankBids([{ runnerId: "solo", price: "2.00" }], ledger);
    expect(only.rank).toBe(1);
  });

  it("prefers the cheaper bid when reputations are equal", () => {
    const ledger = createReputationLedger();
    const ranked = rankBids(
      [
        { runnerId: "a", price: "5.00" },
        { runnerId: "b", price: "1.00" },
      ],
      ledger
    );
    expect(ranked[0].runnerId).toBe("b");
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it("lets reputation outweigh a small price gap", () => {
    const ledger = createReputationLedger();
    // Trusted veteran vs. cheap unknown.
    for (let i = 0; i < 20; i++) ledger.recordCompletion("veteran", 3_000);

    const ranked = rankBids(
      [
        { runnerId: "veteran", price: "2.00" },
        { runnerId: "newbie", price: "1.90" },
      ],
      ledger
    );
    expect(ranked[0].runnerId).toBe("veteran");
  });

  it("lets a big price gap outweigh reputation", () => {
    const ledger = createReputationLedger();
    for (let i = 0; i < 20; i++) ledger.recordCompletion("veteran", 3_000);

    const ranked = rankBids(
      [
        { runnerId: "veteran", price: "50.00" },
        { runnerId: "newbie", price: "1.00" },
      ],
      ledger
    );
    expect(ranked[0].runnerId).toBe("newbie");
  });

  it("rejects invalid prices", () => {
    const ledger = createReputationLedger();
    expect(() =>
      rankBids([{ runnerId: "x", price: "lots" }], ledger)
    ).toThrow(/invalid bid price/);
  });
});
