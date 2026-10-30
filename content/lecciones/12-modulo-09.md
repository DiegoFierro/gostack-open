---
title: "Módulo 09: Autenticación, Sesiones & Seguridad Web"
description: "Identidad, sesiones y defensas contra los ataques web más comunes."
weight: 12
fase: "Fase 3: Seguridad, APIs y tiempo real"
---

> Identidad, sesiones y defensas contra los ataques web más comunes.

**Fase 3: Seguridad, APIs y tiempo real** · Lección 12 de 20

## 🎯 Objetivos

- Guardar contraseñas con Argon2id de forma segura.
- Gestionar sesiones con cookies bien configuradas.
- Emitir y verificar JWT para autenticación de APIs.
- Aplicar control de acceso por roles (RBAC).
- Mitigar CSRF, XSS e inyección SQL.

## 1. Autenticación vs. autorización

- **Autenticación (*authn*)**: ¿quién eres? (verificar identidad: usuario + contraseña).
- **Autorización (*authz*)**: ¿qué puedes hacer? (permisos, roles).

Se resuelven en capas: primero un middleware identifica al usuario; luego otro (o el propio handler) decide si tiene permiso.

## 2. Contraseñas: hashing con Argon2id

**Jamás** guardes una contraseña ni la cifres de forma reversible. Guarda el resultado de una función *hash* **lenta y con sal** (*salt*): aunque se filtre la base de datos, recuperar las contraseñas es costosísimo.

Por qué **Argon2id** (ganador de la *Password Hashing Competition*, recomendado por OWASP): es "memory-hard", encarece los ataques con GPU/ASIC.

```bash
go get golang.org/x/crypto/argon2
```

```go
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

type paramsArgon struct {
	memoria     uint32 // KiB
	iteraciones uint32
	paralelismo uint8
	longSal     uint32
	longClave   uint32
}

// Valores de partida razonables (OWASP: m=19 MiB, t=2, p=1 como mínimo).
// Ajústalos para que verificar tarde ~50–250 ms en tu servidor.
var porDefecto = paramsArgon{memoria: 64 * 1024, iteraciones: 3, paralelismo: 2, longSal: 16, longClave: 32}

func HashPassword(password string) (string, error) {
	p := porDefecto
	sal := make([]byte, p.longSal)
	if _, err := rand.Read(sal); err != nil { // sal ÚNICA y aleatoria por usuario
		return "", err
	}
	clave := argon2.IDKey([]byte(password), sal, p.iteraciones, p.memoria, p.paralelismo, p.longClave)

	// Formato PHC: autodescriptivo, permite subir parámetros en el futuro.
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.memoria, p.iteraciones, p.paralelismo,
		base64.RawStdEncoding.EncodeToString(sal),
		base64.RawStdEncoding.EncodeToString(clave)), nil
}

var ErrHashInvalido = errors.New("formato de hash inválido")

func VerificarPassword(password, codificado string) (bool, error) {
	partes := strings.Split(codificado, "$")
	if len(partes) != 6 || partes[1] != "argon2id" {
		return false, ErrHashInvalido
	}
	var version int
	if _, err := fmt.Sscanf(partes[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, ErrHashInvalido
	}
	var p paramsArgon
	if _, err := fmt.Sscanf(partes[3], "m=%d,t=%d,p=%d", &p.memoria, &p.iteraciones, &p.paralelismo); err != nil {
		return false, ErrHashInvalido
	}
	sal, err := base64.RawStdEncoding.DecodeString(partes[4])
	if err != nil {
		return false, ErrHashInvalido
	}
	esperada, err := base64.RawStdEncoding.DecodeString(partes[5])
	if err != nil {
		return false, ErrHashInvalido
	}
	calculada := argon2.IDKey([]byte(password), sal, p.iteraciones, p.memoria, p.paralelismo, uint32(len(esperada)))

	// Comparación en tiempo constante: evita ataques de temporización.
	return subtle.ConstantTimeCompare(calculada, esperada) == 1, nil
}
```

Buenas prácticas con contraseñas:

- Longitud mínima de 8 (idealmente 12+); **permite** frases largas y cualquier carácter; no impongas reglas absurdas de composición.
- Mensaje genérico en fallos de inicio de sesión: *"Credenciales inválidas"*, sin revelar si el correo existe.
- Limita intentos (*rate limiting*) por IP y por cuenta.
- Si el correo no existe, ejecuta igualmente un hash falso para igualar el tiempo de respuesta.

Esquema:

