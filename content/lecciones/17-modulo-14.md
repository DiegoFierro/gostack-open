---
title: "Módulo 14: Testing, Calidad de Software & Benchmarks"
description: "Pruebas que dan confianza para cambiar el código."
weight: 17
fase: "Fase 4: Rendimiento, observabilidad, escritorio y producción"
---

## Objetivos

- Escribir pruebas unitarias y de integración con el paquete `testing`.
- Probar handlers HTTP con `httptest` sin levantar un servidor real.
- Aplicar pruebas de tabla, subpruebas y dobles de prueba.
- Medir con benchmarks y descubrir fallos con fuzzing.
- Integrar calidad en el flujo de trabajo (cobertura, race detector, CI).

## 1. Por qué probar

Las pruebas automáticas son lo que te permite **cambiar código sin miedo**. Un buen conjunto de pruebas:

- Detecta regresiones al instante.
- Documenta el comportamiento esperado.
- Fomenta un diseño desacoplado (lo que ya hiciste con interfaces y repositorios).

Go incluye todo lo necesario en la biblioteca estándar: `testing`, `httptest`, `go test`. Sin frameworks.

### Convenciones

- Los archivos de prueba terminan en `_test.go` y se ubican junto al código.
- Las funciones se llaman `TestXxx(t *testing.T)`, `BenchmarkXxx(b *testing.B)`, `FuzzXxx(f *testing.F)`.
- Un archivo `foo_test.go` en `package foo` prueba por dentro (acceso a lo privado). En `package foo_test` prueba **como un consumidor externo** (recomendado para la API pública).

```bash
go test ./...               # todo el proyecto
go test -v -run TestCrear   # solo las que coincidan, con detalle
go test -race ./...         # con el detector de carreras
go test -count=1 ./...      # sin usar resultados cacheados
go test -cover ./...        # cobertura
```

## 2. Tu primera prueba

```go
package tarea_test

import (
	"context"
	"errors"
	"testing"

	"github.com/TU_USUARIO/tareas/internal/almacen/memoria"
	"github.com/TU_USUARIO/tareas/internal/tarea"
)

func TestServicio_Crear_TituloVacio(t *testing.T) {
	svc := tarea.NuevoServicio(memoria.Nuevo())

	_, err := svc.Crear(context.Background(), "   ")

	if !errors.Is(err, tarea.ErrTituloVacio) {
		t.Fatalf("Crear(vacío) error = %v; quería %v", err, tarea.ErrTituloVacio)
	}
}
```

Herramientas de `*testing.T`:

| Método | Efecto |
|--------|--------|
| `t.Errorf(...)` | Marca fallo y **continúa** |
| `t.Fatalf(...)` | Marca fallo y **detiene** esa prueba |
| `t.Helper()` | Oculta la función auxiliar de la traza del error |
| `t.Cleanup(f)` | Ejecuta `f` al terminar (cierres, borrados) |
| `t.TempDir()` | Directorio temporal que se elimina solo |
| `t.Setenv(k, v)` | Variable de entorno restaurada al terminar |
| `t.Skip(...)` | Omite la prueba (por ejemplo, sin base de datos) |
| `t.Parallel()` | Ejecuta en paralelo con otras |

Estilo recomendado de mensaje: **"qué hice, qué obtuve, qué quería"**.

## 3. Pruebas de tabla y subpruebas

Es el patrón estrella de Go: una tabla de casos y un bucle. Añadir un caso es añadir una fila.

```go
func TestFormTarea_Validar(t *testing.T) {
	casos := []struct {
		nombre  string
		titulo  string
		campoErr string // "" si no se esperan errores
	}{
		{"válido", "Estudiar Go", ""},
		{"con espacios laterales", "  hola  ", ""},
		{"vacío", "", "titulo"},
		{"solo espacios", "   \t ", "titulo"},
		{"demasiado largo", strings.Repeat("a", 121), "titulo"},
		{"121 runas multibyte", strings.Repeat("ñ", 121), "titulo"},
		{"120 runas multibyte", strings.Repeat("ñ", 120), ""},
	}

	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			f := FormTarea{Titulo: c.titulo}
			f.Validar()

			_, hayError := f.Errores["titulo"]
			if hayError != (c.campoErr != "") {
				t.Errorf("Validar(%q): errores = %v; esperaba error en %q", c.titulo, f.Errores, c.campoErr)
			}
		})
	}
}
```

