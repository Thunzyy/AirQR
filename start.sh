#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
WEB_DIST="$WEB_DIR/dist"
SYNC_DIR="$ROOT_DIR/services/sync-server"
ENV_FILE="$ROOT_DIR/.env"

WEB_PORT=5173
SYNC_PORT=8081
WS_PORT=
AIRQR_TLS_CERT="${AIRQR_TLS_CERT:-}"
AIRQR_TLS_KEY="${AIRQR_TLS_KEY:-}"
AIRQR_BOOTSTRAP_USERNAME="${AIRQR_BOOTSTRAP_USERNAME:-}"
AIRQR_BOOTSTRAP_PASSWORD="${AIRQR_BOOTSTRAP_PASSWORD:-}"

MODE="prod"
TRANSPORT="auto"
ACTION="run"
EXTRA_SYNC_ARGS=()
LOCAL_TRUSTED_PROXY_ARGS=(--trusted-proxy 127.0.0.1/32 --trusted-proxy ::1/128)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac

    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(trim "$key")"
    value="$(trim "$value")"

    case "$key" in
      AIRQR_WEB_PORT) WEB_PORT="$value" ;;
      AIRQR_SYNC_PORT) SYNC_PORT="$value" ;;
      AIRQR_WS_PORT) WS_PORT="$value" ;;
      AIRQR_TLS_CERT) AIRQR_TLS_CERT="$value" ;;
      AIRQR_TLS_KEY) AIRQR_TLS_KEY="$value" ;;
      AIRQR_BOOTSTRAP_USERNAME) AIRQR_BOOTSTRAP_USERNAME="$value" ;;
      AIRQR_BOOTSTRAP_PASSWORD) AIRQR_BOOTSTRAP_PASSWORD="$value" ;;
    esac
  done < "$env_file"

  if [ -z "${WS_PORT:-}" ]; then
    WS_PORT="$SYNC_PORT"
  fi
}

usage() {
  echo "AirQR launcher"
  echo
  echo "Usage:"
  echo "  ./start.sh                        (default: -prod -http)"
  echo "  ./start.sh -dev  [-http | -https] [-- extra sync-server args]"
  echo "  ./start.sh -prod [-http | -https] [-- extra sync-server args]"
  echo "  ./start.sh -stop"
  echo "  ./start.sh -dev -restart"
  echo "  ./start.sh -help"
  echo
  echo "Examples:"
  echo "  ./start.sh -dev -http"
  echo "  ./start.sh -dev -https"
  echo "  ./start.sh -prod -http"
  echo "  ./start.sh -prod -https -- --verbose"
  echo
}

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "[STOP] Killing port $port: $pids"
      kill $pids 2>/dev/null || true
      sleep 1
      kill -9 $pids 2>/dev/null || true
    fi
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
}

stop_services() {
  kill_port "$WEB_PORT"
  kill_port "$SYNC_PORT"
  if [ "$WS_PORT" != "$SYNC_PORT" ]; then
    kill_port "$WS_PORT"
  fi
}

resolve_tls_files() {
  TLS_CERT=""
  TLS_KEY=""

  if [ -n "$AIRQR_TLS_CERT" ] && [ -n "$AIRQR_TLS_KEY" ] && [ -f "$AIRQR_TLS_CERT" ] && [ -f "$AIRQR_TLS_KEY" ]; then
    TLS_CERT="$AIRQR_TLS_CERT"
    TLS_KEY="$AIRQR_TLS_KEY"
    return 0
  fi

  if [ -f "$SYNC_DIR/cert.pem" ] && [ -f "$SYNC_DIR/key.pem" ]; then
    TLS_CERT="$SYNC_DIR/cert.pem"
    TLS_KEY="$SYNC_DIR/key.pem"
    return 0
  fi

  if [ -f "$ROOT_DIR/localhost+2.pem" ] && [ -f "$ROOT_DIR/localhost+2-key.pem" ]; then
    TLS_CERT="$ROOT_DIR/localhost+2.pem"
    TLS_KEY="$ROOT_DIR/localhost+2-key.pem"
  fi
}

require_tls_files() {
  if [ -n "${TLS_CERT:-}" ] && [ -n "${TLS_KEY:-}" ]; then
    return 0
  fi

  echo -e "${RED}[ERROR]${NC} -https requires a certificate and key."
  echo "[INFO] Configure AIRQR_TLS_CERT / AIRQR_TLS_KEY in .env, or place cert.pem and key.pem in services/sync-server."
  echo "[INFO] Example:"
  echo "[INFO]   mkcert -install"
  echo "[INFO]   mkcert -cert-file \"$SYNC_DIR/cert.pem\" -key-file \"$SYNC_DIR/key.pem\" YOUR_LAN_IP localhost 127.0.0.1 ::1"
  return 1
}

