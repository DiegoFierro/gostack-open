---
title: "Módulo 12: Rendimiento, Caché & Optimización"
description: "Mide primero, optimiza después: caché, compresión y consultas eficientes."
weight: 15
fase: "Fase 4: Rendimiento, observabilidad, escritorio y producción"
---

> Mide primero, optimiza después: caché, compresión y consultas eficientes.

**Fase 4: Rendimiento, observabilidad, escritorio y producción** · Lección 15 de 20

## 🎯 Objetivos

- Medir antes de optimizar (profiling y benchmarks).
- Implementar caché en memoria y con Redis, con invalidación razonable.
- Reducir tráfico con compresión HTTP y carga diferida.
- Detectar y corregir el problema N+1.
- Reducir asignaciones de memoria en Go.

## 1. La regla número uno: medir

> "La optimización prematura es la raíz de todos los males." — Donald Knuth

Optimizar sin medir es adivinar. El ciclo correcto:

1. **Define** un objetivo (p. ej. "p95 de `/tareas` < 100 ms con 200 usuarios").
2. **Mide** el estado actual.
3. **Encuentra el cuello de botella** con un perfilador.
4. **Cambia una cosa**, vuelve a medir.
5. Detente cuando alcances el objetivo.

La mayoría de las veces el cuello de botella es **la base de datos o la red**, no el código Go.

### Herramientas

**Carga HTTP** (instalables con `go install` o desde paquetes): `hey`, `wrk`, `vegeta`, `k6`.

```bash
hey -z 20s -c 50 http://localhost:8080/tareas     # 50 conexiones durante 20 s
```

Fíjate en **percentiles** (p50, p95, p99), no solo en el promedio.

**Perfilado con `pprof`**: expón los perfiles en un puerto **interno** (nunca público):

```go
import _ "net/http/pprof" // registra /debug/pprof/* en http.DefaultServeMux

go func() {
	log.Println(http.ListenAndServe("127.0.0.1:6060", nil)) // solo localhost
}()
```

```bash
# Mientras corre la carga:
go tool pprof -http=:9090 http://localhost:6060/debug/pprof/profile?seconds=20   # CPU
go tool pprof -http=:9090 http://localhost:6060/debug/pprof/heap                 # memoria
go tool pprof http://localhost:6060/debug/pprof/goroutine                        # goroutines
```

La interfaz web muestra un **flame graph**: lo más ancho es lo que más consume. Los **benchmarks** (Módulo 14) miden funciones concretas.

## 2. Caché: guardar para no recalcular

Una **caché** guarda el resultado de una operación costosa para reutilizarlo. Es la optimización con mayor retorno… y la fuente de errores sutiles. Como se dice: *"Hay dos problemas difíciles en informática: invalidar cachés y nombrar cosas."*

Preguntas antes de cachear:

- ¿El dato se **lee mucho más de lo que cambia**?
- ¿Aceptas servir un dato **ligeramente desactualizado**? ¿Cuánto tiempo?
- ¿Cómo y cuándo lo **invalidas**?

### Estrategias

| Estrategia | Cómo funciona |
|------------|---------------|
| **Cache-aside** (la más común) | La aplicación consulta la caché; si falla (*miss*), lee de la BD y guarda el resultado. |
| **TTL** (*time to live*) | Cada entrada caduca tras un tiempo. Simple y robusta. |
| **Invalidación explícita** | Al modificar el dato, borras su clave. |
| **Write-through** | Se escribe en BD y caché a la vez. |

### Caché en memoria con TTL

Para datos pequeños dentro de **una sola instancia** (listas de países, configuración, resultados de un cálculo):

```go
package cache

import (
	"sync"
	"time"
)

type entrada[V any] struct {
	valor   V
	expira  time.Time
}

type TTL[K comparable, V any] struct {
	mu    sync.RWMutex
	datos map[K]entrada[V]
	vida  time.Duration
}

func NuevaTTL[K comparable, V any](vida time.Duration) *TTL[K, V] {
	return &TTL[K, V]{datos: make(map[K]entrada[V]), vida: vida}
}

func (c *TTL[K, V]) Obtener(k K) (V, bool) {
	c.mu.RLock()
	e, ok := c.datos[k]
	c.mu.RUnlock()
	if !ok || time.Now().After(e.expira) {
		var cero V
		return cero, false
	}
	return e.valor, true
}

func (c *TTL[K, V]) Guardar(k K, v V) {
	c.mu.Lock()
	c.datos[k] = entrada[V]{valor: v, expira: time.Now().Add(c.vida)}
	c.mu.Unlock()
}

func (c *TTL[K, V]) Borrar(k K) {
	c.mu.Lock()
	delete(c.datos, k)
	c.mu.Unlock()
}
```

