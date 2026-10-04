# syntax=docker/dockerfile:1
# fd-wire-web image — Vite 构建产物由 nginx 托管（wire-platform-v1 任务 3.4）。
#
# 形制照抄 fd-wanxing wanxing-web 的 builder/runtime 两段，但目标是纯静态：
# builder 产出 dist/，runtime 只跑 nginx（非 root，8080）。
# SPA 路由（/ 与 /console 的 try_files）与 /mcp 占位说明在 nginx.conf。
ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
# 依赖层先行，锁文件变化才失效。
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# package.json build = tsc --noEmit && vite build → dist/
RUN npm run build

FROM ${NGINX_IMAGE}
# server 块（8080、SPA fallback、/mcp 占位注释）。
COPY nginx.conf /etc/nginx/conf.d/default.conf
# 非 root：master 由 USER nginx 起动——pid 挪 /tmp，日志/缓存/html 目录
# 归属 nginx 用户。
RUN sed -i 's|/var/run/nginx.pid|/tmp/nginx.pid|' /etc/nginx/nginx.conf \
 && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx
COPY --from=builder /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
# busybox wget 探首页（SPA shell）。
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
