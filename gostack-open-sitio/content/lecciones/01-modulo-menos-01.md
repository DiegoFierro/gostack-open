---
title: "Módulo -01: Fundamentos de la Terminal & Entorno CLI"
description: "Pierde el miedo a la terminal: navegar, editar archivos y versionar con Git y GitHub."
weight: 1
fase: "Fase -1 & 0: Fundamentos, terminal y mentalidad Go"
---

## Objetivos

- Explicar qué es una interfaz de comandos y cómo habla con el sistema operativo.
- Moverte por el sistema de archivos y gestionar archivos sin usar el ratón.
- Entender permisos y variables de entorno.
- Crear un repositorio Git, hacer commits y subirlos a GitHub.

## 1. ¿Qué es la terminal?

Una **interfaz de línea de comandos (CLI)** es una forma de darle órdenes al computador escribiéndolas. Tres piezas se confunden a menudo:

| Pieza | Qué es | Ejemplos |
|-------|--------|----------|
| **Terminal** | La ventana donde escribes | Terminal de macOS, Windows Terminal, GNOME Terminal |
| **Shell** | El programa que interpreta lo que escribes | `bash`, `zsh`, `PowerShell` |
| **Comando** | Un programa que el shell ejecuta | `ls`, `git`, `go` |

Cuando escribes `ls` y pulsas Enter, el shell busca un programa llamado `ls` en los directorios listados en la variable `PATH`, lo ejecuta, y le pide al sistema operativo que lo cargue en memoria. El programa escribe su resultado en la **salida estándar** (`stdout`) y la terminal lo muestra.

> **Si usas Windows:** instala **WSL 2** (`wsl --install` en PowerShell como administrador). Obtendrás un Linux real dentro de Windows y todos los comandos del curso funcionarán igual. Los comandos de este curso asumen un shell tipo Unix (bash/zsh).

## 2. Navegar por el sistema de archivos

El sistema de archivos es un árbol. La raíz es `/`; tu carpeta personal es `~` (por ejemplo `/home/ana` o `/Users/ana`).

```bash
pwd                 # dónde estoy (print working directory)
ls                  # lista el contenido
ls -la              # lista detallada, incluye archivos ocultos (los que empiezan por .)
cd Documentos       # entra en una carpeta
cd ..               # sube un nivel
cd ~                # vuelve a casa
cd -                # vuelve a la carpeta anterior
```

Una **ruta absoluta** empieza en `/` (`/home/ana/proyectos`). Una **ruta relativa** parte de donde estás (`proyectos/tareas`). `.` es "esta carpeta" y `..` es "la carpeta padre".

Trucos que te ahorrarán horas:

- **Tab** autocompleta nombres. Pulsa Tab dos veces para ver opciones.
- **Flecha arriba** recupera comandos anteriores; `Ctrl+R` busca en el historial.
- **Ctrl+C** interrumpe un programa; **Ctrl+L** limpia la pantalla.

## 3. Crear, copiar, mover y borrar

```bash
mkdir mi-curso              # crear carpeta
mkdir -p proyectos/tareas   # crear toda la ruta de una vez
touch notas.md              # crear archivo vacío
cp notas.md copia.md        # copiar archivo
cp -r carpeta otra          # copiar carpeta (recursivo)
mv copia.md borrador.md     # mover o renombrar
rm borrador.md              # borrar archivo
rm -r carpeta               # borrar carpeta y su contenido
```

⚠️ **`rm` no tiene papelera.** Lo borrado no vuelve. Nunca ejecutes `rm -rf` con una ruta que no entiendas del todo.

### Ver y editar contenido

```bash
cat notas.md              # muestra todo el archivo
less notas.md             # lo muestra paginado (q para salir)
head -n 5 notas.md        # primeras 5 líneas
tail -f registro.log      # sigue un archivo mientras crece
echo "Hola" > notas.md    # escribe (sobrescribe) en el archivo
echo "Otra" >> notas.md   # añade al final
grep "Hola" notas.md      # busca texto
```

`>` y `>>` son **redirecciones**; `|` (tubería) conecta la salida de un comando con la entrada de otro:

```bash
ls -la | grep ".md"       # solo líneas que contienen ".md"
cat registro.log | wc -l  # cuántas líneas tiene
```

Para editar con un editor de terminal usa `nano notas.md` (Ctrl+O guarda, Ctrl+X sale). Más adelante usarás un editor gráfico como VS Code (`code .` abre la carpeta actual).

## 4. Permisos

```bash
ls -l
# -rwxr-xr--  1 ana  equipo  120 oct 21 10:00 script.sh
```

Lee `-rwxr-xr--` en grupos de tres tras el primer carácter (tipo de archivo):

