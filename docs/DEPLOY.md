# Deploy de Hydra (CI/CD)

Deploy automático a producción vía GitHub Actions: `.github/workflows/deploy.yml`.

## Flujo

```
push / merge a main
  └─ job build  (GitHub-hosted runner)
       · construye backend y frontend
       · publica en GHCR:
           ghcr.io/human-software-mx/hydra-back:{latest,<sha>}
           ghcr.io/human-software-mx/hydra-front:{latest,<sha>}
  └─ job deploy (Environment "production" → REQUIERE APROBACIÓN MANUAL)
       · SSH al VM de producción (35.188.238.30)
       · docker pull de las imágenes del <sha>
       · retag a hydra-back:coolify / hydra-front:coolify (nombres que usa Coolify)
       · docker compose up -d --force-recreate --no-deps hydra-backend hydra-front
         (la DB NO se recrea; el backend corre `prisma migrate deploy` al arrancar)
       · health check de /api/health (3063) y del front (3062)
```

Las imágenes se construyen **en GitHub**, no en el VM. El VM solo las jala y recrea.
El recurso en Coolify sigue siendo un Docker Compose "raw" sin cambios.

## Aprobación de producción

El job `deploy` está atado al Environment **production**, que exige que un revisor
apruebe la ejecución antes de recrear contenedores. Esto evita aplicar migraciones
Prisma a la BD de producción sin una decisión explícita. Aprobar: pestaña Actions →
run → "Review deployments" → Approve.

## Configuración (ya provisionada)

Secrets del repo:
- `DEPLOY_HOST` — IP del VM
- `DEPLOY_USER` — usuario SSH
- `DEPLOY_SSH_KEY` — llave privada ed25519 dedicada (pública autorizada en el VM)

Variables del repo:
- `VITE_API_BASE_URL` — URL de la API horneada en el build del frontend
  (build-time; cambiarla aquí y re-desplegar si cambia el dominio del backend)

## Deploy manual

Actions → "Deploy Hydra" → "Run workflow" (usa el estado actual de `main`).

## Rollback

Cada deploy queda etiquetado por SHA en GHCR. Para volver a una versión anterior,
en el VM: `docker tag ghcr.io/human-software-mx/hydra-back:<sha-bueno> hydra-back:coolify`
(idem front) y recrear con el mismo `docker compose up -d --force-recreate --no-deps`.
