# =============================================================================
# OPTIONAL. The service does NOT require this file — Railway, Render and Fly can
# all build it from package.json alone (nixpacks / native Node builders). It is
# here because a Dockerfile is the one build definition all three understand
# identically, which removes "it built differently on the other host" from the
# list of things that can go wrong during an incident.
#
# THE BUILD CONTEXT IS `services/realtime`, NOT THE REPOSITORY ROOT. That is the
# whole isolation property: nothing outside this directory is copied, so a build
# that succeeds here cannot be secretly depending on the Next app. It is also why
# the handshake verifier is duplicated rather than imported — see src/auth/token.ts.
# =============================================================================

# Pinned to the major line the Next app's engines field requires, on Alpine for
# a ~50 MB image. `-slim` would be safer for native modules; `pg` and `socket.io`
# are pure JavaScript, so Alpine costs nothing here.
FROM node:20-alpine AS build

WORKDIR /app

# package.json and the lockfile FIRST, as their own layer. Source changes then
# do not invalidate the dependency layer, which is the difference between a 5 s
# and a 60 s redeploy on every code change.
COPY package.json package-lock.json* ./
# `npm ci` and not `npm install`: ci installs exactly the lockfile and fails if
# the two disagree, so a deploy can never silently pick up a different version
# from the one that passed the tests.
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# -----------------------------------------------------------------------------
# Runtime stage: production dependencies and compiled JS only. No TypeScript, no
# test framework, no source. Smaller, and nothing in the image can run a test
# script or a build tool.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Documentation only — the platform injects PORT and the server reads it. An
# EXPOSE that disagrees with the injected value is harmless; a server that
# ignores PORT is not, which is why src/config.ts reads it rather than hardcoding.
EXPOSE 4001

# The unprivileged user that ships with the node images. A process that never
# needs to write to the filesystem has no business running as root.
USER node

# `node dist/index.js` directly, NOT `npm start`. npm sits between the platform
# and the process and does not forward SIGTERM to its child by default, which
# would mean the graceful-shutdown path in src/index.ts never runs and every
# deploy drops connections and loses the engagement flush.
CMD ["node", "dist/index.js"]

# The platform's own health check should target GET /healthz. Declared here too
# so `docker run` locally behaves the same way.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4001)+'/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
