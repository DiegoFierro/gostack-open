---
title: "Módulo 16: Interfaces Nativas & Multiplataforma con Fyne"
description: "Una sola base de código Go para escritorio y Android."
weight: 19
fase: "Fase 4: Rendimiento, observabilidad, escritorio y producción"
---

> Una sola base de código Go para escritorio y Android.

**Fase 4: Rendimiento, observabilidad, escritorio y producción** · Lección 19 de 20

## 🎯 Objetivos

- Construir interfaces gráficas con widgets, contenedores y layouts de Fyne.
- Reutilizar el dominio de Tareas en una aplicación gráfica nativa.
- Mantener la interfaz fluida sin bloquear el hilo de la UI.
- Generar un paquete `.apk` para Android.

## 1. Wails vs. Fyne

En el módulo anterior la interfaz era **web** (HTML/JS) dentro de una ventana. **Fyne** toma el camino opuesto: la interfaz se dibuja **íntegramente en Go**, sin WebView ni JavaScript.

| | Wails | Fyne |
|---|-------|------|
| Interfaz | HTML/CSS/JS | Widgets en Go |
| Lenguajes a dominar | Go + web | Solo Go |
| Plataformas | Windows, macOS, Linux | Windows, macOS, Linux, **Android, iOS**, web (WASM) |
| Apariencia | La que diseñes con CSS | Un tema coherente (Material-like) en todas partes |
| Mejor para | Equipos con experiencia web, interfaces muy personalizadas | Herramientas, utilidades y apps móviles simples con un solo lenguaje |

Fyne renderiza con OpenGL, lo que le da una apariencia idéntica en todas las plataformas y un mismo código para escritorio y móvil.

## 2. Instalación

Necesitas Go y un compilador de C (Fyne usa CGO para OpenGL y los sistemas de ventanas):

- **Windows**: MSYS2/MinGW-w64 (`gcc` en el PATH).
- **macOS**: Xcode Command Line Tools.
- **Linux**: `gcc` y las librerías de desarrollo gráficas (`libgl1-mesa-dev`, `xorg-dev` en Debian/Ubuntu).

```bash
mkdir tareas-fyne && cd tareas-fyne
go mod init github.com/TU_USUARIO/tareas-fyne
go get fyne.io/fyne/v2@latest
go install fyne.io/tools/cmd/fyne@latest     # herramienta de empaquetado
```

