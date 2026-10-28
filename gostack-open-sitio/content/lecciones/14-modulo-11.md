---
title: "Módulo 11: Comunicación en Tiempo Real & Tareas en Segundo Plano"
description: "Notificaciones en vivo y trabajo diferido con colas."
weight: 14
fase: "Fase 3: Seguridad, APIs y tiempo real"
---

## Objetivos

- Servir WebSockets en Go y conectarlos con HTMX.
- Diseñar un *hub* concurrente que difunda mensajes a muchos clientes.
- Encolar y procesar tareas en segundo plano con Asynq y Redis.
- Diseñar tareas idempotentes con reintentos.

## 1. Tiempo real: ¿qué opciones hay?

HTTP clásico es *petición → respuesta*: el servidor no puede hablar primero. Para que el servidor "empuje" datos hay varias técnicas:

| Técnica | Dirección | Cuándo |
|---------|-----------|--------|
| **Sondeo** (`hx-trigger="every 5s"`) | cliente → servidor repetido | Simple; datos que cambian poco |
| **SSE** (*Server-Sent Events*) | servidor → cliente | Notificaciones, progreso, feeds; usa HTTP normal y reconecta solo |
| **WebSockets** | **bidireccional** | Chat, edición colaborativa, juegos, paneles interactivos |

Elige lo más sencillo que resuelva tu problema. Aquí veremos WebSockets, que son lo que pide el syllabus.

Un **WebSocket** comienza como una petición HTTP con `Upgrade: websocket`; el servidor responde `101 Switching Protocols` y la misma conexión TCP queda abierta, permitiendo mensajes en ambos sentidos con muy poca sobrecarga.

## 2. WebSockets en Go

La biblioteca estándar no incluye servidor WebSocket completo. Usaremos **`github.com/coder/websocket`** (antes `nhooyr.io/websocket`): moderna, idiomática, con `context` y sin dependencias.

```bash
go get github.com/coder/websocket
```

### Un eco mínimo

```go
func eco(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, nil) // verifica el origen por defecto
	if err != nil {
		return
	}
	defer c.CloseNow()

	ctx := r.Context()
	for {
		tipo, msg, err := c.Read(ctx)
		if err != nil {
			return // cliente desconectado o error
		}
		if err := c.Write(ctx, tipo, msg); err != nil {
			return
		}
	}
}
```

Notas de seguridad: `Accept` rechaza orígenes distintos del host por defecto (protección contra *Cross-Site WebSocket Hijacking*); si necesitas otros, indícalos en `AcceptOptions.OriginPatterns`. Autentica la conexión con la **cookie de sesión** del Módulo 09 *antes* de aceptar el *upgrade*.

## 3. Un *Hub*: difundir a muchos clientes

Aquí se une todo lo del Módulo 08. Un **hub** mantiene el conjunto de clientes conectados y reparte los mensajes. Diseño CSP: **una sola goroutine es dueña del mapa de clientes** y los demás se comunican por canales (sin mutex).

```go
package tiemporeal

import (
	"context"
	"time"

	"github.com/coder/websocket"
)

type Cliente struct {
	envio chan []byte // búfer: protege al hub de clientes lentos
}

type Hub struct {
	registrar chan *Cliente
	baja      chan *Cliente
	difundir  chan []byte
}

func NuevoHub() *Hub {
	return &Hub{
		registrar: make(chan *Cliente),
		baja:      make(chan *Cliente),
		difundir:  make(chan []byte, 64),
	}
}

// Run debe ejecutarse en su propia goroutine; termina cuando se cancela ctx.
func (h *Hub) Run(ctx context.Context) {
	clientes := make(map[*Cliente]struct{})
	for {
		select {
		case <-ctx.Done():
			return
		case c := <-h.registrar:
			clientes[c] = struct{}{}
		case c := <-h.baja:
			if _, ok := clientes[c]; ok {
				delete(clientes, c)
				close(c.envio)
			}
		case msg := <-h.difundir:
			for c := range clientes {
				select {
				case c.envio <- msg:
				default: // cliente lento: lo desconectamos en vez de bloquear a todos
					delete(clientes, c)
					close(c.envio)
				}
			}
		}
	}
}

// Publicar es seguro para llamar desde cualquier goroutine (por ejemplo, un handler HTTP).
func (h *Hub) Publicar(msg []byte) {
	select {
	case h.difundir <- msg:
	default: // hub saturado: descartar en vez de bloquear la petición
	}
}

// Servir atiende una conexión WebSocket.
func (h *Hub) Servir(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()

	c := &Cliente{envio: make(chan []byte, 16)}
	h.registrar <- c
	defer func() { h.baja <- c }()

	ctx := conn.CloseRead(r.Context()) // procesa pings/cierres; se cancela si el cliente se va

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-c.envio:
			if !ok {
				return
			}
			ctxEsc, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Write(ctxEsc, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		}
	}
}
```

