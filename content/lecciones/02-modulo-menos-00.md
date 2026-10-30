---
title: "Módulo -00: Fundamentos de la Web & Protocolo HTTP"
description: "Entiende qué ocurre entre que escribes una URL y ves una página."
weight: 2
fase: "Fase -1 & 0: Fundamentos, terminal y mentalidad Go"
---

> Entiende qué ocurre entre que escribes una URL y ves una página.

**Fase -1 & 0: Fundamentos, terminal y mentalidad Go** · Lección 2 de 20

## 🎯 Objetivos

- Describir el modelo cliente-servidor, las IPs y el DNS.
- Leer y escribir peticiones y respuestas HTTP a mano.
- Identificar métodos, cabeceras y códigos de estado.
- Entender por qué la web es **hipermedia** y qué implica para este curso.

## 1. Clientes, servidores, IPs y dominios

Internet es una red de redes. Cada dispositivo conectado tiene una **dirección IP** (`93.184.216.34` en IPv4, `2606:2800:...` en IPv6). Los humanos preferimos nombres, así que existe el **DNS** (*Domain Name System*), una "guía telefónica" distribuida que traduce `ejemplo.com` a una IP.

- **Cliente**: quien pide algo (tu navegador, `curl`, una app móvil).
- **Servidor**: quien responde (un programa Go escuchando en un puerto).
- **Puerto**: un número (0–65535) que identifica qué programa de la máquina debe recibir la conexión. HTTP usa el 80 y HTTPS el 443 por convención; en desarrollo usaremos `8080`.

```bash
dig +short example.com     # resuelve el dominio a IP (nslookup en Windows)
```

## 2. Qué ocurre al abrir `https://ejemplo.com/tareas?pagina=2`

```text
 Navegador                          DNS                      Servidor
    │ ── ¿IP de ejemplo.com? ───────▶│                           │
    │ ◀──────────── 93.184.216.34 ───│                           │
    │ ── conexión TCP al puerto 443 ───────────────────────────▶│
    │ ── negociación TLS (HTTPS: cifrado y certificado) ────────▶│
    │ ── GET /tareas?pagina=2 ──────────────────────────────────▶│
    │ ◀──────────────────────────── 200 OK + HTML ───────────────│
    │ (pide además CSS, JS, imágenes mencionadas en el HTML)      │
```

Una URL se descompone así:

```text
https://ejemplo.com:443/tareas/42?pagina=2#detalle
└─┬──┘   └────┬────┘└┬─┘└───┬───┘└───┬────┘└──┬───┘
esquema     host  puerto  ruta    query   fragmento
```

El **fragmento** (`#detalle`) nunca viaja al servidor; solo lo usa el navegador.

## 3. Anatomía de HTTP

HTTP es un protocolo de **texto**, sin estado, de petición-respuesta. Así luce una petición:

```http
GET /tareas?pagina=2 HTTP/1.1
Host: ejemplo.com
Accept: text/html
User-Agent: curl/8.5.0
```

Y una respuesta:

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 1256
Set-Cookie: sesion=abc123; HttpOnly

<!doctype html>
<html>...
```

Consta de **línea inicial**, **cabeceras** (pares `Nombre: valor`), una línea en blanco y un **cuerpo** opcional.

### Métodos

| Método | Intención | ¿Cuerpo? | Idempotente* |
|--------|-----------|----------|--------------|
| `GET` | Leer un recurso | no | sí |
| `POST` | Crear / ejecutar una acción | sí | no |
| `PUT` | Reemplazar un recurso completo | sí | sí |
| `PATCH` | Modificar parcialmente | sí | no necesariamente |
| `DELETE` | Eliminar | no | sí |

\* *Idempotente*: repetir la petición deja el sistema en el mismo estado. `GET` además debe ser **seguro** (no modifica nada); por eso jamás se borran datos con un `GET`.

### Códigos de estado

| Rango | Significado | Ejemplos |
|-------|-------------|----------|
| `1xx` | Informativo | `101 Switching Protocols` (WebSockets) |
| `2xx` | Éxito | `200 OK`, `201 Created`, `204 No Content` |
| `3xx` | Redirección | `301 Moved Permanently`, `303 See Other`, `304 Not Modified` |
| `4xx` | Error del cliente | `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `422 Unprocessable Content`, `429 Too Many Requests` |
| `5xx` | Error del servidor | `500 Internal Server Error`, `502 Bad Gateway`, `503 Service Unavailable` |

