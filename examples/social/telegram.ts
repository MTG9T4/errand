import { createGroq } from "@ai-sdk/groq";
import { createErrand, LogLevel } from "@errand/core";
import { telegram } from "@errand/telegram";

const groq = createGroq({});

createErrand({
  logLevel: LogLevel.DEBUG,
  model: groq("deepseek-r1-distill-llama-70b"),
  extensions: [telegram],
}).start();