(Importa también `net/http`. En un `Servir` real conviene proteger el envío a `h.registrar`/`h.baja` si el hub ya terminó; aquí lo omitimos por claridad.)

Puntos clave del diseño:

- **Un productor, un consumidor por conexión**: cada cliente tiene su propio canal con búfer.
- **Cliente lento = desconexión**, no bloqueo de los demás.
- Todo termina limpiamente por `context`.
- La biblioteca no permite escrituras concurrentes sobre la misma conexión; por eso solo **una goroutine escribe**.

## 4. WebSockets + HTMX

HTMX incluye una **extensión de WebSocket** (en HTMX 1.x se activaba con `hx-ws`; en **HTMX 2** la extensión se llama `ws` y usa los atributos `ws-connect` y `ws-send`). Descárgala del repositorio de extensiones y cárgala tras `htmx.min.js`.

```html
<div hx-ext="ws" ws-connect="/ws">
  <ul id="avisos"></ul>

  <form ws-send>
    <input name="mensaje" placeholder="Escribe…" autocomplete="off">
    <button>Enviar</button>
  </form>
</div>
```

- `ws-connect="/ws"` abre la conexión (y reconecta con *backoff* automático).
- `ws-send` en un formulario envía sus campos como **JSON** al servidor al hacer *submit*.
- Los mensajes **recibidos** deben ser **fragmentos HTML con un `id`**; HTMX los aplica como OOB swaps (Módulo 07). Por ejemplo, el servidor envía:

```html
<ul id="avisos" hx-swap-oob="beforeend">
  <li>María completó «Estudiar Go»</li>
</ul>
```

Es decir, el servidor "empuja" el **mismo tipo de parcial** que ya sabes producir con `html/template`: la historia hipermedia se mantiene, ahora en tiempo real.

Combinándolo con tu servicio: cuando alguien crea o completa una tarea, publicas un fragmento al hub:

```go
func (s *Servidor) alternar(w http.ResponseWriter, r *http.Request) {
	// ... cambia la tarea ...
	var buf bytes.Buffer
	_ = s.vistas.Parcial(&buf, "tareas.html", "aviso-tarea", t) // renderiza el HTML del aviso
	s.hub.Publicar(buf.Bytes())
	// ... responde al cliente que hizo la acción ...
}
```

(Para simplificar, aquí `Parcial` acepta un `io.Writer`; adapta la versión del Módulo 05.)

**Cuidado**: escapa SIEMPRE el contenido (`html/template` ya lo hace). Un título con `<script>` difundido a todos los clientes sería un XSS masivo.

**Escalar a varias instancias**: un hub en memoria solo ve a los clientes de *su* proceso. Con varias instancias del servidor, publica los mensajes en **Redis Pub/Sub** y que cada instancia los difunda a sus propios clientes.

## 5. Tareas en segundo plano

Hay trabajo que **no debe ocurrir dentro de la petición**: enviar correos, generar un PDF, procesar imágenes, llamar a APIs externas lentas. Razones: el usuario no debería esperar, la petición puede cancelarse, el proceso puede reiniciarse y el trabajo se perdería.

Solución: una **cola de tareas**:

