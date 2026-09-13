# ReviewStage — container image.
#
# Stage 1 builds the React dashboard bundle; stage 2 is the runtime: Python for the server,
# bash + git + gh + jq for the review scripts, Node for the Claude Code CLI. The whole
# persistent footprint lives under /home/reviewstage/.reviewstage (ROOT), which compose
# mounts as a named volume. Everything else is disposable.

# ---- stage 1: dashboard bundle ---------------------------------------------------------------
FROM node:24-alpine AS ui
RUN npm install -g pnpm@10
WORKDIR /build/dashboard-ui
COPY dashboard-ui/package.json dashboard-ui/pnpm-lock.yaml dashboard-ui/pnpm-workspace.yaml ./
# pnpm-workspace.yaml carries dangerouslyAllowAllBuilds so esbuild's postinstall may run.
RUN pnpm install --frozen-lockfile
COPY dashboard-ui/ ./
# scripts/icons.mjs (the tail of "build") renders the PWA icons from ../assets/logo.png.
COPY assets/logo.png /build/assets/logo.png
# esbuild writes app.js / app.css to ../bin/static (see package.json "build").
RUN pnpm build && ls -1 /build/bin/static

# ---- stage 2: runtime ------------------------------------------------------------------------
FROM python:3.12-slim
ARG CLAUDE_CODE_VERSION=latest
ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        bash ca-certificates curl git gnupg jq openssl procps util-linux; \
    # gh — official apt repo
    mkdir -p -m 755 /etc/apt/keyrings; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        -o /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        > /etc/apt/sources.list.d/github-cli.list; \
    # Node 24 — runtime for the Claude Code CLI
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash -; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh nodejs; \
    npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"; \
    npm cache clean --force; \
    apt-get clean; rm -rf /var/lib/apt/lists/*

# Non-root. $HOME must be writable: the Claude CLI keeps its own state in ~/.claude, and the
# entrypoint installs the review skills into ~/.claude/skills on every start.
RUN useradd --create-home --uid 1000 --shell /bin/bash reviewstage
ENV HOME=/home/reviewstage \
    ROOT=/home/reviewstage/.reviewstage \
    RS_PORT=8899 \
    RS_BIND=0.0.0.0 \
    PATH=/app/bin:/usr/local/bin:/usr/bin:/bin

WORKDIR /app
COPY --chown=reviewstage:reviewstage bin/ /app/bin/
COPY --chown=reviewstage:reviewstage skills/ /app/skills/
COPY --from=ui --chown=reviewstage:reviewstage /build/bin/static/ /app/bin/static/
RUN chmod 0755 /app/bin/*.sh /app/bin/*.py \
    && ln -s /app/bin/entrypoint.sh /usr/local/bin/doctor \
    && mkdir -p /home/reviewstage/.reviewstage /home/reviewstage/.claude \
    && chown -R reviewstage:reviewstage /home/reviewstage

USER reviewstage
VOLUME ["/home/reviewstage/.reviewstage"]
EXPOSE 8899
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${RS_PORT}/health" || exit 1

ENTRYPOINT ["/app/bin/entrypoint.sh"]
CMD ["server"]
