/**
 * `errand` CLI — post errands and drive them through the marketplace loop.
 *
 * This is a thin shell over @errand/core's market modules (escrow +
 * reputation). Errands and escrow locks persist in `.errand-board.json` in
 * the current directory so the loop survives across invocations:
 *
 *   errand post --task "Summarize this repo" --bounty "2.50"
 *   errand list
 *   errand accept --errand <id> --runner speedy
 *   errand settle --errand <id>
 *
 * Argument parsing is hand-rolled on purpose — no new dependencies.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createEscrow, type Escrow, type EscrowLock } from "@errand/core";

const BOARD_FILE = ".errand-board.json";

type ErrandStatus = "open" | "in-progress" | "settled" | "refunded";

interface BoardErrand {
  id: string;
  task: string;
  bounty: string;
  currency: string;
  posterId: string;
  status: ErrandStatus;
  runnerId?: string;
  escrowLockId?: string;
  createdAt: number;
}

interface Board {
  errands: BoardErrand[];
  locks: EscrowLock[];
}

function boardPath(): string {
  return path.resolve(process.cwd(), BOARD_FILE);
}

function loadBoard(escrow: Escrow): Board {
  const file = boardPath();
  const board: Board = { errands: [], locks: [] };
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
      board.errands = Array.isArray(raw.errands) ? raw.errands : [];
      board.locks = Array.isArray(raw.locks) ? raw.locks : [];
    } catch {
      // Corrupt board: start fresh rather than crash.
    }
  }
  for (const lock of board.locks) {
    try {
      escrow.restore(lock);
    } catch {
      // Already restored; ignore.
    }
  }
  return board;
}

function saveBoard(board: Board): void {
  fs.writeFileSync(boardPath(), JSON.stringify(board, null, 2) + "\n");
}

function nextErrandId(): string {
  return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseArgs(argv: string[]): {
  command: string | undefined;
  flags: Record<string, string | boolean>;
  positionals: string[];
} {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = rest[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { command, flags, positionals };
}

function str(
  flags: Record<string, string | boolean>,
  name: string
): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function usage(): string {
  return [
    "Usage:",
    '  errand post --task "..." --bounty "2.50" [--currency USDC] [--poster NAME]',
    "  errand list",
    "  errand accept --errand <id> --runner <name>",
    "  errand settle --errand <id>",
    "",
    "The marketplace loop: post an errand, a runner's bid is accepted (the",
    "bounty locks in escrow), and settling releases the bounty to the runner.",
  ].join("\n");
}

function cmdPost(
  board: Board,
  flags: Record<string, string | boolean>
): number {
  const taskDesc = str(flags, "task");
  const bounty = str(flags, "bounty");
  if (!taskDesc || !bounty) {
    console.error('errand post requires --task "..." and --bounty "2.50"');
    return 1;
  }
  if (!Number.isFinite(Number(bounty)) || Number(bounty) <= 0) {
    console.error(`errand: invalid bounty "${bounty}"`);
    return 1;
  }
  const errand: BoardErrand = {
    id: nextErrandId(),
    task: taskDesc,
    bounty,
    currency: str(flags, "currency") ?? "USDC",
    posterId: str(flags, "poster") ?? "local-poster",
    status: "open",
    createdAt: Date.now(),
  };
  board.errands.push(errand);
  saveBoard(board);
  console.log(`Posted errand ${errand.id}`);
  console.log(`  task:   ${errand.task}`);
  console.log(`  bounty: ${errand.bounty} ${errand.currency}`);
  console.log(`  status: open — waiting for a runner bid`);
  return 0;
}

function cmdList(board: Board): number {
  if (board.errands.length === 0) {
    console.log("No errands posted yet. Post one with: errand post --task \"...\" --bounty \"2.50\"");
    return 0;
  }
  for (const e of board.errands) {
    const extra =
      e.status === "in-progress" ? ` (runner: ${e.runnerId})` : "";
    console.log(
      `${e.id}  [${e.status}]${extra}  ${e.bounty} ${e.currency}  — ${e.task}`
    );
  }
  return 0;
}

function findErrand(board: Board, id: string): BoardErrand | undefined {
  return board.errands.find((e) => e.id === id || e.id.startsWith(id));
}

function cmdAccept(
  board: Board,
  escrow: Escrow,
  flags: Record<string, string | boolean>
): number {
  const id = str(flags, "errand");
  const runnerId = str(flags, "runner");
  if (!id || !runnerId) {
    console.error("errand accept requires --errand <id> and --runner <name>");
    return 1;
  }
  const errand = findErrand(board, id);
  if (!errand) {
    console.error(`errand: unknown errand "${id}"`);
    return 1;
  }
  if (errand.status !== "open") {
    console.error(`errand: ${errand.id} is ${errand.status}, not open`);
    return 1;
  }
  // Bid accepted -> lock the bounty in escrow (x402 settlement adapter).
  const lock = escrow.lockBounty({
    errandId: errand.id,
    posterId: errand.posterId,
    runnerId,
    amount: errand.bounty,
    currency: errand.currency,
  });
  errand.status = "in-progress";
  errand.runnerId = runnerId;
  errand.escrowLockId = lock.id;
  board.locks = board.locks.filter((l) => l.id !== lock.id);
  board.locks.push({ ...lock });
  saveBoard(board);
  console.log(`Accepted bid from ${runnerId} on ${errand.id}`);
  console.log(`  escrow lock ${lock.id}: ${lock.amount} ${lock.currency} locked`);
  return 0;
}

function cmdSettle(
  board: Board,
  escrow: Escrow,
  flags: Record<string, string | boolean>
): number {
  const id = str(flags, "errand");
  if (!id) {
    console.error("errand settle requires --errand <id>");
    return 1;
  }
  const errand = findErrand(board, id);
  if (!errand) {
    console.error(`errand: unknown errand "${id}"`);
    return 1;
  }
  if (errand.status !== "in-progress" || !errand.escrowLockId) {
    console.error(`errand: ${errand.id} has no locked bounty to settle`);
    return 1;
  }
  const lock = escrow.release(errand.escrowLockId);
  errand.status = "settled";
  const stored = board.locks.find((l) => l.id === lock.id);
  if (stored) stored.status = lock.status;
  saveBoard(board);
  console.log(`Settled ${errand.id}: ${lock.amount} ${lock.currency} released to ${errand.runnerId}`);
  return 0;
}

/** Entry point for the `errand` bin. Returns a process exit code. */
export async function runErrandCli(argv: string[]): Promise<number> {
  const escrow = createEscrow();
  const board = loadBoard(escrow);
  const { command, flags } = parseArgs(argv);

  switch (command) {
    case "post":
      return cmdPost(board, flags);
    case "list":
      return cmdList(board);
    case "accept":
      return cmdAccept(board, escrow, flags);
    case "settle":
      return cmdSettle(board, escrow, flags);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(usage());
      return 0;
    default:
      console.error(`errand: unknown command "${command}"\n`);
      console.error(usage());
      return 1;
  }
}
