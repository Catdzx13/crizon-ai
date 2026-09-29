#!/usr/bin/env node
import { main } from "../src/main.mjs";

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = Number.isInteger(code) ? code : 0;
  },
  (err) => {
    console.error(err?.stack || String(err));
    process.exitCode = 1;
  },
);
