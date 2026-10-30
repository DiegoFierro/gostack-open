---
title: "Módulo 03: Configuración Tipada & Arquitectura de Proyectos"
description: "Estructura tu proyecto y su configuración para que crezca sin dolor."
weight: 6
fase: "Fase 1: Arquitectura, configuración y web hipermedia"
---

> Estructura tu proyecto y su configuración para que crezca sin dolor.

**Fase 1: Arquitectura, configuración y web hipermedia** · Lección 6 de 20

## 🎯 Objetivos

- Cargar y validar configuración desde variables de entorno al arrancar.
- Organizar paquetes con criterio de Clean Architecture pragmática.
- Desacoplar la persistencia mediante el Patrón Repository.
- Arrancar el proyecto que acompañará el resto del curso: **Tareas**.

## 1. Configuración: la regla de los doce factores

La configuración que cambia entre entornos (desarrollo, pruebas, producción) **no va en el código**: va en el entorno. Así el mismo binario corre en todas partes y los secretos nunca entran a Git.

El enfoque ingenuo es esparcir `os.Getenv("PUERTO")` por todo el programa. Problemas: devuelve siempre `string`, no avisa si falta, no valida y no hay un único lugar donde ver qué configura la app.

El enfoque correcto: **una struct tipada, cargada y validada una sola vez al arrancar**. Si falta algo, la aplicación **falla de inmediato** (*fail fast*) con un mensaje claro, en vez de romperse en producción tres horas después.

### Con `cleanenv`

```bash
mkdir tareas && cd tareas
go mod init github.com/TU_USUARIO/tareas
go get github.com/ilyakaznacheev/cleanenv
```

`internal/config/config.go`:

```go
package config

import (
	"fmt"
	"time"

	"github.com/ilyakaznacheev/cleanenv"
)

type Config struct {
	Entorno string `env:"APP_ENV"  env-default:"desarrollo"`
	Puerto  int    `env:"PORT"     env-default:"8080"`

	// Obligatoria: sin ella la app no arranca.
	BaseDatos string `env:"DATABASE_URL" env-required:"true"`

	TiempoLectura   time.Duration `env:"READ_TIMEOUT"  env-default:"5s"`
	TiempoEscritura time.Duration `env:"WRITE_TIMEOUT" env-default:"10s"`
}

// Cargar lee las variables de entorno y valida la configuración.
func Cargar() (*Config, error) {
	var cfg Config
	if err := cleanenv.ReadEnv(&cfg); err != nil {
		return nil, fmt.Errorf("leyendo configuración: %w", err)
	}
	if cfg.Puerto < 1 || cfg.Puerto > 65535 {
		return nil, fmt.Errorf("PORT fuera de rango: %d", cfg.Puerto)
	}
	return &cfg, nil
}
```

`cleanenv` convierte tipos automáticamente (`int`, `bool`, `time.Duration`…), aplica valores por defecto y rechaza la ausencia de las obligatorias. También puede leer un archivo `.env`/YAML con `cleanenv.ReadConfig`. Alternativa muy usada: `github.com/kelseyhightower/envconfig` (etiquetas `envconfig:"PORT" default:"8080" required:"true"`).

Para desarrollo local, un archivo `.env` (¡en `.gitignore`!) y un `.env.example` versionado con valores de ejemplo:

```bash
# .env.example
APP_ENV=desarrollo
PORT=8080
DATABASE_URL=postgres://tareas:tareas@localhost:5432/tareas?sslmode=disable
```

```bash
set -a; source .env; set +a     # exporta las variables al shell actual
```

> Si algún valor es secreto (contraseñas, claves), evita imprimir la struct completa en los logs.

## 2. Estructura del proyecto

No hay un layout oficial, pero esta organización pragmática funciona para casi todo:

```text
tareas/
├── cmd/
│   └── tareas/
│       └── main.go            # punto de entrada: ensambla las piezas
├── internal/                  # código privado de la aplicación
│   ├── config/                # configuración tipada
│   ├── tarea/                 # DOMINIO: entidades, reglas, interfaces
│   │   ├── tarea.go
│   │   └── servicio.go
│   ├── almacen/               # ADAPTADORES de persistencia
│   │   └── memoria/memoria.go
│   └── web/                   # ADAPTADOR HTTP: handlers, plantillas
├── go.mod
└── .env.example
```

