#!/bin/sh
set -eu
umask 077
test "$(id -u)" = 0 || exit 30
test "$(uname -m)" = x86_64 || exit 31
. /etc/os-release
case "$ID:$VERSION_ID" in ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;; *) exit 32 ;; esac
test -d /run/systemd/system || exit 33
if test -e /opt/noted; then
    test -f /opt/noted/.setup-id || exit 34
    test "$(cat /opt/noted/.setup-id)" = "$NOTED_SETUP_ID" || exit 34
else
    if command -v ss >/dev/null; then
        if ss -ltnH | awk '{print $4}' | grep -Eq ':(80|443)$'; then exit 35; fi
    else
        exit 36
    fi
    if command -v docker >/dev/null; then
        test -z "$(docker ps -aq --filter label=com.docker.compose.project=noted)" || exit 34
        test -z "$(docker volume ls -q --filter label=com.docker.compose.project=noted)" || exit 34
    fi
fi
if command -v docker >/dev/null; then
    docker compose version >/dev/null || exit 37
    systemctl is-active --quiet docker || exit 38
fi
test "$(df -Pk /opt | awk 'NR==2 {print $4}')" -gt 2097152 || exit 39
if test "${NOTED_SETUP_CHECK_ONLY:-0}" = 1; then exit 0; fi
if ! test -d /opt/noted; then
    mkdir -m 700 /opt/noted
    printf '%s' "$NOTED_SETUP_ID" > /opt/noted/.setup-id
fi
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=l
if ! command -v docker >/dev/null; then
    apt-get update -qq
    apt-get install -y ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    curl --fail --retry 3 "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/noted-docker.asc
    chmod a+r /etc/apt/keyrings/noted-docker.asc
    cat > /etc/apt/sources.list.d/noted-docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $VERSION_CODENAME
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/noted-docker.asc
EOF
    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
packages=""
if ! command -v python3 >/dev/null; then packages="$packages python3"; fi
if ! command -v ssh >/dev/null; then packages="$packages openssh-client"; fi
if test -n "$packages"; then
    apt-get update -qq
    apt-get install -y $packages
fi
python3 -c 'import sys; assert sys.version_info >= (3,11)'
docker compose version >/dev/null
systemctl is-active --quiet docker
