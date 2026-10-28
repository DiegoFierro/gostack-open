---
title: "Módulo 15: Desarrollo de Apps de Escritorio con Go y Wails"
description: "Lleva tu lógica Go a una app de escritorio con interfaz web."
weight: 18
fase: "Fase 4: Rendimiento, observabilidad, escritorio y producción"
---

## Objetivos

- Explicar cómo Wails une un backend Go con una interfaz web en un ejecutable nativo.
- Crear un proyecto Wails y enlazar métodos de Go con el frontend.
- Reutilizar el dominio (`tarea.Servicio`) en la app de escritorio.
- Empaquetar para Windows, macOS y Linux.

## 1. ¿Qué es Wails?

**Wails** permite construir aplicaciones de escritorio con **Go para la lógica** y **HTML/CSS/JS para la interfaz**, en un único ejecutable nativo. Es parecido a Electron, pero con una diferencia enorme:

| | Electron | Wails |
|---|----------|-------|
| Motor web | Chromium **incluido** (≈100+ MB) | **WebView del sistema** (WebView2 en Windows, WebKit en macOS/Linux) |
| Backend | Node.js | **Go** (compilado) |
| Tamaño típico | 100–200 MB | **8–20 MB** |
| Memoria | Alta | Mucho menor |

Arquitectura:

```text
┌──────────── Ventana nativa ─────────────┐
│  WebView (HTML / CSS / JS / HTMX…)      │
│      ▲  llamadas a funciones Go         │
│      │  eventos en ambos sentidos       │
│  ┌───▼────────────────────────────────┐ │
│  │ Backend Go: structs enlazadas      │ │
│  │ (tu dominio, BD, archivos, red…)   │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

Un único proceso: el frontend **llama directamente a métodos Go** (con tipos TypeScript autogenerados), sin servidor HTTP ni puertos.

> Este curso usa **Wails v2** (estable). Existe Wails v3 (en evolución) con una API distinta; revisa la documentación oficial en [wails.io](https://wails.io) para el estado actual.

## 2. Requisitos e instalación

- Go 1.21+ y Node.js (para el frontend; necesita `npm`).
- **Windows**: WebView2 (viene con Windows 10/11 recientes).
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: `gcc`, `libgtk-3-dev` y `libwebkit2gtk-4.x-dev` (los nombres varían según la distribución).

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails doctor          # revisa dependencias y te dice qué falta
```

## 3. Crear el proyecto

```bash
wails init -n tareas-escritorio -t vanilla
cd tareas-escritorio
wails dev             # modo desarrollo con recarga en caliente
```

Plantillas disponibles: `vanilla` (JS puro), `react`, `vue`, `svelte`, etc. Para seguir la filosofía del curso (sin frameworks), elegiremos `vanilla`.

Estructura generada:

```text
tareas-escritorio/
├── main.go              # arranque: opciones de ventana y bindings
├── app.go               # tu struct "App" con métodos que verá el frontend
├── wails.json           # configuración del proyecto
├── build/               # iconos, manifiestos, instaladores por plataforma
└── frontend/
    ├── index.html, src/ # la interfaz
    └── wailsjs/         # ← GENERADO: funciones JS/TS que llaman a Go
```

### `main.go`

```go
package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "Tareas",
		Width:  900,
		Height: 640,
		AssetServer: &assetserver.Options{Assets: assets},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{app}, // ← todo método público de app queda visible al frontend
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
```

Fíjate que el frontend ya compilado se **incrusta con `go:embed`** (igual que las plantillas y Swagger UI): un solo binario.

## 4. Enlazar Go con el frontend (*bindings*)

Todo método **exportado** de una struct incluida en `Bind` se convierte en una función asíncrona en JavaScript, con tipos.

`app.go`:

