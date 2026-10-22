#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'HELP'
Usage: bun run deploy [--local | --host SSH_HOST] [--dry-run]

Build here, rsync build/ into /var/www/yangle, migrate, and restart yangle.service.
On pronix deployment is local; elsewhere the default SSH host is ros.
--dry-run builds and previews rsync without changing the running deployment.
HELP
}

host=ros
if [[ $(hostname -s) == pronix ]]; then host=local; fi
dry_run=false
while (($#)); do
	case "$1" in
		--local) host=local; shift ;;
		--host)
			if (($# < 2)) || [[ -z $2 || $2 == -* ]]; then usage >&2; exit 2; fi
			host=$2; shift 2 ;;
		--dry-run) dry_run=true; shift ;;
		--help|-h) usage; exit 0 ;;
		*) usage >&2; exit 2 ;;
	esac
done

project=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
target=/var/www/yangle
service=yangle.service
run_target() {
	if [[ $host == local ]]; then
		bash -seuo pipefail
	else
		ssh -o ConnectTimeout=10 -- "$host" 'bash -seuo pipefail'
	fi
}

# Check before building or stopping the service. No production secrets are copied.
run_target <<'PREFLIGHT'
test -f /var/www/yangle/.env
test -w /var/www/yangle
command -v bun >/dev/null
command -v rsync >/dev/null
case "$(systemctl show yangle.service -p ExecStart --value)" in
	*' ./index.js '*) ;;
	*) echo 'Activate the updated NixOS configuration (bun ./index.js) before deploying.' >&2; exit 1 ;;
esac
if [[ $(id -u) != 0 ]]; then
	sudo -n -l systemctl stop yangle.service >/dev/null
	sudo -n -l systemctl restart yangle.service >/dev/null
fi
PREFLIGHT

cd -- "$project"
bun run build
test -f build/index.js
test -f build/migrate.js

# Only generated artifacts participate in deletion. Environment files, SQLite
# databases, uploads, backups, and all other target files are left alone.
sync_args=(-az --delete --itemize-changes
	--include='/client/***' --include='/server/***' --include='/prerendered/***'
	--include='/drizzle/***' --include='/*.js' --include='/*.js.map' --exclude='*')
destination="$target/"
if [[ $host != local ]]; then
	sync_args+=(-e 'ssh -o ConnectTimeout=10')
	destination="$host:$target/"
fi
if $dry_run; then
	rsync "${sync_args[@]}" --dry-run -- build/ "$destination"
	exit 0
fi

run_target <<'STOP'
if [[ $(id -u) == 0 ]]; then systemctl stop yangle.service
else sudo -n systemctl stop yangle.service; fi
STOP
restart() {
	run_target <<'RESTART'
if [[ $(id -u) == 0 ]]; then systemctl restart yangle.service
else sudo -n systemctl restart yangle.service; fi
RESTART
}
# Bring the service back even if syncing or migration fails; keep the failure status.
trap 'status=$?; trap - EXIT; restart || exit 1; exit "$status"' EXIT
rsync "${sync_args[@]}" -- build/ "$destination"
run_target <<'MIGRATE'
cd /var/www/yangle
bun ./migrate.js
MIGRATE
restart
trap - EXIT
run_target <<'CHECK'
systemctl is-active --quiet yangle.service
for attempt in {1..20}; do
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3007/ || true)
	case "$code" in 200|302|303|307|308) exit 0 ;; esac
	sleep 1
done
echo 'Yangle did not become healthy; inspect journalctl -u yangle.service.' >&2
exit 1
CHECK
printf 'Deployed to %s:%s\n' "$host" "$target"
