---
title: "Módulo 06: Persistencia Relacional & SQL Tipado con sqlc"
description: "PostgreSQL con migraciones versionadas y consultas con tipos generados."
weight: 9
fase: "Fase 2: Bases de datos, estado y concurrencia"
---

> PostgreSQL con migraciones versionadas y consultas con tipos generados.

**Fase 2: Bases de datos, estado y concurrencia** · Lección 9 de 20

## 🎯 Objetivos

- Levantar PostgreSQL localmente y conectarte con `pgx` y un pool de conexiones.
- Versionar el esquema con `golang-migrate`.
- Generar código Go tipado desde SQL con `sqlc`.
- Sustituir el repositorio en memoria por uno real sin tocar el dominio.

## 1. PostgreSQL en local con Docker

La forma más rápida de tener una base de datos desechable:

```bash
docker run -d --name tareas-db \
  -e POSTGRES_USER=tareas -e POSTGRES_PASSWORD=tareas -e POSTGRES_DB=tareas \
  -p 5432:5432 -v tareas-datos:/var/lib/postgresql/data \
  postgres:17

# Conectarte con el cliente interactivo
docker exec -it tareas-db psql -U tareas -d tareas
```

Cadena de conexión (la que irá en `DATABASE_URL`):

```text
postgres://tareas:tareas@localhost:5432/tareas?sslmode=disable
```

Comandos útiles dentro de `psql`: `\dt` (tablas), `\d tareas` (estructura), `\q` (salir).

## 2. `database/sql` y `pgx`

Go define en la biblioteca estándar `database/sql` una API genérica y los *drivers* la implementan. Para PostgreSQL el driver recomendado es **`pgx`**, que además ofrece una API nativa más rápida y con más funciones (`pgxpool`, tipos de PostgreSQL, `COPY`, `LISTEN/NOTIFY`).

```bash
go get github.com/jackc/pgx/v5
```

### Pool de conexiones

Abrir una conexión por petición es lento. Un **pool** mantiene conexiones abiertas y las reparte. Se crea **una vez** al arrancar y se comparte:

```go
package almacen

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Conectar(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("url inválida: %w", err)
	}
	cfg.MaxConns = 10
	cfg.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("creando pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil { // verifica que realmente responde
		pool.Close()
		return nil, fmt.Errorf("ping a la base de datos: %w", err)
	}
	return pool, nil
}
```

Consultas a mano (antes de ver `sqlc`, para entender qué automatiza):

```go
var t Tarea
err := pool.QueryRow(ctx,
	`SELECT id, titulo, hecha, creada_en FROM tareas WHERE id = $1`, id,
).Scan(&t.ID, &t.Titulo, &t.Hecha, &t.CreadaEn)
if errors.Is(err, pgx.ErrNoRows) {
	return Tarea{}, tarea.ErrNoEncontrada
}
```

Reglas innegociables:

- **Siempre parámetros** (`$1`, `$2`…), **nunca** concatenar texto en la consulta: es la defensa contra la inyección SQL.
- **Siempre pasa `ctx`**: si el cliente cancela la petición, la consulta se aborta.
- Cierra el pool (`pool.Close()`) al apagar.

### Transacciones

```go
tx, err := pool.Begin(ctx)
if err != nil { return err }
defer tx.Rollback(ctx) // seguro: no hace nada si ya se hizo Commit

if _, err := tx.Exec(ctx, `UPDATE cuentas SET saldo = saldo - $1 WHERE id = $2`, monto, origen); err != nil {
	return err
}
if _, err := tx.Exec(ctx, `UPDATE cuentas SET saldo = saldo + $1 WHERE id = $2`, monto, destino); err != nil {
	return err
}
return tx.Commit(ctx)
```

## 3. Migraciones con `golang-migrate`

Cambiar la estructura de la base de datos a mano en producción es una receta para el desastre. Una **migración** es un archivo SQL **versionado** que describe un cambio; se aplican en orden y se pueden revertir.

