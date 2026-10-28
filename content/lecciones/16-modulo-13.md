---
title: "Módulo 13: Observabilidad en Producción: Logging Estructurado & Métricas"
description: "Saber qué pasa en tu sistema cuando ya no estás mirando."
weight: 16
fase: "Fase 4: Rendimiento, observabilidad, escritorio y producción"
---

## Objetivos

- Registrar eventos en JSON con `log/slog` y contexto de petición.
- Exponer métricas para Prometheus y definir las que importan.
- Añadir trazas distribuidas con OpenTelemetry.
- Ofrecer *health checks* y apagado observable.

## 1. Los tres pilares de la observabilidad

**Observabilidad** es la capacidad de entender qué ocurre *dentro* de un sistema a partir de lo que emite hacia afuera. En producción no puedes poner un depurador; necesitas señales.

| Pilar | Responde a | Ejemplo |
|-------|------------|---------|
| **Logs** | *¿Qué pasó?* (eventos discretos) | "usuario 7 falló el login desde 1.2.3.4" |
| **Métricas** | *¿Cómo está el sistema?* (números agregados en el tiempo) | peticiones/s, latencia p95, errores 5xx |
| **Trazas** | *¿Dónde se fue el tiempo?* (recorrido de una petición) | `GET /tareas`: 3 ms handler → 85 ms consulta SQL |

## 2. Logging estructurado con `log/slog`

Un log tradicional es una frase: `usuario 7 creó tarea 42`. Para buscarlo en máquinas hay que usar expresiones regulares. Un log **estructurado** son pares clave-valor (normalmente JSON): se filtra, agrega y alerta sin parsear texto.

`log/slog` está en la biblioteca estándar desde Go 1.21.

```go
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
	Level: slog.LevelInfo,
}))
slog.SetDefault(logger) // ahora slog.Info(...) usa este logger

slog.Info("tarea creada", "tarea_id", 42, "usuario_id", 7)
// {"time":"2026-10-21T10:00:00Z","level":"INFO","msg":"tarea creada","tarea_id":42,"usuario_id":7}
```

### Niveles

`Debug` (detalle de desarrollo) < `Info` (eventos normales) < `Warn` (algo raro pero recuperable) < `Error` (algo falló). En producción: `Info`; en desarrollo `Debug`, configurable por variable de entorno:

```go
var nivel slog.LevelVar
nivel.Set(slog.LevelDebug)   // se puede cambiar en caliente
```

### Atributos tipados y grupos

```go
slog.Error("falló la consulta",
	slog.String("operacion", "listar_tareas"),
	slog.Int64("usuario_id", 7),
	slog.Duration("duracion", 83*time.Millisecond),
	slog.Any("error", err),
)

slog.Info("petición",
	slog.Group("http",
		slog.String("metodo", "GET"),
		slog.String("ruta", "/tareas"),
		slog.Int("estado", 200),
	),
)
// {"msg":"petición","http":{"metodo":"GET","ruta":"/tareas","estado":200}}
```

### Loggers con contexto: `With`

```go
log := slog.Default().With("componente", "servicio_tareas")
log.Info("iniciado")   // todos sus registros llevan componente=servicio_tareas
```

### ID de petición: correlacionar todo lo que pasó en una petición

Es la técnica más útil: un identificador único que aparece en **todos** los registros de esa petición.

```go
type claveLogger struct{}

func ConLogger(ctx context.Context, l *slog.Logger) context.Context {
	return context.WithValue(ctx, claveLogger{}, l)
}

// Log devuelve el logger de la petición, o el global si no hay.
func Log(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(claveLogger{}).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

func IDPeticion(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", id)
		l := slog.Default().With("request_id", id)
		next.ServeHTTP(w, r.WithContext(ConLogger(r.Context(), l)))
	})
}
```

Ahora el middleware de registro del Módulo 04 queda profesional:

```go
func Registro(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inicio := time.Now()
		rec := &respuestaRegistrada{ResponseWriter: w, estado: http.StatusOK}
		next.ServeHTTP(rec, r)

		Log(r.Context()).LogAttrs(r.Context(), slog.LevelInfo, "petición",
			slog.String("metodo", r.Method),
			slog.String("ruta", r.URL.Path),
			slog.Int("estado", rec.estado),
			slog.Duration("duracion", time.Since(inicio)),
			slog.String("ip", r.RemoteAddr),
		)
	})
}
```

Y en cualquier capa: `observabilidad.Log(ctx).Error("falló la consulta", "error", err)` — con el mismo `request_id`.

### Buenas prácticas de logging

- **Registra o devuelve el error, no ambos** (Módulo 02). El lugar ideal para registrar es el borde (handler / middleware).
- Mensajes **constantes** y datos en atributos (no `fmt.Sprintf` dentro del mensaje): facilita agrupar.
- **Nunca** registres contraseñas, tokens, datos personales ni cuerpos completos. Implementa `slog.LogValuer` para ocultar campos sensibles:

```go
type Usuario struct{ ID int64; Email, Password string }

func (u Usuario) LogValue() slog.Value {
	return slog.GroupValue(slog.Int64("id", u.ID)) // solo el ID
}
```

- Escribe en **stdout**: es el contenedor/orquestador quien recoge y envía los logs (Docker, Loki, Cloud Logging).
- Cuidado con el volumen: `Debug` en producción puede ser costoso.

## 3. Métricas con Prometheus

**Prometheus** *rastrea* (*scrapes*) periódicamente el endpoint `/metrics` de tu servicio, almacena series temporales y permite consultarlas (PromQL), graficarlas (Grafana) y alertar.

```bash
go get github.com/prometheus/client_golang/prometheus
go get github.com/prometheus/client_golang/prometheus/promhttp
```

### Tipos de métrica

| Tipo | Qué es | Ejemplo |
|------|--------|---------|
| **Counter** | Solo sube | peticiones totales, errores |
| **Gauge** | Sube y baja | conexiones activas, tamaño de cola |
| **Histogram** | Distribución en *buckets* | latencia de peticiones |
| **Summary** | Cuantiles calculados en cliente | (menos usado) |

### Instrumentar HTTP

```go
package observabilidad

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	peticiones = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total de peticiones HTTP.",
	}, []string{"metodo", "ruta", "estado"})

	latencia = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "Duración de las peticiones HTTP.",
		Buckets: prometheus.DefBuckets, // 5 ms … 10 s; ajústalos a tu SLO
	}, []string{"metodo", "ruta"})

	enVuelo = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "http_requests_in_flight",
		Help: "Peticiones en curso.",
	})
)

func Metricas(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		enVuelo.Inc()
		defer enVuelo.Dec()

		inicio := time.Now()
		rec := &respuestaRegistrada{ResponseWriter: w, estado: http.StatusOK}
		next.ServeHTTP(rec, r)

		// r.Pattern (Go 1.23+) = patrón del enrutador, p. ej. "GET /tareas/{id}"
		ruta := r.Pattern
		if ruta == "" {
			ruta = "desconocida"
		}
		latencia.WithLabelValues(r.Method, ruta).Observe(time.Since(inicio).Seconds())
		peticiones.WithLabelValues(r.Method, ruta, strconv.Itoa(rec.estado)).Inc()
	})
}
```

⚠️ **Cardinalidad**: cada combinación de etiquetas crea una serie temporal. Usa `r.Pattern` (`/tareas/{id}`), **no** `r.URL.Path` (`/tareas/42`, `/tareas/43`…): millones de series revientan Prometheus. Nunca pongas IDs de usuario ni mensajes de error como etiqueta.

### Exponer `/metrics`

```go
import "github.com/prometheus/client_golang/prometheus/promhttp"

// En un puerto interno (o protegido), no en el público:
interno := http.NewServeMux()
interno.Handle("GET /metrics", promhttp.Handler())
go http.ListenAndServe("127.0.0.1:9100", interno)
```

