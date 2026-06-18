#!/bin/sh
set -e

printf '%s /usr/local/bin/node /hub-app/scripts/cleanup-expired-subscriptions.js\n' \
    "${CLEANUP_CRON_SCHEDULE:-*/30 * * * *}" > /crontab

echo "cleanup cron schedule: ${CLEANUP_CRON_SCHEDULE:-*/30 * * * *}"
exec /usr/local/bin/supercronic -quiet /crontab
