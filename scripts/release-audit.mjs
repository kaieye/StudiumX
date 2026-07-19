import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const root = resolve(process.cwd());
const args = process.argv.slice(2);
const outputArg = args.indexOf('--output');
const output = outputArg >= 0 ? resolve(root, args[outputArg + 1]) : resolve(root, 'release/p0-clean-checkout-audit.json');
const commandArgs = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--command') commandArgs.push(args[++i]);
const knownSkip = /POSIX|descriptor-relative|FIFO|platform capability|win32/i;
const run = (argv) => { const t = Date.now(); const r = spawnSync(argv[0], argv.slice(1), { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }); return { argv, exit: r.status ?? 1, durationMs: Date.now()-t, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }; };
const git = (args) => run(['git', ...args]);
const statusBefore = git(['status','--porcelain=v1']);
if (statusBefore.stdout.trim()) { console.error('release audit requires a clean worktree before execution'); process.exit(2); }
const sha = git(['rev-parse','HEAD']).stdout.trim();
const tools = {};
for (const [name, argv] of Object.entries({node:['node','--version'], pnpm:['pnpm','--version'], git:['git','--version']})) { const r = run(argv); tools[name] = { version: r.stdout.trim() || r.stderr.trim(), argv }; }
const commands = commandArgs.length ? commandArgs : ['pnpm install --frozen-lockfile','pnpm run typecheck','pnpm run test:unit','pnpm run build','pnpm run test:integration','pnpm run check:security','git diff --check'];
const results = [];
const logDir = mkdtempSync(resolve(tmpdir(), 'studiumx-release-audit-'));
for (const text of commands) {
  const argv = text.trim().split(/\s+/); const r = run(argv);
  const outPath = resolve(logDir, `${results.length}.stdout`), errPath = resolve(logDir, `${results.length}.stderr`);
  writeFileSync(outPath, r.stdout); writeFileSync(errPath, r.stderr);
  const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const skips = [...(r.stdout+'\n'+r.stderr).matchAll(/(?:skip(?:ped)?|todo)[:\-]?\s*([^\n]+)/gi)].map(m=>m[1].trim());
  const unknownSkips = skips.filter(s => !knownSkip.test(s));
  results.push({ command:text, argv, exit:r.exit, durationMs:r.durationMs, stdoutFile:outPath, stderrFile:errPath, stdoutSha256:hash(outPath), stderrSha256:hash(errPath), skips, unknownSkips });
  if (r.exit !== 0 || unknownSkips.length) { console.error(`release audit failed: ${text}`); process.exitCode = 1; break; }
}
const statusAfter = git(['status','--porcelain=v1']);
const audit = { schemaVersion:1, generatedAt:new Date().toISOString(), commitSha:sha, statusBefore:statusBefore.stdout, statusAfter:statusAfter.stdout, tools, commands:results, knownSkipPolicy:'Only explicit Windows POSIX addon capability skips are allowed; skips never imply green.', passed: process.exitCode !== 1 && !statusAfter.stdout.trim() };
mkdirSync(dirname(output), { recursive:true }); writeFileSync(output, JSON.stringify(audit,null,2)+'\n');
if (statusAfter.stdout.trim()) { console.error('release audit failed: worktree became dirty'); process.exitCode=1; }
console.log(output);



