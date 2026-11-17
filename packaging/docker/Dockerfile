# Merathon pour NAS : binaire statique (musl) + interface web, en une image.
#
#   docker build -f packaging/docker/Dockerfile -t merathon .            # image de Container Manager, Unraid, TrueNAS…
#   docker build -f packaging/docker/Dockerfile --target artifacts -t merathon-artifacts .
#                                                                        # binaire et interface, pour le paquet Synology
#
# Le contexte est la racine du dépôt. La même construction tourne sur chaque architecture (x86_64, aarch64) : on la
# lance sur une machine de cette architecture, Alpine étant musl en natif.

FROM node:22-alpine AS web
WORKDIR /src/git-client
COPY git-client/package.json git-client/package-lock.json ./
RUN npm ci
COPY git-client/ ./
RUN npm run build:server

FROM rust:1-alpine AS server
# OpenSSL en statique : libgit2 et libssh2 s'y lient, le binaire n'a alors aucune dépendance sur le NAS.
RUN apk add --no-cache build-base pkgconf perl cmake openssl-dev openssl-libs-static zlib-static
ENV OPENSSL_STATIC=1 OPENSSL_DIR=/usr
WORKDIR /src/git-client/src-tauri
COPY git-client/src-tauri/ ./
RUN cargo build --release --no-default-features --features server --bin merathon-server \
    && strip target/release/merathon-server

# Ce que le paquet Synology embarque.
FROM scratch AS artifacts
COPY --from=server /src/git-client/src-tauri/target/release/merathon-server /bin/merathon-server
COPY --from=web /src/git-client/dist-server /web

FROM alpine:3 AS image
# Rattache l'image publiée sur ghcr.io au dépôt public (visibilité, README, licence).
LABEL org.opencontainers.image.source="https://github.com/J-Dudek/merathon" \
      org.opencontainers.image.title="Merathon" \
      org.opencontainers.image.description="Merathon — Git Repository Manager, servi à votre navigateur (NAS, serveur)" \
      org.opencontainers.image.licenses="MIT"
# Certificats pour joindre GitHub et GitLab ; git sert aux crochets et à LFS des dépôts, sh au terminal intégré.
RUN apk add --no-cache ca-certificates git git-lfs openssh-client \
    && adduser -D -h /data -u 1000 merathon \
    && mkdir -p /data /repos && chown merathon /data /repos
COPY --from=artifacts /bin/merathon-server /usr/local/bin/merathon-server
COPY --from=artifacts /web /usr/share/merathon/web
USER merathon
# Sans authentification un conteneur ne doit pas démarrer : MERATHON_TOKEN (16 caractères au moins) est obligatoire.
ENV MERATHON_BIND=0.0.0.0:8765 \
    MERATHON_AUTH=token \
    MERATHON_DATA_DIR=/data \
    MERATHON_WEB_DIR=/usr/share/merathon/web \
    MERATHON_ALLOWED_ROOTS=/repos
EXPOSE 8765
VOLUME ["/data", "/repos"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8765/api/health || exit 1
ENTRYPOINT ["merathon-server"]
