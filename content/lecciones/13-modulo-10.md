---
title: "Módulo 10: Especialización de APIs: OpenAPI & Generación de Código (oapi-codegen)"
description: "Diseña el contrato primero y deja que el código se genere a partir de él."
weight: 13
fase: "Fase 3: Seguridad, APIs y tiempo real"
---

> Diseña el contrato primero y deja que el código se genere a partir de él.

**Fase 3: Seguridad, APIs y tiempo real** · Lección 13 de 20

## 🎯 Objetivos

- Describir una API REST en OpenAPI 3.0 (YAML) siguiendo el enfoque *API-First*.
- Generar tipos y servidor en Go con `oapi-codegen`.
- Implementar la interfaz generada reutilizando el servicio de dominio.
- Embeber Swagger UI en el binario con `go:embed`.

## 1. ¿Por qué una API además de HTML?

Hasta ahora el servidor devuelve **HTML para humanos** con HTMX. Pero tu aplicación necesitará hablar con **otros programas**: la app de escritorio (Módulo 15), la móvil (Módulo 16), integraciones de terceros, scripts. Para ellos el formato adecuado es **JSON** sobre una API REST documentada.

Lo mejor: ambas interfaces comparten el **mismo dominio** (`tarea.Servicio`). Las dos son solo adaptadores distintos, tal como dibujamos en el Módulo 03:

```text
 HTML/HTMX (web) ─┐
                  ├──▶ tarea.Servicio ──▶ Repositorio ──▶ PostgreSQL
 JSON (api)     ──┘
```

## 2. API-First y OpenAPI

**API-First**: se diseña y acuerda **primero el contrato** de la API y luego se implementa. Beneficios: el equipo de la app móvil puede empezar antes de que exista el servidor, la documentación nunca queda desactualizada (es la fuente), y se evitan discrepancias entre lo documentado y lo implementado.

**OpenAPI** (antes Swagger) es el estándar para describir APIs REST en un archivo YAML o JSON: rutas, métodos, parámetros, cuerpos, respuestas, errores, seguridad.

`api/openapi.yaml`:

```yaml
openapi: 3.0.3
info:
  title: API de Tareas
  version: 1.0.0
  description: API JSON del curso GoStack Open.
servers:
  - url: http://localhost:8080/api/v1

paths:
  /tareas:
    get:
      operationId: listarTareas
      summary: Lista las tareas
      parameters:
        - name: estado
          in: query
          schema: { type: string, enum: [todas, pendientes, completadas], default: todas }
        - name: limite
          in: query
          schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
      responses:
        "200":
          description: Lista de tareas
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/Tarea" }
        "401": { $ref: "#/components/responses/NoAutenticado" }
    post:
      operationId: crearTarea
      summary: Crea una tarea
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/NuevaTarea" }
      responses:
        "201":
          description: Tarea creada
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Tarea" }
        "422":
          description: Datos inválidos
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
        "401": { $ref: "#/components/responses/NoAutenticado" }

  /tareas/{id}:
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: integer, format: int64 }
    get:
      operationId: obtenerTarea
      summary: Obtiene una tarea
      responses:
        "200":
          description: La tarea
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Tarea" }
        "404":
          description: No existe
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
    patch:
      operationId: actualizarTarea
      summary: Modifica parcialmente una tarea
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ActualizarTarea" }
      responses:
        "200":
          description: Tarea actualizada
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Tarea" }
        "404":
          description: No existe
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }
    delete:
      operationId: eliminarTarea
      summary: Elimina una tarea
      responses:
        "204": { description: Eliminada }
        "404":
          description: No existe
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Error" }

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
  schemas:
    Tarea:
      type: object
      required: [id, titulo, hecha, creada_en]
      properties:
        id:        { type: integer, format: int64, example: 7 }
        titulo:    { type: string, example: Aprender Go }
        hecha:     { type: boolean }
        creada_en: { type: string, format: date-time }
    NuevaTarea:
      type: object
      required: [titulo]
      properties:
        titulo: { type: string, minLength: 1, maxLength: 120 }
    ActualizarTarea:
      type: object
      properties:
        titulo: { type: string, minLength: 1, maxLength: 120 }
        hecha:  { type: boolean }
    Error:
      type: object
      required: [mensaje]
      properties:
        mensaje: { type: string }
        campos:
          type: object
          additionalProperties: { type: string }
  responses:
    NoAutenticado:
      description: Falta el token o es inválido
      content:
        application/json:
          schema: { $ref: "#/components/schemas/Error" }

security:
  - bearerAuth: []
```

