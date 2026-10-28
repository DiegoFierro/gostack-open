---
title: "Módulo 01: Fundamentos del Lenguaje, Punteros & Memoria"
description: "Sintaxis esencial, slices, mapas y punteros con una idea clara de cómo se usa la memoria."
weight: 4
fase: "Fase -1 & 0: Fundamentos, terminal y mentalidad Go"
---

## Objetivos

- Escribir programas con control de flujo y funciones con retornos múltiples.
- Explicar la diferencia entre array y slice (backing array, `len`, `cap`).
- Usar mapas correctamente.
- Decidir cuándo usar punteros para eficiencia o mutabilidad.

## 1. Variables, tipos y constantes

```go
package main

import "fmt"

const Version = "1.0" // constante

func main() {
	var nombre string = "Ana" // declaración completa
	var edad int              // valor cero: 0
	ciudad := "Quito"         // := declara e infiere (solo dentro de funciones)
	altura, activo := 1.68, true

	fmt.Println(nombre, edad, ciudad, altura, activo, Version)
}
```

Tipos básicos: `bool`, `string`, `int` (y `int8…int64`, `uint…`), `float64`, `byte` (= `uint8`), `rune` (= `int32`, un carácter Unicode).

**Valor cero**: toda variable declarada sin valor inicial recibe uno útil: `0`, `""`, `false`, `nil`. Esto elimina toda una clase de errores de "variable sin inicializar".

Go **no convierte tipos implícitamente**:

```go
var a int = 3
var b float64 = float64(a) * 1.5 // conversión explícita
```

## 2. Control de flujo

```go
// if con sentencia de inicialización
if n := len(nombre); n > 3 {
	fmt.Println("largo")
} else if n == 0 {
	fmt.Println("vacío")
}

// for: el único bucle
for i := 0; i < 3; i++ { fmt.Println(i) } // clásico
for cond() { /* como un while */ }
for { break }                              // infinito

// range sobre colecciones
for i, v := range []string{"a", "b"} { fmt.Println(i, v) }
for i := range 3 { fmt.Println(i) }        // Go 1.22+: 0,1,2

// switch: sin break, sin "caída" por defecto
switch dia := "sab"; dia {
case "sab", "dom":
	fmt.Println("fin de semana")
default:
	fmt.Println("laboral")
}

// switch sin expresión = cadena de if
switch {
case edad < 18: fmt.Println("menor")
default: fmt.Println("adulto")
}
```

`defer` pospone una llamada hasta que la función termina; ideal para liberar recursos:

```go
f, err := os.Open("datos.txt")
if err != nil { return err }
defer f.Close() // se ejecuta al salir de la función, pase lo que pase
```

## 3. Funciones y retornos múltiples

```go
func dividir(a, b float64) (float64, error) {
	if b == 0 {
		return 0, errors.New("división por cero")
	}
	return a / b, nil
}

func main() {
	r, err := dividir(10, 2)
	if err != nil {
		fmt.Println("error:", err)
		return
	}
	fmt.Println(r)
}
```

Los retornos múltiples son la base del manejo de errores en Go (`valor, err`). Otras características: parámetros variádicos (`func suma(n ...int)`), funciones como valores y closures:

```go
func contador() func() int {
	c := 0
	return func() int { c++; return c }
}
```

## 4. Arrays y slices

Un **array** tiene tamaño fijo que forma parte de su tipo: `[3]int` y `[4]int` son tipos distintos. Se usan poco directamente.

Un **slice** (`[]T`) es una *ventana* sobre un array subyacente. Internamente es una estructura de tres campos:

```text
slice = { puntero al array, len, cap }
```

- `len`: cuántos elementos ve el slice.
- `cap`: cuántos caben desde su inicio hasta el final del array subyacente (*backing array*).

```go
s := []int{1, 2, 3}          // literal
t := make([]int, 0, 10)      // len 0, cap 10: reserva espacio de antemano
t = append(t, 4, 5)          // añadir devuelve el slice resultante: SIEMPRE reasigna
fmt.Println(len(t), cap(t))  // 2 10
```

`append` reutiliza el array si hay capacidad; si no, **asigna uno nuevo más grande** y copia. De ahí una sorpresa clásica:

```go
a := []int{1, 2, 3, 4}
b := a[:2]       // comparte el backing array con a
b[0] = 99
fmt.Println(a)   // [99 2 3 4]  ← a cambió

b = append(b, 100)  // b tenía cap 4: sobrescribe a[2]
fmt.Println(a)   // [99 2 100 4]
```

Cuando necesites independencia, copia:

```go
c := make([]int, len(a))
copy(c, a)               // o: c := slices.Clone(a)
```

Los paquetes `slices` y `maps` (biblioteca estándar) ofrecen `slices.Sort`, `slices.Contains`, `slices.Index`, `maps.Keys`, etc.

Un slice sin inicializar es `nil` y **funciona** con `len`, `range` y `append`.

## 5. Mapas

```go
edades := map[string]int{"ana": 30, "luis": 25}
edades["marta"] = 41             // insertar / actualizar
delete(edades, "luis")           // borrar (no falla si no existe)

if e, ok := edades["ana"]; ok {  // "comma ok": distingue ausente de cero
	fmt.Println("ana tiene", e)
}

for nombre, edad := range edades { /* orden NO garantizado */ }
```