resolve_transport() {
  local run_mode="$1"
  resolve_tls_files

  SYNC_TLS=0
  SYNC_SCHEME="http"
  WS_SCHEME="ws"

  case "$TRANSPORT" in
    https)
      require_tls_files || return 1
      SYNC_TLS=1
      ;;
    http)
      SYNC_TLS=0
      ;;
    auto)
      if [ "$run_mode" = "dev" ] && [ -n "${TLS_CERT:-}" ] && [ -n "${TLS_KEY:-}" ]; then
        SYNC_TLS=1
      fi
      ;;
  esac

  if [ "$SYNC_TLS" -eq 1 ]; then
    SYNC_SCHEME="https"
    WS_SCHEME="wss"
  fi
}

run_dev() {
  local no_sync=0
  local python_cmd=""
  local sync_pid=""

  cleanup() {
    echo
    echo -e "${YELLOW}[STOP]${NC} Arrêt des services..."
    if [ -n "$sync_pid" ] && kill -0 "$sync_pid" 2>/dev/null; then
      kill "$sync_pid" 2>/dev/null || true
      wait "$sync_pid" 2>/dev/null || true
    fi
    stop_services
    echo -e "${GREEN}[STOP]${NC} Tous les services sont arrêtés."
  }

  trap cleanup EXIT INT TERM

  echo -e "${BLUE}"
  echo "    _    _      ___  ____"
  echo "   / \\  (_)_ __/ _ \\|  _ \\"
  echo "  / _ \\ | | '__| | | | |_) |"
  echo " / ___ \\| | |  | |_| |  _ <"
  echo "/_/   \\_\\_|_|   \\__\\_\\_| \\_\\"
  echo -e "${NC}"
  echo

  if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}[ERROR]${NC} Node.js n'est pas installé."
    echo "Installez Node.js depuis https://nodejs.org/"
    exit 1
  fi
  echo -e "${GREEN}[OK]${NC} Node.js $(node -v) détecté"

  if command -v python3 >/dev/null 2>&1; then
    python_cmd="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then
    python_cmd="$(command -v python)"
  else
    echo -e "${YELLOW}[WARN]${NC} Python n'est pas installé. Le serveur de sync ne sera pas démarré."
    no_sync=1
  fi

  if [ "$no_sync" -eq 0 ]; then
    echo -e "${GREEN}[OK]${NC} $("$python_cmd" --version 2>&1) détecté"
    resolve_transport dev
  fi

  cd "$WEB_DIR"
  if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[INFO]${NC} Installation des dépendances npm..."
    npm install
  fi

  if [ "$no_sync" -eq 0 ] && [ -f "$SYNC_DIR/requirements.txt" ]; then
    echo -e "${YELLOW}[INFO]${NC} Installation des dépendances Python - best effort..."
    "$python_cmd" -m pip install -q -r "$SYNC_DIR/requirements.txt" 2>/dev/null || true
  fi

  echo
  echo "============================================"
  echo "  Démarrage des services AirQR"
  echo "============================================"
  echo

  stop_services

  if [ "$no_sync" -eq 0 ]; then
    export VITE_SYNC_SERVER_URL="${SYNC_SCHEME}://127.0.0.1:${SYNC_PORT}"
    if [ "$WS_PORT" != "$SYNC_PORT" ]; then
      export VITE_SYNC_EVENTS_WS_TARGET="${WS_SCHEME}://127.0.0.1:${WS_PORT}"
      export VITE_SYNC_WS_URL="$VITE_SYNC_EVENTS_WS_TARGET"
    else
      unset VITE_SYNC_EVENTS_WS_TARGET || true
      unset VITE_SYNC_WS_URL || true
    fi

    cd "$SYNC_DIR"
    export AIRQR_BOOTSTRAP_USERNAME AIRQR_BOOTSTRAP_PASSWORD
    if [ "$SYNC_TLS" -eq 1 ]; then
      if [ "$WS_PORT" = "$SYNC_PORT" ]; then
        echo -e "${GREEN}[START]${NC} Sync server (unified internal listener): ${SYNC_SCHEME}/${WS_SCHEME} ${SYNC_PORT}"
      else
        echo -e "${GREEN}[START]${NC} Sync server (split internal listeners): API ${SYNC_PORT}, WS ${WS_PORT}"
      fi
      "$python_cmd" server.py --port "$SYNC_PORT" --ws-port "$WS_PORT" --host 0.0.0.0 "${LOCAL_TRUSTED_PROXY_ARGS[@]}" --tls-cert "$TLS_CERT" --tls-key "$TLS_KEY" "${EXTRA_SYNC_ARGS[@]}" &
    else
      if [ "$WS_PORT" = "$SYNC_PORT" ]; then
        echo -e "${GREEN}[START]${NC} Sync server (unified internal listener): ${SYNC_SCHEME}/${WS_SCHEME} ${SYNC_PORT}"
      else
        echo -e "${GREEN}[START]${NC} Sync server (split internal listeners): API ${SYNC_PORT}, WS ${WS_PORT}"
      fi
      "$python_cmd" server.py --port "$SYNC_PORT" --ws-port "$WS_PORT" --host 0.0.0.0 "${LOCAL_TRUSTED_PROXY_ARGS[@]}" "${EXTRA_SYNC_ARGS[@]}" &
    fi
    sync_pid=$!
    sleep 2
  fi

  echo -e "${GREEN}[START]${NC} Frontend Vite (port ${WEB_PORT})..."
  echo
  echo "============================================"
  echo "  URLs d'accès:"
  echo "  - Frontend: https://localhost:${WEB_PORT}"
  echo "  - Sync navigateur: https://localhost:${WEB_PORT}/api/... (via proxy Vite)"
  if [ "$no_sync" -eq 0 ]; then
    if [ "$WS_PORT" = "$SYNC_PORT" ]; then
      echo "  - Sync interne unifie: ${SYNC_SCHEME}://localhost:${SYNC_PORT} (+ ${WS_SCHEME} /api/v1/ws/...)"
    else
      echo "  - Sync API interne: ${SYNC_SCHEME}://localhost:${SYNC_PORT}"
      echo "  - Sync WS interne: ${WS_SCHEME}://localhost:${WS_PORT}"
    fi
  fi
  echo "============================================"
  echo
  echo "Appuyez sur Ctrl+C pour arrêter tous les services."
  echo

  cd "$WEB_DIR"
  npm run dev
}