```go
package main

import (
	"context"
	"fmt"

	"github.com/TU_USUARIO/tareas/internal/tarea"
)

type App struct {
	ctx context.Context // contexto de Wails (necesario para diálogos y eventos)
	svc *tarea.Servicio
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Aquí abres la base de datos local y construyes el servicio (ver sección 5)
}

func (a *App) shutdown(ctx context.Context) { /* cerrar recursos */ }

// DTOs: structs simples que Wails convierte a JSON/TypeScript.
type TareaDTO struct {
	ID     int64  `json:"id"`
	Titulo string `json:"titulo"`
	Hecha  bool   `json:"hecha"`
}

func (a *App) ListarTareas() ([]TareaDTO, error) {
	ts, err := a.svc.Listar(a.ctx)
	if err != nil {
		return nil, err // llega al frontend como una promesa rechazada
	}
	res := make([]TareaDTO, len(ts))
	for i, t := range ts {
		res[i] = TareaDTO{t.ID, t.Titulo, t.Hecha}
	}
	return res, nil
}

func (a *App) CrearTarea(titulo string) (TareaDTO, error) {
	t, err := a.svc.Crear(a.ctx, titulo)
	if err != nil {
		return TareaDTO{}, fmt.Errorf("no se pudo crear: %w", err)
	}
	return TareaDTO{t.ID, t.Titulo, t.Hecha}, nil
}

func (a *App) AlternarTarea(id int64) (TareaDTO, error) {
	t, err := a.svc.Alternar(a.ctx, id)
	if err != nil {
		return TareaDTO{}, err
	}
	return TareaDTO{t.ID, t.Titulo, t.Hecha}, nil
}

func (a *App) EliminarTarea(id int64) error { return a.svc.Eliminar(a.ctx, id) }
```

Al ejecutar `wails dev` o `wails generate module`, se genera `frontend/wailsjs/go/main/App.js` (y `.d.ts`):

```js
// Generado automáticamente: no editar
export function ListarTareas() { return window['go']['main']['App']['ListarTareas'](); }
export function CrearTarea(arg1) { return window['go']['main']['App']['CrearTarea'](arg1); }
```

Uso en el frontend (`frontend/src/main.js`):

```js
import { ListarTareas, CrearTarea, AlternarTarea, EliminarTarea } from '../wailsjs/go/main/App';

const lista = document.getElementById('lista');

async function pintar() {
  const tareas = await ListarTareas();          // llamada directa a Go
  lista.replaceChildren(...tareas.map(t => {
    const li = document.createElement('li');
    li.textContent = t.titulo;                  // textContent: sin riesgo de XSS
    li.className = t.hecha ? 'hecha' : '';
    li.onclick = async () => { await AlternarTarea(t.id); pintar(); };
    return li;
  }));
}

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const campo = e.target.elements.titulo;
  try {
    await CrearTarea(campo.value);
    campo.value = '';
    pintar();
  } catch (err) {
    alert(err);                                 // el error de Go llega como cadena
  }
});

pintar();
```

Qué tipos pueden cruzar la frontera: números, cadenas, booleanos, slices, mapas y structs con etiquetas `json`. **No** pueden cruzar canales, funciones ni interfaces complejas.

### Eventos: de Go al frontend (y viceversa)

Para notificaciones sin que el frontend tenga que preguntar (progreso, datos nuevos):

```go
import "github.com/wailsapp/wails/v2/pkg/runtime"

// Go → frontend
runtime.EventsEmit(a.ctx, "tarea:creada", dto)
```

```js
import { EventsOn } from '../wailsjs/runtime/runtime';
EventsOn('tarea:creada', (t) => { /* añadir a la lista */ });
```

### Funciones nativas del runtime

```go
// Diálogos nativos
ruta, _ := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Importar tareas"})
resp, _ := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
	Type: runtime.QuestionDialog, Title: "Eliminar", Message: "¿Seguro?",
})

// Ventana
runtime.WindowSetTitle(a.ctx, "Tareas — 3 pendientes")
runtime.WindowMaximise(a.ctx)
runtime.BrowserOpenURL(a.ctx, "https://diegofierro.github.io/gostack-open/")
```

