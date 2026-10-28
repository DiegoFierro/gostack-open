---
title: "Módulo 17: Despliegue, Contenedores & Producción"
description: "De tu máquina a un servidor real con HTTPS automático."
weight: 20
fase: "Fase 4: Rendimiento, observabilidad, escritorio y producción"
---

## Objetivos

- Compilar binarios estáticos ultraligeros sin dependencias.
- Crear imágenes Docker multi-stage y orquestarlas con Docker Compose.
- Publicar con Caddy como proxy inverso con HTTPS automático.
- Automatizar el despliegue y operar la aplicación con seguridad.

## 1. Binarios estáticos con Go

Go compila a **un único ejecutable** sin necesidad de intérprete ni máquina virtual. Con CGO desactivado, además es **estático**: no depende de librerías del sistema, de modo que corre en cualquier Linux, incluso en una imagen vacía.

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath -ldflags "-s -w -X main.version=$(git describe --tags --always)" \
  -o bin/tareas ./cmd/tareas

ls -lh bin/tareas        # típicamente 10–25 MB
file bin/tareas          # ELF 64-bit ... statically linked
```

| Opción | Efecto |
|--------|--------|
| `CGO_ENABLED=0` | Sin dependencias de C: binario estático y compilación cruzada trivial |
| `GOOS` / `GOARCH` | Sistema y arquitectura de destino (`linux/arm64` para servidores ARM, `windows/amd64`…) |
| `-trimpath` | Quita rutas locales del binario (reproducibilidad y privacidad) |
| `-ldflags "-s -w"` | Elimina tablas de símbolos y depuración (−25–30 % de tamaño) |
| `-X main.version=…` | Inyecta valores en tiempo de compilación |

Como todo (plantillas, estáticos, Swagger UI) va incrustado con `go:embed`, **copiar ese único archivo es desplegar**. Mira la lista de plataformas con `go tool dist list`.

> Si una dependencia requiere CGO (algunos drivers de SQLite), usa alternativas puras en Go (`modernc.org/sqlite`) o compila en una imagen con `gcc` y ejecuta en una con `libc`.

## 2. Dockerfile multi-stage

Una imagen "ingenua" con el SDK de Go pesa más de 800 MB y contiene herramientas de compilación que no deben estar en producción. Con **multi-stage** se compila en una etapa y se copia **solo el binario** a una imagen mínima.

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# ---------- Etapa 1: compilación ----------
FROM golang:1.25 AS build
WORKDIR /src

# Dependencias primero: esta capa se cachea mientras go.mod/go.sum no cambien
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
ARG VERSION=dev
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/tareas ./cmd/tareas

# ---------- Etapa 2: ejecución ----------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/tareas /tareas

USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/tareas"]
```

Por qué así:

- **`distroless/static`**: sin shell ni gestor de paquetes (≈2 MB), con certificados CA y datos de zona horaria. Menor superficie de ataque. (Alternativa mínima: `FROM scratch`, copiando tú los certificados.)
- **`nonroot`**: la aplicación **no corre como root**.
- Copiar `go.mod/go.sum` antes que el código aprovecha la **caché de capas**: reconstruir tras cambiar solo código es rapidísimo.
- La imagen final suele pesar **15–30 MB**.

`.dockerignore` (imprescindible: evita enviar basura al contexto y filtrar secretos):

```text
.git
.env
bin/
*.log
node_modules/
```

```bash
docker build -t tareas:dev --build-arg VERSION=$(git describe --tags --always) .
docker run --rm -p 8080:8080 --env-file .env tareas:dev
docker images tareas                # comprueba el tamaño
```

Por defecto `distroless` no tiene shell: para depurar usa `docker logs` (de ahí que escribir logs a stdout sea la regla) o la variante `:debug`.

## 3. Docker Compose: toda la pila

**Compose** describe y arranca varios servicios (aplicación, base de datos, caché, migraciones, proxy) con un solo archivo.

`compose.yaml`:

```yaml
services:
  app:
    build:
      context: .
      args: { VERSION: "${VERSION:-dev}" }
    restart: unless-stopped
    environment:
      APP_ENV: produccion
      PORT: "8080"
      DATABASE_URL: postgres://tareas:${DB_PASSWORD}@db:5432/tareas?sslmode=disable
      REDIS_ADDR: redis:6379
    depends_on:
      db:      { condition: service_healthy }
      redis:   { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    healthcheck:   # distroless no tiene curl: el binario implementa su propio chequeo (ver abajo)
      test: ["CMD", "/tareas", "-healthcheck"]
      interval: 15s
      timeout: 3s
      retries: 3
    networks: [interna]

  worker:                       # el mismo binario con otro comando (cmd/worker) o argumento
    build: { context: ., dockerfile: Dockerfile.worker }
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://tareas:${DB_PASSWORD}@db:5432/tareas?sslmode=disable
      REDIS_ADDR: redis:6379
    depends_on: [db, redis]
    networks: [interna]

  migrate:
    image: migrate/migrate:v4.18.1
    command: ["-path=/migraciones", "-database=postgres://tareas:${DB_PASSWORD}@db:5432/tareas?sslmode=disable", "up"]
    volumes: ["./db/migrations:/migraciones:ro"]
    depends_on:
      db: { condition: service_healthy }
    networks: [interna]

  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: tareas
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: tareas
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tareas -d tareas"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [interna]          # NO se publica ningún puerto al exterior

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes: ["redisdata:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [interna]

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]   # único punto de entrada público
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_datos:/data         # guarda los certificados: ¡no lo pierdas!
      - caddy_config:/config
    depends_on: [app]
    networks: [interna]

volumes: { pgdata: {}, redisdata: {}, caddy_datos: {}, caddy_config: {} }
networks: { interna: {} }
```

Detalles importantes:

- **Los secretos** (`DB_PASSWORD`) salen de un `.env` junto al `compose.yaml` (¡fuera de Git!) o de los *secrets* de Docker. Nunca de la imagen.
- **Solo Caddy expone puertos** (80/443). La base de datos y Redis viven en una red interna: inaccesibles desde internet.
- `depends_on` con `condition` garantiza el orden: base de datos sana → migraciones → aplicación.
- **Volúmenes con nombre** conservan los datos al recrear contenedores.
- El *healthcheck* de la app: como no hay `curl` en `distroless`, añade al binario un modo `-healthcheck` que haga una petición a `http://127.0.0.1:8080/healthz` y devuelva código de salida 0/1.

```go
if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
	c := http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get("http://127.0.0.1:" + os.Getenv("PORT") + "/healthz")
	if err != nil || resp.StatusCode != http.StatusOK {
		os.Exit(1)
	}
	os.Exit(0)
}
```

Comandos habituales:

```bash
docker compose up -d --build        # construir y arrancar en segundo plano
docker compose ps                   # estado y salud
docker compose logs -f app          # seguir los logs de un servicio
docker compose exec db psql -U tareas -d tareas
docker compose down                 # detener (los volúmenes se conservan)
docker compose down -v              # ¡también borra los datos!
```

## 4. Caddy: proxy inverso con HTTPS automático

**Caddy** es un servidor web/proxy inverso escrito en Go. Su gran característica: **obtiene y renueva certificados TLS de Let's Encrypt automáticamente**. Sin `certbot`, sin crons, sin configuración de certificados.

`Caddyfile`:

```caddyfile
{
	email tu@correo.com            # contacto para Let's Encrypt (avisos de caducidad)
}

tareas.midominio.com {
	encode zstd gzip               # compresión (Módulo 12)

	# Cabeceras de seguridad (refuerzan las que ya envía la app)
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options    "nosniff"
		-Server                    # oculta la cabecera Server
	}

	# Los estáticos con hash en el nombre se cachean un año
	@estaticos path /static/*
	header @estaticos Cache-Control "public, max-age=31536000, immutable"

	# El panel de métricas no se expone
	@privado path /metrics /debug/*
	respond @privado 404

	# Limita el tamaño de las peticiones
	request_body {
		max_size 5MB
	}

	reverse_proxy app:8080 {
		health_uri /healthz
		health_interval 10s
		header_up X-Real-IP {remote_host}
	}

	log {
		output stdout
		format json
	}
}

# Redirección del dominio "desnudo" o de www
www.midominio.com {
	redir https://tareas.midominio.com{uri} permanent
}
```

Para que funcione:

1. Un **servidor** (VPS) con IP pública y Docker instalado.
2. Un **registro DNS tipo A** (y AAAA si tienes IPv6) de `tareas.midominio.com` hacia la IP del servidor.
3. Los puertos **80 y 443** abiertos (Caddy usa el 80 para el desafío ACME y para redirigir a HTTPS).

Al arrancar, Caddy detecta el dominio, solicita el certificado, lo instala y redirige HTTP → HTTPS. Los certificados se renuevan solos. Para pruebas locales usa `localhost` (Caddy genera un certificado local de confianza) o el *staging* de Let's Encrypt para no agotar límites de emisión.

> En la aplicación Go: confía en `X-Forwarded-*`/`X-Real-IP` **solo** si la petición viene del proxy (red interna), y marca `Secure` en las cookies (el navegador ve HTTPS, aunque el tráfico interno sea HTTP).