### Cabeceras que verás constantemente

- `Content-Type`: formato del cuerpo (`text/html`, `application/json`, `application/x-www-form-urlencoded`).
- `Accept`: formatos que el cliente acepta.
- `Cookie` / `Set-Cookie`: estado de sesión (Módulo 09).
- `Cache-Control`, `ETag`: caché (Módulo 12).
- `Location`: destino de una redirección.
- `Authorization`: credenciales (`Bearer <token>`).

## 4. Practicar con `curl`

```bash
curl -v https://example.com              # -v muestra petición y respuesta
curl -I https://example.com              # solo cabeceras (HEAD)
curl -X POST https://httpbin.org/post \
     -d "titulo=Aprender Go" -d "hecha=false"   # formulario
curl https://httpbin.org/post \
     -H "Content-Type: application/json" \
     -d '{"titulo":"Aprender Go"}'              # JSON
curl -i https://example.com/no-existe    # -i incluye cabeceras: verás 404
curl -L http://github.com                # -L sigue redirecciones
```

También puedes ver todo esto en el navegador: **F12 → pestaña Red (Network)**.

## 5. Sin estado: por qué existen las cookies

Cada petición HTTP es independiente; el servidor no recuerda quién eres. Para "recordarte", el servidor envía una cookie (`Set-Cookie`) y tu navegador la devuelve en cada petición posterior (`Cookie`). Todo el sistema de sesiones del Módulo 09 se apoya en esto.

## 6. Hipermedia: la filosofía de este curso

La web nació como **hipertexto**: documentos con *enlaces* y *formularios*. Una respuesta HTML no solo contiene datos, también contiene **las acciones disponibles** (enlaces y formularios). El cliente no necesita saber de antemano qué rutas existen: las descubre en el HTML. Esta idea se llama **HATEOAS** (*Hypermedia As The Engine Of Application State*).

Hoy muchas aplicaciones invierten el modelo: el servidor devuelve JSON y un framework de JavaScript en el navegador construye la interfaz. Nosotros seguiremos otro camino, **HTML Over The Wire**:

1. El servidor (Go) genera HTML.
2. El navegador lo muestra.
3. Para interactividad, HTMX pide **fragmentos de HTML** y los coloca donde corresponde.

Resultado: menos código, una sola fuente de verdad (el servidor) y un stack mucho más pequeño.

## 🧪 Práctica

Usa `curl -v https://example.com` y anota: método, ruta, cabeceras de petición, código de estado y cabeceras de respuesta. Repite con una URL inexistente y compara el código de estado.

<details>
<summary>Ver solución</summary>

Con `curl -v https://example.com` verás líneas con `>` (petición) y `<` (respuesta):

```text
> GET / HTTP/2
> Host: example.com
> User-Agent: curl/8.x
> Accept: */*
< HTTP/2 200
< content-type: text/html
< cache-control: max-age=...
```

Con `https://example.com/no-existe` el estado será `404`. Observa que **la respuesta sigue teniendo cuerpo HTML**: un error también es una respuesta válida. Bonus: haz `curl -X POST https://example.com -i` y observa el código (normalmente `405 Method Not Allowed` o similar).
</details>

## ⚠️ Errores comunes

- Creer que `POST` es "más seguro" que `GET`: ninguno cifra nada; eso lo hace HTTPS.
- Poner datos sensibles en la URL (quedan en historiales y logs).
- Usar `200 OK` para todo, incluso errores: pierdes información valiosa.

## 📌 Resumen

- DNS convierte nombres en IPs; el puerto identifica el programa.
- HTTP es texto: línea inicial, cabeceras, cuerpo.
- Método + ruta expresan la intención; el código de estado expresa el resultado.
- La web es hipermedia: el HTML contiene las acciones. Este curso se construye sobre esa idea.

## ✅ Autoevaluación

1. ¿Qué tarea cumple el DNS?
2. ¿Por qué nunca se borra un recurso con `GET`?
3. ¿Qué diferencia hay entre `401` y `403`?
4. ¿Qué significa que HTTP "no tiene estado"? ¿Cómo se soluciona?
5. ¿Qué significa "HTML Over The Wire"?

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Hice una petición con `curl` y la interpreté línea a línea.
- [ ] Sé qué parte me costó más y la repasaré.

