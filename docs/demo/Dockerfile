FROM oven/bun:1-slim

# TypeScript/Bun — el mismo lenguaje del repo. El modelo canónico entra como
# artefacto (docs/canonico/agua.yaml); el motor Callosum NO corre aquí.
WORKDIR /app
RUN bun add yaml

COPY demo.ts template.html /app/

EXPOSE 8090
CMD ["bun", "demo.ts"]