Buenas prácticas de diseño REST:

- Recursos en **plural** y sustantivos: `/tareas`, `/tareas/{id}` (no `/obtenerTareas`).
- El **método** expresa la acción; el **código de estado** el resultado (Módulo -00).
- **Versiona** la API en la ruta (`/api/v1`).
- Errores con un formato **uniforme**.
- Cada operación con un `operationId` único: de él nace el nombre del método Go.

## 3. Generación de código con `oapi-codegen`

```bash
go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
```

Configuración `api/cfg.yaml`:

```yaml
package: api
output: internal/api/api.gen.go
generate:
  models: true          # structs Tarea, NuevaTarea, Error…
  std-http-server: true # integración con net/http (ServeMux de Go 1.22+)
  strict-server: true   # interfaz con tipos de petición/respuesta fuertemente tipados
```

Y el generador, anotado en Go para ejecutarlo con `go generate ./...`:

```go
// internal/api/generate.go
package api

//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen -config ../../api/cfg.yaml ../../api/openapi.yaml
```

```bash
go generate ./internal/api
```

Qué obtienes en `api.gen.go` (resumido):

```go
type Tarea struct {
	CreadaEn time.Time `json:"creada_en"`
	Hecha    bool      `json:"hecha"`
	Id       int64     `json:"id"`
	Titulo   string    `json:"titulo"`
}

type StrictServerInterface interface {
	ListarTareas(ctx context.Context, request ListarTareasRequestObject) (ListarTareasResponseObject, error)
	CrearTarea(ctx context.Context, request CrearTareaRequestObject) (CrearTareaResponseObject, error)
	ObtenerTarea(ctx context.Context, request ObtenerTareaRequestObject) (ObtenerTareaResponseObject, error)
	ActualizarTarea(ctx context.Context, request ActualizarTareaRequestObject) (ActualizarTareaResponseObject, error)
	EliminarTarea(ctx context.Context, request EliminarTareaRequestObject) (EliminarTareaResponseObject, error)
}

// Tipos de respuesta: uno por cada código documentado
type ListarTareas200JSONResponse []Tarea
type CrearTarea201JSONResponse Tarea
type ObtenerTarea404JSONResponse Error
type EliminarTarea204Response struct{}

func NewStrictHandler(ssi StrictServerInterface, middlewares []StrictMiddlewareFunc) ServerInterface
func HandlerFromMux(si ServerInterface, m ServeMux) http.Handler // o HandlerWithOptions
```

**La magia del modo estricto**: si tu implementación intenta devolver un código que no está en el contrato, **no compila**. Si cambias el YAML y regeneras, el compilador te señala qué handlers hay que ajustar. Contrato y código no pueden divergir.

> Los nombres exactos (`Id` vs `ID`, tipos de parámetros) dependen de la versión; revisa `api.gen.go`. Los campos opcionales se generan como punteros (`*string`, `*bool`).

## 4. Implementar la interfaz

La implementación es **fina**: traduce entre los tipos de la API y el dominio.

