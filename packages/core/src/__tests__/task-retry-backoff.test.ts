import { describe, it, expect } from "vitest";
import { TaskRunner, task } from "../market/task";
import { Logger } from "../io/logger";

function quietRunner(concurrency = 1) {
  // Logger with no transports keeps test output clean; default options work.
  return new TaskRunner(concurrency, new Logger({ styled: false }));
}

describe("task runner — self-healing exponential backoff", () => {
  it("retries with exponential backoff and eventually succeeds", async () => {
    const runner = quietRunner();
    let attempts = 0;

    const flaky = task({
      key: "flaky-errand",
      handler: async () => {
        attempts++;
        if (attempts < 3) throw new Error("downstream flapping");
        return "done";
      },
    });

    const started = Date.now();
    const result = await runner.enqueueTask(flaky, undefined, {
      retry: 5,
      retryBaseMs: 20,
      retryMaxMs: 1_000,
      retryJitter: false, // deterministic timing for the test
    });
    const elapsed = Date.now() - started;

    expect(result).toBe("done");
    expect(attempts).toBe(3);
    // Backoff before attempt 2 = 20ms, before attempt 3 = 40ms -> >= 60ms total.
    expect(elapsed).toBeGreaterThanOrEqual(55);
  });

  it("gives up after the retry budget is exhausted", async () => {
    const runner = quietRunner();
    let attempts = 0;

    const hopeless = task({
      key: "hopeless-errand",
      handler: async () => {
        attempts++;
        throw new Error("always fails");
      },
    });

    await expect(
      runner.enqueueTask(hopeless, undefined, {
        retry: 2,
        retryBaseMs: 10,
        retryJitter: false,
      })
    ).rejects.toThrow("always fails");
    // 1 initial attempt + 2 retries
    expect(attempts).toBe(3);
  });

  it("does not retry when no retry option is set", async () => {
    const runner = quietRunner();
    let attempts = 0;

    const once = task({
      key: "once-errand",
      handler: async () => {
        attempts++;
        throw new Error("boom");
      },
    });

    await expect(runner.enqueueTask(once, undefined)).rejects.toThrow("boom");
    expect(attempts).toBe(1);
  });

  it("caps the backoff at retryMaxMs", async () => {
    const runner = quietRunner();
    const delays: number[] = [];
    let last = Date.now();
    let attempts = 0;

    const slow = task({
      key: "slow-errand",
      handler: async () => {
        attempts++;
        const now = Date.now();
        if (attempts > 1) delays.push(now - last);
        last = now;
        if (attempts < 4) throw new Error("flap");
        return "ok";
      },
    });

    const result = await runner.enqueueTask(slow, undefined, {
      retry: 5,
      retryBaseMs: 1_000,
      retryMaxMs: 50,
      retryJitter: false,
    });

    expect(result).toBe("ok");
    expect(delays).toHaveLength(3);
    // Every delay must respect the 50ms cap (with scheduling slack).
    for (const d of delays) {
      expect(d).toBeLessThan(200);
    }
  });
});
