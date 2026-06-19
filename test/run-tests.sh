#!/bin/sh
# Run the full dockerised test suite and print a clean summary at the end.
set -e
cd "$(dirname "$0")"

docker compose up --build --abort-on-container-exit --exit-code-from test-runner "$@"
EXIT=$?

printf '\n%.0s' {1..2}
printf '=%.0s' {1..60}
printf '\n  TEST SUMMARY\n'
printf '=%.0s' {1..60}
printf '\n'
docker compose logs test-runner 2>/dev/null | grep -v '^\s*$' | sed 's/^test-runner-[0-9]*\s*|\s*//'
printf '=%.0s' {1..60}
printf '\n'

exit $EXIT