```go
package apihttp

import (
	"context"
	"errors"

	"github.com/TU_USUARIO/tareas/internal/api"
	"github.com/TU_USUARIO/tareas/internal/tarea"
)

type Servidor struct{ svc *tarea.Servicio }

func Nuevo(svc *tarea.Servicio) *Servidor { return &Servidor{svc: svc} }

var _ api.StrictServerInterface = (*Servidor)(nil)

func aAPI(t tarea.Tarea) api.Tarea {
	return api.Tarea{Id: t.ID, Titulo: t.Titulo, Hecha: t.Hecha, CreadaEn: t.CreadaEn}
}

func (s *Servidor) ListarTareas(ctx context.Context, _ api.ListarTareasRequestObject) (api.ListarTareasResponseObject, error) {
	ts, err := s.svc.Listar(ctx)
	if err != nil {
		return nil, err // el manejador de errores devolverá un 500
	}
	res := make(api.ListarTareas200JSONResponse, len(ts))
	for i, t := range ts {
		res[i] = aAPI(t)
	}
	return res, nil
}

func (s *Servidor) CrearTarea(ctx context.Context, req api.CrearTareaRequestObject) (api.CrearTareaResponseObject, error) {
	t, err := s.svc.Crear(ctx, req.Body.Titulo)
	if errors.Is(err, tarea.ErrTituloVacio) {
		return api.CrearTarea422JSONResponse{Mensaje: err.Error()}, nil
	}
	if err != nil {
		return nil, err
	}
	return api.CrearTarea201JSONResponse(aAPI(t)), nil
}

func (s *Servidor) ObtenerTarea(ctx context.Context, req api.ObtenerTareaRequestObject) (api.ObtenerTareaResponseObject, error) {
	t, err := s.svc.Obtener(ctx, req.Id)
	if errors.Is(err, tarea.ErrNoEncontrada) {
		return api.ObtenerTarea404JSONResponse{Mensaje: "tarea no encontrada"}, nil
	}
	if err != nil {
		return nil, err
	}
	return api.ObtenerTarea200JSONResponse(aAPI(t)), nil
}

func (s *Servidor) EliminarTarea(ctx context.Context, req api.EliminarTareaRequestObject) (api.EliminarTareaResponseObject, error) {
	err := s.svc.Eliminar(ctx, req.Id)
	if errors.Is(err, tarea.ErrNoEncontrada) {
		return api.EliminarTarea404JSONResponse{Mensaje: "tarea no encontrada"}, nil
	}
	if err != nil {
		return nil, err
	}
	return api.EliminarTarea204Response{}, nil
}

// ActualizarTarea sigue el mismo patrón (omitido por brevedad).
```

Montaje en el enrutador principal:

```go
apiSrv := api.NewStrictHandler(apihttp.Nuevo(svc), nil)
api.HandlerWithOptions(apiSrv, api.StdHTTPServerOptions{
	BaseRouter: mux,
	BaseURL:    "/api/v1",
})
```

Un detalle valioso: el mismo `Servicio` y el mismo repositorio sirven a HTML y a JSON. Las reglas de negocio no se duplican.

**Validación de peticiones contra el contrato**: el middleware `github.com/oapi-codegen/nethttp-middleware` (con `kin-openapi`) rechaza automáticamente peticiones que no cumplan el esquema (tipos, rangos, campos obligatorios), así que el YAML es también tu validador.

**Autenticación de la API**: usa un middleware que lea `Authorization: Bearer …` y verifique la JWT del Módulo 09; el HTML sigue usando cookies.

## 5. Swagger UI dentro del binario

**Swagger UI** es una interfaz web que lee tu `openapi.yaml` y permite explorar y **probar** la API desde el navegador. Queremos servirla **desde el propio binario**, sin depender de una CDN ni archivos externos, con `go:embed`.

1. Obtén los archivos estáticos de Swagger UI (paquete npm `swagger-ui-dist`). Necesitas `swagger-ui.css`, `swagger-ui-bundle.js` y `swagger-ui-standalone-preset.js`; colócalos en `internal/docs/swagger/`:

```bash
mkdir -p internal/docs/swagger && cd internal/docs/swagger
npm pack swagger-ui-dist && tar -xzf swagger-ui-dist-*.tgz
cp package/swagger-ui.css package/swagger-ui-bundle.js package/swagger-ui-standalone-preset.js .
rm -rf package swagger-ui-dist-*.tgz
```

2. Copia o referencia tu contrato (`openapi.yaml`) en el mismo paquete, y escribe un `index.html`:

