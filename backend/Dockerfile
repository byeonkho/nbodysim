# ---- Build stage ----
FROM eclipse-temurin:21-jdk AS builder
WORKDIR /app

# Dependency layer (cached unless pom.xml changes)
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw dependency:go-offline -q

COPY src src
RUN ./mvnw package -DskipTests -q

# ---- Runtime stage ----
FROM eclipse-temurin:21-jre
WORKDIR /app

COPY --from=builder /app/target/*.jar app.jar

# Orekit data must live on the filesystem — DirectoryCrawler can't read
# resources from inside a fat JAR. Copied separately and referenced via env var.
COPY src/main/resources/orekit-data-master /app/orekit-data
ENV OREKIT_DATA_PATH=/app/orekit-data

# Drop root: run as an unprivileged user so a container-level compromise can't
# trivially escalate to root inside the container. The only path the app writes
# at runtime is the Horizons disk cache (default ./horizons-cache, which under
# WORKDIR /app resolves to /app/horizons-cache), so create that dir and hand it
# to the app user. The jar and Orekit data stay root-owned and read-only — the
# app only needs read access, which world-readable default perms already grant.
# Port 8080 (and Railway's injected high PORT) is >1024, so a non-root bind is
# fine. Files.createDirectories on an already-existing dir is a no-op, so the
# app never needs write access to /app itself.
RUN useradd --uid 1001 --create-home --home-dir /home/appuser appuser \
    && mkdir -p /app/horizons-cache \
    && chown appuser:appuser /app/horizons-cache
USER appuser

EXPOSE 8080

# Container-aware heap. The default MaxRAMPercentage is 25% (~256 MB on a 1 GB
# instance), which a few concurrent chunk requests can exhaust. 70% leaves
# headroom for off-heap usage (zstd-jni native buffers, thread stacks, metaspace).
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70.0", "-jar", "app.jar"]
