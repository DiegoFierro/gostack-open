---
title: "Módulo 04: Servidores Web Nativos & Filosofía Hipermedia"
description: "Un servidor completo con la librería estándar, middlewares y plantillas HTML."
weight: 7
fase: "Fase 1: Arquitectura, configuración y web hipermedia"
---

## Objetivos

- Registrar rutas con métodos y comodines en `net/http`.
- Escribir middlewares como `http.Handler`.
- Renderizar HTML en el servidor con `html/template`.
- Arrancar y detener el servidor de forma correcta (timeouts y apagado ordenado).

## 1. El servidor mínimo

```go
package main

import (
	"fmt"
	"log"
	"net/http"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hola desde Go")
	})
	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

Todo gira en torno a dos tipos:

- **`http.Request`**: la petición (método, URL, cabeceras, cuerpo, formulario).
- **`http.ResponseWriter`**: por donde escribes la respuesta (cabeceras → estado → cuerpo, **en ese orden**).

Y una interfaz fundamental:

```go
type Handler interface {
	ServeHTTP(http.ResponseWriter, *http.Request)
}
```

`http.HandlerFunc` adapta cualquier función con esa firma a `Handler`. Cada servidor, enrutador y middleware en Go es un `Handler` que envuelve o delega a otro.

## 2. Enrutamiento moderno (Go 1.22+)

El `ServeMux` estándar admite **métodos, comodines y patrones**; ya no necesitas un enrutador externo para la mayoría de aplicaciones:

```go
mux := http.NewServeMux()

mux.HandleFunc("GET /tareas", listar)               // solo GET
mux.HandleFunc("POST /tareas", crear)
mux.HandleFunc("GET /tareas/{id}", ver)              // comodín de un segmento
mux.HandleFunc("DELETE /tareas/{id}", eliminar)
mux.HandleFunc("GET /archivos/{ruta...}", archivos)  // resto de la ruta
mux.HandleFunc("GET /{$}", inicio)                   // SOLO la raíz exacta "/"
mux.Handle("GET /static/", http.StripPrefix("/static/", fileServer))
```

Lectura de datos de la petición:

```go
func ver(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")                 // /tareas/42 → "42"
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "id inválido", http.StatusBadRequest)
		return
	}
	q := r.URL.Query().Get("pagina")           // ?pagina=2
	r.ParseForm()                              // formularios (POST)
	titulo := r.FormValue("titulo")            // campo de formulario o query
	_ = q; _ = titulo; _ = id
}
```

Reglas de precedencia: gana el patrón **más específico**; `GET` también atiende `HEAD`; un método no permitido en una ruta existente devuelve automáticamente `405 Method Not Allowed`.

Escribir respuestas:

```go
w.Header().Set("Content-Type", "text/plain; charset=utf-8")
w.WriteHeader(http.StatusCreated)  // si no lo llamas, será 200
fmt.Fprint(w, "creado")

http.Redirect(w, r, "/tareas", http.StatusSeeOther) // 303: patrón Post/Redirect/Get
http.NotFound(w, r)
```

## 3. Middlewares

Un **middleware** es una función que recibe un `Handler` y devuelve otro, añadiendo comportamiento antes y/o después. Sirven para registro, autenticación, recuperación de errores, compresión, métricas…

```go
type Middleware func(http.Handler) http.Handler
```

Un registro de peticiones:

```go
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inicio := time.Now()
		rec := &respuestaRegistrada{ResponseWriter: w, estado: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s -> %d (%s)", r.Method, r.URL.Path, rec.estado, time.Since(inicio))
	})
}

// Envoltorio para capturar el código de estado que escribe el handler.
type respuestaRegistrada struct {
	http.ResponseWriter
	estado int
}

