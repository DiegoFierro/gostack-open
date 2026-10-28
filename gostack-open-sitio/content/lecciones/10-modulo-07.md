---
title: "Módulo 07: Formularios Dinámicos, OOB Swaps & Estado de Interfaz"
description: "Formularios con validación en servidor y actualizaciones de varias zonas a la vez."
weight: 10
fase: "Fase 2: Bases de datos, estado y concurrencia"
---

## Objetivos

- Validar en el servidor y mostrar errores en línea con HTMX.
- Actualizar múltiples regiones de la pantalla con *Out-of-Band swaps*.
- Implementar búsqueda, filtrado y paginación del lado del servidor.
- Mantener el estado de la interfaz en la URL.

## 1. Validar siempre en el servidor

La validación del navegador (`required`, `type="email"`) mejora la experiencia, pero **cualquiera puede saltársela** con `curl`. La única validación que cuenta es la del servidor. Mantenemos ambas: HTML para comodidad, Go para seguridad.

### Un validador sencillo

```go
package web

import (
	"strings"
	"unicode/utf8"
)

// Errores asocia nombre de campo → mensaje.
type Errores map[string]string

func (e Errores) Vacio() bool { return len(e) == 0 }

type FormTarea struct {
	Titulo  string
	Errores Errores
}

func (f *FormTarea) Validar() {
	f.Errores = Errores{}
	f.Titulo = strings.TrimSpace(f.Titulo)
	switch n := utf8.RuneCountInString(f.Titulo); {
	case n == 0:
		f.Errores["titulo"] = "El título es obligatorio."
	case n > 120:
		f.Errores["titulo"] = "Máximo 120 caracteres."
	}
}
```

Usa `utf8.RuneCountInString` (caracteres) en lugar de `len` (bytes): "ñ" ocupa 2 bytes.

### Plantilla del formulario como parcial

```html
{{define "form-tarea"}}
<form id="form-tarea" hx-post="/tareas" hx-target="this" hx-swap="outerHTML">
  <label for="titulo">Nueva tarea</label>
  <input id="titulo" name="titulo" value="{{.Titulo}}"
         {{if .Errores.titulo}}aria-invalid="true" aria-describedby="err-titulo"{{end}}>
  {{with .Errores.titulo}}<p id="err-titulo" class="error" role="alert">{{.}}</p>{{end}}
  <button>Añadir</button>
</form>
{{end}}
```

(`{{.Errores.titulo}}` funciona porque `Errores` es un mapa de strings; si la clave no existe, devuelve cadena vacía y `if` es falso.) Los atributos `aria-*` hacen que los lectores de pantalla anuncien el error.

### El handler

```go
func (s *Servidor) crear(w http.ResponseWriter, r *http.Request) {
	form := FormTarea{Titulo: r.FormValue("titulo")}
	form.Validar()

	if !form.Errores.Vacio() {
		w.WriteHeader(http.StatusUnprocessableEntity) // 422
		s.vistas.Parcial(w, "tareas.html", "form-tarea", form)
		return
	}

	t, err := s.svc.Crear(r.Context(), form.Titulo)
	if err != nil {
		http.Error(w, "error interno", http.StatusInternalServerError)
		return
	}
	// ... respuesta de éxito (ver sección 2)
	_ = t
}
```

### Hacer que HTMX muestre los `422`

Por defecto, HTMX 2 **ignora** las respuestas `4xx`/`5xx` (no cambia el DOM). Los errores de validación son respuestas legítimas con contenido, así que hay que indicarle que las intercambie. En el `<head>` del layout:

```html
<meta name="htmx-config" content='{
  "responseHandling": [
    {"code": "204", "swap": false},
    {"code": "[23]..", "swap": true},
    {"code": "422", "swap": true, "error": false},
    {"code": "[45]..", "swap": false, "error": true},
    {"code": "...", "swap": false}
  ]
}'>
```

Se evalúan en orden: éxitos y redirecciones se intercambian; `422` también (y no se cuenta como error); el resto de `4xx/5xx` no.

## 2. Out-of-Band swaps: actualizar varias zonas a la vez

Una petición HTMX normal actualiza **un** destino (`hx-target`). Pero al crear una tarea quizá quieras cambiar tres cosas: añadir el `<li>`, actualizar el contador "3 pendientes" y limpiar el formulario.

**OOB (*out of band*)**: la respuesta incluye fragmentos adicionales marcados con `hx-swap-oob`; HTMX los extrae y los coloca **por `id`** en otras zonas, además del swap principal.

```html
<!-- Respuesta del servidor al crear una tarea -->

<!-- 1) Formulario limpio: es el swap principal (target = form) -->
{{template "form-tarea" .Form}}

<!-- 2) OOB: se añade al final de #lista -->
<ul id="lista" hx-swap-oob="beforeend">
  {{template "tarea-item" .Tarea}}
</ul>

<!-- 3) OOB: se reemplaza el contador -->
<span id="contador" hx-swap-oob="true">{{.Pendientes}} pendientes</span>
```

