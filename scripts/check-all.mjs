#!/usr/bin/env node
// Runs every `check:*` script in package.json in one pass and prints only what failed.
//
// Copied from the website's scripts/check-all.mjs (same discovery, same
// self-exclusion by resolved path, same failures-only output) with one addition:
// a loud pre-flight. Every check here leans on the website checkout and on the
// built engine bundle, and a missing prerequisite must read as a red result,
// never as a quiet "0 checks ran" green.
//
//   node scripts/check-all.mjs              # all checks, failures only
//   node scripts/check-all.mjs --only packs # only checks whose name matches
//   node scripts/check-all.mjs --verbose    # show output from passing checks too
//   node scripts/check-all.mjs --jobs 1     # serial, for debugging
//
// Exit code is the thing to read: 0 = all green, 1 = at least one failure.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { cpus } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name, fallback) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}

const VERBOSE = flag('--verbose') || flag('-v')
const ONLY = value('--only', null)
const JOBS = Math.max(1, Number(value('--jobs', Math.min(4, cpus().length))) || 1)
const TAIL = Math.max(1, Number(value('--tail', 15)) || 15)

// ---- pre-flight ------------------------------------------------------------
const WEB = resolve(process.env.SHADOWBASE_WEBSITE ?? join(ROOT, '..', 'ShadowBase Website'))
const ENGINE = resolve(process.env.ENGINE_BUNDLE ?? join(ROOT, 'engine', 'shadowbase-engine.mjs'))
const preflight = []
if (!existsSync(join(WEB, 'package.json'))) preflight.push(`website checkout not found at ${WEB} (set SHADOWBASE_WEBSITE)`)
else if (!existsSync(join(WEB, 'node_modules', 'jiti'))) preflight.push(`website has no node_modules/jiti - run npm ci in ${WEB}`)
if (!existsSync(ENGINE)) preflight.push(`engine bundle missing at ${ENGINE} - run npm run build:engine`)
if (!existsSync(join(ROOT, 'node_modules', 'esbuild'))) preflight.push(`this repo has no node_modules - run npm install here`)
if (preflight.length) {
  console.error('check-all: pre-flight failed')
  for (const p of preflight) console.error('  - ' + p)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const SELF = fileURLToPath(import.meta.url)

// Discovery is the UNION of package.json's check:* scripts and every
// scripts/check-*.mjs on disk. A check a unit added but forgot to register
// still runs (and is reported as unregistered), so "check-all green" can never
// be vacuous because the runner did not know about a file.
const registered = Object.entries(pkg.scripts ?? {})
  .filter(([name]) => name.startsWith('check:'))
  .map(([name, cmd]) => {
    const m = /^node\s+(\S+\.mjs)\s*(.*)$/.exec(cmd.trim())
    return m ? { name, file: m[1], args: m[2] ? m[2].split(/\s+/) : [] } : { name, cmd }
  })
const registeredFiles = new Set(registered.filter((c) => c.file).map((c) => resolve(ROOT, c.file)))
const onDisk = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => /^check-.*\.mjs$/.test(f))
  .map((f) => ({ name: `check:${f.replace(/^check-/, '').replace(/\.mjs$/, '')} (unregistered)`, file: `scripts/${f}`, args: [] }))
  .filter((c) => !registeredFiles.has(resolve(ROOT, c.file)))
const checks = [...registered, ...onDisk]
  // Never run this runner: it is itself a check:* script, and a name test would
  // go stale the moment the alias were renamed (see the website's 511-process story).
  .filter((c) => !c.file || resolve(ROOT, c.file) !== SELF)
  .filter((c) => !ONLY || c.name.includes(ONLY))

if (checks.length === 0) {
  console.error(`check-all: no check:* scripts matched${ONLY ? ` --only ${ONLY}` : ''} - that is a failure, not a pass`)
  process.exit(1)
}

const run = (c) => new Promise((done) => {
  const t0 = Date.now()
  const child = c.file
    ? spawn(process.execPath, [resolve(ROOT, c.file), ...c.args], { cwd: ROOT, env: process.env })
    : spawn(c.cmd, { cwd: ROOT, shell: true, env: process.env })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  child.on('close', (code) => done({ ...c, code, out, ms: Date.now() - t0 }))
  child.on('error', (err) => done({ ...c, code: 1, out: String(err), ms: Date.now() - t0 }))
})

const results = []
let next = 0
await Promise.all(Array.from({ length: Math.min(JOBS, checks.length) }, async () => {
  while (next < checks.length) {
    const c = checks[next++]
    results.push(await run(c))
  }
}))

results.sort((a, b) => a.name.localeCompare(b.name))
let failed = 0
for (const r of results) {
  if (r.code === 0) {
    if (VERBOSE) console.log(`ok   ${r.name} (${r.ms} ms)\n${r.out.trimEnd()}\n`)
    continue
  }
  failed++
  const lines = r.out.trimEnd().split('\n')
  const tail = lines.slice(-TAIL).join('\n')
  console.log(`FAIL ${r.name} (exit ${r.code}, ${r.ms} ms)\n${tail}\n`)
}
console.log(`${results.length - failed}/${results.length} checks green${failed ? `, ${failed} failed` : ''}`)
process.exit(failed ? 1 : 0)