run_prod() {
  local python_cmd=""

  if [ ! -f "$WEB_DIST/index.html" ]; then
    echo "[ERROR] Build web introuvable: $WEB_DIST/index.html"
    echo "[INFO] Executez: cd apps/web && npm run build"
    exit 1
  fi

  if command -v python3 >/dev/null 2>&1; then
    python_cmd="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then
    python_cmd="$(command -v python)"
  else
    echo "[ERROR] Python non trouve."
    exit 1
  fi

  resolve_transport prod

  echo -e "${BLUE}"
  echo "    _    _      ___  ____"
  echo "   / \\  (_)_ __/ _ \\|  _ \\"
  echo "  / _ \\ | | '__| | | | |_) |"
  echo " / ___ \\| | |  | |_| |  _ <"
  echo "/_/   \\_\\_|_|   \\__\\_\\_| \\_\\"
  echo -e "${NC}"
  echo

  echo "[INFO] Stopping existing services on internal ports ${SYNC_PORT}/${WS_PORT}..."
  stop_services

  echo "[START] AirQR Web prod locale"
  echo "[START] URL: ${SYNC_SCHEME}://localhost:${SYNC_PORT}"
  echo "[START] Unified listener: ${SYNC_SCHEME}/${WS_SCHEME} on ${SYNC_PORT}"
  export AIRQR_BOOTSTRAP_USERNAME AIRQR_BOOTSTRAP_PASSWORD

  if [ "$SYNC_TLS" -eq 1 ]; then
    "$python_cmd" "$SYNC_DIR/server.py" \
      --host 0.0.0.0 \
      --port "$SYNC_PORT" \
      --ws-port "$SYNC_PORT" \
      "${LOCAL_TRUSTED_PROXY_ARGS[@]}" \
      --tls-cert "$TLS_CERT" \
      --tls-key "$TLS_KEY" \
      --storage-dir "$SYNC_DIR/storage" \
      --users-file "$SYNC_DIR/users.json" \
      --static-dir "$WEB_DIST" \
      "${EXTRA_SYNC_ARGS[@]}"
  else
    "$python_cmd" "$SYNC_DIR/server.py" \
      --host 0.0.0.0 \
      --port "$SYNC_PORT" \
      --ws-port "$SYNC_PORT" \
      "${LOCAL_TRUSTED_PROXY_ARGS[@]}" \
      --storage-dir "$SYNC_DIR/storage" \
      --users-file "$SYNC_DIR/users.json" \
      --static-dir "$WEB_DIST" \
      "${EXTRA_SYNC_ARGS[@]}"
  fi
}

load_env "$ENV_FILE"
if [ -z "${WS_PORT:-}" ]; then
  WS_PORT="$SYNC_PORT"
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    -dev|dev)
      MODE="dev"
      ;;
    -prod|prod)
      MODE="prod"
      ;;
    -http)
      TRANSPORT="http"
      ;;
    -https)
      TRANSPORT="https"
      ;;
    -stop|stop)
      ACTION="stop"
      ;;
    -restart|restart)
      ACTION="restart"
      ;;
    -help|--help|-h|help)
      usage
      exit 0
      ;;
    --)
      shift
      EXTRA_SYNC_ARGS=("$@")
      break
      ;;
    *)
      echo "[ERROR] Unknown argument: $1"
      echo
      usage
      exit 1
      ;;
  esac
  shift
done

if [ "$ACTION" = "stop" ]; then
  stop_services
  echo "[OK] Services stopped."
  exit 0
fi

if [ "$ACTION" = "restart" ]; then
  echo "[INFO] Restart: stopping existing services first..."
  stop_services
fi

case "$MODE" in
  dev)
    run_dev
    ;;
  prod)
    run_prod
    ;;
  *)
    echo "[ERROR] Unknown mode: $MODE"
    echo
    usage
    exit 1
    ;;
esac