(Consulta [docs.fyne.io/started](https://docs.fyne.io/started/) por si los requisitos de tu sistema cambiaron.)

## 3. Hola, Fyne

```go
package main

import (
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/widget"
)

func main() {
	a := app.New()
	w := a.NewWindow("Hola")
	w.SetContent(widget.NewLabel("Hola, Fyne"))
	w.ShowAndRun()   // muestra la ventana y bloquea hasta que se cierra
}
```

```bash
go run .
```

Piezas básicas:

- **`fyne.App`**: la aplicación (una por proceso).
- **`fyne.Window`**: una ventana; contiene un único `CanvasObject` (normalmente un contenedor).
- **`CanvasObject`**: cualquier cosa dibujable: widgets, contenedores, imágenes, texto.
- **Tema**: colores y tamaños; claro/oscuro automático según el sistema.

## 4. Widgets y layouts

### Widgets habituales

```go
widget.NewLabel("Texto")
widget.NewButton("Pulsar", func() { /* acción */ })
widget.NewEntry()                         // campo de texto
widget.NewPasswordEntry()
widget.NewCheck("Hecha", func(b bool) {})
widget.NewSelect([]string{"Todas", "Pendientes"}, func(s string) {})
widget.NewProgressBar()
widget.NewList(longitud, crearItem, actualizarItem) // listas eficientes (virtualizadas)
widget.NewForm(widget.NewFormItem("Título", entry))
dialog.ShowConfirm("Eliminar", "¿Seguro?", func(ok bool) {}, ventana)
```

### Layouts y contenedores

Los **contenedores** organizan a sus hijos según un **layout**:

```go
import "fyne.io/fyne/v2/container"

container.NewVBox(a, b, c)                  // vertical, cada uno con su tamaño mínimo
container.NewHBox(a, b)                     // horizontal
container.NewBorder(arriba, abajo, izq, der, centro) // el centro ocupa el espacio sobrante
container.NewGridWithColumns(2, a, b, c, d)
container.NewAppTabs(container.NewTabItem("Tareas", x), container.NewTabItem("Ajustes", y))
container.NewVScroll(contenido)
```

El más útil para apps: **`Border`**, que pone una cabecera arriba, una barra abajo y deja que el contenido principal (una lista, por ejemplo) ocupe el resto.

## 5. La aplicación de tareas con Fyne

La clave de arquitectura es la misma de siempre: la interfaz es **un adaptador más** sobre `tarea.Servicio`. Este código supone que el dominio está en un paquete importable (`pkg/tarea`, o un módulo compartido).

```go
package main

import (
	"context"
	"fmt"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/widget"

	"github.com/TU_USUARIO/tareas/pkg/tarea"
	"github.com/TU_USUARIO/tareas/pkg/almacen/memoria"
)

type interfaz struct {
	svc    *tarea.Servicio
	ventana fyne.Window
	tareas []tarea.Tarea
	lista  *widget.List
}

func main() {
	a := app.NewWithID("com.ejemplo.tareas")   // el ID identifica la app (preferencias, Android)
	ui := &interfaz{
		svc:     tarea.NuevoServicio(memoria.Nuevo()),
		ventana: a.NewWindow("Tareas"),
	}
	ui.construir()
	ui.recargar()
	ui.ventana.Resize(fyne.NewSize(420, 600))
	ui.ventana.ShowAndRun()
}

func (u *interfaz) construir() {
	entrada := widget.NewEntry()
	entrada.SetPlaceHolder("Nueva tarea…")

	anadir := func() {
		if _, err := u.svc.Crear(context.Background(), entrada.Text); err != nil {
			dialog.ShowError(err, u.ventana)
			return
		}
		entrada.SetText("")
		u.recargar()
	}
	entrada.OnSubmitted = func(string) { anadir() }
	boton := widget.NewButton("Añadir", anadir)

	u.lista = widget.NewList(
		func() int { return len(u.tareas) },
		func() fyne.CanvasObject { // plantilla de cada fila (se reutiliza)
			return container.NewBorder(nil, nil,
				widget.NewCheck("", nil),
				widget.NewButton("🗑", nil),
				widget.NewLabel("título de ejemplo"),
			)
		},
		func(i widget.ListItemID, o fyne.CanvasObject) { // rellena una fila concreta
			t := u.tareas[i]
			fila := o.(*fyne.Container)
			etiqueta := fila.Objects[0].(*widget.Label)
			check := fila.Objects[1].(*widget.Check)
			borrar := fila.Objects[2].(*widget.Button)

			etiqueta.SetText(t.Titulo)
			check.OnChanged = nil            // evita disparar el callback al fijar el estado
			check.SetChecked(t.Hecha)
			check.OnChanged = func(bool) {
				u.svc.Alternar(context.Background(), t.ID)
				u.recargar()
			}
			borrar.OnTapped = func() {
				dialog.ShowConfirm("Eliminar", fmt.Sprintf("¿Eliminar «%s»?", t.Titulo),
					func(ok bool) {
						if ok {
							u.svc.Eliminar(context.Background(), t.ID)
							u.recargar()
						}
					}, u.ventana)
			}
		},
	)

	u.ventana.SetContent(container.NewBorder(
		container.NewBorder(nil, nil, nil, boton, entrada), // arriba: entrada + botón
		nil, nil, nil,
		u.lista, // el centro ocupa el resto
	))
}

func (u *interfaz) recargar() {
	ts, err := u.svc.Listar(context.Background())
	if err != nil {
		dialog.ShowError(err, u.ventana)
		return
	}
	u.tareas = ts
	u.lista.Refresh()
}
```

(Los `Objects` del contenedor `Border` se ordenan según el orden en que se pasaron los elementos no nulos: centro primero, luego izquierda y derecha. Si cambias el layout, revisa los índices.)

### Datos reactivos: *data binding*

Para que la interfaz se actualice sola al cambiar los datos, usa el paquete `fyne.io/fyne/v2/data/binding`:

```go
contador := binding.NewInt()
etiqueta := widget.NewLabelWithData(binding.IntToStringWithFormat(contador, "Pendientes: %d"))
contador.Set(5)           // la etiqueta se actualiza sola
```

## 6. Concurrencia y el hilo de la interfaz

La UI de Fyne se gestiona en un **hilo principal**. Una operación lenta en un callback (una petición de red, una consulta grande) **congela la ventana**. Lanza el trabajo en una goroutine y devuelve el resultado a la interfaz con seguridad:

```go
boton := widget.NewButton("Sincronizar", func() {
	aviso := widget.NewProgressBarInfinite()
	u.mostrar(aviso)

	go func() {
		err := sincronizar(context.Background())      // trabajo lento, fuera del hilo de UI
		fyne.Do(func() {                              // vuelve al hilo de UI para tocar widgets
			u.ocultar(aviso)
			if err != nil {
				dialog.ShowError(err, u.ventana)
			}
			u.recargar()
		})
	}()
})
```

`fyne.Do` (y `fyne.DoAndWait`) están disponibles en las versiones recientes de Fyne (2.6+); en versiones anteriores la mayoría de las operaciones de widgets eran seguras desde goroutines, pero el comportamiento actual exige usar `fyne.Do` para modificar la interfaz desde fuera del hilo principal. Revisa las notas de tu versión.

Aplican las reglas del Módulo 08: un `context` para cancelar, y nunca dos goroutines escribiendo el mismo estado sin protección.

## 7. Persistencia y preferencias

```go
// Preferencias simples (clave/valor) por aplicación
p := a.Preferences()
p.SetString("tema", "oscuro")
tema := p.StringWithFallback("tema", "claro")

// Archivos: en móviles no existe un "directorio de trabajo" convencional.
// Usa el almacenamiento propio de la app:
raiz := a.Storage().RootURI()    // ruta privada de la aplicación en cualquier plataforma
```

Para una base de datos local usa **SQLite sin CGO** (`modernc.org/sqlite`) guardada en `a.Storage().RootURI().Path()`; implementa `tarea.Repositorio` y el resto no cambia. Si los datos viven en el servidor, consume la API del Módulo 10 con un repositorio cliente.

## 8. Empaquetado

La herramienta `fyne` genera paquetes nativos con icono y metadatos:

```bash
# Escritorio (para el sistema en el que ejecutas el comando)
fyne package -os linux   -icon icono.png
fyne package -os windows -icon icono.png
fyne package -os darwin  -icon icono.png
```

Para ahorrar pasos repetidos, crea un archivo `FyneApp.toml`:

```toml
[Details]
  Icon = "icono.png"
  Name = "Tareas"
  ID = "com.ejemplo.tareas"
  Version = "1.0.0"
  Build = 1
```

### Android (`.apk`)

Requisitos: **Android SDK + NDK** instalados y la variable `ANDROID_NDK_HOME` apuntando al NDK (se instalan con Android Studio → SDK Manager → *NDK (Side by side)*).

```bash
export ANDROID_NDK_HOME=$HOME/Android/Sdk/ndk/<versión>
fyne package -os android -app-id com.ejemplo.tareas -icon icono.png
# genera Tareas.apk
```

Para probarlo en un dispositivo con la depuración USB activada:

```bash
fyne install -os android          # instala el .apk vía adb
adb logcat | grep -i fyne         # ver registros
```

Consejos para móvil:

- Usa **`app.NewWithID`** con un ID en formato de dominio inverso: obligatorio para Android.
- Diseña para **pantallas táctiles pequeñas**: áreas pulsables grandes, formularios sencillos, evitar menús anidados.
- Android pide **permisos** declarados (internet, almacenamiento) para ciertas funciones; Fyne ofrece una configuración en `FyneApp.toml`/manifiesto.
- Para publicar en Google Play necesitarás un **paquete firmado** (`.aab`/`.apk` con clave de firma propia); consulta la documentación de `fyne release`.

### Compilación cruzada con `fyne-cross`

Como Fyne usa CGO, compilar para otro sistema desde el tuyo exige un entorno específico. **`fyne-cross`** lo resuelve con contenedores Docker:

```bash
go install github.com/fyne-io/fyne-cross@latest
fyne-cross windows -arch=amd64
fyne-cross linux   -arch=amd64,arm64
fyne-cross android -app-id com.ejemplo.tareas
```

(macOS e iOS suelen requerir compilar en un Mac.)

## 9. ¿Cuándo elegir cada enfoque?

| Necesidad | Mejor opción |
|-----------|--------------|
| Servicio y panel web | HTMX + Go (Módulos 04–07) |
| Integración con otros sistemas | API OpenAPI (Módulo 10) |
| App de escritorio con UI web muy cuidada | Wails (Módulo 15) |
| Utilidad de escritorio o móvil, un solo lenguaje, `.apk` | Fyne |
| Distribución a gran escala en tiendas móviles con UX muy nativa | Quizá Kotlin/Swift; evalúa honestamente |

Lo esencial del curso: **un dominio, muchos adaptadores**.

## 🧪 Práctica

Implementa una lista de tareas con Fyne, ejecútala en escritorio y empaquétala con `fyne package -os android`.

<details>
<summary>Ver solución</summary>

1. Crea el módulo `tareas-fyne` y añade Fyne. Asegúrate de poder importar el dominio (`pkg/tarea`) — o copia el paquete `tarea` y el repositorio en memoria dentro de este módulo para la práctica.
2. Copia el código de la sección 5 y ejecútalo: `go run .`. Comprueba: añadir con Enter, marcar, borrar con confirmación.
3. Añade persistencia con `Preferences` (por ejemplo, guarda el filtro actual) o con SQLite local.
4. Mueve cualquier operación lenta a una goroutine con `fyne.Do`.
5. Crea `FyneApp.toml` y un `icono.png` de 512×512.
6. Instala el NDK, exporta `ANDROID_NDK_HOME` y ejecuta `fyne package -os android -app-id com.ejemplo.tareas`.
7. Instala el `.apk` en un teléfono o emulador (`adb install Tareas.apk`) y verifica que la lista funciona.
8. Compara con tu app Wails: ¿qué tamaño tiene cada una? ¿Qué te resultó más cómodo?
</details>

## ⚠️ Errores comunes

- Bloquear el hilo de UI con trabajo lento.
- Modificar widgets desde goroutines sin `fyne.Do`.
- Olvidar `list.Refresh()` tras cambiar los datos.
- Callbacks que se disparan al fijar valores por código (el caso de `Check.SetChecked`).
- Intentar compilar para Android sin NDK o con `ANDROID_NDK_HOME` mal configurada.
- Asumir rutas de archivos de escritorio en móviles.

## 📌 Resumen

- Fyne dibuja la interfaz en Go; mismo código para escritorio y Android.
- Widgets + contenedores/layouts; `Border` para pantallas de aplicación; `List` para colecciones.
- Trabajo pesado en goroutines y regreso al hilo de UI con `fyne.Do`.
- `fyne package` genera el paquete nativo; `-os android` produce el `.apk` (requiere SDK/NDK); `fyne-cross` automatiza la compilación cruzada.
- La interfaz es otro adaptador sobre el mismo `tarea.Servicio`.

## ✅ Autoevaluación

1. ¿Qué diferencia fundamental hay entre Fyne y Wails?
2. ¿Qué hace un contenedor `Border`?
3. ¿Qué ocurre si haces una petición de red lenta dentro del callback de un botón?
4. ¿Qué necesitas instalar para generar un `.apk`?
5. ¿Cómo reutilizas el dominio del curso en Fyne?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi lista de tareas funciona en escritorio y generé el `.apk`.
- [ ] Sé qué parte me costó más y la repasaré.

