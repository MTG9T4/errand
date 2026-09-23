/**
 * Runner reputation ledger for the Errand marketplace.
 *
 * When several runners bid on the same errand, price alone is a bad way to
 * choose — the cheapest runner that never delivers is the most expensive one.
 * This ledger tracks what actually happened (completions, failures, speed)
 * and `rankBids` combines price with reputation so posters pick the bid most
 * likely to deliver value.
 *
 * Scoring (all components in [0, 1], higher is better):
 *   - success rate: Laplace-smoothed, so new runners start near the middle
 *     instead of at 0 or 1: (completions + 1) / (total + 2)
 *   - volume factor: total / (total + 5) — ramps toward 1 as the runner
 *     proves itself; a handful of errands is enough to count
 *   - speed factor: 1 / (1 + avgLatencyMs / 60000) — decays gently as the
 *     runner gets slower than ~1 minute per errand
 *   - score = successRate * (0.4 + 0.6 * volumeFactor) * (0.5 + 0.5 * speedFactor)
 *
 * In-memory only, like the escrow adapter. A production marketplace would
 * persist this per runner identity (wallet address).
 */

export interface RunnerStats {
  runnerId: string;
  completions: number;
  failures: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  lastActiveAt: number;
}

export interface Bid {
  runnerId: string;
  /** Decimal price string, e.g. "1.75" (USDC). */
  price: string;
}

export interface RankedBid extends Bid {
  rank: number;
  reputation: number;
  /** Blended cost used for ordering — lower wins. */
  score: number;
}

const VOLUME_HALF_LIFE = 5; // errands needed for volume factor to approach 1
const SPEED_REFERENCE_MS = 60_000; // ~1 minute per errand is "normal" speed

export function createReputationLedger() {
  const stats = new Map<string, RunnerStats>();

  function getOrCreate(runnerId: string): RunnerStats {
    let s = stats.get(runnerId);
    if (!s) {
      s = {
        runnerId,
        completions: 0,
        failures: 0,
        totalLatencyMs: 0,
        averageLatencyMs: 0,
        lastActiveAt: 0,
      };
      stats.set(runnerId, s);
    }
    return s;
  }

  /** Record a completed errand and how long it took end-to-end. */
  function recordCompletion(runnerId: string, latencyMs: number): RunnerStats {
    const s = getOrCreate(runnerId);
    s.completions += 1;
    s.totalLatencyMs += Math.max(0, latencyMs);
    s.averageLatencyMs = s.totalLatencyMs / s.completions;
    s.lastActiveAt = Date.now();
    return { ...s };
  }

  /** Record an errand the runner failed or abandoned. */
  function recordFailure(runnerId: string): RunnerStats {
    const s = getOrCreate(runnerId);
    s.failures += 1;
    s.lastActiveAt = Date.now();
    return { ...s };
  }

  function getStats(runnerId: string): RunnerStats | undefined {
    const s = stats.get(runnerId);
    return s ? { ...s } : undefined;
  }

  /**
   * Reputation score in [0, 1]. New runners start around ~0.2 (smoothed),
   * proven fast runners approach 1, chronic failures sink toward 0.
   */
  function getScore(runnerId: string): number {
    const s = stats.get(runnerId);
    // Unknown runner: same prior as a brand-new ledger entry
    // (successRate 1/2, volume 0, speed 1 -> 0.5 * 0.4 * 1.0 = 0.2).
    if (!s) return 0.2;
    const total = s.completions + s.failures;
    const successRate = (s.completions + 1) / (total + 2);
    const volumeFactor = total / (total + VOLUME_HALF_LIFE);
    const speedFactor = 1 / (1 + s.averageLatencyMs / SPEED_REFERENCE_MS);
    return successRate * (0.4 + 0.6 * volumeFactor) * (0.5 + 0.5 * speedFactor);
  }

  return { recordCompletion, recordFailure, getStats, getScore };
}

export type ReputationLedger = ReturnType<typeof createReputationLedger>;

/**
 * Rank bids cheapest-and-most-reliable first.
 *
 * Both price and reputation are min-max normalized across the bid set, then
 * blended: cost = 0.6 * normPrice + 0.4 * (1 - normReputation). A single bid
 * always ranks first. Ties break on lower price, then runner id for
 * determinism.
 */
export function rankBids(
  bids: Bid[],
  ledger: Pick<ReputationLedger, "getScore">
): RankedBid[] {
  if (bids.length === 0) return [];

  const prices = bids.map((b) => {
    const p = Number(b.price);
    if (!Number.isFinite(p) || p < 0) {
      throw new Error(`reputation: invalid bid price "${b.price}"`);
    }
    return p;
  });
  const reputations = bids.map((b) => ledger.getScore(b.runnerId));

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minRep = Math.min(...reputations);
  const maxRep = Math.max(...reputations);

  // Price is normalized as the *relative premium* over the cheapest bid, so
  // a 5% premium barely registers while a 50x premium dominates — min-max
  // would wrongly treat any gap, however small, as decisive.
  // Reputation is min-max normalized across the bid set.
  const normPrice = (p: number) =>
    minPrice > 0
      ? (p - minPrice) / minPrice
      : maxPrice === minPrice
        ? 0
        : (p - minPrice) / (maxPrice - minPrice);
  const normRep = (r: number) => (maxRep === minRep ? 0 : (r - minRep) / (maxRep - minRep));

  return bids
    .map((bid, i) => {
      const priceComponent = normPrice(prices[i]);
      const repComponent = 1 - normRep(reputations[i]);
      const score = 0.6 * priceComponent + 0.4 * repComponent;
      return { ...bid, rank: 0, reputation: reputations[i], score };
    })
    .sort(
      (a, b) =>
        a.score - b.score ||
        Number(a.price) - Number(b.price) ||
        (a.runnerId < b.runnerId ? -1 : 1)
    )
    .map((b, i) => ({ ...b, rank: i + 1 }));
}
