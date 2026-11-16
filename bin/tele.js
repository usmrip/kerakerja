#!/usr/bin/env node

/**
 * Tele-vs-CLI Entry Point
 * Headless CLI & Telegram task runner for autonomous AI agents.
 */

const { main } = require('../src/cli/index');

main().catch(err => {
  console.error('\n❌ Terjadi kesalahan fatal:');
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