También: menús de aplicación, notificaciones del sistema (con bibliotecas adicionales), portapapeles, arrastrar y soltar de archivos, icono de bandeja (con extensiones).

## 5. Reutilizar la lógica de negocio

Esta es la gran recompensa de la arquitectura del Módulo 03. El paquete `tarea` **no sabe nada** de HTTP ni de Wails. La app de escritorio es un **tercer adaptador**:

```text
 web (HTMX)    ─┐
 api (JSON)    ─┼──▶ tarea.Servicio ──▶ tarea.Repositorio ──┬─▶ postgres (servidor)
 escritorio    ─┘                                           └─▶ sqlite / memoria (local)
```

Dos formas de usar los datos desde el escritorio:

**A. Modo local** (la app funciona sin servidor): implementa `tarea.Repositorio` sobre un archivo local, p. ej. **SQLite** con el driver sin CGO `modernc.org/sqlite` (cómodo para compilar de forma cruzada). El dominio no cambia ni una línea.

```go
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	dir, _ := os.UserConfigDir()                       // ubicación estándar por sistema operativo
	repo, err := sqliterepo.Abrir(filepath.Join(dir, "tareas", "datos.db"))
	if err != nil {
		runtime.LogFatalf(ctx, "abriendo base de datos: %v", err)
	}
	a.svc = tarea.NuevoServicio(repo)
}
```

**B. Modo cliente** (la app consume la API del Módulo 10): genera un **cliente Go** a partir del mismo `openapi.yaml` (añade `client: true` a `oapi-codegen`) y haz que implemente `tarea.Repositorio` llamando a la API con la JWT del usuario. Es el enfoque correcto cuando los datos viven en el servidor y hay varios dispositivos.

Guarda el token en el **almacén seguro del sistema** (Keychain, Credential Manager, Secret Service) con `github.com/zalando/go-keyring`, no en un archivo de texto.

## 6. Empaquetado y distribución

```bash
wails build                               # binario para tu sistema (en build/bin/)
wails build -clean -ldflags "-s -w"       # limpia y reduce tamaño
wails build -platform windows/amd64
wails build -platform darwin/universal    # Intel + Apple Silicon (solo desde macOS)
wails build -platform linux/amd64
wails build -nsis                         # instalador de Windows (requiere NSIS)
```