Valores de `hx-swap-oob`: `true` (equivale a `outerHTML` sobre el elemento con ese `id`), o una estrategia (`beforeend`, `innerHTML`, `delete`…), opcionalmente con selector: `beforeend:#lista`.

Un detalle importante: con `hx-swap-oob="beforeend"` el elemento de la respuesta es solo un **contenedor**; HTMX inserta sus *hijos* en `#lista`.

Handler completo:

```go
func (s *Servidor) crear(w http.ResponseWriter, r *http.Request) {
	form := FormTarea{Titulo: r.FormValue("titulo")}
	form.Validar()
	if !form.Errores.Vacio() {
		w.WriteHeader(http.StatusUnprocessableEntity)
		s.vistas.Parcial(w, "tareas.html", "form-tarea", form)
		return
	}

	t, err := s.svc.Crear(r.Context(), form.Titulo)
	if err != nil {
		http.Error(w, "error interno", http.StatusInternalServerError)
		return
	}
	pend, _ := s.svc.ContarPendientes(r.Context())

	if !esHTMX(r) {
		http.Redirect(w, r, "/tareas", http.StatusSeeOther)
		return
	}
	s.vistas.Parcial(w, "tareas.html", "crear-ok", map[string]any{
		"Form":       FormTarea{},   // formulario vacío
		"Tarea":      t,
		"Pendientes": pend,
	})
}
```

Con la plantilla `crear-ok` que contiene los tres bloques de arriba. El mismo `<span id="contador">` debe existir en la página principal para que HTMX lo encuentre.

> OOB es la herramienta para "estado derivado" repartido por la pantalla (contadores, avisos, menús). Evita abusar: si cada acción actualiza diez zonas, quizá convenga un solo fragmento mayor.

## 3. Tablas interactivas: búsqueda, filtros y paginación

Todo el estado vive en la **URL** (query string): la página es *enlazable*, funciona con el botón "Atrás" y sin JavaScript. HTMX solo acelera.

### Consulta con filtro y paginación (sqlc)

```sql
-- name: BuscarTareas :many
SELECT * FROM tareas
WHERE (@busqueda::text = '' OR titulo ILIKE '%' || @busqueda::text || '%')
  AND (@estado::text = 'todas'
       OR (@estado::text = 'pendientes'   AND NOT hecha)
       OR (@estado::text = 'completadas'  AND hecha))
ORDER BY id DESC
LIMIT @limite::int OFFSET @desplazamiento::int;

-- name: ContarTareas :one
SELECT count(*) FROM tareas
WHERE (@busqueda::text = '' OR titulo ILIKE '%' || @busqueda::text || '%')
  AND (@estado::text = 'todas'
       OR (@estado::text = 'pendientes'   AND NOT hecha)
       OR (@estado::text = 'completadas'  AND hecha));
```

`sqlc` convierte los parámetros nombrados `@busqueda` etc. en campos de una struct de parámetros.

### Parámetros y estructura de página

```go
type Consulta struct {
	Busqueda string
	Estado   string // todas | pendientes | completadas
	Pagina   int
}

const porPagina = 10

func consultaDe(r *http.Request) Consulta {
	q := r.URL.Query()
	c := Consulta{Busqueda: strings.TrimSpace(q.Get("q")), Estado: q.Get("estado"), Pagina: 1}
	if n, err := strconv.Atoi(q.Get("pagina")); err == nil && n > 1 {
		c.Pagina = n
	}
	switch c.Estado {
	case "pendientes", "completadas":
	default:
		c.Estado = "todas" // lista blanca: nunca confíes en el valor recibido
	}
	return c
}

type Pagina struct {
	Tareas      []tarea.Tarea
	Consulta    Consulta
	Total       int64
	TotalPaginas int
}

func (p Pagina) Anterior() int  { return max(p.Consulta.Pagina-1, 1) }
func (p Pagina) Siguiente() int { return min(p.Consulta.Pagina+1, p.TotalPaginas) }
```

### Plantilla

```html
{{define "tabla-tareas"}}
<div id="tabla-tareas">
  <ul id="lista">
    {{range .Tareas}}{{template "tarea-item" .}}{{else}}<li>Sin resultados.</li>{{end}}
  </ul>

  <nav aria-label="Paginación">
    {{if gt .Consulta.Pagina 1}}
      <a href="?q={{.Consulta.Busqueda}}&estado={{.Consulta.Estado}}&pagina={{.Anterior}}"
         hx-get="/tareas?q={{.Consulta.Busqueda}}&estado={{.Consulta.Estado}}&pagina={{.Anterior}}"
         hx-target="#tabla-tareas" hx-swap="outerHTML" hx-push-url="true">← Anterior</a>
    {{end}}
    <span>Página {{.Consulta.Pagina}} de {{.TotalPaginas}}</span>
    {{if lt .Consulta.Pagina .TotalPaginas}}
      <a href="?q={{.Consulta.Busqueda}}&estado={{.Consulta.Estado}}&pagina={{.Siguiente}}"
         hx-get="/tareas?q={{.Consulta.Busqueda}}&estado={{.Consulta.Estado}}&pagina={{.Siguiente}}"
         hx-target="#tabla-tareas" hx-swap="outerHTML" hx-push-url="true">Siguiente →</a>
    {{end}}
  </nav>
</div>
{{end}}
```

