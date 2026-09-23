#!/usr/bin/env node
import { runErrandCli } from "./post";

const code = await runErrandCli(process.argv.slice(2));
process.exit(code);