Ventajas: cada caso es una **subprueba** con nombre (`go test -run 'TestFormTarea_Validar/vacío'`), los fallos se reportan por separado y se pueden paralelizar con `t.Parallel()`.

### Comparar valores complejos

La biblioteca estándar basta para casos simples (`reflect.DeepEqual`, `slices.Equal`, `maps.Equal`). Para diferencias legibles en estructuras grandes se usa `github.com/google/go-cmp/cmp`:

```go
if diff := cmp.Diff(esperado, obtenido); diff != "" {
	t.Errorf("(-esperado +obtenido):\n%s", diff)
}
```

### Archivos *golden*

Para salidas largas (HTML renderizado) guarda el resultado esperado en `testdata/` (carpeta ignorada por el compilador y por `go test`) y compáralo; con un indicador `-update` se regeneran.

## 4. Dobles de prueba (*fakes*, *stubs*, *mocks*)

Gracias a las interfaces pequeñas, sustituir dependencias es trivial. Para el repositorio ya tienes un *fake* real: `memoria.Repo`.

Cuando necesitas **forzar un error**, un *stub* a mano de pocas líneas basta, sin bibliotecas de mocks:

```go
type repoQueFalla struct{ tarea.Repositorio } // incrusta la interfaz: solo sobrescribes lo que usas

func (repoQueFalla) Listar(context.Context) ([]tarea.Tarea, error) {
	return nil, errors.New("conexión rota")
}

func TestServidor_Listar_ErrorInterno(t *testing.T) {
	srv := nuevoServidorDePrueba(t, tarea.NuevoServicio(repoQueFalla{}))
	// ... el handler debe responder 500 y NO mostrar "conexión rota" al usuario
}
```

Principios: prefiere **fakes funcionales** sobre mocks que verifican llamadas (las pruebas se acoplan a la implementación y se rompen al refactorizar); prueba **comportamiento observable**, no detalles internos.

## 5. Probar HTTP con `net/http/httptest`

`httptest` permite ejercitar handlers **sin red**.

### `httptest.NewRecorder`: probar un handler directamente

```go
func TestListar_OK(t *testing.T) {
	repo := memoria.Nuevo()
	repo.Crear(context.Background(), "Estudiar Go")
	srv := NuevoServidor(tarea.NuevoServicio(repo), vistasDePrueba(t))

	req := httptest.NewRequest(http.MethodGet, "/tareas", nil)
	rec := httptest.NewRecorder()

	srv.Rutas().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("estado = %d; quería %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Errorf("Content-Type = %q", got)
	}
	if !strings.Contains(rec.Body.String(), "Estudiar Go") {
		t.Errorf("el cuerpo no contiene la tarea:\n%s", rec.Body)
	}
}
```

### Formularios y cabeceras HTMX

```go
func TestCrear_HTMX_Valido(t *testing.T) {
	srv := nuevoServidorDePrueba(t, tarea.NuevoServicio(memoria.Nuevo()))

	form := url.Values{"titulo": {"Nueva"}}
	req := httptest.NewRequest(http.MethodPost, "/tareas", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("HX-Request", "true")
	rec := httptest.NewRecorder()

	srv.Rutas().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("estado = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `hx-swap-oob`) {
		t.Error("falta el fragmento OOB del contador")
	}
}

func TestCrear_TituloVacio_422(t *testing.T) {
	// ... mismo envío con titulo="" → esperar 422 y el mensaje de error en línea
}
```

### `httptest.NewServer`: servidor real efímero

Útil para probar clientes HTTP y flujos completos (cookies, redirecciones):

```go
ts := httptest.NewServer(srv.Rutas())
defer ts.Close()

jar, _ := cookiejar.New(nil)
cliente := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse // no seguir redirecciones: inspeccionarlas
}}

resp, err := cliente.PostForm(ts.URL+"/entrar", url.Values{"email": {"a@b.c"}, "password": {"secreto-largo"}})
// comprobar resp.StatusCode == 303 y que existe la cookie "sesion"
```

También sirve para **simular APIs externas** que consume tu código.

### Probar middlewares

Un middleware es una función: pásale un `Handler` falso y verifica el efecto.

