#!/bin/sh
set -eu
umask 077

ensure_compose() (
    docker compose version >/dev/null 2>&1 && return 0
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq || return 37
    if apt-get install -y --no-remove --no-upgrade --no-install-recommends docker-compose-plugin; then
        docker compose version >/dev/null 2>&1 && return 0
    fi
    apt-get install -y --no-remove --no-upgrade --no-install-recommends ca-certificates curl || return 37
    compose_download=$(mktemp -d) || return 37
    trap 'rm -f "$compose_download/docker-compose-linux-x86_64" "$compose_download/docker-compose-linux-x86_64.sha256"; rmdir "$compose_download"' EXIT
    compose_release=https://github.com/docker/compose/releases/download/v5.6.0
    for compose_asset in docker-compose-linux-x86_64 docker-compose-linux-x86_64.sha256; do
        curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 "$compose_release/$compose_asset" -o "$compose_download/$compose_asset" || return 37
    done
    cd "$compose_download" || return 37
    sha256sum --check docker-compose-linux-x86_64.sha256 || return 37
    install -m 0755 -d /usr/local/lib/docker/cli-plugins || return 37
    install -m 0755 docker-compose-linux-x86_64 /usr/local/lib/docker/cli-plugins/docker-compose || return 37
    docker compose version >/dev/null 2>&1 || return 37
)
test "$(id -u)" = 0
test "$(uname -m)" = x86_64
test ! -e /opt/noted
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) exit 20 ;; esac
if command -v ss >/dev/null; then
    if ss -ltnH | awk '{print $4}' | grep -Eq ':(80|443)$'; then exit 21; fi
fi
if command -v docker >/dev/null; then
    test -z "$(docker ps -aq --filter label=com.docker.compose.project=noted)"
    test -z "$(docker volume ls -q --filter label=com.docker.compose.project=noted)"
else
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    curl --fail --retry 3 "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/noted-docker.asc
    chmod a+r /etc/apt/keyrings/noted-docker.asc
    codename=${UBUNTU_CODENAME:-$VERSION_CODENAME}
    cat > /etc/apt/sources.list.d/noted-docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $codename
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/noted-docker.asc
EOF
    apt-get update -qq
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
export DEBIAN_FRONTEND=noninteractive
apt-get install -y python3 openssh-client
python3 -c 'import shutil, sys; assert sys.version_info >= (3,11); assert shutil.disk_usage("/opt").free > 2147483648'
ensure_compose || exit 37
systemctl is-active --quiet docker
mkdir -m 700 /opt/noted
