---
title: "Módulo 08: El Superpoder de Go: Concurrencia Nativa (CSP)"
description: "Goroutines, channels y context: concurrencia segura y legible."
weight: 11
fase: "Fase 2: Bases de datos, estado y concurrencia"
---

## Objetivos

- Explicar la diferencia entre concurrencia y paralelismo y el modelo CSP.
- Lanzar goroutines y coordinarlas con channels y `select`.
- Detectar y evitar condiciones de carrera.
- Cancelar trabajo y fijar plazos con `context.Context`.

## 1. Concurrencia ≠ paralelismo

- **Concurrencia**: estructurar un programa como tareas independientes que *progresan* sin esperarse entre sí (es una cuestión de diseño).
- **Paralelismo**: varias tareas *ejecutándose literalmente a la vez* en distintos núcleos (es una cuestión de hardware).

Go te da concurrencia como pieza central del lenguaje y el *runtime* la reparte en los núcleos disponibles. Tu servidor `net/http` **ya es concurrente**: cada petición se atiende en su propia goroutine. Por eso en el Módulo 03 el repositorio en memoria necesitaba un mutex.

### El modelo CSP

Go se inspira en **CSP** (*Communicating Sequential Processes*). Su lema:

> **No comuniques compartiendo memoria; comparte memoria comunicando.**

En lugar de que varios hilos lean y escriban la misma variable protegida por cerrojos, se pasan los datos entre sí por **canales**: quien envía cede la propiedad del dato y quien recibe pasa a ser su dueño. No es una prohibición (los mutex existen y se usan), sino una guía de diseño.

## 2. Goroutines

Una **goroutine** es una función ejecutándose de forma concurrente. Se lanza con la palabra `go`. Es *muy* barata (≈2 KB de pila inicial, que crece), así que puedes tener cientos de miles.

```go
func main() {
	go func() {
		fmt.Println("desde la goroutine")
	}()
	fmt.Println("desde main")
	time.Sleep(100 * time.Millisecond) // ¡mal! solo para este ejemplo
}
```

⚠️ Cuando `main` termina, el programa termina y **mata** todas las goroutines. Dormir "un rato" no es sincronizar; necesitas una forma real de esperar.

### `sync.WaitGroup`

```go
var wg sync.WaitGroup
for i := 1; i <= 3; i++ {
	wg.Add(1)
	go func() {
		defer wg.Done()
		fmt.Println("trabajador", i) // Go 1.22+: cada iteración tiene su propia i
	}()
}
wg.Wait() // bloquea hasta que el contador llegue a 0
```

(Desde Go 1.22 la variable de un bucle `for` es nueva en cada iteración, eliminando un clásico error de closures. En Go 1.25 existe además `wg.Go(func(){...})`, que hace `Add` y `Done` por ti.)

## 3. Channels

Un **canal** es un conducto tipado y seguro para comunicar goroutines.

```go
ch := make(chan int)      // sin búfer (unbuffered)
go func() { ch <- 42 }()  // enviar
v := <-ch                 // recibir (bloquea hasta que haya un valor)
fmt.Println(v)            // 42
```

### Con y sin búfer

| Tipo | Declaración | Comportamiento |
|------|-------------|----------------|
| **Sin búfer** | `make(chan T)` | El envío **espera** a que alguien reciba: sincroniza ambos lados (*rendezvous*). |
| **Con búfer** | `make(chan T, n)` | El envío solo bloquea si el búfer está lleno; recibir bloquea si está vacío. |

### Cerrar y recorrer

```go
func producir(n int) <-chan int {  // <-chan: solo lectura para quien lo recibe
	ch := make(chan int)
	go func() {
		defer close(ch)   // quien ENVÍA es quien cierra
		for i := 0; i < n; i++ {
			ch <- i
		}
	}()
	return ch
}

for v := range producir(5) { // termina cuando el canal se cierra
	fmt.Println(v)
}
```

Reglas de oro de los canales:

1. **Solo el emisor cierra** el canal; nunca el receptor.
2. Enviar a un canal cerrado → *panic*. Cerrarlo dos veces → *panic*.
3. Recibir de un canal cerrado devuelve el valor cero inmediatamente: `v, ok := <-ch` (`ok == false` si está cerrado y vacío).
4. Un canal `nil` bloquea para siempre (útil, avanzado, en `select`).
5. Indica la dirección en las firmas: `chan<- T` (solo enviar), `<-chan T` (solo recibir).

### Fugas de goroutines