```sql
CREATE TABLE usuarios (
    id            bigserial PRIMARY KEY,
    email         text UNIQUE NOT NULL,
    password_hash text NOT NULL,
    rol           text NOT NULL DEFAULT 'usuario' CHECK (rol IN ('usuario','admin')),
    creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sesiones (
    token_hash bytea PRIMARY KEY,           -- SHA-256 del token; nunca el token en claro
    usuario_id bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_en  timestamptz NOT NULL,
    creada_en  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sesiones (expira_en);
```

## 3. Sesiones con cookies

Como HTTP no tiene estado, tras el inicio de sesión el servidor entrega un **identificador de sesión** aleatorio en una cookie; el navegador lo devuelve en cada petición y el servidor busca a quién pertenece.

### Generar el token

```go
func NuevoToken() (token string, hash []byte, err error) {
	b := make([]byte, 32) // 256 bits de entropía
	if _, err = rand.Read(b); err != nil {
		return
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(token))
	return token, h[:], nil
}
```

Se guarda el **hash** del token en la base de datos: si esta se filtra, los tokens no sirven. (SHA-256 es suficiente aquí porque el token ya es aleatorio de alta entropía; no ocurre lo mismo con una contraseña elegida por un humano.)

### Enviar la cookie con los atributos de seguridad

```go
func (s *Servidor) iniciarSesion(w http.ResponseWriter, usuarioID int64) error {
	token, hash, err := NuevoToken()
	if err != nil { return err }
	expira := time.Now().Add(7 * 24 * time.Hour)
	if err := s.sesiones.Crear(ctx, hash, usuarioID, expira); err != nil { return err }

	http.SetCookie(w, &http.Cookie{
		Name:     "sesion",
		Value:    token,
		Path:     "/",
		Expires:  expira,
		HttpOnly: true,                 // JavaScript NO puede leerla (mitiga robo por XSS)
		Secure:   true,                 // solo viaja por HTTPS
		SameSite: http.SameSiteLaxMode, // no se envía en peticiones cruzadas "peligrosas" (mitiga CSRF)
	})
	return nil
}
```

| Atributo | Qué previene |
|----------|--------------|
| `HttpOnly` | Que un script malicioso lea la cookie (`document.cookie`). |
| `Secure` | Que viaje en claro por HTTP. En desarrollo local sin HTTPS tendrás que relajarlo por configuración. |
| `SameSite=Lax` / `Strict` | Que el navegador la adjunte a peticiones iniciadas desde otros sitios. |
| `Path`, `Expires`/`Max-Age` | Alcance y duración. |
| Prefijo `__Host-` (nombre `__Host-sesion`) | Obliga `Secure`, `Path=/` y sin `Domain`: más robusto. |

### Middleware que identifica al usuario

```go
type claveCtx struct{}

func (s *Servidor) Autenticar(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie("sesion"); err == nil {
			h := sha256.Sum256([]byte(c.Value))
			if u, err := s.sesiones.Usuario(r.Context(), h[:]); err == nil { // comprueba expiración
				r = r.WithContext(context.WithValue(r.Context(), claveCtx{}, u))
			}
		}
		next.ServeHTTP(w, r) // sin sesión válida: simplemente anónimo
	})
}

func UsuarioDe(ctx context.Context) (Usuario, bool) {
	u, ok := ctx.Value(claveCtx{}).(Usuario)
	return u, ok
}

func ExigirLogin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := UsuarioDe(r.Context()); !ok {
			http.Redirect(w, r, "/entrar", http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

Detalles críticos:

- **Regenera el token al iniciar sesión** (nunca reutilices uno previo): previene *session fixation*.
- Al cerrar sesión **borra la fila** de la base de datos y expira la cookie (`MaxAge: -1`); no basta con borrar la cookie.
- Expira sesiones inactivas y limpia las vencidas periódicamente.
- Para HTMX: si la sesión expira, un `Redirect` produciría la página de login *dentro* de un fragmento; responde con la cabecera `HX-Redirect: /entrar` (y estado `401`/`200`) para que el navegador navegue de verdad.

## 4. JWT para APIs

Una **JWT** (*JSON Web Token*) es un token **firmado** que contiene datos (*claims*) y que el servidor puede verificar **sin consultar la base de datos**. Tiene tres partes en Base64URL: `cabecera.carga.firma`.

Cuándo usarlas: APIs consumidas por clientes que no son un navegador (apps móviles, de escritorio, otros servicios; Módulos 10, 15, 16). Para la web con HTMX, **las cookies de sesión son más simples y más seguras** (se pueden revocar al instante).

```bash
go get github.com/golang-jwt/jwt/v5
```

```go
type Claims struct {
	Rol string `json:"rol"`
	jwt.RegisteredClaims
}

