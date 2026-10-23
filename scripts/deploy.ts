#!/usr/bin/env bun
import { hostname, tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = '/var/www/yangle';
const service = 'yangle.service';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let host = hostname().split('.')[0] === 'pronix' ? 'local' : 'ros';
let dryRun = false;
const cliArgs = Bun.argv.slice(2);
for (let i = 0; i < cliArgs.length; i++) {
	if (cliArgs[i] === '--local') host = 'local';
	else if (cliArgs[i] === '--host') {
		const next = cliArgs[++i];
		if (!next || next.startsWith('-')) process.exit(2);
		host = next;
	} else if (cliArgs[i] === '--dry-run') dryRun = true;
	else if (cliArgs[i] === '--help' || cliArgs[i] === '-h') {
		console.log('Usage: bun run deploy [--local | --host SSH_HOST] [--dry-run]');
		process.exit(0);
	} else {
		console.error(`Unknown option: ${cliArgs[i]}`);
		process.exit(2);
	}
}

async function run(command: string[], input?: string, capture = false): Promise<string> {
	const proc = Bun.spawn(command, {
		cwd: project,
		stdin: input === undefined ? 'inherit' : new Blob([input]),
		stdout: capture ? 'pipe' : 'inherit',
		stderr: 'inherit'
	});
	const output = capture ? await new Response(proc.stdout).text() : '';
	const code = await proc.exited;
	if (code !== 0) throw new Error(`Command failed (${code}): ${command.join(' ')}`);
	return output.trim();
}
function remote(script: string, capture = false): Promise<string> {
	if (host === 'local') return run(['bash', '-seuo', 'pipefail'], script, capture);
	const destination = host === 'ros' ? 'root@rizinos.com' : host;
	return run(
		['ssh', '-F', '/dev/null', '-o', 'ConnectTimeout=10', '--', destination, 'bash -seuo pipefail'],
		script,
		capture
	);
}

function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function databaseCommand(action: 'snapshot' | 'install', token: string): string {
	const helper = readFileSync(new URL('./deployDatabase.ts', import.meta.url), 'utf8');
	return `cd ${target}
data_dir=$(systemctl show ${service} -p Environment --value | xargs -r -n 1 printf '%s\\n' | sed -n 's/^DATA_DIR=//p')
if [[ -n $data_dir ]]; then export DATA_DIR="$data_dir"; else unset DATA_DIR; fi
bun --eval ${quote(`${helper}\ndeployDatabase(${JSON.stringify(action)}, ${JSON.stringify(token)});`)}`;
}

function databaseLocation(path: string): string {
	if (host === 'local') return path;
	return `${host === 'ros' ? 'root@rizinos.com' : host}:${path}`;
}

async function main(): Promise<void> {
	await remote(`test -w ${target}
command -v bun >/dev/null
command -v rsync >/dev/null
bun_version=$(bun --version)
bun_major=\${bun_version%%.*}
bun_minor=\${bun_version#*.}
bun_minor=\${bun_minor%%.*}
if (( bun_major < 1 || (bun_major == 1 && bun_minor < 4) )); then echo "Bun 1.4 or newer is required (found $bun_version)." >&2; exit 1; fi
case "$(systemctl show ${service} -p ExecStart --value)" in *' ./index.js '*) ;; *) echo 'Activate the updated NixOS configuration (bun ./index.js) before deploying.' >&2; exit 1 ;; esac
if [[ $(id -u) != 0 ]]; then sudo -n -l systemctl stop ${service} >/dev/null; sudo -n -l systemctl restart ${service} >/dev/null; fi`);
	const build = Bun.spawn(['bun', 'run', 'build'], {
		cwd: project,
		env: { ...process.env, ORIGIN: process.env.ORIGIN ?? 'https://yangle.ileies.de' },
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit'
	});
	const buildStatus = await build.exited;
	if (buildStatus !== 0) throw new Error(`Build failed (${buildStatus})`);
	await run(['test', '-f', 'build/index.js']);
	const sync = [
		'-az',
		'--delete',
		'--itemize-changes',
		'--include=/client/***',
		'--include=/server/***',
		'--include=/prerendered/***',
		// Remove artifacts from the previous server-side migration deployment.
		'--include=/drizzle/***',
		'--include=/*.js',
		'--include=/*.js.map',
		'--exclude=*'
	];
	let dest = `${target}/`;
	if (host !== 'local') {
		const destination = host === 'ros' ? 'root@rizinos.com' : host;
		sync.push('-e', 'ssh -F /dev/null -o ConnectTimeout=10');
		dest = `${destination}:${target}/`;
	}
	if (dryRun) {
		await run(['rsync', ...sync, '--dry-run', '--', 'build/', dest]);
		await run(['rsync', '-az', '--dry-run', '--', 'package.json', 'bun.lock', dest]);
		console.log(
			'Would migrate the production database, sync the build, install dependencies and restart.'
		);
		return;
	}
	const scratch = mkdtempSync(join(tmpdir(), 'yangle-deploy-'));
	const token = crypto.randomUUID();
	const transfer = ['rsync', '-az', '-s'];
	if (host !== 'local') transfer.push('-e', 'ssh -F /dev/null -o ConnectTimeout=10');
	let stopped = false;
	let failure: unknown;
	try {
		await remote(
			`if [[ $(id -u) == 0 ]]; then systemctl stop ${service}; else sudo -n systemctl stop ${service}; fi`
		);
		stopped = true;
		const staging: unknown = JSON.parse(await remote(databaseCommand('snapshot', token), true));
		if (typeof staging !== 'string' || !staging.startsWith('/') || staging.includes('\n')) {
			throw new Error('Invalid production database path');
		}
		console.log(`Production database snapshot: ${staging}/original.db`);
		const candidate = join(scratch, 'migrated.db');
		await run([...transfer, '--', databaseLocation(`${staging}/original.db`), candidate]);
		await run(['bun', 'scripts/migrate.ts', candidate]);
		await run([...transfer, '--', candidate, databaseLocation(`${staging}/migrated.db`)]);
		await run(['rsync', ...sync, '--', 'build/', dest]);
		await run(['rsync', '-az', '--', 'package.json', 'bun.lock', dest]);
		await remote(`cd ${target} && bun install --production --frozen-lockfile`);
		await remote(databaseCommand('install', token));
	} catch (error) {
		failure = error;
	} finally {
		try {
			rmSync(scratch, { recursive: true, force: true });
		} catch (error) {
			if (failure === undefined) failure = error;
		}
	}
	try {
		if (stopped) {
			await remote(
				`if [[ $(id -u) == 0 ]]; then systemctl restart ${service}; else sudo -n systemctl restart ${service}; fi`
			);
		}
	} catch (error) {
		if (failure === undefined) failure = error;
	}
	if (failure !== undefined) throw failure;
	await remote(`systemctl is-active --quiet ${service}
for attempt in {1..20}; do code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3007/ || true); case "$code" in 200|302|303|307|308) exit 0 ;; esac; sleep 1; done
echo 'Yangle did not become healthy; inspect journalctl -u ${service}.' >&2
exit 1`);
	console.log(`Deployed to ${host}:${target}`);
}
main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