```html
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>API de Tareas — Documentación</title>
  <link rel="stylesheet" href="swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="swagger-ui-bundle.js"></script>
  <script src="swagger-ui-standalone-preset.js"></script>
  <script src="iniciar.js"></script>
</body>
</html>
```

`iniciar.js` (archivo aparte para no necesitar scripts *inline* con tu CSP):

```js
window.ui = SwaggerUIBundle({
  url: "openapi.yaml",
  dom_id: "#swagger-ui",
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: "StandaloneLayout",
});
```

3. Incrústalo y sírvelo:

```go
package docs

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed swagger/*
var contenido embed.FS

func Handler() http.Handler {
	sub, _ := fs.Sub(contenido, "swagger")
	return http.StripPrefix("/docs/", http.FileServer(http.FS(sub)))
}
```

```go
mux.Handle("GET /docs/", docs.Handler())
mux.HandleFunc("GET /docs", func(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/docs/", http.StatusMovedPermanently)
})
```

Como la CSP del Módulo 09 es estricta, tendrás que relajarla **solo** para `/docs/` (Swagger UI usa estilos *inline*), o servirla con una política propia.

Resultado: `go build` produce **un único binario** que contiene API, interfaz web y documentación interactiva en `/docs/`.

## 🧪 Práctica

Escribe `openapi.yaml` para `/api/v1/tareas`, genera el servidor, implementa la interfaz generada y sirve Swagger UI en `/docs/` embebido en el binario.

<details>
<summary>Ver solución</summary>

```bash
# 1. Contrato y configuración (esta lección)
# 2. Generar
go generate ./internal/api && go build ./...
# 3. Implementar internal/apihttp (ListarTareas, CrearTarea, ObtenerTarea, ActualizarTarea, EliminarTarea)
# 4. Montar en main y en el mux; embeber Swagger UI
go run ./cmd/tareas
```

Pruebas:

```bash
curl -s localhost:8080/api/v1/tareas | jq
curl -s -X POST localhost:8080/api/v1/tareas \
     -H 'Content-Type: application/json' -d '{"titulo":"Probar la API"}' | jq
curl -i localhost:8080/api/v1/tareas/9999      # 404 con cuerpo JSON {"mensaje": "..."}
```

Abre `http://localhost:8080/docs/`, pulsa *Try it out* en `POST /tareas` y verifica que obtienes `201`. Comprueba además que `go build` genera un solo ejecutable que sirve la documentación desde cualquier carpeta.

Experimento: elimina `"404"` de `obtenerTarea` en el YAML, regenera y observa cómo el compilador rechaza tu handler que devuelve `ObtenerTarea404JSONResponse`.
</details>

## ⚠️ Errores comunes

- Editar `api.gen.go` a mano (se sobrescribe en la siguiente generación).
- Un contrato "decorativo" que nadie actualiza: si la API cambia, cambia primero el YAML.
- Meter reglas de negocio en la capa de la API en vez de en el servicio.
- Exponer en la API los tipos internos de base de datos.
- Documentación de Swagger sin autenticación en producción cuando la API es privada.

## 📌 Resumen

- API-First: el contrato OpenAPI (YAML) es la fuente de verdad.
- `oapi-codegen` genera modelos y una interfaz estricta que el compilador obliga a cumplir.
- La capa API es un adaptador delgado sobre el mismo dominio que usa el HTML.
- Swagger UI se incrusta con `go:embed`: documentación interactiva dentro del binario.

## ✅ Autoevaluación

1. ¿Qué significa API-First y qué ventaja aporta al trabajo en equipo?
2. ¿Qué ocurre si cambias el YAML y regeneras? ¿Quién te avisa de lo que debes ajustar?
3. ¿Por qué la implementación de la API reutiliza `tarea.Servicio`?
4. ¿Qué papel cumple `operationId`?
5. ¿Cómo logras que la documentación viaje dentro del binario?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] `/docs/` muestra Swagger UI y puedo crear una tarea desde ahí.
- [ ] Sé qué parte me costó más y la repasaré.

