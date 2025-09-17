#!/usr/bin/env node

const { ensureDependencies } = require("./src/dependencies");
const { downloadLoop } = require("./src/cli");

async function main() {
  try {
    await ensureDependencies();
    await downloadLoop();
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

process.on("exit", () => {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
});

main();