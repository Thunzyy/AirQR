FROM node:22-slim AS web-builder

WORKDIR /build/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web ./
RUN npm run build

FROM python:3.12-slim AS runtime

ARG AIRQR_VERSION=1.0
ARG AIRQR_COMMIT=unknown
ARG AIRQR_BUILD_TIME=unknown

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV AIRQR_VERSION=$AIRQR_VERSION
ENV AIRQR_COMMIT=$AIRQR_COMMIT
ENV AIRQR_BUILD_TIME=$AIRQR_BUILD_TIME

LABEL org.opencontainers.image.title="AirQR Sync Server"
LABEL org.opencontainers.image.version=$AIRQR_VERSION
LABEL org.opencontainers.image.revision=$AIRQR_COMMIT
LABEL org.opencontainers.image.created=$AIRQR_BUILD_TIME

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY services/sync-server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/sync-server/sync_server ./sync_server
COPY services/sync-server/server.py ./server.py

# Non-root user
RUN groupadd -r airqr && useradd -r -g airqr -d /app -s /sbin/nologin airqr \
    && mkdir -p /data/storage /app/web-dist \
    && chown -R airqr:airqr /app /data

COPY --from=web-builder --chown=airqr:airqr /build/apps/web/dist/. /app/web-dist/

USER airqr

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8081/health')" || exit 1

CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8081", "--ws-port", "8081", "--storage-dir", "/data/storage", "--users-file", "/data/users.json", "--static-dir", "/app/web-dist"]