| Grupo | Quién | Ejemplo | Significa |
|-------|-------|---------|-----------|
| 1.º | propietario | `rwx` | leer, escribir, ejecutar |
| 2.º | grupo | `r-x` | leer, ejecutar |
| 3.º | otros | `r--` | solo leer |

```bash
chmod +x script.sh     # hacerlo ejecutable
chmod 640 secreto.txt  # r/w propietario, r grupo, nada otros (4=r, 2=w, 1=x)
./script.sh            # ejecutarlo (el ./ significa "en esta carpeta")
```

## 5. Variables de entorno

Son pares nombre=valor que heredan los programas que lanzas. Son la forma estándar de pasar **configuración** (puertos, contraseñas, URLs) sin escribirla dentro del código. Las usarás mucho a partir del Módulo 03.

```bash
echo $HOME               # leer una variable
export PUERTO=8080       # definirla para este shell y los programas que lance
echo "Puerto: $PUERTO"
env | grep PUERTO        # ver variables
PUERTO=9000 ./programa   # definirla solo para esta ejecución
```

`PATH` es la lista de carpetas donde el shell busca programas. Para que sea permanente, añade el `export` a `~/.bashrc` o `~/.zshrc`.

## 6. Git y GitHub desde cero

**Git** guarda el historial de tu proyecto como una serie de "fotografías" (*commits*). **GitHub** es un servicio que aloja tus repositorios en la nube.

### Configuración inicial (una sola vez)

```bash
git config --global user.name  "Tu Nombre"
git config --global user.email "tu@correo.com"
git config --global init.defaultBranch main
```

### El ciclo básico

```bash
mkdir mi-curso && cd mi-curso
git init                         # crea el repositorio
echo "# Mi curso" > README.md
git status                       # ¿qué cambió?
git add README.md                # prepara el cambio (staging)
git commit -m "Primer commit"    # guarda la fotografía
git log --oneline                # historial
git diff                         # cambios aún sin preparar
```

Piensa en tres zonas: **directorio de trabajo** → (`git add`) → **área de preparación** → (`git commit`) → **historial**.

### Subir a GitHub

1. Crea una cuenta en github.com y un repositorio vacío llamado `mi-curso`.
2. Autentícate. Lo más sencillo es la CLI oficial: `gh auth login`. (Alternativa: una clave SSH.)
3. Conecta y sube:

```bash
git remote add origin https://github.com/TU_USUARIO/mi-curso.git
git push -u origin main
```

Para traer cambios: `git pull`. Para copiar un repositorio ajeno: `git clone URL`.

### Ramas

```bash
git switch -c mejora-readme      # crea y cambia a una rama nueva
# ...trabajas y haces commits...
git switch main
git merge mejora-readme          # integra la rama
```

### `.gitignore`

Lista lo que **no** debe versionarse (binarios, secretos, dependencias):

```gitignore
.env
*.log
bin/
```

> **Regla de oro:** nunca hagas commit de contraseñas, tokens ni archivos `.env`. Si lo haces por error, considéralos comprometidos y cámbialos.

## Práctica

Crea un directorio `mi-curso`, dentro un archivo `notas.md`, inicializa un repositorio con `git init`, haz tu primer commit y súbelo a un repositorio nuevo en GitHub.

<details>
<summary>Ver solución</summary>

```bash
mkdir ~/mi-curso && cd ~/mi-curso
echo "# Notas del curso" > notas.md
printf ".env\n*.log\n" > .gitignore
git init
git add .
git commit -m "Notas iniciales"
# (crea el repo vacío en GitHub)
git remote add origin https://github.com/TU_USUARIO/mi-curso.git
git push -u origin main
```

Comprueba en GitHub que ves `notas.md` y `.gitignore`.
</details>

## Errores comunes

- **`command not found`**: el programa no está instalado o no está en `PATH`.
- **`Permission denied`** al ejecutar un script: falta `chmod +x`.
- **`fatal: not a git repository`**: no estás dentro de una carpeta con `git init`.
- **Rechazo en `git push`**: el remoto tiene commits que no tienes; haz `git pull` primero.

## Resumen

- La terminal es la ventana, el shell interpreta y los comandos son programas.
- `pwd`, `ls`, `cd`, `mkdir`, `cp`, `mv`, `rm` te permiten gestionar archivos.
- Las variables de entorno son la vía estándar para configurar programas.
- Git guarda historial local; GitHub lo comparte.

## Autoevaluación

1. ¿Cuál es la diferencia entre terminal y shell?
2. ¿Qué hace `chmod 640 archivo` exactamente?
3. ¿Qué diferencia hay entre `>` y `>>`?
4. ¿Por qué no se versiona un archivo `.env`?
5. ¿Qué hacen, en orden, `git add` y `git commit`?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi práctica está subida a GitHub.
- [ ] Sé qué parte me costó más y la repasaré.

