#!/usr/bin/env bash
# Usage: sudo scripts/install.sh
#
# Installs or updates the Meals host tools from this checkout: the deployer
# user, /opt/server/meals, the scripts, the Compose file, and the systemd
# timers. An update keeps .env, hold, the data, and the backups. The first
# run puts the host on hold, so nothing deploys before you move your data in.
set -euo pipefail

readonly ROOT=/opt/server/meals
repo=$(dirname "$(dirname "$(readlink -f "$0")")")

if [[ $EUID != 0 ]]; then
  echo "Run install.sh as root: sudo scripts/install.sh" >&2
  exit 1
fi
if ! getent group docker >/dev/null; then
  echo "The docker group doesn't exist. Install Docker first." >&2
  exit 1
fi

if ! id deployer >/dev/null 2>&1; then
  useradd --system --gid docker --no-create-home --home-dir /nonexistent \
    --shell /usr/sbin/nologin deployer
  echo "Created the deployer user."
fi

install -d -o root -g docker -m 2775 /opt/server
install -d -o deployer -g docker -m 2775 \
  "$ROOT" "$ROOT/.docker" "$ROOT/backups" "$ROOT/data" "$ROOT/scripts" "$ROOT/scripts/lib"
install -o deployer -g docker -m 0664 "$repo/deploy/compose.yaml" "$ROOT/compose.yaml"
install -o deployer -g docker -m 0664 "$repo"/scripts/lib/*.sh "$ROOT/scripts/lib/"
install -o deployer -g docker -m 0775 "$repo"/scripts/meals-* "$ROOT/scripts/"
# Removes the scripts that this checkout no longer has, for example after a
# rename, and their links.
for script in "$ROOT"/scripts/meals-*; do
  name=$(basename "$script")
  if [[ -e $script && ! -e $repo/scripts/$name ]]; then
    if [[ $(readlink "/usr/local/bin/$name") == "$script" ]]; then
      rm -f "/usr/local/bin/$name"
    fi
    rm -f "$script"
    echo "Removed the old script $name."
  fi
done

if [[ ! -e $ROOT/.env ]]; then
  # The hold comes first, so a run interrupted before .env exists still holds.
  touch "$ROOT/hold"
  printf 'MEALS_GID=%s\nMEALS_IMAGE=\nMEALS_PORT=3000\nMEALS_UID=%s\nMEALS_VERSION=\n' \
    "$(getent group docker | cut -d: -f3)" "$(id -u deployer)" >"$ROOT/.env"
  chown deployer:docker "$ROOT/.env" "$ROOT/hold"
  chmod 0664 "$ROOT/.env" "$ROOT/hold"
  echo "Created .env, and put the host on hold until you run: sudo -u deployer meals-deploy --resume"
fi

for script in "$ROOT"/scripts/meals-*; do
  ln -sfn "$script" "/usr/local/bin/$(basename "$script")"
done

install -m 0644 "$repo"/deploy/systemd/*.service "$repo"/deploy/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now meals-backup.timer meals-deploy.timer meals-restore-check.timer
echo "Installed the Meals host tools in $ROOT."
