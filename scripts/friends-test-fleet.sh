#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GRIXDROID_WORKER_ENV_FILE:-$ROOT/.env.worker}"
STATE_DIR="${GRIXDROID_FLEET_STATE_DIR:-$ROOT/.grixdroid-test-fleet}"
COUNT=10
BASE_PORT=8788

usage() {
  echo "Usage: $0 start|stop|status"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing private worker config: $ENV_FILE"
  echo "Copy .env.worker.example to .env.worker and fill in the server-only credentials."
  exit 1
fi

# Parse the same dotenv format Node uses for the worker. Do not source this file
# as shell code: Android SDK package values contain semicolons and are not shell syntax.
read_env() {
  node --env-file="$ENV_FILE" -e 'process.stdout.write(process.env[process.argv[1]] ?? "")' "$1"
}

if [[ "${1:-}" == "start" ]]; then
  for required in ANDROID_SDK_ROOT SUPABASE_URL SUPABASE_API_KEY SUPABASE_SERVICE_ROLE_JWT; do
    value="$(read_env "$required")"
    if [[ -z "$value" || "$value" == *"replace_with"* ]]; then
      echo "Set $required in $ENV_FILE before starting the test fleet."
      exit 1
    fi
  done

  ANDROID_SDK_ROOT="$(read_env ANDROID_SDK_ROOT)"
  if [[ ! -x "$ANDROID_SDK_ROOT/emulator/emulator" || ! -x "$ANDROID_SDK_ROOT/platform-tools/adb" ]]; then
    echo "Android Emulator and ADB must be installed under ANDROID_SDK_ROOT."
    exit 1
  fi

  accel="$(read_env GRIXDROID_ACCEL)"
  software_opt_in="$(read_env GRIXDROID_ENABLE_SOFTWARE_EMULATION)"
  if [[ "${accel:-auto}" == "off" && "${software_opt_in:-0}" != "1" ]]; then
    echo "Ten software-emulated Android instances are not a suitable friends-test fleet."
    echo "Use a host with hardware virtualization enabled."
    exit 1
  fi
fi

mkdir -p "$STATE_DIR"

case "${1:-}" in
  start)
    started=0
    for n in $(seq -w 1 "$COUNT"); do
      id_file="$STATE_DIR/worker-$n.id"
      pid_file="$STATE_DIR/worker-$n.pid"
      log_file="$STATE_DIR/worker-$n.log"
      if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
        echo "worker-$n already running (pid $(cat "$pid_file"))."
        started=$((started + 1))
        continue
      fi
      if [[ ! -s "$id_file" ]]; then
        python3 -c 'import uuid; print(uuid.uuid4())' > "$id_file"
      fi
      worker_id="$(cat "$id_file")"
      port=$((BASE_PORT + 10#$n - 1))
      data_root="$(read_env GRIXDROID_DATA_ROOT)"
      data_root="${data_root:-/var/lib/grixdroid}"
      worker_data_root="$data_root/friends-test/worker-$n"
      label="grix-friends-test-$n"
      nohup env \
        GRIXDROID_WORKER_ID="$worker_id" \
        GRIXDROID_WORKER_LABEL="$label" \
        GRIXDROID_WORKER_PORT="$port" \
        GRIXDROID_WORKER_HOST=127.0.0.1 \
        GRIXDROID_MAX_DEVICES=1 \
        GRIXDROID_DATA_ROOT="$worker_data_root" \
        node --env-file="$ENV_FILE" "$ROOT/server/cloud-worker.mjs" \
        > "$log_file" 2>&1 </dev/null &
      pid=$!
      echo "$pid" > "$pid_file"
      sleep 2
      if kill -0 "$pid" 2>/dev/null; then
        echo "Started worker-$n (pid $pid, port $port)."
        started=$((started + 1))
      else
        rm -f "$pid_file"
        echo "worker-$n failed to start. Last log lines:"
        tail -n 20 "$log_file" || true
      fi
    done
    echo "$started/$COUNT worker processes are running. Confirm their Supabase heartbeats before inviting testers."
    [[ "$started" -eq "$COUNT" ]]
    ;;
  stop)
    stopped=0
    for n in $(seq -w 1 "$COUNT"); do
      pid_file="$STATE_DIR/worker-$n.pid"
      [[ -f "$pid_file" ]] || continue
      pid="$(cat "$pid_file")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid"
        stopped=$((stopped + 1))
      fi
      rm -f "$pid_file"
    done
    echo "Stopped $stopped worker processes."
    ;;
  status)
    running=0
    for n in $(seq -w 1 "$COUNT"); do
      pid_file="$STATE_DIR/worker-$n.pid"
      if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
        echo "worker-$n: process running (pid $(cat "$pid_file"))"
        running=$((running + 1))
      else
        echo "worker-$n: stopped"
      fi
    done
    echo "$running/$COUNT processes running. Process status is not proof of a current database heartbeat."
    ;;
  *)
    usage
    exit 2
    ;;
esac