Reglas importantes:

- Un mapa `nil` se puede leer pero **escribir en él provoca *panic***. Inicialízalo con `make(map[K]V)` o un literal.
- El orden de iteración es aleatorio a propósito. Si lo necesitas, ordena las claves (`slices.Sorted(maps.Keys(m))`).
- Los mapas **no son seguros para acceso concurrente** (lo verás en el Módulo 08).
- La clave debe ser comparable (`string`, números, structs de campos comparables…; no slices).

## 6. Punteros

Un puntero guarda la **dirección de memoria** de un valor. `&x` obtiene la dirección; `*p` accede al valor.

```go
x := 10
p := &x
*p = 20
fmt.Println(x) // 20
```

Go pasa **todo por valor**: cada argumento se copia. Para modificar el original o evitar copiar una struct grande, pasas un puntero:

```go
type Tarea struct {
	Titulo string
	Hecha  bool
}

func completarValor(t Tarea)     { t.Hecha = true } // modifica una COPIA
func completarPuntero(t *Tarea)  { t.Hecha = true } // modifica el original

func main() {
	t := Tarea{Titulo: "Estudiar"}
	completarValor(t)
	fmt.Println(t.Hecha) // false
	completarPuntero(&t)
	fmt.Println(t.Hecha) // true
}
```

Aspectos prácticos:

- Con punteros a struct, Go desreferencia automáticamente: `t.Hecha` en lugar de `(*t).Hecha`.
- `new(T)` o `&T{}` crean un valor y devuelven su puntero.
- Un puntero sin inicializar es `nil`; desreferenciarlo provoca *panic*.
- **No hay aritmética de punteros** (a diferencia de C).
- Los slices, mapas y canales ya contienen internamente referencias: pasarlos por valor copia solo la "cabecera", no los datos.
- Go decide con **análisis de escape** si un valor vive en la pila (*stack*, barata) o en el montón (*heap*, gestionado por el recolector de basura). No necesitas liberar memoria manualmente.

**¿Cuándo usar puntero?** (1) Cuando la función debe mutar el valor. (2) Cuando la struct es grande y copiarla costaría. (3) Para representar "ausencia" (`*string` puede ser `nil`). En caso de duda, empieza por valores: son más simples y seguros.

## Práctica

Implementa un contador de palabras que lea un texto, use un `map[string]int` y devuelva las 5 palabras más frecuentes. Después, escribe una función que modifique un slice y otra que reciba un puntero, y explica la diferencia.

<details>
<summary>Ver solución</summary>

```go
package main

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
)

type Frecuencia struct {
	Palabra string
	Veces   int
}

func Top(texto string, n int) []Frecuencia {
	cuenta := make(map[string]int)
	palabras := strings.FieldsFunc(strings.ToLower(texto), func(r rune) bool {
		return !unicode.IsLetter(r)
	})
	for _, p := range palabras {
		cuenta[p]++
	}

	res := make([]Frecuencia, 0, len(cuenta))
	for p, v := range cuenta {
		res = append(res, Frecuencia{p, v})
	}
	slices.SortFunc(res, func(a, b Frecuencia) int {
		if a.Veces != b.Veces {
			return b.Veces - a.Veces // más frecuentes primero
		}
		return strings.Compare(a.Palabra, b.Palabra) // desempate estable
	})
	if len(res) > n {
		res = res[:n]
	}
	return res
}

// Los elementos de un slice SÍ se modifican (comparte el backing array)...
func duplicar(s []int) {
	for i := range s {
		s[i] *= 2
	}
}

// ...pero para cambiar el slice en sí (len/cap) hace falta un puntero.
func agregar(s *[]int, v int) { *s = append(*s, v) }

func main() {
	fmt.Println(Top("a b a c b a d e a b", 3))

	n := []int{1, 2, 3}
	duplicar(n)
	agregar(&n, 7)
	fmt.Println(n) // [2 4 6 7]
}
```

Explicación: `duplicar` cambia elementos que ambos slices comparten; pero un `append` dentro de una función que recibe el slice por valor no se vería fuera, por eso `agregar` recibe `*[]int`.
</details>

## Errores comunes

- Olvidar reasignar el resultado de `append` (`s = append(s, x)`).
- Escribir en un mapa `nil`.
- Suponer un orden de iteración en mapas.
- Modificar una copia pensando que cambias el original (paso por valor).
- Guardar un sub-slice que retiene en memoria un array enorme.

## Resumen

- `:=` declara; el valor cero evita variables sin inicializar.
- `for` es el único bucle; `switch` no necesita `break`; `defer` limpia recursos.
- Un slice = puntero + `len` + `cap` sobre un array; `append` puede reasignar.
- Los mapas requieren inicialización y el patrón *comma ok*.
- Todo se pasa por valor; un puntero permite mutar y evitar copias.

## Autoevaluación

1. ¿Qué imprime `len` y `cap` de `make([]int, 2, 5)`?
2. ¿Por qué `append(s, x)` sin asignar el resultado es un error?
3. ¿Qué pasa al escribir en un `map` nil?
4. ¿Cuándo preferirías un puntero a una struct frente a un valor?
5. ¿Qué diferencia hay entre array y slice?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi contador de palabras funciona y está en Git.
- [ ] Sé qué parte me costó más y la repasaré.

