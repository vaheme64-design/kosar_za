#!/usr/bin/env bash
# KPIMS — one-shot browser E2E verification.
# The sandbox reaps background processes between tool calls, so services and
# the whole browser flow must run inside a single invocation of this script.
set -u
cd "$(dirname "$0")/.."

OUT=/tmp/render
mkdir -p "$OUT"
BASE=http://127.0.0.1:3000

step() { printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"; }

step "start services"
setsid nohup bash .zscripts/dev.sh > /tmp/devsh.log 2>&1 < /dev/null &
UP=0
for i in $(seq 1 90); do
  V=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$BASE/" 2>/dev/null)
  A=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:4100/api/v1/health 2>/dev/null)
  if [ "$V" = "200" ] && [ "$A" = "200" ]; then UP=1; echo "services up after ${i}s"; break; fi
  sleep 1
done
if [ "$UP" != "1" ]; then echo "FATAL: services did not start"; tail -30 /tmp/devsh.log; exit 1; fi

agent-browser set viewport 1440 900 >/dev/null

step "open app (expect redirect to /login)"
agent-browser open "$BASE/" 
agent-browser wait --load networkidle --timeout 20000
agent-browser get url
agent-browser screenshot "$OUT/01-login.png"

step "wrong password shows error"
agent-browser find first "#username" fill "admin"
agent-browser find first "#password" fill "wrong-password"
agent-browser find first "button[type=submit]" click
sleep 1.2
agent-browser get text ".alert--error" || echo "(no error box found!)"
agent-browser screenshot "$OUT/02-login-error.png"

step "correct login (admin)"
agent-browser find first "#password" fill "Kpims@1404"
agent-browser find first "button[type=submit]" click
agent-browser wait --load networkidle --timeout 20000
sleep 1.5
agent-browser get url
agent-browser screenshot "$OUT/03-dashboard.png"

step "dashboard interactive snapshot"
agent-browser snapshot -i -c | head -40

step "navigate to انبار (inventory placeholder)"
agent-browser find text "انبار" click
sleep 1.2
agent-browser get url
agent-browser screenshot "$OUT/04-inventory-placeholder.png"

step "navigate to اطلاعات پایه"
agent-browser find text "اطلاعات پایه" click
sleep 1.2
agent-browser screenshot "$OUT/05-masterdata-placeholder.png"

step "logout from sidebar"
agent-browser find text "خروج" click
sleep 1.5
agent-browser get url

step "mobile viewport check (390x844)"
agent-browser set viewport 390 844
agent-browser open "$BASE/login"
agent-browser wait --load networkidle --timeout 20000
agent-browser find first "#username" fill "keeper"
agent-browser find first "#password" fill "Kpims@1404"
agent-browser find first "button[type=submit]" click
agent-browser wait --load networkidle --timeout 20000
sleep 1.5
agent-browser screenshot "$OUT/06-mobile-dashboard.png"
agent-browser find first ".topbar__menu" click
sleep 0.8
agent-browser screenshot "$OUT/07-mobile-sidebar.png"

step "page errors / console"
agent-browser errors || true
agent-browser console | tail -15 || true

agent-browser close >/dev/null 2>&1 || true
step "done — screenshots in $OUT"
