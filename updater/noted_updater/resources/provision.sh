#!/bin/sh
set -eu
umask 077
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
docker compose version >/dev/null
systemctl is-active --quiet docker
mkdir -m 700 /opt/noted
