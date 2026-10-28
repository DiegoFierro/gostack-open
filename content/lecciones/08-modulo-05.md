---
title: "Módulo 05: Interfaz Interactiva sin JavaScript (HTMX & View Transitions)"
description: "Interactividad moderna devolviendo HTML desde el servidor."
weight: 8
fase: "Fase 1: Arquitectura, configuración y web hipermedia"
---

## Objetivos

- Usar atributos `hx-*` para pedir y reemplazar fragmentos de HTML.
- Dividir las plantillas en *parciales* reutilizables.
- Aprovechar diálogos y acordeones nativos de HTML5.
- Aplicar View Transitions para una navegación fluida.

## 1. La idea de HTMX

En el HTML clásico solo `<a>` y `<form>` pueden hacer peticiones, y la respuesta **reemplaza la página entera**. HTMX amplía el HTML con cuatro ideas:

1. **Cualquier elemento** puede hacer una petición (no solo enlaces y formularios).
2. **Cualquier evento** puede dispararla (clic, cambio, teclado, scroll…).
3. **Cualquier verbo** HTTP está disponible (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
4. La respuesta **reemplaza cualquier parte** de la página, no solo la página completa.

Todo se declara con atributos; el servidor devuelve **fragmentos de HTML** (no JSON). Es la filosofía hipermedia del Módulo -00 llevada al límite.

### Instalación

Descarga `htmx.min.js` (versión 2.x) desde [htmx.org](https://htmx.org) a `internal/web/static/htmx.min.js` y cárgalo desde el layout. Servirlo tú mismo evita depender de una CDN y encaja con el despliegue de un único binario.

```html
<script src="/static/htmx.min.js" defer></script>
```

## 2. Los atributos fundamentales

```html
<button hx-get="/saludo"        <!-- qué petición hacer -->
        hx-target="#caja"       <!-- dónde colocar la respuesta (selector CSS) -->
        hx-swap="innerHTML">    <!-- cómo colocarla -->
  Saludar
</button>
<div id="caja"></div>
```

| Atributo | Función |
|----------|---------|
| `hx-get`, `hx-post`, `hx-put`, `hx-patch`, `hx-delete` | URL y verbo de la petición |
| `hx-trigger` | Evento que la dispara (por defecto: `click`, `submit` en formularios, `change` en inputs) |
| `hx-target` | Elemento que recibe la respuesta (por defecto el propio elemento) |
| `hx-swap` | Estrategia de inserción |
| `hx-include`, `hx-vals` | Datos adicionales a enviar |
| `hx-confirm` | Pide confirmación antes de enviar |
| `hx-indicator` | Elemento a mostrar mientras se espera |
| `hx-push-url` | Actualiza la URL del navegador (historial) |
| `hx-boost` | Convierte enlaces y formularios normales en peticiones AJAX |

Estrategias de `hx-swap`:

| Valor | Efecto |
|-------|--------|
| `innerHTML` (por defecto) | Reemplaza el **contenido** del objetivo |
| `outerHTML` | Reemplaza el **elemento completo** |
| `beforeend` / `afterbegin` | Añade al final / al inicio del contenido |
| `beforebegin` / `afterend` | Inserta antes / después del elemento |
| `delete` | Elimina el elemento objetivo |
| `none` | No toca el DOM |

Modificadores de `hx-trigger`: `click`, `keyup changed delay:300ms` (esperar a que dejes de teclear), `load`, `revealed`, `every 5s` (sondeo)…

## 3. Del lado de Go: parciales

La clave: el servidor devuelve **solo el fragmento** cuando la petición viene de HTMX. HTMX añade la cabecera `HX-Request: true`.

Divide la plantilla en bloques reutilizables. En `tareas.html`:

```html
{{define "contenido"}}
<h1>Mis tareas</h1>

<form hx-post="/tareas" hx-target="#lista" hx-swap="beforeend"
      hx-on::after-request="this.reset()">
  <input name="titulo" placeholder="Nueva tarea" required autofocus>
  <button>Añadir</button>
</form>

<ul id="lista">
  {{range .Tareas}}{{template "tarea-item" .}}{{end}}
</ul>
{{end}}

{{define "tarea-item"}}
<li id="tarea-{{.ID}}">
  <input type="checkbox" {{if .Hecha}}checked{{end}}
         hx-post="/tareas/{{.ID}}/alternar"
         hx-target="#tarea-{{.ID}}" hx-swap="outerHTML">
  <span {{if .Hecha}}class="hecha"{{end}}>{{.Titulo}}</span>
  <button hx-delete="/tareas/{{.ID}}"
          hx-target="#tarea-{{.ID}}" hx-swap="outerHTML"
          hx-confirm="¿Eliminar esta tarea?">🗑</button>
</li>
{{end}}
```

Para poder renderizar **solo** `tarea-item`, añade a `Vistas` un método que ejecute un bloque por nombre:

```go
func (v Vistas) Parcial(w http.ResponseWriter, pagina, bloque string, datos any) {
	t := v["templates/"+pagina]
	var buf bytes.Buffer
	if err := t.ExecuteTemplate(&buf, bloque, datos); err != nil {
		http.Error(w, "error al renderizar", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	buf.WriteTo(w)
}
```

Handlers:

```go
func esHTMX(r *http.Request) bool { return r.Header.Get("HX-Request") == "true" }

func (s *Servidor) crear(w http.ResponseWriter, r *http.Request) {
	t, err := s.svc.Crear(r.Context(), r.FormValue("titulo"))
	if err != nil { /* mapear errores como en el Módulo 04 */ return }

	if esHTMX(r) {
		w.WriteHeader(http.StatusCreated)
		s.vistas.Parcial(w, "tareas.html", "tarea-item", t) // solo el <li>
		return
	}
	http.Redirect(w, r, "/tareas", http.StatusSeeOther) // sin JS sigue funcionando
}

func (s *Servidor) alternar(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	t, err := s.svc.Alternar(r.Context(), id)
	if errors.Is(err, tarea.ErrNoEncontrada) { http.NotFound(w, r); return }
	if err != nil { http.Error(w, "error interno", 500); return }
	s.vistas.Parcial(w, "tareas.html", "tarea-item", t)
}

func (s *Servidor) eliminar(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err := s.svc.Eliminar(r.Context(), id); err != nil && !errors.Is(err, tarea.ErrNoEncontrada) {
		http.Error(w, "error interno", 500)
		return
	}
	w.WriteHeader(http.StatusOK) // cuerpo vacío: outerHTML lo sustituye por nada
}
```

```go
mux.HandleFunc("POST /tareas/{id}/alternar", s.alternar)
mux.HandleFunc("DELETE /tareas/{id}", s.eliminar)
```

**Mejora progresiva**: si el navegador no tiene JavaScript, el formulario sigue enviando un `POST` normal y recibe una redirección. La interactividad es un añadido, no un requisito.

> Sobre códigos de estado: por defecto HTMX **no intercambia** respuestas `4xx`/`5xx`. En el Módulo 07 configuraremos cómo mostrar errores de validación.

### Búsqueda en vivo (ejemplo de `hx-trigger`)

```html
<input type="search" name="q" placeholder="Buscar…"
       hx-get="/tareas" hx-trigger="keyup changed delay:300ms, search"
       hx-target="#lista" hx-select="#lista" hx-swap="outerHTML">
```

`hx-select` elige un fragmento de la respuesta completa; es un atajo útil mientras empiezas.

### Botón "cargando"

```html
<button hx-post="/informe" hx-indicator="#espera">Generar</button>
<span id="espera" class="htmx-indicator">Procesando…</span>
```

```css
.htmx-indicator { opacity: 0; transition: opacity .2s; }
.htmx-request .htmx-indicator, .htmx-request.htmx-indicator { opacity: 1; }
```

## 4. Componentes nativos de HTML5

Muchas cosas que antes exigían JavaScript ya existen en el navegador.

### Acordeón: `<details>`

```html
<details>
  <summary>Opciones avanzadas</summary>
  <p>Contenido que se despliega al pulsar.</p>
</details>
<!-- Acordeón exclusivo: mismo atributo name => solo uno abierto -->
<details name="faq"><summary>Pregunta 1</summary>Respuesta 1</details>
<details name="faq"><summary>Pregunta 2</summary>Respuesta 2</details>
```

### Diálogos modales: `<dialog>`

```html
<button command="show-modal" commandfor="confirmar">Eliminar…</button>

<dialog id="confirmar">
  <form method="dialog">
    <p>¿Seguro que quieres eliminar la tarea?</p>
    <button value="cancelar">Cancelar</button>
    <button value="ok" hx-delete="/tareas/7" hx-target="#tarea-7" hx-swap="outerHTML">Eliminar</button>
  </form>
</dialog>
```

`<dialog>` modal ofrece de serie: capa de fondo (`::backdrop`), foco atrapado y cierre con `Esc`. Si `command`/`commandfor` aún no se soportan en tu navegador objetivo, la alternativa es abrirlo con una línea de JavaScript: `document.getElementById('confirmar').showModal()`.

Otras utilidades nativas: `popover`, validación de formularios (`required`, `pattern`, `type="email"`), `<input type="date">`, `loading="lazy"` en imágenes.

## 5. View Transitions

La **API View Transitions** anima el paso entre dos estados de la página con CSS.

### Navegación entre páginas (multi-página)

Basta una regla CSS:

```css
@view-transition { navigation: auto; }
```

El navegador hará un fundido suave entre páginas del mismo origen. Personalízalo:

```css
::view-transition-old(root) { animation: 150ms ease-out both fade-out; }
::view-transition-new(root) { animation: 200ms ease-in  both fade-in; }
@keyframes fade-out { to   { opacity: 0; } }
@keyframes fade-in  { from { opacity: 0; } }

/* Un elemento que "viaja" entre páginas */
.cabecera { view-transition-name: cabecera; }
```

### Con HTMX

```html
<button hx-get="/tareas" hx-target="main" hx-swap="innerHTML transition:true">Ver tareas</button>
```

`transition:true` envuelve el intercambio en una View Transition. O globalmente: `<meta name="htmx-config" content='{"globalViewTransitions":true}'>`.

Respeta a quien prefiere menos movimiento:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) {
    animation: none !important;
  }
}
```

Es una mejora progresiva: los navegadores sin soporte simplemente omiten la animación.

## Práctica

Convierte tu lista de tareas en interactiva: añade y elimina tareas sin recargar la página con `hx-post`, `hx-delete` y `hx-target`, y usa `<dialog>` para confirmar el borrado. Añade una View Transition al navegar entre la lista y el detalle.

<details>
<summary>Ver solución</summary>

1. Descarga `htmx.min.js` y cárgalo en `base.html`.
2. Usa las plantillas `tareas.html` / `tarea-item` y los handlers `crear`, `alternar`, `eliminar` de esta lección.
3. Sustituye `hx-confirm` por un diálogo; un patrón sencillo con un solo `<dialog>` compartido:

```html
<dialog id="confirmar">
  <form method="dialog">
    <p>¿Eliminar «<span id="confirmar-titulo"></span>»?</p>
    <button>Cancelar</button>
    <button id="confirmar-ok">Eliminar</button>
  </form>