Una goroutine bloqueada para siempre en un canal que nadie lee es una **fuga de memoria**. Cada goroutine que lances debe tener una **forma clara de terminar** (canal cerrado, contexto cancelado).

## 4. `select`

`select` espera a **varias** operaciones de canal y ejecuta la primera que esté lista:

```go
select {
case msg := <-canalA:
	fmt.Println("A:", msg)
case canalB <- 7:
	fmt.Println("enviado a B")
case <-time.After(2 * time.Second):
	fmt.Println("tiempo agotado")
default:
	fmt.Println("nada listo, sigo sin bloquear")
}
```

Patrón típico: un bucle que procesa trabajo hasta que se le pide parar:

```go
for {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case trabajo, ok := <-trabajos:
		if !ok { return nil }
		procesar(trabajo)
	}
}
```

## 5. Condiciones de carrera, `sync.Mutex` y el Race Detector

Una **condición de carrera** (*data race*) ocurre cuando dos goroutines acceden a la misma memoria a la vez y al menos una escribe, sin sincronización. Los resultados son impredecibles.

```go
contador := 0
var wg sync.WaitGroup
for i := 0; i < 1000; i++ {
	wg.Add(1)
	go func() { defer wg.Done(); contador++ }() // ¡CARRERA!
}
wg.Wait()
fmt.Println(contador) // casi nunca 1000
```

### Detectarlas: el *Race Detector*

```bash
go run -race .
go test -race ./...
```

Si hay una carrera, Go imprime las dos pilas de llamadas implicadas. **Ejecuta siempre `go test -race` en tu CI.** Solo detecta carreras que *ocurren* durante la ejecución, así que necesita buenas pruebas.

### Solución 1: `sync.Mutex`

```go
type Contador struct {
	mu sync.Mutex
	n  int
}

func (c *Contador) Inc() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
}
```

`sync.RWMutex` permite muchos lectores simultáneos o un único escritor; conviene cuando se lee mucho más de lo que se escribe (como el repositorio en memoria). **Un mutex nunca debe copiarse**: usa receptor de puntero y `go vet` te avisará.

### Solución 2: `sync/atomic`

```go
var n atomic.Int64
n.Add(1)
fmt.Println(n.Load())
```

### Solución 3: un único dueño

Una sola goroutine es dueña del dato y las demás le piden cosas por canal. Es la solución más "CSP", útil para estados complejos.

**¿Mutex o canal?** Mutex para proteger un estado compartido simple; canales para pasar datos, coordinar etapas y distribuir trabajo.

### Otras piezas de `sync`

- `sync.Once`: ejecutar algo exactamente una vez (inicialización perezosa).
- `sync.Map`: mapa concurrente para casos específicos; normalmente un `map` + `RWMutex` es más claro.
- `golang.org/x/sync/errgroup`: un `WaitGroup` que recoge el primer error y cancela el resto.

## 6. `context.Context`: cancelación, plazos y valores

Un `Context` transporta **señales de cancelación y plazos** a través de goroutines y llamadas. Ya lo usas: `r.Context()` se cancela cuando el cliente cierra la conexión.

```go
// Cancelación manual
ctx, cancel := context.WithCancel(context.Background())
defer cancel()                       // SIEMPRE llama a cancel para liberar recursos

// Plazo máximo
ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
defer cancel()

// Hora límite absoluta
ctx, cancel = context.WithDeadline(ctx, time.Now().Add(time.Minute))
```

Convenciones (importantes):

1. `ctx` es **siempre el primer parámetro** y se llama `ctx`: `func Hacer(ctx context.Context, ...)`.
2. **No guardes** un contexto dentro de una struct; pásalo por parámetro.
3. Quien crea el contexto con `WithCancel/WithTimeout` **debe** llamar a `cancel`.
4. `context.WithValue` solo para datos del ámbito de la petición (ID de petición, usuario), nunca para parámetros opcionales. Usa un tipo propio como clave.

Quien recibe un contexto debe **respetarlo**:

```go
func esperar(ctx context.Context) error {
	select {
	case <-time.After(5 * time.Second):
		return nil
	case <-ctx.Done():
		return ctx.Err() // context.Canceled o context.DeadlineExceeded
	}
}
```

Las bibliotecas serias ya lo hacen por ti: `pool.Query(ctx, ...)`, `http.NewRequestWithContext(ctx, ...)`. Un `WithTimeout` alrededor de una consulta evita que una base de datos lenta cuelgue tu servidor.

## 7. Patrones habituales

### Worker pool (distribuir trabajo entre N trabajadores)