Piezas clave:

- **`cmd/`**: cada subcarpeta es un ejecutable. `main.go` debe ser **corto**: carga configuración, construye dependencias y arranca.
- **`internal/`**: el compilador de Go **prohíbe** que otros módulos importen paquetes dentro de `internal/`. Protege tu API interna.
- **Nombra por lo que *hace* el paquete**, no por su tipo (`tarea`, no `models`; `web`, no `controllers`).

### La regla de la dependencia

Es el núcleo de Clean Architecture, en versión pragmática:

```text
 web (HTTP) ──▶ tarea (dominio) ◀── almacen (BD)
```

- El **dominio** (`tarea`) no importa nada del mundo exterior: ni `net/http`, ni `database/sql`.
- Los **adaptadores** (`web`, `almacen`) dependen del dominio, nunca al revés.
- El dominio declara **interfaces** que describen lo que necesita (por ejemplo, "algo que guarde tareas"); los adaptadores las implementan.

Sin dogmatismo: no necesitas una carpeta por cada concepto teórico. Divide cuando duela, no antes.

## 3. El Patrón Repository

Un **repositorio** es una abstracción que oculta *cómo* se guardan los datos. Tu lógica pide "guarda esta tarea" sin saber si hay PostgreSQL, un archivo o un `map` detrás.

`internal/tarea/tarea.go`:

```go
package tarea

import (
	"context"
	"errors"
	"strings"
	"time"
)

var (
	ErrNoEncontrada = errors.New("tarea no encontrada")
	ErrTituloVacio  = errors.New("el título es obligatorio")
)

type Tarea struct {
	ID       int64
	Titulo   string
	Hecha    bool
	CreadaEn time.Time
}

// Repositorio la define el dominio: es lo que el dominio NECESITA.
type Repositorio interface {
	Crear(ctx context.Context, titulo string) (Tarea, error)
	Obtener(ctx context.Context, id int64) (Tarea, error)
	Listar(ctx context.Context) ([]Tarea, error)
	Actualizar(ctx context.Context, t Tarea) error
	Eliminar(ctx context.Context, id int64) error
}

// Servicio contiene las reglas de negocio.
type Servicio struct {
	repo Repositorio
}

func NuevoServicio(repo Repositorio) *Servicio { return &Servicio{repo: repo} }

func (s *Servicio) Crear(ctx context.Context, titulo string) (Tarea, error) {
	titulo = strings.TrimSpace(titulo)
	if titulo == "" {
		return Tarea{}, ErrTituloVacio
	}
	return s.repo.Crear(ctx, titulo)
}

func (s *Servicio) Listar(ctx context.Context) ([]Tarea, error) { return s.repo.Listar(ctx) }

func (s *Servicio) Alternar(ctx context.Context, id int64) (Tarea, error) {
	t, err := s.repo.Obtener(ctx, id)
	if err != nil {
		return Tarea{}, err
	}
	t.Hecha = !t.Hecha
	return t, s.repo.Actualizar(ctx, t)
}

func (s *Servicio) Eliminar(ctx context.Context, id int64) error {
	return s.repo.Eliminar(ctx, id)
}
```

Nota que todos los métodos reciben `context.Context` como primer parámetro: permitirá cancelar consultas y propagar plazos (Módulo 08).

`internal/almacen/memoria/memoria.go` — la primera implementación, en memoria:

```go
package memoria

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/TU_USUARIO/tareas/internal/tarea"
)

type Repo struct {
	mu     sync.RWMutex
	datos  map[int64]tarea.Tarea
	sigID  int64
}

func Nuevo() *Repo { return &Repo{datos: make(map[int64]tarea.Tarea)} }

var _ tarea.Repositorio = (*Repo)(nil) // verificación en compilación

func (r *Repo) Crear(_ context.Context, titulo string) (tarea.Tarea, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sigID++
	t := tarea.Tarea{ID: r.sigID, Titulo: titulo, CreadaEn: time.Now()}
	r.datos[t.ID] = t
	return t, nil
}

func (r *Repo) Obtener(_ context.Context, id int64) (tarea.Tarea, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.datos[id]
	if !ok {
		return tarea.Tarea{}, tarea.ErrNoEncontrada
	}
	return t, nil
}

func (r *Repo) Listar(_ context.Context) ([]tarea.Tarea, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	res := make([]tarea.Tarea, 0, len(r.datos))
	for _, t := range r.datos {
		res = append(res, t)
	}
	sort.Slice(res, func(i, j int) bool { return res[i].ID < res[j].ID })
	return res, nil
}

func (r *Repo) Actualizar(_ context.Context, t tarea.Tarea) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.datos[t.ID]; !ok {
		return tarea.ErrNoEncontrada
	}
	r.datos[t.ID] = t
	return nil
}

func (r *Repo) Eliminar(_ context.Context, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.datos[id]; !ok {
		return tarea.ErrNoEncontrada
	}
	delete(r.datos, id)
	return nil
}
```

