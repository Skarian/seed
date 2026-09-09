#!/usr/bin/env bash
# Stock Hearmeman image plus authenticated browser access. Not yet GPU-tested.
set -Eeuo pipefail
umask 077
: "${JUPYTER_TOKEN:?Set a strong Jupyter token before deployment}"
: "${H3_UI_PASSWORD:?Set a strong browser password before deployment}"
if ! mountpoint -q /workspace; then
  echo 'Refusing startup: /workspace is not a mount point.' >&2
  exit 1
fi
mkdir -p /workspace/h3-deployment
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends nginx apache2-utils
printf '%s\n' "$H3_UI_PASSWORD" | htpasswd -ci /etc/nginx/h3.htpasswd neil
chmod 640 /etc/nginx/h3.htpasswd
chown root:www-data /etc/nginx/h3.htpasswd
cat > /etc/nginx/nginx.conf <<'NGINX'
user www-data;
worker_processes 2;
pid /run/nginx.pid;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  map $http_upgrade $connection_upgrade { default upgrade; '' close; }
  server {
    listen 8080;
    server_name _;
    client_max_body_size 2g;
    location = /_auth {
      internal;
      proxy_pass http://127.0.0.1:8888/api/status;
      proxy_pass_request_body off;
      proxy_method GET;
      proxy_set_header Content-Type "";
      proxy_set_header Content-Length "";
      proxy_set_header Host $host;
    }
    location ~ ^/(login|logout|static/|api/status) {
      proxy_pass http://127.0.0.1:8888;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_cookie_flags ~ secure samesite=lax;
    }
    location / {
      auth_request /_auth;
      error_page 401 403 =302 /login?next=%2F;
      proxy_pass http://127.0.0.1:8188;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
      proxy_buffering off;
      proxy_request_buffering off;
    }
  }
}
NGINX
nginx -t
nginx
# Keep startup credentials out of the ComfyUI child environment where possible.
unset H3_UI_PASSWORD
export download_minimax_h3=true
export minimax_quant=int8
export COMFYUI_VERSION=approved
export PERSIST_MODELS_TO_VOLUME=true
export COMFY_EXTRA_ARGS='--listen 127.0.0.1'
# Stock upstream startup. Capture source identities after it syncs during acceptance.
exec /start_script.sh
