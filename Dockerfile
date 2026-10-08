# เครื่องมือ Cloudflare (wrangler) สำหรับทดสอบในเครื่องและ deploy โดยไม่ต้องลง Node.js
FROM node:20-bookworm-slim
WORKDIR /app
RUN npm install -g wrangler@3.80.0 && npm cache clean --force
ENV WRANGLER_SEND_METRICS=false
EXPOSE 8788