| Sistema | Resultado | Notas |
|---------|-----------|-------|
| **Windows** | `tareas-escritorio.exe` (+ instalador NSIS con `-nsis`) | Si falta WebView2, el instalador puede incluirlo. |
| **macOS** | `tareas-escritorio.app` | Para distribuir fuera de la App Store hay que **firmar y notarizar** con una cuenta de desarrollador de Apple. |
| **Linux** | Binario ELF | Para un `.deb` o `.rpm`, empaqueta el binario con una herramienta como [`nfpm`](https://nfpm.goreleaser.com/), que genera `.deb`, `.rpm` y `.apk` desde un YAML. |

Ejemplo mínimo de `nfpm.yaml` para generar el `.deb`:

```yaml
name: tareas-escritorio
arch: amd64
version: 1.0.0
maintainer: "Tu Nombre <tu@correo.com>"
description: Gestor de tareas de escritorio
depends: [libgtk-3-0, libwebkit2gtk-4.0-37]
contents:
  - src: build/bin/tareas-escritorio
    dst: /usr/bin/tareas-escritorio
  - src: build/appicon.png
    dst: /usr/share/icons/hicolor/512x512/apps/tareas-escritorio.png
```

```bash
nfpm package -p deb -f nfpm.yaml -t build/bin/
```

**Compilación cruzada**: Wails usa componentes nativos (CGO en algunas plataformas), así que lo más fiable es **compilar cada plataforma en su propio sistema operativo**. La forma habitual de automatizarlo es **GitHub Actions con una matriz** `[windows-latest, macos-latest, ubuntu-latest]`.

Buenas prácticas de distribución:

- Incrusta la versión: `-ldflags "-X main.version=1.2.0"` y muéstrala en la aplicación.
- **Firma** los ejecutables (Windows: certificado de firma de código; macOS: firma + notarización) o los usuarios verán advertencias de seguridad.
- Plan de **actualizaciones** (comprobar una versión nueva contra una URL propia o GitHub Releases).
- Una **única instancia**: `options.SingleInstanceLock` evita abrir la app dos veces.
- **Registra errores** a un archivo en `os.UserCacheDir()` para poder diagnosticar problemas de usuarios.

## 7. Seguridad en apps de escritorio

- El frontend corre en un WebView: aplican las mismas reglas de **XSS** (usa `textContent`, no `innerHTML` con datos externos).
- Expón a Go **solo lo necesario**: cada método enlazado es una superficie de ataque. Valida **todo** parámetro que llegue desde JS, como harías con una petición HTTP.
- No cargues contenido remoto no confiable dentro de la ventana.
- Guarda secretos en el almacén del sistema, nunca en el código ni en archivos planos.

## Práctica

Crea una app Wails que reutilice tu paquete de tareas, exponga métodos Go al frontend y genere un ejecutable con `wails build`.

<details>
<summary>Ver solución</summary>

1. `wails init -n tareas-escritorio -t vanilla` en una carpeta fuera de tu repositorio principal (o como módulo hermano con `replace`).
2. Referencia el dominio. Lo más simple: dentro del mismo repositorio, mueve el dominio a un paquete **público** (`pkg/tarea`, no `internal/`), porque `internal/` solo es importable desde dentro del mismo módulo. O bien crea la app de escritorio como `cmd/escritorio/` dentro del módulo `tareas` y mantén `internal/`.
3. Implementa un repositorio local (memoria o SQLite con `modernc.org/sqlite`).
4. Crea `App` con `ListarTareas`, `CrearTarea`, `AlternarTarea`, `EliminarTarea` (sección 4).
5. Escribe el HTML/JS mínimo (sección 4). Pruébalo con `wails dev`.
6. Compila: `wails build`. Ejecuta `build/bin/tareas-escritorio` y verifica que las tareas persisten entre ejecuciones.
7. Compara el tamaño: `ls -lh build/bin/` (debería estar en decenas de MB como mucho; compáralo con un hola-mundo en Electron).
8. (Bonus) Emite un evento `tarea:creada` y escúchalo en el frontend; abre un diálogo nativo de confirmación al borrar.
</details>

## Errores comunes

- Olvidar el contexto de `startup` y usar `a.ctx` antes de que exista (será `nil`).
- Importar paquetes `internal/` desde otro módulo (el compilador lo prohíbe).
- Confiar en que lo que viene de JS es válido.
- Intentar compilar para macOS desde Linux/Windows sin las herramientas adecuadas.
- Distribuir sin firmar y sorprenderse por las alertas del sistema.
- Exponer a JS métodos con funciones o canales en su firma.

## Resumen

- Wails = backend Go + WebView del sistema en un ejecutable pequeño.
- Los métodos públicos de las structs enlazadas se llaman desde JS con tipos autogenerados; los eventos comunican en ambos sentidos.
- El mismo dominio sirve a web, API y escritorio: la arquitectura del Módulo 03 da sus frutos.
- `wails build` genera `.exe` y `.app`; para `.deb` se usa `nfpm`; firma y CI por plataforma completan la distribución.

## Autoevaluación

1. ¿Por qué un ejecutable Wails es mucho más pequeño que uno de Electron?
2. ¿Qué convierte un método Go en una función invocable desde JS?
3. ¿Cómo reutilizas `tarea.Servicio` sin modificarlo?
4. ¿Qué dos estrategias hay para obtener los datos en la app de escritorio?
5. ¿Por qué se suele compilar cada plataforma en su propio sistema operativo?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi app de escritorio abre, crea tareas y las conserva al reiniciarse.
- [ ] Sé qué parte me costó más y la repasaré.