Además de las tuyas, obtienes gratis métricas del *runtime* de Go (goroutines, memoria, GC) y del proceso.

### Métricas de negocio y de dependencias

```go
tareasCreadas = promauto.NewCounter(prometheus.CounterOpts{Name: "tareas_creadas_total", Help: "Tareas creadas."})
colaProfundidad = promauto.NewGaugeFunc(prometheus.GaugeOpts{Name: "cola_pendientes"}, func() float64 { return float64(contarPendientes()) })
```

Y del pool de conexiones: `pool.Stat()` expone conexiones abiertas, en uso y esperas.

### Qué medir: las "señales doradas" y el método RED

Para un servicio web: **R**ate (peticiones/s), **E**rrors (porcentaje de 5xx), **D**uration (latencia p50/p95/p99). Añade **saturación** (CPU, memoria, pool de BD, cola). Alertas útiles, ejemplos en PromQL:

```promql
# Tasa de peticiones por segundo
sum(rate(http_requests_total[5m]))

# Porcentaje de errores 5xx
sum(rate(http_requests_total{estado=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))

# Latencia p95
histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))
```

Prometheus mínimo (`prometheus.yml`):

```yaml
scrape_configs:
  - job_name: tareas
    scrape_interval: 15s
    static_configs:
      - targets: ["host.docker.internal:9100"]
```

## 4. Trazas con OpenTelemetry

**OpenTelemetry (OTel)** es el estándar abierto para generar **trazas, métricas y logs** de forma neutral respecto al proveedor (Jaeger, Tempo, Datadog, etc.).

Conceptos:

- **Traza** (*trace*): el recorrido completo de una petición.
- **Span**: una operación dentro de la traza (handler, consulta SQL, llamada HTTP). Tiene nombre, duración, atributos y un span padre.
- **Propagación de contexto**: el ID de traza viaja entre servicios en cabeceras (`traceparent`).

```text
GET /tareas (trace 4bf92f…)
├─ handler.listar              90 ms
│  ├─ db.ListarTareas          70 ms   ← el cuello de botella se ve de un vistazo
│  └─ template.render          15 ms
```

### Configuración básica

```bash
go get go.opentelemetry.io/otel \
       go.opentelemetry.io/otel/sdk \
       go.opentelemetry.io/otel/exporters/stdout/stdouttrace \
       go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
```

```go
func IniciarTrazas(ctx context.Context, servicio string) (func(context.Context) error, error) {
	exp, err := stdouttrace.New(stdouttrace.WithPrettyPrint()) // en producción: OTLP (otlptracegrpc)
	if err != nil {
		return nil, err
	}
	res, err := resource.Merge(resource.Default(),
		resource.NewSchemaless(semconv.ServiceName(servicio)))
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(0.1))), // muestrea el 10 %
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{}, propagation.Baggage{}))
	return tp.Shutdown, nil // llamar al apagar para vaciar los spans pendientes
}
```

(Imports: `go.opentelemetry.io/otel/sdk/resource`, `sdktrace "go.opentelemetry.io/otel/sdk/trace"`, `semconv "go.opentelemetry.io/otel/semconv/v1.26.0"` o la versión vigente, `go.opentelemetry.io/otel/propagation`.)

### Instrumentar el servidor y tus operaciones

```go
// Todo el servidor: crea un span por petición y propaga el contexto entrante
handler := otelhttp.NewHandler(mux, "tareas")

// Spans propios
var tracer = otel.Tracer("tareas/servicio")

func (s *Servicio) Listar(ctx context.Context) ([]Tarea, error) {
	ctx, span := tracer.Start(ctx, "servicio.Listar")
	defer span.End()

	ts, err := s.repo.Listar(ctx)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "falló el listado")
		return nil, err
	}
	span.SetAttributes(attribute.Int("tareas.cantidad", len(ts)))
	return ts, nil
}
```