## 5. Lista de verificación de producción

### Seguridad

- [ ] HTTPS en todo; `Strict-Transport-Security` activado.
- [ ] Contenedores **sin root**, imágenes mínimas, sin herramientas de compilación.
- [ ] Solo el proxy expone puertos; base de datos y Redis en red interna.
- [ ] Secretos en variables de entorno/secrets, **nunca** en Git ni en la imagen.
- [ ] Cortafuegos del servidor (`ufw allow 22,80,443/tcp`), SSH solo con claves, sin login de root.
- [ ] `govulncheck` y escaneo de imágenes (`docker scout`, `trivy`) en la CI.
- [ ] Actualizaciones de seguridad del sistema operativo y de las imágenes base.
- [ ] Limitación de tasa en login y registro.

### Fiabilidad

- [ ] `restart: unless-stopped` y *healthchecks*.
- [ ] Apagado ordenado (`Shutdown`) y `stop_grace_period` coherente.
- [ ] Migraciones automáticas y **reversibles**; despliegues compatibles hacia atrás (la versión nueva del código debe funcionar un momento con el esquema anterior).
- [ ] Límites de recursos (`mem_limit`, `cpus`) y `GOMEMLIMIT` ajustado a ~90 % del límite de memoria.
- [ ] Zona horaria y reloj correctos (UTC en servidores, convierte en la interfaz).

### Datos

- [ ] **Copias de seguridad automáticas** de PostgreSQL, almacenadas **fuera** del servidor.
- [ ] **Prueba de restauración** periódica: una copia que nunca has restaurado no es una copia.
- [ ] Volúmenes persistentes para PostgreSQL y para los certificados de Caddy.

Ejemplo de copia diaria (con `cron` del host):

```bash
#!/usr/bin/env bash
# /opt/tareas/backup.sh
set -euo pipefail
fecha=$(date +%F)
docker compose -f /opt/tareas/compose.yaml exec -T db \
  pg_dump -U tareas -Fc tareas > "/var/backups/tareas/tareas-$fecha.dump"
find /var/backups/tareas -name '*.dump' -mtime +14 -delete    # retención de 14 días
# y sincroniza a almacenamiento externo (rclone, rsync, S3…)
```

```bash
# Restaurar
docker compose exec -T db pg_restore -U tareas -d tareas --clean --if-exists < tareas-2026-10-21.dump
```

### Observabilidad

- [ ] Logs JSON a stdout con rotación (`logging: driver: json-file, options: { max-size: "10m", max-file: "5" }`).
- [ ] `/metrics` accesible solo desde la red interna (Prometheus en la misma red).
- [ ] Alertas sobre disponibilidad, tasa de errores y latencia (Módulo 13).

## 6. Despliegue automatizado

Un flujo sencillo y sólido: **GitHub Actions** construye y publica la imagen; el servidor la descarga.

`.github/workflows/deploy.yml`:

```yaml
name: Desplegar
on:
  push:
    tags: ["v*"]

jobs:
  imagen:
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          build-args: VERSION=${{ github.ref_name }}
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.ref_name }}
            ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  desplegar:
    needs: imagen
    runs-on: ubuntu-latest
    steps:
      - name: Actualizar el servidor por SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVIDOR_HOST }}
          username: ${{ secrets.SERVIDOR_USUARIO }}
          key: ${{ secrets.SERVIDOR_SSH_KEY }}
          script: |
            cd /opt/tareas
            docker compose pull app worker
            docker compose up -d
            docker image prune -f
```

(En el `compose.yaml` del servidor, `app` usaría `image: ghcr.io/TU_USUARIO/tareas:latest` en lugar de `build:`.)

Estrategias de versión y **reversión**: etiqueta cada imagen con la versión (`v1.4.2`), no solo `latest`; así, para volver atrás basta cambiar la etiqueta y `docker compose up -d`. Para despliegues sin interrupción, el patrón *blue/green* con Caddy (dos instancias y cambio de `reverse_proxy`) o un orquestador como Kubernetes; para empezar, Compose en un único servidor es más que suficiente para la mayoría de proyectos.

### Alternativas de alojamiento

- **VPS** (Hetzner, DigitalOcean, OVH…) + Docker Compose: control total y barato (lo que hemos hecho).
- **PaaS** (Fly.io, Railway, Render): subes el `Dockerfile` y ellos gestionan la infraestructura.
- **Binario con `systemd`** sin Docker: perfectamente válido para Go. Copias el ejecutable y creas una unidad:

```ini
# /etc/systemd/system/tareas.service
[Unit]
Description=Tareas
After=network-online.target postgresql.service

[Service]
User=tareas
EnvironmentFile=/etc/tareas/entorno
ExecStart=/opt/tareas/tareas
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

## Práctica

Escribe un `Dockerfile` multi-stage, un `compose.yaml` con la app, PostgreSQL y Redis, y un `Caddyfile` que sirva tu dominio con HTTPS.

<details>
<summary>Ver solución</summary>

1. Añade `.dockerignore`, `Dockerfile`, `compose.yaml`, `Caddyfile` y un `.env` (fuera de Git) con `DB_PASSWORD=$(openssl rand -base64 24)`.
2. Implementa el modo `-healthcheck` en `main.go`.
3. **Local con HTTPS**: pon `localhost` como dirección en el `Caddyfile`, ejecuta `docker compose up -d --build` y abre `https://localhost` (acepta el certificado local de Caddy).
4. Verifica:

```bash
docker compose ps                                # todos "healthy"
curl -I https://localhost -k                     # 200, con cabeceras de seguridad y compresión
docker images | grep tareas                      # tamaño final de la imagen (¡decenas de MB!)
docker compose exec db psql -U tareas -c '\dt'   # tablas creadas por la migración
docker compose down && docker compose up -d      # los datos persisten
```

5. **En un VPS real**: apunta el registro DNS A a su IP, cambia `localhost` por tu dominio, abre 80/443 y ejecuta `docker compose up -d`. Observa en `docker compose logs caddy` cómo se obtiene el certificado.
6. Comprueba el **resultado final**: `https://tu-dominio` con candado válido; `/metrics` devuelve 404 desde fuera; `docker compose ps` muestra que ni PostgreSQL ni Redis publican puertos.
7. Programa la copia de seguridad con `cron` y **prueba a restaurarla** en una base nueva.
8. (Bonus) Añade el workflow de GitHub Actions y haz un despliegue con una etiqueta `v1.0.0`.
</details>

## Errores comunes

- Imagen final basada en el SDK de Go (cientos de MB y superficie de ataque enorme).
- Contenedores corriendo como root.
- Publicar los puertos de PostgreSQL o Redis a internet.
- Meter secretos en la imagen, en el repositorio o en `docker-compose` versionado.
- No persistir el volumen de Caddy (se agotan los límites de emisión de Let's Encrypt).
- Tener copias de seguridad pero nunca haber probado a restaurarlas.
- Usar solo la etiqueta `latest`: imposible volver atrás con seguridad.
- No configurar rotación de logs y llenar el disco.

## Resumen

- `CGO_ENABLED=0` + `go:embed` = **un binario estático** autosuficiente.
- Dockerfile **multi-stage** con `distroless` y usuario no-root: imágenes pequeñas y seguras.
- **Compose** orquesta aplicación, worker, migraciones, PostgreSQL, Redis y proxy; solo Caddy es público.
- **Caddy** da HTTPS automático, compresión y cabeceras con unas pocas líneas.
- Producción es seguridad + fiabilidad + datos + observabilidad: copias probadas, healthchecks, logs, métricas y despliegues reproducibles.

## Autoevaluación

1. ¿Por qué `CGO_ENABLED=0` facilita el despliegue?
2. ¿Qué ventaja tiene una construcción multi-stage?
3. ¿Qué servicios deben tener un puerto publicado y cuáles no? ¿Por qué?
4. ¿Qué hace Caddy por ti respecto a los certificados?
5. ¿Por qué hay que *probar* la restauración de las copias de seguridad?
6. ¿Cómo vuelves a una versión anterior si el despliegue sale mal?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi aplicación corre con `docker compose up -d` y responde por HTTPS.
- [ ] Sé qué parte me costó más y la repasaré.

## ¡Has completado el curso!

Recorriste todo el camino: terminal y HTTP, el lenguaje Go, una arquitectura limpia, web hipermedia con HTMX, PostgreSQL con SQL tipado, concurrencia, seguridad, APIs con OpenAPI, tiempo real y colas, rendimiento, observabilidad, pruebas, apps de escritorio y móviles, y un despliegue profesional. Lo importante: **un dominio, muchos adaptadores**, y cada pieza medible, probada y explícita.

Próximos pasos sugeridos:

1. Publica tu proyecto **Tareas** completo en GitHub, con README, CI y despliegue.
2. Elige un problema real propio y constrúyelo con este stack.
3. Profundiza: *Effective Go*, el blog oficial de Go, el código de la biblioteca estándar y los proyectos de la comunidad.
4. Contribuye: abre issues o propuestas de mejora a este curso.

