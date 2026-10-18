/**
 * The package resolves by its own name.
 *
 * `tsc` keeps the source layout under `dist/` (rootDir is the package root, so
 * the hand-written core lands in `dist/src/`), but `main` pointed at
 * `dist/index.js`. Every test and sample imported by relative path or through a
 * tsconfig path mapping, so nothing noticed that `require("@guardiano3/sdk")`
 * failed with MODULE_NOT_FOUND for anyone who installed the package (found
 * 2026-10-14). This test resolves it the way a consumer does.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

// Compiled to dist/tests/, so the package root is two levels up.
const root = resolve(__dirname, "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("main and types point at files the build emits", () => {
  assert.ok(existsSync(join(root, pkg.main)), `main ${pkg.main} does not exist`);
  assert.ok(existsSync(join(root, pkg.types)), `types ${pkg.types} does not exist`);
});

test("requiring the package root exposes the client", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require(root);
  assert.equal(typeof sdk.Guardiano3, "function");
  assert.equal(typeof sdk.LiveSession, "function");
});