Con `pgx` existe el *tracer* `github.com/exaring/otelpgx` que crea un span por consulta; y para clientes HTTP, `otelhttp.NewTransport`.

**Une logs y trazas**: añade `trace_id` a tus logs para saltar de un log a su traza.

```go
sc := trace.SpanContextFromContext(ctx)
if sc.IsValid() {
	l = l.With("trace_id", sc.TraceID().String(), "span_id", sc.SpanID().String())
}
```

Para ver trazas localmente puedes levantar **Jaeger** (`docker run -p 16686:16686 -p 4317:4317 jaegertracing/jaeger:latest`) y exportar por OTLP.

## 5. Salud del servicio y apagado

Los orquestadores (Docker, Kubernetes) y los balanceadores necesitan saber si tu aplicación funciona:

```go
// Liveness: el proceso responde.
mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
})

// Readiness: está lista para recibir tráfico (dependencias OK).
mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		http.Error(w, "base de datos no disponible", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK)
})
```

Registra los eventos del ciclo de vida: arranque (versión, configuración **sin secretos**), señal de apagado, fin del apagado ordenado. Incluye la versión en el binario:

```bash
go build -ldflags "-X main.version=$(git describe --tags --always)" ./cmd/tareas
```

## Práctica

Sustituye `log.Println` por `slog` con un ID de petición, expón `/metrics` con contador y histograma de latencia y añade un endpoint `/healthz` (y `/readyz`).

<details>
<summary>Ver solución</summary>

1. Configura `slog` JSON como logger por defecto en `main` (nivel desde `LOG_LEVEL`).
2. Encadena los middlewares: `Recuperar → IDPeticion → Metricas → Registro → … → mux`.
3. Sustituye `log.Printf` en todo el código por `observabilidad.Log(ctx).Info/Error(...)`.
4. Define `http_requests_total` y `http_request_duration_seconds` y sirve `/metrics` en `127.0.0.1:9100`.
5. Añade `/healthz` y `/readyz`.
6. Verifica:

```bash
curl -s -i localhost:8080/tareas | grep -i x-request-id      # cabecera con el ID
curl -s localhost:9100/metrics | grep http_requests_total     # contadores crecen
curl -s localhost:8080/readyz -o /dev/null -w '%{http_code}\n' # 200; detén Postgres y verás 503
```

7. (Bonus) Levanta Prometheus con el `prometheus.yml` de arriba, consulta `histogram_quantile(0.95, …)`, y añade `otelhttp` con exportador `stdout` para ver un span por petición.
</details>

## Errores comunes

- Logs en texto libre imposibles de filtrar.
- Registrar secretos o datos personales.
- Etiquetas de alta cardinalidad en métricas (IDs, rutas con parámetros reales).
- Exponer `/metrics` y `pprof` al público.
- Registrar el mismo error en cada capa (ruido triplicado).
- Medir solo promedios de latencia.

## Resumen

- Logs = qué pasó; métricas = cómo está; trazas = dónde se va el tiempo.
- `log/slog`: JSON, atributos, niveles y un `request_id` que une todo.
- Prometheus: Counter/Gauge/Histogram, método RED, cuidado con la cardinalidad.
- OpenTelemetry: spans y propagación de contexto; enlaza logs con `trace_id`.
- `/healthz` y `/readyz` para orquestadores.

## Autoevaluación

1. ¿Qué ventaja tiene un log estructurado frente a uno de texto?
2. ¿Para qué sirve el `request_id`?
3. ¿Qué tipo de métrica usarías para latencia y cuál para "peticiones totales"?
4. ¿Qué es la cardinalidad y por qué importa?
5. ¿En qué se diferencian *liveness* y *readiness*?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Puedo seguir una petición de principio a fin por su `request_id`.
- [ ] Sé qué parte me costó más y la repasaré.