```go
func TestExigirRol_Prohibido(t *testing.T) {
	siguiente := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	h := ExigirRol("admin")(siguiente)

	req := httptest.NewRequest("GET", "/admin", nil)
	req = req.WithContext(ConUsuario(req.Context(), Usuario{Rol: "usuario"}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("estado = %d; quería 403", rec.Code)
	}
}
```

## 6. Pruebas de integración con una base de datos real

Los *fakes* verifican la lógica, pero no que tu SQL funcione. Para el repositorio PostgreSQL necesitas una base de datos real. Opciones:

1. **Contenedor efímero** con [`testcontainers-go`](https://golang.testcontainers.org/) (levanta PostgreSQL por prueba, requiere Docker).
2. Una base de datos de pruebas aparte, apuntada por `TEST_DATABASE_URL`.

```go
func TestMain(m *testing.M) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		fmt.Println("omitiendo pruebas de integración: falta TEST_DATABASE_URL")
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func nuevoRepo(t *testing.T) *Repo {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(context.Background(), "TRUNCATE tareas RESTART IDENTITY"); err != nil {
		t.Fatal(err)
	}
	return Nuevo(pool)
}
```

Para separar pruebas lentas: `go test -short ./...` y `if testing.Short() { t.Skip("lenta") }`, o etiquetas de compilación (`//go:build integration`).

**Contrato compartido**: escribe una suite que reciba un `tarea.Repositorio` y la ejecutas contra **ambas** implementaciones (memoria y Postgres). Así el *fake* se mantiene fiel al real.

```go
func SuiteRepositorio(t *testing.T, nuevo func(t *testing.T) tarea.Repositorio) {
	t.Run("Obtener inexistente devuelve ErrNoEncontrada", func(t *testing.T) {
		_, err := nuevo(t).Obtener(context.Background(), 999)
		if !errors.Is(err, tarea.ErrNoEncontrada) {
			t.Errorf("err = %v", err)
		}
	})
	// ... más casos
}
```

## 7. Benchmarks

Miden **rendimiento** de una función. Se ejecutan con `-bench`.

```go
func BenchmarkTop(b *testing.B) {
	texto := strings.Repeat("go es simple go es rápido go ", 1000)
	b.ReportAllocs()
	for b.Loop() { // Go 1.24+; en versiones anteriores: for i := 0; i < b.N; i++
		Top(texto, 5)
	}
}
```

```bash
go test -bench=. -benchmem -run=^$ ./...
# BenchmarkTop-8   1500   780000 ns/op   200000 B/op   1200 allocs/op
```

(`-run=^$` evita ejecutar las pruebas normales a la vez.) Aspectos prácticos:

- Ejecuta con `-count=10` y compara versiones con **`benchstat`** (`go install golang.org/x/perf/cmd/benchstat@latest`), porque una sola medición es ruido.
- `b.ResetTimer()` descarta la preparación previa; `b.Run` crea sub-benchmarks (distintos tamaños de entrada).
- Evita que el compilador elimine el cálculo (guarda el resultado en una variable de paquete).
- Perfila el benchmark: `go test -bench=Top -cpuprofile cpu.out && go tool pprof cpu.out`.
- Mide en **máquina tranquila**; los resultados dependen del hardware.

## 8. Fuzz testing

El *fuzzing* genera automáticamente entradas **inesperadas** para encontrar *panics*, bucles infinitos y violaciones de propiedades. Ideal para parsers, validadores y decodificadores.

```go
func FuzzParsearPagina(f *testing.F) {
	// Corpus inicial: casos "semilla"
	for _, s := range []string{"1", "10", "-3", "abc", "", "99999999999999999999"} {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, entrada string) {
		p := ParsearPagina(entrada) // la función bajo prueba

		// Propiedades que SIEMPRE deben cumplirse, sea cual sea la entrada
		if p < 1 {
			t.Errorf("ParsearPagina(%q) = %d; debe ser ≥ 1", entrada, p)
		}
	})
}
```

```bash
go test -fuzz=FuzzParsearPagina -fuzztime=30s
```

Si encuentra un fallo, guarda la entrada culpable en `testdata/fuzz/FuzzParsearPagina/…` y desde entonces **`go test` normal la reproduce** como prueba de regresión. Versiona esa carpeta.

La clave es expresar **propiedades** (invariantes), por ejemplo "decodificar(codificar(x)) == x" o "nunca hace panic".

## 9. Calidad en el día a día

### Cobertura

```bash
go test -coverprofile=cover.out ./...
go tool cover -html=cover.out          # informe visual
go tool cover -func=cover.out | tail -1
```

La cobertura indica **qué código no se ejecutó**, no que esté bien probado. Persigue pruebas significativas, no un número (un 100 % sin aserciones no vale nada). Apunta a cubrir bien la lógica de dominio y las ramas de error.

### Lista de verificación antes de cada commit

```bash
gofmt -l .                  # nada listado
go vet ./...
golangci-lint run
go test -race -count=1 ./...
govulncheck ./...           # vulnerabilidades en dependencias
```

### Integración continua (GitHub Actions)

`.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_USER: tareas, POSTGRES_PASSWORD: tareas, POSTGRES_DB: tareas_test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U tareas" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgres://tareas:tareas@localhost:5432/tareas_test?sslmode=disable
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version-file: go.mod }
      - run: go vet ./...
      - uses: golangci/golangci-lint-action@v8
      - run: go test -race -cover ./...
```

### La pirámide de pruebas

```text
        /\        pocas: de extremo a extremo (navegador)
       /  \       algunas: de integración (BD real, HTTP completo)
      /____\      muchas: unitarias (rápidas, sin red ni BD)
```

## Práctica

Cubre con pruebas de tabla el validador de formularios, prueba un handler con `httptest.NewRecorder`, añade un benchmark y un fuzz test para el parser de entrada.

<details>
<summary>Ver solución</summary>

1. **Tabla**: `TestFormTarea_Validar` (sección 3) con al menos 7 casos, incluida la frontera de 120/121 runas.
2. **Handler**: `TestListar_OK`, `TestCrear_HTMX_Valido` y `TestCrear_TituloVacio_422` con `httptest.NewRecorder`; añade un caso de `404` para `GET /tareas/999`.
3. **Parser**:

```go
func ParsearPagina(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 1 {
		return 1
	}
	return n
}
```

4. **Fuzz**: `FuzzParsearPagina` (sección 8), ejecútalo 30 s. Prueba a introducir un fallo (por ejemplo, devolver `n` sin comprobar `n < 1`) y observa cómo el fuzzer lo encuentra y lo guarda en `testdata/fuzz/`.
5. **Benchmark**: `BenchmarkParsearPagina` y `BenchmarkRenderListado` con `-benchmem`.
6. **Calidad**: ejecuta `go test -race -cover ./...` y verifica que supera el 70 % en `internal/tarea` y `internal/web`.
7. Añade el workflow de CI y confirma que corre en verde en GitHub.
</details>

## Errores comunes

- Pruebas que dependen del orden, del reloj o de datos compartidos entre pruebas.
- `time.Sleep` para esperar goroutines (usa sincronización o canales).
- Mocks que verifican cada llamada interna (frágiles ante refactorizaciones).
- Ignorar `-race` hasta tener un servidor en producción.
- Perseguir el 100 % de cobertura en lugar de probar el comportamiento importante.
- Olvidar versionar `testdata/fuzz/`.

## Resumen

- `testing` + `go test` (con `-race`, `-cover`, `-bench`, `-fuzz`) cubren todo.
- Pruebas de tabla con subpruebas; *fakes* y *stubs* a mano gracias a las interfaces pequeñas.
- `httptest.NewRecorder` y `httptest.NewServer` prueban HTTP sin infraestructura.
- Integración con BD real para el SQL; una suite de contrato mantiene fiel al *fake*.
- Benchmarks miden; fuzzing explora lo inesperado; la CI lo automatiza.

## Autoevaluación

1. ¿Qué ventajas tiene una prueba de tabla con subpruebas?
2. ¿Cuándo usarías `NewRecorder` y cuándo `NewServer`?
3. ¿Por qué es preferible un *fake* funcional a un mock estricto?
4. ¿Qué diferencia hay entre un test y un fuzz test? ¿Qué es una "propiedad"?
5. ¿Qué significa una cobertura del 90 %? ¿Qué *no* te garantiza?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] `go test -race ./...` pasa en mi proyecto y la CI está en verde.
- [ ] Sé qué parte me costó más y la repasaré.

