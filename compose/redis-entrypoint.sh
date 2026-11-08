#!/bin/sh
set -eu

if [ -z "${REDIS_PASSWORD:-}" ]; then
  echo "REDIS_PASSWORD is required" >&2
  exit 1
fi

umask 077
cat > /tmp/redis.conf <<EOF
appendonly yes
dir /data
requirepass ${REDIS_PASSWORD}
EOF

exec redis-server /tmp/redis.conf
