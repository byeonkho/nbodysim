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

EXPOSE 8080

# Container-aware heap. The default MaxRAMPercentage is 25% (~256 MB on a 1 GB
# instance), which a few concurrent chunk requests can exhaust. 70% leaves
# headroom for off-heap usage (zstd-jni native buffers, thread stacks, metaspace).
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70.0", "-jar", "app.jar"]