</dialog>
```

y al abrirlo desde cada fila copias el título y el `hx-delete` del botón de confirmar (`htmx.process` si lo cambias por script).
4. En `estilos.css`, añade `@view-transition { navigation: auto; }`.
5. Prueba sin JavaScript (desactívalo en las herramientas del navegador): crear tareas debe seguir funcionando mediante redirección.
</details>

## Errores comunes

- Devolver una página completa a una petición HTMX (verás el layout anidado dentro de la lista).
- Olvidar `hx-target`/`hx-swap` y sorprenderte de dónde aparece la respuesta.
- Un `DELETE` o `POST` sin protección CSRF (lo cerraremos en el Módulo 09).
- Duplicar `id`s en la página.
- Usar HTMX para todo: si basta un enlace normal, usa un enlace normal.

## Resumen

- HTMX amplía el HTML: cualquier elemento, evento y verbo; la respuesta es HTML.
- En Go, los **parciales** de plantilla permiten devolver solo el fragmento.
- `HX-Request` distingue peticiones HTMX de navegación normal y permite *mejora progresiva*.
- `<details>`, `<dialog>` y View Transitions sustituyen mucho JavaScript.

## Autoevaluación

1. ¿Qué diferencia hay entre `innerHTML` y `outerHTML` en `hx-swap`?
2. ¿Qué cabecera envía HTMX y para qué la usas en Go?
3. ¿Por qué es útil que el formulario funcione también sin JavaScript?
4. ¿Qué te da `<dialog>` que antes exigía una biblioteca?
5. ¿Cómo activas una View Transition entre páginas?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi lista de tareas se actualiza sin recargar la página.
- [ ] Sé qué parte me costó más y la repasaré.

