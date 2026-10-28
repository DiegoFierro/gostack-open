---
title: "Módulo 02: Composición, Interfaces Implícitas & Manejo de Errores"
description: "Diseña sin herencia: structs, interfaces implícitas y errores como valores."
weight: 5
fase: "Fase -1 & 0: Fundamentos, terminal y mentalidad Go"
---

## Objetivos

- Modelar con structs y métodos en lugar de jerarquías de clases.
- Definir interfaces pequeñas y satisfacerlas implícitamente.
- Usar aserción de tipos con seguridad.
- Envolver, comparar y extraer errores con `fmt.Errorf`, `errors.Is` y `errors.As`.

## 1. Structs y métodos

Go no tiene clases. Tiene **tipos** con **métodos** asociados.

```go
type Tarea struct {
	ID     int
	Titulo string
	Hecha  bool
}

// Método con receptor de valor: trabaja sobre una copia.
func (t Tarea) Resumen() string {
	estado := " "
	if t.Hecha {
		estado = "x"
	}
	return fmt.Sprintf("[%s] %s", estado, t.Titulo)
}

// Método con receptor de puntero: puede modificar el original.
func (t *Tarea) Completar() { t.Hecha = true }
```

Reglas prácticas para elegir receptor:

- Si el método **modifica** el receptor → puntero.
- Si la struct es **grande** o contiene un `sync.Mutex` → puntero.
- **No mezcles** receptores de valor y puntero en un mismo tipo.
- Un constructor es solo una función por convención: `func NuevaTarea(titulo string) *Tarea`.

Cualquier tipo definido por ti puede tener métodos, no solo structs:

```go
type Prioridad int

const (
	Baja Prioridad = iota // 0
	Media                 // 1
	Alta                  // 2
)

func (p Prioridad) String() string {
	return [...]string{"baja", "media", "alta"}[p]
}
```

(`String()` implementa la interfaz `fmt.Stringer`: `fmt.Println(Alta)` imprime `alta`.)

## 2. Composición en lugar de herencia

Para reutilizar comportamiento, **incrusta** (*embed*) un tipo dentro de otro:

```go
type Auditoria struct {
	CreadoEn time.Time
	CreadoPor string
}

func (a Auditoria) Descripcion() string {
	return a.CreadoPor + " el " + a.CreadoEn.Format("2006-01-02")
}

type Proyecto struct {
	Auditoria        // incrustado: sus campos y métodos se "promueven"
	Nombre string
}

p := Proyecto{Nombre: "Tareas", Auditoria: Auditoria{CreadoPor: "ana"}}
fmt.Println(p.CreadoPor)       // acceso directo
fmt.Println(p.Descripcion())   // método promovido
```

Esto **no** es herencia: `Proyecto` no "es un" `Auditoria`, simplemente *tiene* uno y expone sus miembros. No hay polimorfismo por jerarquía, no hay `super`. Eso hace el código más fácil de seguir.

## 3. Interfaces implícitas

Una **interfaz** define un conjunto de métodos. Un tipo la satisface **automáticamente** si los implementa; no existe `implements`.

```go
type Notificador interface {
	Notificar(mensaje string) error
}

type Email struct{ Direccion string }

func (e Email) Notificar(m string) error {
	fmt.Printf("Enviando a %s: %s\n", e.Direccion, m)
	return nil
}

type Consola struct{}

func (Consola) Notificar(m string) error {
	fmt.Println("LOG:", m)
	return nil
}

// Esta función no sabe nada de Email ni Consola.
func Avisar(n Notificador, texto string) error {
	return n.Notificar(texto)
}
```

Se le llama a veces *duck typing estático*: "si camina como pato…", pero verificado en **compilación**. Consecuencias valiosas:

- **Las interfaces las define quien las consume**, no quien implementa. Puedes crear una interfaz para un tipo de una biblioteca ajena sin modificarla.
- **Interfaces pequeñas** (1–3 métodos) son las mejores. Ejemplos de la biblioteca estándar: `io.Reader` (`Read`), `io.Writer` (`Write`), `error` (`Error() string`), `fmt.Stringer`, `http.Handler` (`ServeHTTP`).
- *"Acepta interfaces, devuelve structs."*
- Facilitan las pruebas: sustituyes una base de datos real por un doble en memoria (Módulo 03).

Para comprobar en compilación que un tipo cumple una interfaz:

```go
var _ Notificador = Email{} // no compila si Email deja de implementarla
```

La interfaz vacía `any` (`interface{}`) acepta cualquier valor; úsala con moderación porque pierdes el sistema de tipos.

### Aserción de tipos y *type switch*

```go
var v any = "hola"

s, ok := v.(string)  // forma segura
if ok { fmt.Println(len(s)) }

n := v.(int)         // sin "ok": hace panic si no es int

switch x := v.(type) {
case string: fmt.Println("texto", x)
case int:    fmt.Println("entero", x)
case nil:    fmt.Println("nada")
default:     fmt.Printf("otro: %T\n", x)
}
```

También puedes preguntar si un valor tiene *además* otro comportamiento: `if c, ok := w.(io.Closer); ok { c.Close() }`.

**Trampa conocida:** una interfaz es `nil` solo si tanto su tipo como su valor son `nil`. Devolver un puntero nil concreto dentro de una interfaz `error` produce un `error != nil`. Devuelve siempre `nil` literal cuando no hay error.

