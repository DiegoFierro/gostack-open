# GoStack Open

Curso práctico para construir aplicaciones Full Stack (web, escritorio y móvil) con Go.
Sitio estático hecho con [Hugo](https://gohugo.io/). Publicado en <https://diegofierro.github.io/gostack-open/>.

## Estructura

```text
hugo.toml                  configuración (baseURL, menú, resaltado de código)
data/syllabus.yaml         fases, módulos y temas (alimenta Inicio y Syllabus)
content/_index.md          portada
content/syllabus/          página del syllabus
content/lecciones/NN-*.md  las 20 lecciones (el orden lo da `weight`)
layouts/                   plantillas (inicio, syllabus, lecciones, navegación)
assets/css, assets/js      estilos (claro/oscuro) y JavaScript mínimo
.github/workflows/pages.yml  despliegue automático a GitHub Pages
```

## Desarrollo local

```bash
hugo server          # http://localhost:1313/gostack-open/
hugo --gc --minify   # compila a ./public
```

Requiere Hugo **extended** 0.139 o superior.

## Publicar

1. En GitHub: *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
2. Haz push a `main`; el workflow compila y publica el sitio.

## Añadir o reordenar una lección

1. Crea `content/lecciones/NN-nombre.md` con `title`, `description`, `weight` y `fase` en el front matter.
2. Añade el módulo en `data/syllabus.yaml` (campo `leccion` = nombre del archivo sin `.md`).
3. Los botones **Anterior / Siguiente** se recalculan solos según `weight`.
