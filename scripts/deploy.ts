#!/usr/bin/env bun
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
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

async function run(command: string[], input?: string): Promise<void> {
	const proc = Bun.spawn(command, {
		cwd: project,
		stdin: input === undefined ? 'inherit' : new Blob([input]),
		stdout: 'inherit',
		stderr: 'inherit'
	});
	const code = await proc.exited;
	if (code !== 0) throw new Error(`Command failed (${code}): ${command.join(' ')}`);
}
function remote(script: string): Promise<void> {
	if (host === 'local') return run(['bash', '-seuo', 'pipefail'], script);
	const destination = host === 'ros' ? 'root@rizinos.com' : host;
	return run(
		['ssh', '-F', '/dev/null', '-o', 'ConnectTimeout=10', '--', destination, 'bash -seuo pipefail'],
		script
	);
}

async function main(): Promise<void> {
	await remote(`test -w ${target}
command -v bun >/dev/null
command -v rsync >/dev/null
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
	await run(['test', '-f', 'build/migrate.js']);
	const sync = [
		'-az',
		'--delete',
		'--itemize-changes',
		'--include=/client/***',
		'--include=/server/***',
		'--include=/prerendered/***',
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
	if (dryRun) return run(['rsync', ...sync, '--dry-run', '--', 'build/', dest]);
	await remote(
		`if [[ $(id -u) == 0 ]]; then systemctl stop ${service}; else sudo -n systemctl stop ${service}; fi`
	);
	let failure: unknown;
	try {
		await run(['rsync', ...sync, '--', 'build/', dest]);
		await remote(
			`cd ${target}\ndatabase_url=$(systemctl show ${service} -p Environment --value | tr ' ' '\\n' | sed -n 's/^DATABASE_URL=//p')\nif [[ -z $database_url ]]; then echo 'DATABASE_URL is missing from the systemd service environment.' >&2; exit 1; fi\nDATABASE_URL="$database_url" bun ./migrate.js`
		);
	} catch (error) {
		failure = error;
	}
	try {
		await remote(
			`if [[ $(id -u) == 0 ]]; then systemctl restart ${service}; else sudo -n systemctl restart ${service}; fi`
		);
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
