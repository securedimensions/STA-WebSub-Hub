#!/bin/sh
set -e

printf '%s node /hub-app/scripts/cleanup-expired-subscriptions.js\n' \
    "${CLEANUP_CRON_SCHEDULE:-*/30 * * * *}" > /crontab

echo "cleanup cron schedule: ${CLEANUP_CRON_SCHEDULE:-*/30 * * * *}"
exec supercronic -quiet /crontab
