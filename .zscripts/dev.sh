#!/usr/bin/env bash
# KPIMS — platform dev entrypoint.
# The sandbox platform runs this script in the background on session start
# (logs: .zscripts/dev.log). Everything is orchestrated by scripts/dev.mjs.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p .zscripts
node scripts/dev.mjs 2>&1 | tee -a dev.log
exit ${PIPESTATUS[0]}
