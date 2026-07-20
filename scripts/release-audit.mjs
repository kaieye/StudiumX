import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const root = resolve(process.cwd());
const args = process.argv.slice(2); const oi = args.indexOf('--output');
const output = oi >= 0 ? resolve(root, args[oi + 1]) : resolve(mkdtempSync(resolve(tmpdir(), 'studiumx-release-audit-')), 'p0-clean-checkout-audit.json');
const run = (argv, cwd) => { const started = Date.now(); const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding:'utf8', shell: process.platform === 'win32' }); return { argv, exit:r.status ?? 1, durationMs:Date.now()-started, stdout:r.stdout ?? '', stderr:r.stderr ?? '' }; };
const git = (a,cwd=root) => run(['git',...a],cwd);
const before = git(['status','--porcelain=v1']); if (before.stdout.trim()) { console.error('release audit requires clean source worktree'); process.exit(2); }
const sha = git(['rev-parse','HEAD']).stdout.trim();
const worktreeParent = mkdtempSync(resolve(tmpdir(),'studiumx-release-audit-worktree-'));
const worktree = resolve(worktreeParent, 'checkout');
const add = git(['worktree','add','--detach',worktree,sha]); if (add.exit !== 0) { console.error(add.stderr); process.exit(2); }
const logDir = mkdtempSync(resolve(tmpdir(),'studiumx-release-audit-')); const knownSkip=/POSIX|descriptor-relative|FIFO|platform capability|win32/i;
const commands = [
 ['pnpm','install','--frozen-lockfile'], ['pnpm','run','typecheck'], ['pnpm','run','test:unit'], ['pnpm','run','test:integration'], ['pnpm','run','build'],
 ['pnpm','run','check:security'], ['pnpm','run','check:provider-privacy'], ['pnpm','run','check:repository-hygiene'], ['git','diff','--check'],
 ['node','scripts/check-learning-outcome-committer.mjs'], ['node','scripts/check-learning-outcome-recovery.mjs'], ['node','scripts/check-learning-record-read-repair.mjs'],
 ['pnpm','exec','playwright','test','tests/e2e/teaching-learning-loop.e2e.spec.ts','--project','electron-e2e','--repeat-each=3']
];
const results=[]; let failed=false;
try {
 for (const argv of commands) { const r=run(argv,worktree); const i=results.length; const out=resolve(logDir,`${i}.stdout`), err=resolve(logDir,`${i}.stderr`); writeFileSync(out,r.stdout); writeFileSync(err,r.stderr); const skips=[...(r.stdout+'\n'+r.stderr).matchAll(/(?:skip(?:ped)?|todo)[:\-]?\s*([^\n]+)/gi)].map(m=>m[1].trim()); const unknownSkips=skips.filter(s=>!knownSkip.test(s)); results.push({argv,exit:r.exit,durationMs:r.durationMs,stdoutFile:out,stderrFile:err,stdoutSha256:createHash('sha256').update(readFileSync(out)).digest('hex'),stderrSha256:createHash('sha256').update(readFileSync(err)).digest('hex'),skips,unknownSkips}); if(r.exit!==0||unknownSkips.length){failed=true;break;} }
} finally { git(['worktree','remove','--force',worktree]); }
const artifact={path:output,sha256:null,sha256Basis:'SHA-256 of manifest bytes with artifact.sha256 set to null'};
const audit={schemaVersion:2,generatedAt:new Date().toISOString(),commitSha:sha,sourceWorktree:root,cleanCheckout:{path:worktree,detached:true,sha},commands:results,artifact,passed:!failed};
mkdirSync(dirname(output),{recursive:true}); const basis=JSON.stringify(audit,null,2)+'\n'; artifact.sha256=createHash('sha256').update(basis).digest('hex'); writeFileSync(output,JSON.stringify(audit,null,2)+'\n');
if(failed){console.error('release audit failed'); process.exitCode=1;} console.log(output);

