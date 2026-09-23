import {
  createContainer,
  createErrand,
  LogLevel,
  Logger,
} from "@errand/core";

import { anthropic } from "@ai-sdk/anthropic";

import { discord } from "@errand/discord";

const container = createContainer();

const agent = createErrand({
  logger: new Logger({ level: LogLevel.DEBUG }),
  model: anthropic("claude-3-7-sonnet-latest"),
  extensions: [discord],
  container,
});

console.log("Starting Errand Discord Bot...");
await agent.start();
console.log("Errand Discord Bot started");