(Esta versión no limita su tamaño ni purga entradas vencidas: para producción añade una goroutine de limpieza o usa una biblioteca como `github.com/dgraph-io/ristretto` u `otter`.)

### Evitar la estampida con `singleflight`

Cuando una entrada popular caduca, 500 peticiones simultáneas pueden ir a la base de datos a la vez (*cache stampede*). `singleflight` **colapsa** las llamadas concurrentes con la misma clave en una sola:

```go
import "golang.org/x/sync/singleflight"

var grupo singleflight.Group

func (s *Servicio) Estadisticas(ctx context.Context) (Stats, error) {
	if v, ok := s.cache.Obtener("stats"); ok {
		return v, nil
	}
	v, err, _ := grupo.Do("stats", func() (any, error) {
		st, err := s.repo.CalcularStats(ctx) // solo UNA ejecución para todos los que esperan
		if err == nil {
			s.cache.Guardar("stats", st)
		}
		return st, err
	})
	if err != nil {
		return Stats{}, err
	}
	return v.(Stats), nil
}
```

### Caché distribuida con Redis

Si tienes **varias instancias** de la aplicación, una caché en memoria difiere entre ellas. **Redis** es una caché compartida:

```bash
go get github.com/redis/go-redis/v9
```

```go
rdb := redis.NewClient(&redis.Options{Addr: cfg.RedisAddr})

func (s *Servicio) Estadisticas(ctx context.Context) (Stats, error) {
	const clave = "tareas:stats:v1"      // versiona las claves cuando cambie el formato

	if b, err := s.rdb.Get(ctx, clave).Bytes(); err == nil {
		var st Stats
		if json.Unmarshal(b, &st) == nil {
			return st, nil                // HIT
		}
	} else if !errors.Is(err, redis.Nil) {
		log.Printf("redis: %v", err)      // un fallo de caché NO debe tumbar la aplicación
	}

	st, err := s.repo.CalcularStats(ctx)  // MISS: ir a la fuente
	if err != nil {
		return Stats{}, err
	}
	if b, err := json.Marshal(st); err == nil {
		s.rdb.Set(ctx, clave, b, 60*time.Second) // TTL de 60 s
	}
	return st, nil
}

// Invalidación explícita al modificar datos
func (s *Servicio) Crear(ctx context.Context, titulo string) (Tarea, error) {
	t, err := s.repo.Crear(ctx, titulo)
	if err == nil {
		s.rdb.Del(ctx, "tareas:stats:v1")
	}
	return t, err
}
```

Principio de diseño: **la caché es una optimización, no una dependencia**. Si Redis cae, la aplicación debe seguir funcionando (más lenta).

### Caché HTTP del navegador

Para recursos estáticos y respuestas que lo permitan:

```go
w.Header().Set("Cache-Control", "public, max-age=31536000, immutable") // archivos con hash en el nombre
w.Header().Set("Cache-Control", "no-store")                              // datos privados/sensibles
```

Los **ETag** permiten peticiones condicionales: el navegador pregunta "¿ha cambiado?" y el servidor responde `304 Not Modified` sin cuerpo. `http.FileServer` ya gestiona `Last-Modified`/`If-Modified-Since`.

> Nunca caches respuestas **personalizadas** (con datos de sesión) en una caché compartida sin incluir al usuario en la clave.

## 3. Compresión y carga diferida

### Compresión HTTP

El HTML, CSS, JS y JSON comprimen muy bien (60–90 %). Hay dos opciones:

1. **Delegarlo al proxy inverso** (recomendado): Caddy lo hace con una línea (`encode zstd gzip`, Módulo 17).
2. **En Go**, con un middleware (biblioteca de confianza como `github.com/klauspost/compress/gzhttp`):

```go
import "github.com/klauspost/compress/gzhttp"

handler := gzhttp.GzipHandler(mux)
```

Reglas: no comprimas contenido ya comprimido (imágenes JPEG/PNG, vídeo, `.zip`); respeta `Accept-Encoding`.

### Carga diferida (*lazy loading*)