func EmitirJWT(secreto []byte, usuarioID int64, rol string) (string, error) {
	ahora := time.Now()
	c := Claims{
		Rol: rol,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(usuarioID, 10),
			Issuer:    "tareas",
			IssuedAt:  jwt.NewNumericDate(ahora),
			ExpiresAt: jwt.NewNumericDate(ahora.Add(15 * time.Minute)), // vida CORTA
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(secreto)
}

func VerificarJWT(secreto []byte, tokenStr string) (*Claims, error) {
	var c Claims
	tok, err := jwt.ParseWithClaims(tokenStr, &c, func(t *jwt.Token) (any, error) {
		return secreto, nil
	},
		jwt.WithValidMethods([]string{"HS256"}), // IMPRESCINDIBLE: fija el algoritmo
		jwt.WithIssuer("tareas"),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !tok.Valid {
		return nil, fmt.Errorf("token inválido: %w", err)
	}
	return &c, nil
}
```

Se envía en la cabecera `Authorization: Bearer <token>`.

Advertencias importantes:

- El contenido de una JWT **está codificado, no cifrado**: cualquiera puede leerlo. No pongas secretos.
- **Fija el algoritmo** al verificar (`WithValidMethods`); aceptar `none` u otros algoritmos es una vulnerabilidad clásica.
- Un secreto HS256 debe ser largo y aleatorio (≥32 bytes) y salir de la configuración, no del código.
- **No se pueden revocar** antes de expirar: por eso duran minutos; se combinan con un *refresh token* guardado en servidor que sí se puede revocar.
- No las guardes en `localStorage` si hay un navegador de por medio (XSS las robaría).

## 5. Control de acceso basado en roles (RBAC)

Asocia permisos a **roles** y roles a usuarios. Para empezar, un middleware parametrizable:

```go
func ExigirRol(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := UsuarioDe(r.Context())
			if !ok {
				http.Redirect(w, r, "/entrar", http.StatusSeeOther)
				return
			}
			if !slices.Contains(roles, u.Rol) {
				http.Error(w, "No tienes permiso", http.StatusForbidden) // 403
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// uso
mux.Handle("GET /admin/usuarios", ExigirRol("admin")(http.HandlerFunc(s.listarUsuarios)))
```

Principios:

- **Denegar por defecto**: lo que no se permite explícitamente está prohibido.
- **Mínimo privilegio**: cada rol solo lo necesario.
- Comprueba **también la propiedad del recurso** (*IDOR*): que `GET /tareas/42` pertenezca al usuario autenticado, no solo que haya iniciado sesión. En SQL: `WHERE id = $1 AND usuario_id = $2`.
- Distingue `401` (no autenticado) de `403` (autenticado sin permiso).
- La autorización se aplica **en el servidor**: ocultar un botón no es seguridad.

## 6. Vulnerabilidades web habituales

### CSRF (*Cross-Site Request Forgery*)

Una página maliciosa hace que **tu navegador** envíe una petición a tu aplicación aprovechando que lleva tus cookies (por ejemplo, un formulario oculto que apunta a `POST /tareas/7/eliminar`).

Defensas (en capas):

1. Cookies **`SameSite=Lax`** (ya lo hicimos): bloquea el envío de la cookie en `POST` cruzados.
2. **Nunca cambies estado con `GET`.**
3. **Verificación del origen**: desde Go 1.25, `http.CrossOriginProtection` rechaza peticiones inseguras (`POST`, `PUT`, `DELETE`…) cuyo origen no coincida, usando las cabeceras `Sec-Fetch-Site` y `Origin`:

```go
cop := http.NewCrossOriginProtection()
handler := cop.Handler(mux)
```

4. **Token CSRF** (defensa clásica y adicional): un valor aleatorio ligado a la sesión, incluido como campo oculto y exigido en cada petición que modifica estado. Con HTMX puedes enviarlo en todas las peticiones:

```html
<body hx-headers='{"X-CSRF-Token": "{{.CSRF}}"}'>
```

Y en los formularios normales: `<input type="hidden" name="csrf" value="{{.CSRF}}">`. En Go comparas con `subtle.ConstantTimeCompare`. La librería `github.com/gorilla/csrf` lo implementa si prefieres no escribirlo tú.

### XSS (*Cross-Site Scripting*)

Un atacante consigue que **su** JavaScript se ejecute en la página de otros (por ejemplo, un título de tarea con `<script>…</script>`).

- `html/template` **escapa por contexto** automáticamente: la defensa principal. **No lo evites**: no uses `template.HTML(entrada)` ni `template.JS(entrada)` con datos del usuario.
- Cabecera **Content-Security-Policy** (CSP) restrictiva como segunda línea:

```go
func CabecerasSeguras(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; base-uri 'self'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains") // solo sobre HTTPS
		next.ServeHTTP(w, r)
	})
}
```

(Si usas estilos o scripts *inline*, tendrás que ajustar la política con *nonces*. Mantén la tuya lo más estricta que puedas.)

- Cookies `HttpOnly` limitan el daño si ocurre.

### Inyección SQL

La entrada del usuario se interpreta como parte de la consulta. **Defensa: consultas parametrizadas**, siempre (`pgx` con `$1` y `sqlc` lo garantizan). Nunca `fmt.Sprintf` con entrada del usuario dentro de SQL. Para nombres de columnas u ordenación dinámica usa una **lista blanca**.

### Otras defensas básicas

- **HTTPS en todas partes** (Módulo 17 con Caddy).
- **Limita el tamaño del cuerpo**: `r.Body = http.MaxBytesReader(w, r.Body, 1<<20)`.
- **Limitación de tasa** (*rate limiting*) en login y registro; por ejemplo con `golang.org/x/time/rate`.
- **Dependencias**: `govulncheck ./...` detecta vulnerabilidades conocidas en lo que usas.
- **No registres** contraseñas, tokens ni datos sensibles.
- Errores genéricos al usuario; detalles solo en los logs.

## 🧪 Práctica

Implementa registro e inicio de sesión con Argon2id, sesión por cookie `HttpOnly; Secure; SameSite=Lax`, un middleware de roles (`admin`/`usuario`) y protección CSRF en los formularios.

<details>
<summary>Ver solución</summary>

1. Migración con `usuarios` y `sesiones` (sección 2) + consultas `sqlc` (`CrearUsuario`, `UsuarioPorEmail`, `CrearSesion`, `UsuarioPorSesion`, `EliminarSesion`).
2. `POST /registro`: valida, `HashPassword`, inserta; `POST /entrar`: `UsuarioPorEmail` → `VerificarPassword` → `iniciarSesion` → redirige `303`. Mismo mensaje de error si falla cualquiera de los dos.
3. `POST /salir`: `EliminarSesion` + cookie con `MaxAge: -1`.
4. Encadena: `Recuperar → Logging → CabecerasSeguras → CrossOriginProtection → Autenticar → mux`; protege `/tareas` con `ExigirLogin` y `/admin/*` con `ExigirRol("admin")`.
5. Añade `usuario_id` a `tareas` y filtra por él en todas las consultas.
6. Pruebas: (a) inspecciona la cookie en las herramientas del navegador (flags `HttpOnly`, `Secure`, `SameSite`); (b) intenta `curl -X POST` sin cabecera de origen válida: debe rechazarse; (c) accede a `/admin/usuarios` con un usuario normal: `403`; (d) intenta ver una tarea ajena: `404`.
</details>

## ⚠️ Errores comunes

- Guardar contraseñas con SHA-256/MD5 simple, o sin sal.
- Cookies de sesión sin `HttpOnly`/`Secure`/`SameSite`.
- Usar JWT "porque sí" en una aplicación web con navegador.
- Aceptar el algoritmo indicado por la propia JWT.
- Autorizar solo en la interfaz, sin comprobar en el servidor (y olvidar la propiedad del recurso).
- Mensajes de error que revelan si un usuario existe.
- Usar `template.HTML` con entrada del usuario.

## 📌 Resumen

- Contraseñas con **Argon2id**, sal única y comparación en tiempo constante.
- Sesiones: token aleatorio, guardado como hash, en cookie `HttpOnly; Secure; SameSite`.
- JWT para clientes no-navegador: vida corta, algoritmo fijado, sin secretos dentro.
- RBAC + comprobación de propiedad; deny by default.
- CSRF, XSS y SQLi se mitigan en capas: SameSite/tokens/origen, escape automático + CSP, consultas parametrizadas.

## ✅ Autoevaluación

1. ¿Por qué se guarda un hash lento con sal en lugar de cifrar la contraseña?
2. ¿Qué previene cada atributo de la cookie: `HttpOnly`, `Secure` y `SameSite`?
3. ¿Por qué se guarda el *hash* del token de sesión y no el token?
4. ¿Cuándo preferirías sesiones con cookie y cuándo JWT?
5. ¿Qué es un IDOR y cómo se evita?
6. Nombra tres defensas contra CSRF.

- [ ] Puedo explicar con mis palabras cada objetivo de esta lección.
- [ ] Mi aplicación exige login y separa los datos de cada usuario.
- [ ] Sé qué parte me costó más y la repasaré.

