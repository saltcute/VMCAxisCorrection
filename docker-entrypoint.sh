#!/bin/sh
# Starts as root only to make the mounted /data writable, then drops to an unprivileged user.
# PUID/PGID default to the image's `node` user (1000:1000); on Unraid use 99:100.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "${CONFIG_DIR:-/data}"
  chown -R "$PUID:$PGID" "${CONFIG_DIR:-/data}"
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