No cargues lo que el usuario aún no ve.

```html
<!-- Imágenes -->
<img src="grafico.png" loading="lazy" width="600" height="300" alt="Gráfico semanal">

<!-- Con HTMX: cargar un bloque costoso después de pintar la página -->
<div hx-get="/panel/estadisticas" hx-trigger="load" hx-swap="outerHTML">
  <p>Cargando estadísticas…</p>
</div>

<!-- Cargar cuando aparece en pantalla (scroll infinito) -->
<tr hx-get="/tareas?pagina=3" hx-trigger="revealed" hx-swap="afterend">
  <td colspan="3">Cargando más…</td>
</tr>
```

Con `hx-trigger="load"` la página principal llega rápido y las partes lentas aparecen después: la **percepción de velocidad** mejora mucho.

## 4. El problema N+1

Ocurre cuando, para listar N elementos, ejecutas **1 consulta** para la lista y **N consultas** más para datos relacionados de cada uno.

```go
// ❌ N+1: 1 consulta para listar + N consultas para el autor de cada tarea
tareas, _ := q.ListarTareas(ctx)
for _, t := range tareas {
	autor, _ := q.ObtenerUsuario(ctx, t.UsuarioID) // una ida y vuelta a la BD por tarea
	vista = append(vista, TareaConAutor{t, autor})
}
```

Con 100 tareas son 101 consultas; con 10 000, 10 001. Cada una cuesta latencia de red.

### Soluciones

**1. JOIN** (lo más simple):

```sql
-- name: ListarTareasConAutor :many
SELECT t.id, t.titulo, t.hecha, u.id AS autor_id, u.nombre AS autor_nombre
FROM tareas t
JOIN usuarios u ON u.id = t.usuario_id
ORDER BY t.id DESC
LIMIT $1;
```

**2. Consulta por lotes** con `ANY` (útil cuando no quieres un JOIN):

```sql
-- name: UsuariosPorIDs :many
SELECT * FROM usuarios WHERE id = ANY($1::bigint[]);
```

```go
ids := make([]int64, len(tareas))
for i, t := range tareas { ids[i] = t.UsuarioID }
usuarios, _ := q.UsuariosPorIDs(ctx, ids)
porID := make(map[int64]db.Usuario, len(usuarios))
for _, u := range usuarios { porID[u.ID] = u }   // 2 consultas en total, sin importar N
```

### Cómo detectarlo

- Activa el registro de consultas de PostgreSQL en desarrollo (`log_min_duration_statement = 0`) y busca patrones repetitivos.
- Cuenta consultas por petición (middleware + métrica; Módulo 13).
- En el *flame graph*, mucho tiempo en `pgx` esperando red.

### Otras optimizaciones de base de datos