Instala la CLI ([instrucciones](https://github.com/golang-migrate/migrate/tree/master/cmd/migrate)) y crea la primera migración:

```bash
migrate create -ext sql -dir db/migrations -seq crear_tareas
# crea: db/migrations/000001_crear_tareas.up.sql
#       db/migrations/000001_crear_tareas.down.sql
```

`000001_crear_tareas.up.sql`:

```sql
CREATE TABLE tareas (
    id         bigserial   PRIMARY KEY,
    titulo     text        NOT NULL CHECK (length(trim(titulo)) > 0),
    hecha      boolean     NOT NULL DEFAULT false,
    creada_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tareas_creada_en_idx ON tareas (creada_en DESC);
```

`000001_crear_tareas.down.sql`:

```sql
DROP TABLE IF EXISTS tareas;
```

Aplicar y revertir:

```bash
export DATABASE_URL="postgres://tareas:tareas@localhost:5432/tareas?sslmode=disable"

migrate -path db/migrations -database "$DATABASE_URL" up       # aplica todas
migrate -path db/migrations -database "$DATABASE_URL" version  # versión actual
migrate -path db/migrations -database "$DATABASE_URL" down 1   # revierte la última
```

Buenas prácticas:

- **Nunca edites una migración ya aplicada** en otros entornos; crea una nueva.
- Una migración = un cambio pequeño y reversible.
- Cambios destructivos (borrar columnas) en dos pasos: primero deja de usarla, luego elimínala.
- Las migraciones se versionan en Git junto con el código.

(También puedes ejecutar las migraciones **desde Go** con la biblioteca `github.com/golang-migrate/migrate/v4` al arrancar; en el Módulo 17 lo haremos con un contenedor aparte.)

## 4. SQL tipado con `sqlc`

El dilema habitual: un ORM oculta el SQL (y a veces lo hace mal); escribir SQL a mano obliga a mapear columnas con `Scan` propenso a errores. **`sqlc`** resuelve ambas cosas: **tú escribes SQL puro y sqlc genera el código Go tipado**, verificando tus consultas contra el esquema *en tiempo de generación*.

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

Configuración, `sqlc.yaml` en la raíz:

```yaml
version: "2"
sql:
  - engine: "postgresql"
    schema: "db/migrations"   # sqlc entiende los .up.sql y toma los CREATE/ALTER
    queries: "db/queries"
    gen:
      go:
        package: "db"
        out: "internal/db"
        sql_package: "pgx/v5"
```

Consultas, `db/queries/tareas.sql`:

```sql
-- name: CrearTarea :one
INSERT INTO tareas (titulo) VALUES ($1)
RETURNING *;

-- name: ObtenerTarea :one
SELECT * FROM tareas WHERE id = $1;

-- name: ListarTareas :many
SELECT * FROM tareas ORDER BY id;

-- name: ActualizarTarea :exec
UPDATE tareas SET titulo = $2, hecha = $3 WHERE id = $1;

-- name: EliminarTarea :execrows
DELETE FROM tareas WHERE id = $1;
```

El comentario `-- name: Nombre :tipo` le dice a sqlc cómo generar el método:

| Anotación | Devuelve |
|-----------|----------|
| `:one` | una fila (`pgx.ErrNoRows` si no hay) |
| `:many` | un slice de filas |
| `:exec` | solo `error` |
| `:execrows` | filas afectadas (`int64`) |
| `:execresult` | resultado completo |

Genera:

```bash
sqlc generate
```

Obtendrás en `internal/db/`: `models.go` (la struct `Tarea`), `tareas.sql.go` (los métodos) y `db.go` (`Queries`). Algo así:

```go
type Tarea struct {
	ID       int64
	Titulo   string
	Hecha    bool
	CreadaEn pgtype.Timestamptz
}

func (q *Queries) CrearTarea(ctx context.Context, titulo string) (Tarea, error)
func (q *Queries) ListarTareas(ctx context.Context) ([]Tarea, error)
func (q *Queries) ActualizarTarea(ctx context.Context, arg ActualizarTareaParams) error
```

Si escribes una consulta con una columna inexistente, **`sqlc generate` falla**: el error aparece al generar, no en producción. Regenera cada vez que cambies el SQL y versiona el código generado (o genéralo en CI).

## 5. El repositorio real

`internal/almacen/postgres/postgres.go` adapta el código generado a la interfaz del dominio. Los tipos de `pgtype` **no deben salir de este paquete**:

```go
package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TU_USUARIO/tareas/internal/db"
	"github.com/TU_USUARIO/tareas/internal/tarea"
)

type Repo struct{ q *db.Queries }

func Nuevo(pool *pgxpool.Pool) *Repo { return &Repo{q: db.New(pool)} }

var _ tarea.Repositorio = (*Repo)(nil)

func aDominio(t db.Tarea) tarea.Tarea {
	return tarea.Tarea{ID: t.ID, Titulo: t.Titulo, Hecha: t.Hecha, CreadaEn: t.CreadaEn.Time}
}

func (r *Repo) Crear(ctx context.Context, titulo string) (tarea.Tarea, error) {
	t, err := r.q.CrearTarea(ctx, titulo)
	if err != nil {
		return tarea.Tarea{}, err
	}
	return aDominio(t), nil
}

func (r *Repo) Obtener(ctx context.Context, id int64) (tarea.Tarea, error) {
	t, err := r.q.ObtenerTarea(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return tarea.Tarea{}, tarea.ErrNoEncontrada
	}
	if err != nil {
		return tarea.Tarea{}, err
	}
	return aDominio(t), nil
}

func (r *Repo) Listar(ctx context.Context) ([]tarea.Tarea, error) {
	filas, err := r.q.ListarTareas(ctx)
	if err != nil {
		return nil, err
	}
	res := make([]tarea.Tarea, len(filas))
	for i, f := range filas {
		res[i] = aDominio(f)
	}
	return res, nil
}

func (r *Repo) Actualizar(ctx context.Context, t tarea.Tarea) error {
	return r.q.ActualizarTarea(ctx, db.ActualizarTareaParams{ID: t.ID, Titulo: t.Titulo, Hecha: t.Hecha})
}

func (r *Repo) Eliminar(ctx context.Context, id int64) error {
	n, err := r.q.EliminarTarea(ctx, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return tarea.ErrNoEncontrada
	}
	return nil
}
```

(El nombre exacto de los campos de `ActualizarTareaParams` puede variar; revisa el archivo generado.)

Y en `main.go`, **cambia solo una línea**:

```go
pool, err := almacen.Conectar(ctx, cfg.BaseDatos)
if err != nil { return err }
defer pool.Close()

repo := postgres.Nuevo(pool)        // antes: memoria.Nuevo()
svc := tarea.NuevoServicio(repo)    // el dominio no se entera
```

Ésa es la recompensa del Patrón Repository.

## 🧪 Práctica

Crea la migración de la tabla `tareas`, escribe tres consultas en SQL (crear, listar, borrar), genera el código con `sqlc generate` y reemplaza el repositorio en memoria por uno real.

<details>
<summary>Ver solución</summary>

```bash
docker start tareas-db                      # o el docker run de esta lección
migrate create -ext sql -dir db/migrations -seq crear_tareas
# pega el SQL de up / down de arriba
migrate -path db/migrations -database "$DATABASE_URL" up
# escribe db/queries/tareas.sql y sqlc.yaml
sqlc generate && go build ./...
```

Verificación: arranca la app, crea una tarea en el navegador y comprueba en `psql`:

```sql
SELECT * FROM tareas;
```

Reinicia la app: **las tareas siguen ahí** (con el repositorio en memoria desaparecían).
</details>

## ⚠️ Errores comunes

- Concatenar variables dentro de SQL (inyección SQL).
- Abrir un pool por petición o no cerrarlo.
- Editar una migración ya aplicada.
- Dejar que `pgtype` / tipos generados se filtren hasta el dominio y los handlers.
- Olvidar `sqlc generate` tras cambiar el SQL.

## 📌 Resumen

- `pgx` + `pgxpool` para conectar; un único pool compartido; siempre con `context` y parámetros.
- `golang-migrate` versiona y aplica cambios de esquema (`up` / `down`).
- `sqlc` convierte SQL en código Go tipado y valida las consultas al generar.
- El repositorio PostgreSQL implementa la interfaz del dominio; `main` cambia una línea.

## ✅ Autoevaluación

1. ¿Por qué se usa un pool en lugar de una conexión por petición?
2. ¿Qué diferencia hay entre `:one`, `:many` y `:exec` en sqlc?
3. ¿Por qué nunca se edita una migración ya aplicada?
4. ¿Qué te protege de la inyección SQL?
5. ¿Qué cambió en el dominio al pasar de memoria a PostgreSQL?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mis tareas sobreviven al reinicio de la aplicación.
- [ ] Sé qué parte me costó más y la repasaré.

