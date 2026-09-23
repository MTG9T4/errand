/**
 * Errand marketplace demo — the full loop in one file:
 *
 *   post an errand -> runners bid -> best bid wins (price x reputation)
 *   -> bid accepted (bounty locks in escrow) -> runner works the errand
 *   (self-healing retries with exponential backoff) -> settle (bounty
 *   releases to the runner) -> reputation recorded.
 *
 * Run with: bun examples/marketplace-demo.ts
 * (or: npx tsx examples/marketplace-demo.ts)
 */
import {
  createEscrow,
  createReputationLedger,
  rankBids,
  TaskRunner,
  task,
  Logger,
} from "@errand/core";

const log = (...args: unknown[]) => console.log("🏃", ...args);

async function main() {
  // ---- 1. The market opens ----
  const escrow = createEscrow({ defaultTimeoutMs: 60_000 });
  const ledger = createReputationLedger();
  const poster = "alice";

  // A veteran with history, and two unknowns.
  for (let i = 0; i < 12; i++) ledger.recordCompletion("runner-veteran", 4_000);
  ledger.recordFailure("runner-flaky");
  ledger.recordFailure("runner-flaky");

  const errand = {
    id: "err_demo_1",
    task: "Summarize the Errand README in 3 bullet points",
    bounty: "2.50",
    currency: "USDC",
  };
  log(`"${poster}" posts errand: "${errand.task}" — bounty ${errand.bounty} ${errand.currency}`);

  // ---- 2. Runners bid; price x reputation decides ----
  const bids = [
    { runnerId: "runner-veteran", price: "2.40" },
    { runnerId: "runner-newbie", price: "2.10" },
    { runnerId: "runner-flaky", price: "1.90" },
  ];
  const ranked = rankBids(bids, ledger);
  for (const b of ranked) {
    log(
      `bid #${b.rank}: ${b.runnerId} @ ${b.price} ${errand.currency} ` +
        `(reputation ${b.reputation.toFixed(2)})`
    );
  }
  const winner = ranked[0];
  log(`winner: ${winner.runnerId} — best blend of price and reputation`);

  // ---- 3. Bid accepted -> bounty locks in escrow (x402 settlement adapter) ----
  const lock = escrow.lockBounty({
    errandId: errand.id,
    posterId: poster,
    runnerId: winner.runnerId,
    amount: errand.bounty,
    currency: errand.currency,
  });
  log(`escrow lock ${lock.id}: ${lock.amount} ${lock.currency} locked`);

  // ---- 4. The runner works the errand — self-healing on failure ----
  const runner = new TaskRunner(1, new Logger({ styled: false }));
  let attempts = 0;
  const startedAt = Date.now();
  const work = task({
    key: "do-errand",
    handler: async () => {
      attempts++;
      // Simulate a flaky downstream on the first try.
      if (attempts === 1) throw new Error("model API hiccup");
      return "• Errand is the errand marketplace for AI agents\n• Runners bid; escrow settles bounties over x402 rails\n• Reputation keeps the market honest";
    },
  });
  const result = await runner.enqueueTask(work, undefined, {
    retry: 3,
    retryBaseMs: 100, // exponential backoff: 100ms, 200ms, 400ms…
    retryJitter: false,
  });
  const latencyMs = Date.now() - startedAt;
  log(`errand completed after ${attempts} attempt(s) (${latencyMs}ms):\n${result}`);

  // ---- 5. Settle -> bounty releases; reputation recorded ----
  const released = escrow.release(lock.id);
  log(`settled: ${released.amount} ${released.currency} -> ${winner.runnerId}`);
  ledger.recordCompletion(winner.runnerId, latencyMs);
  log(
    `${winner.runnerId} reputation is now ${ledger.getScore(winner.runnerId).toFixed(2)}`
  );

  // ---- 6. Timeouts refund automatically ----
  const stale = escrow.lockBounty({
    errandId: "err_demo_stale",
    posterId: poster,
    runnerId: "runner-ghost",
    amount: "1.00",
    currency: "USDC",
    timeoutMs: 1, // expires immediately for the demo
  });
  await new Promise((r) => setTimeout(r, 5));
  const refunded = escrow.sweepExpired();
  log(
    `swept ${refunded.length} expired lock(s): ${stale.id} refunded to ${poster}`
  );
}

main().catch((err) => {
  console.error("demo failed:", err);
  process.exit(1);
});
