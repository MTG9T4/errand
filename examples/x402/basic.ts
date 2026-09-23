import { createErrandRouterAuth } from "@errand/ai-sdk-provider";
import { context, createErrand, LogLevel } from "@errand/core";
import { cliExtension } from "@errand/cli";
import { privateKeyToAccount } from "viem/accounts";

const { errandRouter, user } = await createErrandRouterAuth(
  privateKeyToAccount(Bun.env.PRIVATE_KEY as `0x${string}`),
  {
    payments: {
      amount: "100000", // $0.10 USDC
      network: "base-sepolia",
    },
  }
);

export const chatContext = context({
  type: "chat",
  maxSteps: 100,
  // schema: z.object({ chatId: z.string() }),
  key: (args) => args.chatId,
  render() {
    const date = new Date();
    return `\
Current ISO time is: ${date.toISOString()}, timestamp: ${date.getTime()}`;
  },
});

console.log("user", user.balance);

createErrand({
  logLevel: LogLevel.DEBUG,
  model: errandRouter("google-vertex/gemini-2.5-flash"),
  extensions: [cliExtension],
}).start();