```go
func Procesar(ctx context.Context, urls []string, n int) map[string]int {
	trabajos := make(chan string)
	resultados := make(chan resultado)

	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for url := range trabajos {
				resultados <- descargar(ctx, url)
			}
		}()
	}

	// Productor: envía el trabajo y cierra al terminar o cancelarse
	go func() {
		defer close(trabajos)
		for _, u := range urls {
			select {
			case trabajos <- u:
			case <-ctx.Done():
				return
			}
		}
	}()

	// Cierra "resultados" cuando todos los trabajadores terminaron
	go func() { wg.Wait(); close(resultados) }()

	salida := make(map[string]int, len(urls))
	for r := range resultados {
		salida[r.URL] = r.Estado
	}
	return salida
}

type resultado struct {
	URL    string
	Estado int
}

func descargar(ctx context.Context, url string) resultado {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return resultado{url, 0}
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return resultado{url, 0}
	}
	defer resp.Body.Close()
	return resultado{url, resp.StatusCode}
}
```

Fíjate en las tres tareas de cierre: el productor cierra `trabajos`; un coordinador cierra `resultados` tras `wg.Wait()`; el consumidor principal itera `resultados` hasta su cierre. Nada queda bloqueado.

### Limitar la concurrencia con un semáforo

```go
sem := make(chan struct{}, 5)  // máximo 5 a la vez
for _, u := range urls {
	sem <- struct{}{}          // adquirir
	go func() {
		defer func() { <-sem }() // liberar
		hacer(u)
	}()
}
```

### `errgroup`: concurrencia con errores y cancelación

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(5)
for _, u := range urls {
	g.Go(func() error { return comprobar(ctx, u) })
}
if err := g.Wait(); err != nil { // primer error; cancela ctx para el resto
	return err
}
```

## 8. Concurrencia en tu servidor

- Un handler puede lanzar goroutines, pero **si necesita el resultado antes de responder, debe esperarlas**.
- Trabajo que sobrevive a la petición (enviar correos, generar informes) **no debe usar `r.Context()`** (se cancela al terminar la petición) ni lanzarse sin control: en el Módulo 11 lo delegamos a una cola de tareas.
- Cierre ordenado: al recibir la señal de apagado, cancelas un contexto raíz y esperas (`WaitGroup`) a que tus goroutines terminen.

## Práctica

Escribe un worker pool que procese 100 URLs con 5 goroutines, soporte cancelación con `context.WithTimeout` y pase `go test -race` sin advertencias.

<details>
<summary>Ver solución</summary>

Usa `Procesar` de esta lección. Prueba con un servidor local:

```go
func TestProcesar(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(10 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	urls := make([]string, 100)
	for i := range urls {
		urls[i] = fmt.Sprintf("%s/?n=%d", srv.URL, i)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	res := Procesar(ctx, urls, 5)
	if len(res) != 100 {
		t.Fatalf("esperaba 100 resultados, obtuve %d", len(res))
	}
}
```

```bash
go test -race -count=1 ./...
```

Prueba también con `WithTimeout(…, 50*time.Millisecond)`: debe terminar antes y devolver menos resultados, **sin dejar goroutines colgadas** (ningún *deadlock*, ningún aviso del detector de carreras).
</details>

## Errores comunes

- Lanzar goroutines sin plan para que terminen (fugas).
- Cerrar un canal desde el receptor o cerrarlo dos veces.
- Escribir en un `map` desde varias goroutines sin protección.
- Copiar un `sync.Mutex` o `WaitGroup` (pasarlo por valor).
- Olvidar `defer cancel()` tras `WithTimeout`.
- Usar `time.Sleep` como mecanismo de sincronización.

## Resumen

- Concurrencia: tareas independientes; Go la ofrece con goroutines baratas.
- Los canales comunican y sincronizan; `select` espera a varios; el emisor cierra.
- Los accesos compartidos exigen mutex, atómicos o un único dueño; `go test -race` encuentra carreras.
- `context.Context` propaga cancelaciones y plazos: primer parámetro, siempre se respeta, siempre se cancela.

## Autoevaluación

1. ¿Qué diferencia hay entre concurrencia y paralelismo?
2. ¿Qué diferencia hay entre un canal con búfer y uno sin búfer?
3. ¿Quién debe cerrar un canal y por qué?
4. ¿Cómo detectas una condición de carrera?
5. ¿Qué ocurre con una goroutine bloqueada para siempre y cómo se evita?
6. ¿Por qué no debe usarse `r.Context()` para trabajo que sobrevive a la petición?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi worker pool pasa `go test -race`.
- [ ] Sé qué parte me costó más y la repasaré.