```text
 Handler ──encola──▶ [ Redis ] ──▶ Worker(s) ──▶ procesan, reintentan si fallan
   │ responde de inmediato "202 Accepted"
```

**Asynq** (`github.com/hibiken/asynq`) es una biblioteca de colas para Go respaldada por **Redis**: reintentos con *backoff*, tareas programadas, prioridades, plazos, deduplicación y una UI de monitoreo (`asynqmon`).

```bash
docker run -d --name redis -p 6379:6379 redis:7
go get github.com/hibiken/asynq
```

### Definir tareas

```go
package tareasbg

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

const TipoResumenDiario = "email:resumen_diario"

type PayloadResumen struct {
	UsuarioID int64 `json:"usuario_id"`
	Fecha     string `json:"fecha"` // parte de la clave de idempotencia
}

func NuevaTareaResumen(usuarioID int64, fecha string) (*asynq.Task, error) {
	datos, err := json.Marshal(PayloadResumen{UsuarioID: usuarioID, Fecha: fecha})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TipoResumenDiario, datos,
		asynq.MaxRetry(3),                       // hasta 3 reintentos
		asynq.Timeout(30*time.Second),           // plazo por intento
		asynq.Queue("default"),
		asynq.Unique(24*time.Hour),              // no encolar duplicados (mismo tipo+payload)
	), nil
}

// Handler del worker
type Procesador struct {
	correo Enviador // interfaz propia, fácil de sustituir en pruebas
}

type Enviador interface {
	Enviar(ctx context.Context, usuarioID int64, asunto, cuerpo string) error
}

func (p *Procesador) ManejarResumen(ctx context.Context, t *asynq.Task) error {
	var pl PayloadResumen
	if err := json.Unmarshal(t.Payload(), &pl); err != nil {
		return fmt.Errorf("payload inválido: %w: %w", err, asynq.SkipRetry) // no tiene sentido reintentar
	}
	return p.correo.Enviar(ctx, pl.UsuarioID, "Tu resumen diario", "…") // si devuelve error, se reintenta
}
```

### Encolar (cliente) desde un handler

```go
cliente := asynq.NewClient(asynq.RedisClientOpt{Addr: cfg.RedisAddr})
defer cliente.Close()

tarea, _ := tareasbg.NuevaTareaResumen(u.ID, time.Now().Format("2006-01-02"))
info, err := cliente.EnqueueContext(r.Context(), tarea)
if err != nil && !errors.Is(err, asynq.ErrDuplicateTask) {
	http.Error(w, "no se pudo encolar", http.StatusInternalServerError)
	return
}
w.WriteHeader(http.StatusAccepted) // 202: aceptado, se procesará después
_ = info
```

Para trabajo programado: `asynq.ProcessIn(10*time.Minute)` o `asynq.ProcessAt(hora)`.

### Procesar (worker)

Se suele lanzar como **otro ejecutable** (`cmd/worker/main.go`) o como una goroutine del mismo binario:

```go
srv := asynq.NewServer(
	asynq.RedisClientOpt{Addr: cfg.RedisAddr},
	asynq.Config{
		Concurrency: 10, // goroutines procesando a la vez
		Queues:      map[string]int{"critica": 6, "default": 3, "baja": 1}, // pesos
	},
)

mux := asynq.NewServeMux()
mux.HandleFunc(tareasbg.TipoResumenDiario, proc.ManejarResumen)

if err := srv.Run(mux); err != nil { // bloquea; gestiona las señales y apaga ordenadamente
	log.Fatal(err)
}
```

Tareas periódicas (tipo *cron*) con `asynq.NewScheduler`:

```go
sch := asynq.NewScheduler(redisOpt, nil)
sch.Register("0 8 * * *", tarea) // todos los días a las 8:00
```

### Diseñar tareas fiables

Las colas ofrecen entrega **"al menos una vez"**: una tarea puede ejecutarse **más de una vez** (un reintento tras un fallo a mitad de camino). Por eso:

1. **Hazlas idempotentes**: ejecutarlas dos veces produce el mismo resultado que una. Técnicas: clave de idempotencia (usuario + fecha), `INSERT … ON CONFLICT DO NOTHING`, comprobar "¿ya lo envié hoy?".
2. **Payload mínimo**: guarda IDs, no objetos completos (los datos pueden haber cambiado al ejecutarse).
3. Distingue errores **transitorios** (red caída → reintenta) de **permanentes** (datos inválidos → `asynq.SkipRetry`).
4. **Respeta el `ctx`**: lleva el plazo de la tarea y la señal de apagado.
5. **Monitoriza**: `asynqmon` (UI web) o `asynq` CLI; las tareas agotadas van a la cola de "archivadas".
6. Observabilidad (Módulo 13): registra el ID de tarea, intentos y duración.

Ejemplo de idempotencia en SQL:

```sql
INSERT INTO resumenes_enviados (usuario_id, fecha) VALUES ($1, $2)
ON CONFLICT DO NOTHING;
-- Si no insertó nada (0 filas), ya estaba enviado: terminar con éxito.
```

## Práctica

Crea un panel donde se vean en vivo las tareas nuevas por WebSocket y encola un trabajo de "enviar resumen por email" procesado por un worker de Asynq con tres reintentos.

<details>
<summary>Ver solución</summary>

**WebSocket**

1. Añade `Hub` y arráncalo en `main`: `go hub.Run(ctx)`.
2. Ruta `mux.HandleFunc("GET /ws", s.exigirLoginWS(hub.Servir))`.
3. En `crear`, tras guardar, renderiza el fragmento `<ul id="avisos" hx-swap-oob="beforeend"><li>…</li></ul>` y haz `hub.Publicar(...)`.
4. En la página: `<div hx-ext="ws" ws-connect="/ws"><ul id="avisos"></ul></div>`.
5. Abre dos pestañas; crea una tarea en una y comprueba que aparece el aviso en la otra.

**Asynq**

1. `docker run -d -p 6379:6379 redis:7`; añade `REDIS_ADDR` a la configuración.
2. Implementa `NuevaTareaResumen` y `ManejarResumen` (con un `Enviador` de prueba que imprima en el log).
3. Crea `cmd/worker/main.go` con `asynq.NewServer` y arráncalo: `go run ./cmd/worker`.
4. Desde un handler `POST /resumen`, encola y responde `202`.
5. Simula un fallo: haz que `Enviar` devuelva un error las dos primeras veces y observa en el log los **reintentos con backoff**; la tercera vez funciona. Verifica la idempotencia ejecutando la misma tarea dos veces.
</details>

## Errores comunes

- Escribir en una conexión WebSocket desde varias goroutines a la vez.
- Dejar que un cliente lento bloquee al hub.
- Difundir HTML con datos del usuario sin escapar.
- Lanzar `go enviarCorreo()` dentro del handler sin cola: si el proceso se reinicia, el trabajo se pierde.
- Tareas no idempotentes que envían tres correos tras tres reintentos.
- No limitar el tamaño de los mensajes del WebSocket (`SetReadLimit`).

## Resumen

- Para empujar datos del servidor: sondeo, SSE o WebSockets; elige el más simple.
- Un **hub** con una goroutine dueña del estado y canales por cliente difunde con seguridad.
- La extensión `ws` de HTMX aplica los fragmentos HTML recibidos como OOB swaps.
- **Asynq + Redis** mueve el trabajo lento fuera de la petición, con reintentos y programación; las tareas deben ser idempotentes.

## Autoevaluación

1. ¿Cuándo elegirías SSE en lugar de WebSockets?
2. ¿Por qué es mejor que una goroutine sea dueña del mapa de clientes que usar un mutex?
3. ¿Qué haces con un cliente que no consume sus mensajes?
4. ¿Qué significa "entrega al menos una vez" y cómo afecta al diseño de tareas?
5. ¿Qué diferencia hay entre un error transitorio y uno permanente en Asynq?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Veo mis avisos en vivo en dos pestañas y el worker reintenta tareas fallidas.
- [ ] Sé qué parte me costó más y la repasaré.

