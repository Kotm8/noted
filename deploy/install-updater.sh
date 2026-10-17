#!/bin/sh
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
    printf '%s\n' 'Run the updater installation as root.' >&2
    exit 1
fi

repository=${1:?Usage: sh install-updater.sh owner/repository [/opt/noted]}
installation=${2:-/opt/noted}
case "$installation" in
    /*) ;;
    *) printf '%s\n' 'Use an absolute installation directory.' >&2; exit 1 ;;
esac
case "$installation" in
    *[!a-zA-Z0-9/_-]*) printf '%s\n' 'Use an installation path without spaces or special characters.' >&2; exit 1 ;;
esac

source_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or later is required"'
docker compose version >/dev/null
command -v ssh >/dev/null
command -v ssh-keyscan >/dev/null
systemctl --version >/dev/null
test -f "$installation/.env"
test -f "$installation/compose.production.yaml"
if systemctl is-active --quiet noted-updater.service; then
    printf '%s\n' 'The updater is already running. Stop it during an idle maintenance window before replacing its code.' >&2
    exit 1
fi
python3 - "$installation" "$repository" <<'PY'
import json
import pathlib
import sys
control = pathlib.Path(sys.argv[1]) / 'updater'
job = control / 'state/job.json'
if job.exists() and json.loads(job.read_text()).get('status') in {'queued', 'running', 'needs_recovery'}:
    raise SystemExit('Finish or recover the existing update before replacing the worker.')
host_job = control / 'state/host-job.json'
if host_job.exists() and json.loads(host_job.read_text()).get('status') in {'queued', 'running', 'waiting_dns', 'needs_recovery'}:
    raise SystemExit('Finish or recover the host operation before replacing the worker.')
configuration = control / 'config.json'
if configuration.exists() and json.loads(configuration.read_text())['repository'] != sys.argv[2].lower():
    raise SystemExit('Keep the configured repository identity.')
PY

mkdir -p "$installation/updater/code"
cp -R "$source_directory/noted_updater" "$installation/updater/code/"
if [ ! -f "$installation/updater/config.json" ]; then
    PYTHONPATH="$installation/updater/code" python3 -m noted_updater configure --directory "$installation" --repository "$repository"
fi

cat > /etc/systemd/system/noted-updater.service <<EOF
[Unit]
Description=Noted server update worker
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$installation/updater/code
ExecStart=/usr/bin/python3 -m noted_updater run --config $installation/updater/config.json
Restart=on-failure
RestartSec=5
UMask=0077
TimeoutStopSec=60

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now noted-updater.service
printf '%s\n' 'Update worker started. Open Settings > Server > Updates.'
