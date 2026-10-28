---
title: "Módulo 00: Entorno de Desarrollo, Toolchain & Mentalidad Go"
description: "Deja listo tu entorno y adopta la forma de pensar de Go: explícita y simple."
weight: 3
fase: "Fase -1 & 0: Fundamentos, terminal y mentalidad Go"
---

## Objetivos

- Instalar y verificar el toolchain oficial de Go.
- Crear un módulo y gestionar dependencias.
- Aplicar `gofmt` y `golangci-lint` de forma habitual.
- Entender la filosofía de Go: explícito antes que mágico.

## 1. Instalar Go

Descarga el instalador oficial desde [go.dev/dl](https://go.dev/dl/) (Windows, macOS, Linux) y sigue sus instrucciones. En Linux/WSL, la instalación manual consiste en descomprimir el archivo en `/usr/local` y añadir `/usr/local/go/bin` al `PATH`.

```bash
go version          # go version go1.2x.x linux/amd64
go env GOPATH GOROOT GOFLAGS
```

Si `go version` responde, ya tienes el **toolchain**: compilador, formateador, gestor de módulos, ejecutor de pruebas y más, todo en un solo comando `go`.

Desde Go 1.21 el comando `go` puede **descargar automáticamente la versión del toolchain** que pida tu proyecto (línea `toolchain` en `go.mod`), de modo que todos los colaboradores compilen con la misma versión.

> Añade `$(go env GOPATH)/bin` a tu `PATH`: ahí se instalan las herramientas que descargues con `go install`.

## 2. Tu primer programa

```bash
mkdir -p ~/proyectos/hola && cd ~/proyectos/hola
go mod init ejemplo.com/hola
```

Crea `main.go`:

```go
package main

import "fmt"

func main() {
	fmt.Println("Hola, GoStack")
}
```

```bash
go run .            # compila y ejecuta
go build -o hola .  # genera un binario ./hola
./hola
```

Observa: `package main` + función `main` = programa ejecutable. El binario resultante es **autocontenido**: puedes copiarlo a otro equipo del mismo sistema operativo y ejecutarlo sin instalar nada. Esa característica será clave en el Módulo 17.

## 3. Go Modules

Un **módulo** es una colección de paquetes versionados juntos. Su definición vive en `go.mod`:

```go
module ejemplo.com/hola

go 1.24

require github.com/google/uuid v1.6.0
```

- `module`: nombre/ruta del módulo (se usa para importarlo). Para un proyecto publicado suele ser la URL del repositorio: `github.com/TU_USUARIO/tareas`.
- `go`: versión mínima del lenguaje.
- `require`: dependencias y sus versiones exactas.
- `go.sum`: sumas de verificación (hashes) de cada dependencia. **Se versiona en Git**; garantiza que nadie altere una dependencia.

Comandos del día a día:

```bash
go get github.com/google/uuid@latest   # añade o actualiza una dependencia
go mod tidy                            # añade lo que falta y quita lo que sobra
go list -m all                         # lista todas las dependencias
go mod verify                          # comprueba la integridad
go get -u ./...                        # actualiza dependencias directas
```

Uso:

```go
package main

import (
	"fmt"

	"github.com/google/uuid"
)

func main() {
	fmt.Println(uuid.NewString())
}
```

Convenciones: un directorio = un paquete; los identificadores que empiezan con **mayúscula** son públicos (exportados), los de minúscula son privados al paquete. No hay `public`/`private`.

## 4. Formateo y análisis estático

### `gofmt` / `go fmt`

Go tiene **un único estilo oficial**. No hay debates de tabs vs. espacios: el formateador decide.

```bash
gofmt -l .        # lista archivos mal formateados
gofmt -w .        # los reescribe
go fmt ./...      # equivalente
```

Configura tu editor para formatear al guardar (VS Code con la extensión oficial de Go lo hace con `gopls`).

### `go vet`

Viene incluido; detecta errores sospechosos (formatos de `Printf` incorrectos, copias de mutex, etc.):

```bash
go vet ./...
```

### `golangci-lint`

Agrupa decenas de analizadores en una sola herramienta. Instálala siguiendo [golangci-lint.run/welcome/install](https://golangci-lint.run/welcome/install/) y crea en la raíz el archivo `.golangci.yml` (formato de la versión 2):

```yaml
version: "2"
linters:
  enable:
    - errorlint     # buen uso de errors.Is / errors.As
    - gocritic
    - revive
    - bodyclose
formatters:
  enable:
    - gofmt
```

```bash
golangci-lint run          # analiza el proyecto
golangci-lint fmt          # aplica los formateadores
```

> Hazlo parte del ritmo: `go fmt`, `go vet`, `golangci-lint run`, `go test ./...` antes de cada commit.

## 5. Mentalidad Go: lo explícito frente a la magia

Go se diseñó para equipos grandes y bases de código longevas. Sus decisiones se repiten:

| Principio | En la práctica |
|-----------|----------------|
| **Simplicidad** | Pocas palabras clave (25), un solo bucle (`for`), sin herencia ni sobrecarga de operadores. |
| **Explícito** | Los errores son valores que **tú** manejas; no hay excepciones ocultas. Las conversiones de tipo son manuales. |
| **Composición** | Se combinan piezas pequeñas (structs, interfaces mínimas) en vez de jerarquías. |
| **Biblioteca estándar potente** | `net/http`, `encoding/json`, `html/template`, `testing`... ya vienen incluidos. |
| **Herramientas integradas** | Formato, pruebas, benchmarks, perfilado, documentación. |
| **Legibilidad > ingenio** | El código se lee más veces de las que se escribe. "Un poco de copia es mejor que una pequeña dependencia." |

Si vienes de otros lenguajes, notarás que Go pide *escribir más líneas*, pero cada una dice exactamente lo que hace. Ese es el trato.

## Práctica

Crea un módulo con `go mod init`, escribe un `main.go` con un "Hola, GoStack", formatéalo con `gofmt`, ejecútalo con `go run` y pásale `golangci-lint run`. Después instala una dependencia (`github.com/google/uuid`) y usa `uuid.NewString()`.

<details>
<summary>Ver solución</summary>

```bash
mkdir hola && cd hola
go mod init github.com/TU_USUARIO/hola
cat > main.go <<'EOF'
package main

import (
        "fmt"

        "github.com/google/uuid"
)

func main() {
        fmt.Println("Hola, GoStack", uuid.NewString())
}
EOF
go mod tidy          # descarga uuid y actualiza go.mod / go.sum
gofmt -w .           # convierte los espacios en tabuladores
go vet ./...
golangci-lint run
go run .
```

Comprueba que `go.mod` lista `github.com/google/uuid` y que existe `go.sum`.
</details>

## Errores comunes

- `go: cannot find main module`: te falta `go mod init` o estás fuera de la carpeta del proyecto.
- Importar una dependencia sin ejecutar `go mod tidy`.
- Versionar el binario compilado en Git (añádelo a `.gitignore`).
- Ignorar las advertencias del linter "para después".

## Resumen

- `go` es un único comando que compila, ejecuta, prueba y gestiona módulos.
- `go.mod` declara dependencias; `go.sum` las verifica.
- `gofmt`, `go vet` y `golangci-lint` mantienen el código consistente.
- Go prefiere lo explícito y simple por encima de lo "mágico".

## Autoevaluación

1. ¿Qué diferencia hay entre `go run` y `go build`?
2. ¿Para qué sirve `go.sum` y por qué se versiona?
3. ¿Qué convierte a un identificador en público?
4. ¿Qué hace `go mod tidy`?
5. Menciona tres decisiones de diseño que muestren el enfoque "explícito" de Go.

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] `go version` y `golangci-lint --version` funcionan en mi equipo.
- [ ] Sé qué parte me costó más y la repasaré.