- **Índices** en las columnas de `WHERE`, `JOIN` y `ORDER BY`. Comprueba con `EXPLAIN ANALYZE`.
- Selecciona solo las columnas que necesitas (`SELECT id, titulo` en vez de `SELECT *`).
- **Pagina** siempre (Módulo 07).
- Dimensiona el pool (`MaxConns`): más no siempre es mejor; PostgreSQL tiene su propio límite.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM tareas WHERE usuario_id = 5 ORDER BY id DESC LIMIT 20;
CREATE INDEX tareas_usuario_id_idx ON tareas (usuario_id, id DESC);
```

## 5. Optimización de memoria en Go

El recolector de basura (GC) de Go es muy bueno, pero **cada asignación en el montón cuesta**: tiempo de asignación y trabajo posterior del GC. Reducir asignaciones suele mejorar la latencia.

### Medir asignaciones

```bash
go test -bench=. -benchmem ./...
# BenchmarkConcat-8   1000000   1050 ns/op   2048 B/op   12 allocs/op
```

Columnas: tiempo por operación, **bytes por operación** y **número de asignaciones**.

### Técnicas efectivas

**Preasignar slices y mapas** cuando conoces el tamaño:

```go
res := make([]Vista, 0, len(tareas))     // evita crecer repetidamente
m := make(map[int64]Usuario, len(ids))
```

**Construir cadenas con `strings.Builder`** (no concatenar en bucle):

```go
var sb strings.Builder
sb.Grow(len(partes) * 16)
for _, p := range partes { sb.WriteString(p) }
return sb.String()
```

**Reutilizar búferes con `sync.Pool`**:

```go
var buffers = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func render(w http.ResponseWriter, t *template.Template, datos any) error {
	buf := buffers.Get().(*bytes.Buffer)
	buf.Reset()
	defer buffers.Put(buf)
	if err := t.Execute(buf, datos); err != nil {
		return err
	}
	_, err := buf.WriteTo(w)
	return err
}
```

**Streaming en lugar de cargar todo en memoria**: usa `io.Copy`, `json.NewEncoder(w).Encode(...)` o `bufio.Scanner` para ficheros grandes, en vez de `io.ReadAll`.

**Evita sub-slices que retienen arrays enormes** (`datos[:10]` mantiene vivo todo el array; copia lo que necesitas con `slices.Clone`).

**Estructuras pequeñas por valor** y punteros solo cuando hace falta: los punteros fuerzan asignaciones en el montón y presionan al GC. Para ver qué "escapa" al montón: `go build -gcflags="-m" ./...`.

**Ajustes de GC** (último recurso, tras medir): `GOGC` (más alto = menos GC, más memoria) y `GOMEMLIMIT` (límite blando de memoria; muy útil en contenedores).

### Antipatrones de rendimiento web

- Consultas dentro de bucles (N+1).
- Renderizar plantillas con parseo en cada petición.
- Cargar tablas enteras en memoria para filtrar en Go en vez de en SQL.
- Serializar JSON enorme sin paginar.
- Trabajo pesado síncrono dentro del handler (usa colas, Módulo 11).

## 🧪 Práctica

Perfila un listado con `pprof`, elimina un N+1 con un `JOIN`, añade caché con TTL en Redis y compara tiempos antes y después.

<details>
<summary>Ver solución</summary>

1. **Preparación**: genera datos con `INSERT INTO tareas (titulo, usuario_id) SELECT 'tarea '||g, (g%100)+1 FROM generate_series(1, 20000) g;`.
2. **Línea base**: `hey -z 20s -c 50 http://localhost:8080/tareas` → anota RPS, p50, p95, p99.
3. **Perfil**: `go tool pprof -http=:9090 .../profile?seconds=20`. Verás tiempo en `pgx` y un número altísimo de consultas por petición (el N+1).
4. **Arreglo 1**: sustituye el bucle por `ListarTareasConAutor` con `JOIN`. Repite `hey`; anota la mejora.
5. **Arreglo 2**: cachea el resultado de las estadísticas/contadores 60 s en Redis con invalidación al crear/borrar. Repite `hey`.
6. **Arreglo 3**: activa `gzhttp` (o `encode gzip` en Caddy) y compara el tamaño transferido con `curl -H 'Accept-Encoding: gzip' -s -o /dev/null -w '%{size_download}\n' localhost:8080/tareas`.
7. Anota los resultados en una tabla *antes/después* y comprueba con `go test -bench -benchmem` que bajaron las asignaciones de la función de renderizado.

Resultado esperado: de cientos de consultas por petición a una o dos, y una caída de latencia de uno o dos órdenes de magnitud en el listado.
</details>

## ⚠️ Errores comunes

- Optimizar sin perfilar.
- Cachear sin plan de invalidación (datos obsoletos para siempre).
- Hacer que la aplicación **dependa** de la caché para funcionar.
- Exponer `pprof` a internet.
- Comparar solo medias y no percentiles.
- Micro-optimizar código mientras la consulta SQL sin índice tarda 2 segundos.

## 📌 Resumen

- **Mide** (carga + `pprof` + benchmarks) antes y después de cada cambio.
- Caché: cache-aside + TTL + invalidación; en memoria para una instancia, Redis para varias; `singleflight` contra estampidas.
- Comprime en el proxy o con un middleware y difiere lo que no se ve.
- N+1 se resuelve con `JOIN` o consultas por lotes; añade índices y verifica con `EXPLAIN`.
- Menos asignaciones = menos trabajo para el GC: preasigna, reutiliza, haz streaming.

## ✅ Autoevaluación

1. ¿Por qué usar percentiles y no solo el promedio?
2. ¿Qué es la estampida de caché y cómo ayuda `singleflight`?
3. ¿Qué diferencia práctica hay entre caché en memoria y Redis?
4. ¿Qué es el problema N+1 y cómo lo detectas?
5. ¿Qué te dicen `B/op` y `allocs/op` en un benchmark?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Tengo una tabla antes/después con mediciones reales.
- [ ] Sé qué parte me costó más y la repasaré.