(Usamos un `sync.RWMutex` porque un servidor atiende peticiones en paralelo; lo entenderás a fondo en el Módulo 08.)

## 4. Ensamblado en `main`

`cmd/tareas/main.go` es el único lugar que conoce **todas** las piezas (*composition root*):

```go
package main

import (
	"fmt"
	"log"
	"os"

	"github.com/TU_USUARIO/tareas/internal/almacen/memoria"
	"github.com/TU_USUARIO/tareas/internal/config"
	"github.com/TU_USUARIO/tareas/internal/tarea"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Cargar()
	if err != nil {
		return err
	}
	log.Printf("entorno=%s puerto=%d", cfg.Entorno, cfg.Puerto)

	repo := memoria.Nuevo()          // en el Módulo 06 cambiaremos SOLO esta línea
	svc := tarea.NuevoServicio(repo)
	_ = svc                          // en el Módulo 04 lo conectaremos al servidor HTTP
	return nil
}
```

El patrón `main() → run() error` permite que los `defer` se ejecuten antes de salir y facilita probar `run`.

La inyección de dependencias en Go es **manual y explícita**: pasas las dependencias por constructores. No necesitas un framework de DI.

## 🧪 Práctica

Crea una struct `Config` con puerto, URL de base de datos y modo, cárgala con `cleanenv` y haz que la app falle al arrancar si falta un valor obligatorio. Define una interfaz `Repositorio` con una implementación en memoria y pruébala desde `main`.

<details>
<summary>Ver solución</summary>

1. Crea el esqueleto de carpetas y copia el código de esta lección.
2. Ejecuta sin variables:

```bash
go run ./cmd/tareas
# error: leyendo configuración: required field "DATABASE_URL" is not set
```

3. Ejecuta con ellas:

```bash
DATABASE_URL=postgres://x PORT=9000 go run ./cmd/tareas
# entorno=desarrollo puerto=9000
```

4. Añade un test mínimo (lo ampliarás en el Módulo 14):

```go
func TestServicioCrearVacio(t *testing.T) {
	svc := tarea.NuevoServicio(memoria.Nuevo())
	if _, err := svc.Crear(context.Background(), "   "); !errors.Is(err, tarea.ErrTituloVacio) {
		t.Fatalf("esperaba ErrTituloVacio, obtuve %v", err)
	}
}
```
</details>

## ⚠️ Errores comunes

- Leer variables de entorno dispersas por todo el código.
- Dominio que importa `net/http` o `database/sql`: rompe el desacoplamiento.
- Paquetes genéricos (`utils`, `common`, `models`) que se vuelven vertederos.
- Interfaces demasiado anchas (un "repositorio" con 40 métodos).
- Sobre-ingeniería: crear capas que no aportan nada aún.

## 📌 Resumen

- Configuración tipada, validada **al arrancar**, tomada del entorno.
- `cmd/` + `internal/`; el dominio no depende de nadie.
- El Patrón Repository esconde la persistencia tras una interfaz definida por el dominio.
- `main` ensambla todo; las dependencias se pasan explícitamente.

## ✅ Autoevaluación

1. ¿Por qué *fail fast* es preferible a descubrir una variable ausente en producción?
2. ¿Qué impide el directorio `internal/`?
3. ¿Quién debe definir la interfaz `Repositorio`: el dominio o la implementación? ¿Por qué?
4. ¿Qué ventaja tiene que `main` sea el único que conoce todas las piezas?
5. ¿Cómo cambiarías de memoria a PostgreSQL sin tocar el servicio?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi proyecto `tareas` compila y está en GitHub.
- [ ] Sé qué parte me costó más y la repasaré.