Observa el patrón: cada enlace tiene `href` real (funciona sin JS) **y** `hx-get` (carga parcial, `hx-push-url` actualiza la barra de direcciones). Alternativa más corta: `hx-boost="true"` en un contenedor, que hace esto automáticamente con todos sus enlaces.

`html/template` escapa las URLs de forma contextual; aun así, nunca construyas rutas concatenando entrada del usuario sin pasar por la plantilla.

### Búsqueda en vivo y filtro

```html
<form id="filtros" hx-get="/tareas" hx-target="#tabla-tareas" hx-swap="outerHTML" hx-push-url="true"
      hx-trigger="input changed delay:300ms from:#q, change from:#estado">
  <input id="q" type="search" name="q" value="{{.Consulta.Busqueda}}" placeholder="Buscar…">
  <select id="estado" name="estado">
    <option value="todas"       {{if eq .Consulta.Estado "todas"}}selected{{end}}>Todas</option>
    <option value="pendientes"  {{if eq .Consulta.Estado "pendientes"}}selected{{end}}>Pendientes</option>
    <option value="completadas" {{if eq .Consulta.Estado "completadas"}}selected{{end}}>Completadas</option>
  </select>
</form>
```

En el handler, si la petición es HTMX devuelves solo `tabla-tareas`; si no, la página completa.

### Paginación: OFFSET vs. keyset

`LIMIT/OFFSET` es simple pero lento en tablas enormes (la base de datos recorre y descarta las filas anteriores). Para listas muy grandes usa **paginación por cursor** (*keyset*): `WHERE id < $ultimo_id ORDER BY id DESC LIMIT 10`, con un botón "Cargar más". Para un panel con miles de filas, OFFSET es perfectamente aceptable.

## 4. Estado de interfaz: dónde guardarlo

| Tipo de estado | Dónde vive | Ejemplo |
|----------------|------------|---------|
| Navegación y filtros | **URL** (query string) | `?q=go&pagina=2` |
| Datos del negocio | **Base de datos** | las tareas |
| Identidad | **Sesión/cookie** | usuario autenticado (Módulo 09) |
| Efímero y local | **Atributos HTML / CSS** | `<details open>`, pestañas |

Regla: lo que el usuario querría **compartir o recargar** va en la URL.

## Práctica

Añade un formulario con validación (título obligatorio, máximo 120 caracteres), devuelve el HTML con errores en línea y actualiza un contador de tareas con `hx-swap-oob`. Agrega búsqueda y paginación a la tabla.

<details>
<summary>Ver solución</summary>

1. Implementa `FormTarea.Validar` y el parcial `form-tarea` (sección 1).
2. Añade la `<meta name="htmx-config">` para intercambiar los `422`.
3. Añade `ContarPendientes` al servicio/repositorio con `SELECT count(*) FROM tareas WHERE NOT hecha`.
4. Crea la plantilla `crear-ok` (formulario vacío + `<ul id="lista" hx-swap-oob="beforeend">` + contador OOB).
5. Implementa `BuscarTareas` / `ContarTareas` con `sqlc generate`, `consultaDe`, y el cálculo `TotalPaginas = ceil(total / porPagina)`.
6. Pruebas manuales: envía un título vacío (verás el error en línea sin recargar); crea 25 tareas y navega por las 3 páginas; recarga en la página 2 (la URL conserva el estado).
</details>

## Errores comunes

- Confiar solo en la validación del navegador.
- No configurar `responseHandling` y preguntarse por qué "no pasa nada" al recibir un `422`.
- Ids duplicados o ausentes en los fragmentos OOB (HTMX no encuentra el destino).
- Aceptar sin lista blanca valores de ordenación o filtro que acaban en SQL.
- Guardar en la sesión lo que debería estar en la URL.

## Resumen

- Valida **siempre** en el servidor; responde `422` con el parcial del formulario y errores en línea.
- OOB swaps actualizan varias zonas con una sola respuesta.
- Búsqueda, filtros y paginación del lado del servidor con el estado en la URL; `href` + `hx-get` da mejora progresiva.

## Autoevaluación

1. ¿Por qué no basta con `required` en el HTML?
2. ¿Qué problema resuelven los OOB swaps?
3. ¿Qué hace por defecto HTMX con una respuesta `422` y cómo lo cambias?
4. ¿Por qué el estado de filtros y página va en la URL?
5. ¿Cuándo preferirías paginación *keyset* sobre `OFFSET`?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi formulario muestra errores en línea y el contador se actualiza solo.
- [ ] Sé qué parte me costó más y la repasaré.