func (r *respuestaRegistrada) WriteHeader(code int) {
	r.estado = code
	r.ResponseWriter.WriteHeader(code)
}
```

Recuperación de *panics* para que un error en un handler no tumbe la conexión:

```go
func Recuperar(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v\n%s", rec, debug.Stack())
				http.Error(w, "error interno", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
```

Una utilidad para encadenarlos (el primero de la lista queda más externo):

```go
func Encadenar(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// uso:
handler := Encadenar(mux, Recuperar, Logging)
```

Orden recomendado (de afuera hacia adentro): recuperación → ID de petición → registro → autenticación → handler.

## 4. Plantillas con `html/template`

`html/template` genera HTML y **escapa automáticamente** según el contexto (HTML, atributo, URL, JS), lo que neutraliza la mayoría de ataques XSS. Úsalo **siempre** en lugar de `text/template` para HTML.

### Sintaxis esencial

```html
{{.Titulo}}                      <!-- imprime un campo -->
{{if .Hecha}}✔{{else}}○{{end}}   <!-- condicional -->
{{range .Tareas}}                <!-- bucle; dentro, "." es cada elemento -->
  <li>{{.Titulo}}</li>
{{else}}
  <li>No hay tareas</li>
{{end}}
{{with .Usuario}}Hola {{.Nombre}}{{end}}
{{template "formulario" .}}      <!-- invoca otra plantilla -->
{{- /* los guiones recortan espacios */ -}}
```

### Estructura con layout base

`internal/web/templates/base.html`:

```html
{{define "base"}}
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{template "titulo" .}} — Tareas</title>
  <link rel="stylesheet" href="/static/estilos.css">
</head>
<body>
  <header><a href="/tareas">Tareas</a></header>
  <main>{{template "contenido" .}}</main>
</body>
</html>
{{end}}
```

`internal/web/templates/tareas.html`:

```html
{{define "titulo"}}Mis tareas{{end}}

{{define "contenido"}}
<h1>Mis tareas</h1>
<form method="post" action="/tareas">
  <input name="titulo" placeholder="Nueva tarea" required>
  <button>Añadir</button>
</form>
<ul id="lista">
  {{range .Tareas}}
    <li>{{if .Hecha}}<s>{{.Titulo}}</s>{{else}}{{.Titulo}}{{end}}</li>
  {{else}}
    <li>No hay tareas todavía.</li>
  {{end}}
</ul>
{{end}}
```

### Cargar las plantillas (incrustadas en el binario)

Se analiza **cada página junto con el layout** en su propio conjunto, para que los bloques `titulo` y `contenido` de una página no choquen con los de otra:

```go
package web

import (
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
)

//go:embed templates/*.html
var plantillasFS embed.FS

type Vistas map[string]*template.Template

func CargarVistas() (Vistas, error) {
	paginas, err := fs.Glob(plantillasFS, "templates/*.html")
	if err != nil {
		return nil, err
	}
	vistas := make(Vistas)
	for _, p := range paginas {
		if p == "templates/base.html" {
			continue
		}
		t, err := template.ParseFS(plantillasFS, "templates/base.html", p)
		if err != nil {
			return nil, fmt.Errorf("analizando %s: %w", p, err)
		}
		vistas[p] = t
	}
	return vistas, nil
}

func (v Vistas) Render(w http.ResponseWriter, nombre string, datos any) {
	t, ok := v["templates/"+nombre]
	if !ok {
		http.Error(w, "plantilla inexistente", http.StatusInternalServerError)
		return
	}
	// Renderiza primero a un buffer: si falla, aún puedes enviar un 500 limpio.
	var buf bytes.Buffer
	if err := t.ExecuteTemplate(&buf, "base", datos); err != nil {
		http.Error(w, "error al renderizar", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	buf.WriteTo(w)
}
```

(Importa también `bytes`.) `//go:embed` incluye los archivos **dentro del binario**: no hay que desplegar carpetas aparte.

## 5. El servidor completo con handlers

`internal/web/servidor.go`:

```go
type Servidor struct {
	svc    *tarea.Servicio
	vistas Vistas
}

func NuevoServidor(svc *tarea.Servicio, v Vistas) *Servidor {
	return &Servidor{svc: svc, vistas: v}
}

func (s *Servidor) Rutas() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/tareas", http.StatusSeeOther)
	})
	mux.HandleFunc("GET /tareas", s.listar)
	mux.HandleFunc("POST /tareas", s.crear)
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(estaticosFS()))))
	return Encadenar(mux, Recuperar, Logging)
}

func (s *Servidor) listar(w http.ResponseWriter, r *http.Request) {
	tareas, err := s.svc.Listar(r.Context())
	if err != nil {
		http.Error(w, "error interno", http.StatusInternalServerError)
		return
	}
	s.vistas.Render(w, "tareas.html", map[string]any{"Tareas": tareas})
}

func (s *Servidor) crear(w http.ResponseWriter, r *http.Request) {
	if _, err := s.svc.Crear(r.Context(), r.FormValue("titulo")); err != nil {
		if errors.Is(err, tarea.ErrTituloVacio) {
			http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			return
		}
		http.Error(w, "error interno", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, "/tareas", http.StatusSeeOther) // Post/Redirect/Get
}
```

(`estaticosFS()` devolvería un `fs.FS` de otro `//go:embed static/*` análogo al de las plantillas.)

Observa el **mapeo de errores en el borde**: el dominio devuelve `ErrTituloVacio`; el adaptador HTTP decide que eso es un `422`.

### Arranque con *timeouts* y apagado ordenado

`http.ListenAndServe` sin configurar es peligroso: no tiene límites de tiempo y un cliente lento puede acaparar conexiones. Configura el servidor explícitamente:

```go
srv := &http.Server{
	Addr:              fmt.Sprintf(":%d", cfg.Puerto),
	Handler:           web.NuevoServidor(svc, vistas).Rutas(),
	ReadHeaderTimeout: 5 * time.Second,
	ReadTimeout:       cfg.TiempoLectura,
	WriteTimeout:      cfg.TiempoEscritura,
	IdleTimeout:       60 * time.Second,
}

// Escucha señales de apagado (Ctrl+C, docker stop)
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()

go func() {
	log.Printf("escuchando en %s", srv.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("error del servidor: %v", err)
		stop()
	}
}()

<-ctx.Done() // espera la señal
shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()
return srv.Shutdown(shutdownCtx) // termina las peticiones en curso y cierra
```

## Práctica

Construye una app con rutas `GET /tareas`, `POST /tareas` y `GET /tareas/{id}`, un middleware de registro y una plantilla base con layout. Conecta el `tarea.Servicio` del Módulo 03.

<details>
<summary>Ver solución</summary>

Añade a `Servidor` el handler de detalle y la plantilla `detalle.html`:

```go
mux.HandleFunc("GET /tareas/{id}", s.detalle)

func (s *Servidor) detalle(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	t, err := s.svc.Obtener(r.Context(), id) // añade Obtener al servicio
	switch {
	case errors.Is(err, tarea.ErrNoEncontrada):
		http.NotFound(w, r)
	case err != nil:
		http.Error(w, "error interno", http.StatusInternalServerError)
	default:
		s.vistas.Render(w, "detalle.html", t)
	}
}
```

```html
{{define "titulo"}}{{.Titulo}}{{end}}
{{define "contenido"}}<h1>{{.Titulo}}</h1><p>Creada: {{.CreadaEn.Format "02/01/2006 15:04"}}</p>
<a href="/tareas">← Volver</a>{{end}}
```

Prueba con `curl -i -X POST -d "titulo=Estudiar" localhost:8080/tareas` y verás un `303`; con `curl -i localhost:8080/tareas/999` verás un `404`.
</details>

## Errores comunes

- Llamar a `WriteHeader` **después** de escribir el cuerpo (no tiene efecto).
- Olvidar `return` tras `http.Error`: el código continúa y escribe dos respuestas.
- Servidor sin *timeouts* (vulnerable a clientes lentos).
- Usar `text/template` para HTML (sin escape automático).
- Parsear las plantillas en cada petición: hazlo una vez al arrancar.

## Resumen

- `net/http` + `ServeMux` de Go 1.22 resuelven métodos, comodines y rutas.
- Middleware = `func(http.Handler) http.Handler`.
- `html/template` renderiza en el servidor con escape automático; `go:embed` empaqueta las plantillas.
- Configura timeouts y apaga el servidor con `Shutdown`.

## Autoevaluación

1. ¿Qué devuelve el servidor si pides `POST /tareas/1` y solo existe `GET /tareas/{id}`?
2. ¿Por qué se usa el estado `303` tras un `POST`?
3. ¿Qué ventaja da `html/template` sobre `text/template`?
4. ¿Por qué hay que renderizar a un buffer antes de escribir?
5. ¿Qué hace `srv.Shutdown`?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi servidor lista y crea tareas desde el navegador.
- [ ] Sé qué parte me costó más y la repasaré.

