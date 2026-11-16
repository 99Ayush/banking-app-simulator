FROM node:24-alpine AS dependencies
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev
FROM node:24-alpine AS runner
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --chown=node:node --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --chown=node:node package*.json server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
