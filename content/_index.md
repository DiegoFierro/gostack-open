---
title: "GoStack Open"
---

> **Aprende a construir aplicaciones de nivel de producción (Web, Escritorio y Móvil) usando Go como tecnología central.**

Un programa de formación completo diseñado para llevarte desde los fundamentos absolutos de la computación, la terminal y la web, hasta el desarrollo de aplicaciones fullstack de alto rendimiento, interfaces de escritorio, apps móviles y despliegues en producción.

---

## 🎯 Objetivo del Curso

Diseñar, desarrollar y desplegar una arquitectura completa **Full Stack** con un único lenguaje: **Go**. Al finalizar, serás capaz de:

1. **Dominar el lenguaje**: punteros, composición, interfaces implícitas y manejo idiomático de errores.
2. **Construir aplicaciones web modernas** basadas en Hypermedia (*HTML Over the Wire*) con HTMX, sin frameworks pesados de JavaScript.
3. **Aprovechar la concurrencia nativa (CSP)** con goroutines, channels y `context.Context`.
4. **Crear clientes nativos multiplataforma** para escritorio (Wails) y móvil (Fyne).
5. **Desplegar a producción** con binarios estáticos, Docker multi-stage y Caddy con HTTPS automático.

---

## 🛠️ Stack Tecnológico Oficial (GoStack)

El curso utiliza un **stack acotado y estándar de la industria**:

| Capa | Tecnología | Función Principal |
| --- | --- | --- |
| **Entorno & Tooling** | Go toolchain + `golangci-lint` + `gofmt` | Módulos, análisis estático y formateo automático. |
| **Arquitectura** | `envconfig` / `cleanenv` + Patrón Repository | Configuración tipada y proyectos desacoplados. |
| **Backend Core** | `net/http` + `html/template` | Servidor nativo, middlewares y renderizado en servidor. |
| **Frontend Web** | HTMX + HTML5 Nativo + View Transitions | Interactividad directa sin JavaScript complejo. |
| **Base de Datos** | PostgreSQL + `pgx` + `sqlc` + `golang-migrate` | SQL tipado, migraciones y persistencia relacional. |
| **API & Tiempo Real** | OpenAPI + `oapi-codegen` + WebSockets | APIs API-First y comunicación bidireccional. |
| **Concurrencia & Segundo Plano** | Goroutines + Channels + Asynq + Redis | Concurrencia CSP y colas de tareas asíncronas. |
| **Observabilidad & Calidad** | `log/slog` + Prometheus + OpenTelemetry + `testing` | Logs estructurados, métricas, pruebas y benchmarks. |
| **Cliente Nativo** | Wails + Fyne | Apps de escritorio (`.exe`, `.app`, `.deb`) y móvil (`.apk`). |
| **Infraestructura** | Docker Compose + Caddy | Contenerización y despliegue con HTTPS automático. |

---

## 🛣️ Las Fases del Programa

- **Fase -1 & 0:** Fundamentos, terminal y mentalidad Go (5 módulos)
- **Fase 1:** Arquitectura, configuración y web hipermedia (3 módulos)
- **Fase 2:** Bases de datos, estado y concurrencia (3 módulos)
- **Fase 3:** Seguridad, APIs y tiempo real (3 módulos)
- **Fase 4:** Rendimiento, observabilidad, escritorio y producción (6 módulos)

Consulta el detalle completo en el [Syllabus]({{< relref "syllabus" >}}).

---

## 📋 Requisitos Previos

El curso parte desde cero, por lo que no necesitas experiencia previa. Es recomendable contar con:

- **Un computador** con Windows, macOS o Linux y permisos para instalar software.
- **Ganas de practicar:** cada módulo se aprende escribiendo código.
- **Curiosidad por la web:** los primeros módulos cubren terminal, Git y HTTP.