## 4. Errores como valores

`error` es una interfaz mínima:

```go
type error interface { Error() string }
```

El patrón idiomático:

```go
func Buscar(id int) (*Tarea, error) {
	// ...
	return nil, ErrNoEncontrada
}

t, err := Buscar(7)
if err != nil {
	return fmt.Errorf("cargando tarea: %w", err) // añade contexto y conserva el original
}
```

Sin excepciones, sin `try/catch`: el flujo de errores es **visible** en el código. Sí es verbosa, pero nunca dudas qué puede fallar.

### Errores centinela

```go
var ErrNoEncontrada = errors.New("tarea no encontrada")
```

### Errores como tipos

Cuando el error necesita datos adicionales:

```go
type ErrValidacion struct {
	Campo   string
	Mensaje string
}

func (e *ErrValidacion) Error() string {
	return e.Campo + ": " + e.Mensaje
}
```

### Envolver, comparar y extraer

`%w` en `fmt.Errorf` crea una **cadena de errores**:

```go
func cargar(id int) error {
	if err := buscarEnBD(id); err != nil {
		return fmt.Errorf("cargar(%d): %w", id, err)
	}
	return nil
}

err := cargar(7)

// ¿Algún error de la cadena ES este valor?
if errors.Is(err, ErrNoEncontrada) {
	// responder 404
}

// ¿Algún error de la cadena ES de este tipo? Si sí, lo extrae.
var ev *ErrValidacion
if errors.As(err, &ev) {
	fmt.Println("campo inválido:", ev.Campo)
}
```

Nunca compares con `==` errores que pueden venir envueltos; usa `errors.Is`. Si necesitas combinar varios errores, `errors.Join(err1, err2)` los agrupa y `errors.Is/As` sigue funcionando.

### Buenas prácticas

1. **Maneja el error una sola vez**: o lo registras o lo devuelves, no ambas cosas.
2. **Añade contexto** al propagarlo, en minúscula y sin puntuación final (`"abriendo config: %w"`).
3. No uses `panic` para el flujo normal. `panic` es para errores de programación irrecuperables; en un servidor, un middleware de recuperación lo captura (Módulo 04).
4. Define errores de dominio (`ErrNoEncontrada`) en el paquete del dominio y traduce a HTTP en el borde: `ErrNoEncontrada → 404`.

## Práctica

Define una interfaz `Notificador` con dos implementaciones (email y consola). Crea un error centinela `ErrNoEncontrado`, envuélvelo con `%w` y compruébalo con `errors.Is` en el llamador. Añade un error tipado `ErrValidacion` y recupéralo con `errors.As`.

<details>
<summary>Ver solución</summary>

```go
package main

import (
	"errors"
	"fmt"
)

var ErrNoEncontrado = errors.New("no encontrado")

type ErrValidacion struct{ Campo string }

func (e *ErrValidacion) Error() string { return "campo inválido: " + e.Campo }

type Notificador interface{ Notificar(string) error }

type Email struct{ Para string }

func (e Email) Notificar(m string) error {
	if e.Para == "" {
		return &ErrValidacion{Campo: "para"}
	}
	fmt.Printf("email a %s: %s\n", e.Para, m)
	return nil
}

type Consola struct{}

func (Consola) Notificar(m string) error { fmt.Println("consola:", m); return nil }

func buscar(id int) error {
	if id != 1 {
		return fmt.Errorf("buscar(%d): %w", id, ErrNoEncontrado)
	}
	return nil
}

func main() {
	for _, n := range []Notificador{Email{Para: "a@b.c"}, Consola{}, Email{}} {
		if err := n.Notificar("hola"); err != nil {
			var ev *ErrValidacion
			if errors.As(err, &ev) {
				fmt.Println("validación falló en:", ev.Campo)
			}
		}
	}

	err := buscar(5)
	fmt.Println(err)                                // buscar(5): no encontrado
	fmt.Println(errors.Is(err, ErrNoEncontrado))    // true
}
```
</details>

## Errores comunes

- Mezclar receptores de valor y puntero en el mismo tipo.
- Comparar errores con `==` después de envolverlos.
- Registrar y además devolver el mismo error (duplica los logs).
- Declarar interfaces enormes "por si acaso".
- Devolver un puntero nil tipado como `error`.

## Resumen

- Tipos + métodos reemplazan a las clases; la composición reemplaza a la herencia.
- Las interfaces se satisfacen implícitamente y conviene que sean pequeñas y definidas por el consumidor.
- Los errores son valores: se devuelven, se envuelven con `%w` y se inspeccionan con `errors.Is` / `errors.As`.

## Autoevaluación

1. ¿Qué diferencia hay entre promover métodos por *embedding* y heredar?
2. ¿Por qué se dice que las interfaces de Go son implícitas?
3. ¿Qué ocurre con `v.(int)` si `v` contiene un `string`? ¿Cómo lo evitas?
4. ¿Cuándo usarías `errors.Is` y cuándo `errors.As`?
5. ¿Por qué conviene que el consumidor defina la interfaz?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi práctica pasa `go vet` y `golangci-lint`.
- [ ] Sé qué parte me costó más y la repasaré.

