# Setup de Gmail API para `ingest_mail.py`

Esta guía es para **una sola vez**. Te genera las credenciales que después se
guardan como GitHub Secrets, y el script de ingest las usa para leer el buzón
sin tu intervención.

**Tiempo estimado:** 15 minutos.
**Cuenta a usar en todo el proceso:** `reportes.almacenlag@gmail.com`

---

## 1. Crear proyecto en Google Cloud

1. Abre <https://console.cloud.google.com/> con la cuenta `reportes.almacenlag@gmail.com`
2. Si te pide aceptar términos, acéptalos
3. Arriba a la izquierda, click en el selector de proyecto → "Nuevo proyecto"
4. Nombre: `auditor-almacen-ingest` (o el que prefieras)
5. Click "Crear" y espera a que se cree
6. Selecciónalo en el selector

## 2. Habilitar Gmail API

1. Menú lateral (≡) → "APIs y servicios" → "Biblioteca"
2. Busca "Gmail API"
3. Click en el resultado → "Habilitar"

## 3. Configurar pantalla de consentimiento OAuth

1. Menú lateral → "APIs y servicios" → "Pantalla de consentimiento OAuth"
2. Tipo de usuario: **Externo** → "Crear"
3. Información de la app:
   - Nombre de la app: `Auditor Almacen`
   - Correo de soporte del usuario: `reportes.almacenlag@gmail.com`
   - Información de contacto del desarrollador: el mismo
4. "Guardar y continuar"
5. **Permisos:** click "Agregar o quitar permisos"
   - En el filtro busca `gmail.modify`
   - Marca el checkbox de `https://www.googleapis.com/auth/gmail.modify`
   - "Actualizar" → "Guardar y continuar"
6. **Usuarios de prueba:** click "Agregar usuarios"
   - Agrega `reportes.almacenlag@gmail.com`
   - "Guardar y continuar" → "Volver al panel"

> La app queda en estado **"En prueba"**. Eso está bien. Para uso personal con tu
> propia cuenta como único usuario de prueba no necesitas verificación de Google.

## 4. Crear credenciales OAuth

1. Menú lateral → "APIs y servicios" → "Credenciales"
2. Click "Crear credenciales" → "ID de cliente de OAuth"
3. Tipo de aplicación: **Aplicación de escritorio**
4. Nombre: `auditor-ingest-cli`
5. "Crear"
6. En el diálogo que aparece, click "Descargar JSON"
7. Guarda ese archivo como `parsers/credentials.json` (ya está en `.gitignore` —
   nunca debe subirse al repo)

## 5. Generar el refresh token

En tu terminal:

```bash
cd /Users/mauriciovillalobos/Desktop/CBL/Almacen/Mayo/Code_Audicen/parsers
python3 -m pip install -r requirements.txt
python3 auth_setup.py
```

Esto:
- Abre tu navegador en una página de Google
- Te pide autorizar a la app `Auditor Almacen` con la cuenta `reportes.almacenlag@gmail.com`
- Verás un aviso "Google no ha verificado esta aplicación" — click en
  "Configuración avanzada" → "Ir a Auditor Almacen (no seguro)". Es seguro
  porque la app es tuya
- Al terminar, la terminal imprime tres valores:

```
GMAIL_CLIENT_ID=xxxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-xxxxx
GMAIL_REFRESH_TOKEN=1//0gxxxxx
```

**Copia los tres valores ahora** — los pegas en GitHub en el siguiente paso.

## 6. Subir secretos a GitHub

En el repo de GitHub donde vive este proyecto:

1. Settings → Secrets and variables → Actions
2. Click "New repository secret" tres veces, una por valor:
   - Nombre: `GMAIL_CLIENT_ID` — Valor: el que imprimió `auth_setup.py`
   - Nombre: `GMAIL_CLIENT_SECRET` — Valor: el correspondiente
   - Nombre: `GMAIL_REFRESH_TOKEN` — Valor: el correspondiente

(Más adelante agregamos también `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` cuando
tengamos Supabase listo.)

## 7. Probar localmente

```bash
export GMAIL_CLIENT_ID="..."
export GMAIL_CLIENT_SECRET="..."
export GMAIL_REFRESH_TOKEN="..."
python3 ingest_mail.py
```

Lo que deberías ver:
- Cuántos mensajes nuevos hay en el buzón con remitentes válidos
- Por cada adjunto: nombre, clasificación (tipo / turno / momento), y dónde se guardó
- Los archivos quedan en `parsers/samples/YYYY-MM/turno_N/`
- Cada mensaje procesado queda etiquetado con `auditor-procesado` para no
  procesarlo dos veces

---

## Renovación del refresh token (importante)

Mientras la app esté en estado **"En prueba"** en GCP, **el refresh token de
Google expira a los 7 días**. Si el script empieza a fallar con `invalid_grant`:

**Opción rápida (1 min):** vuelve a correr `python3 auth_setup.py`, copia el
nuevo refresh token, y actualízalo en GitHub Secrets (`GMAIL_REFRESH_TOKEN`).

**Opción definitiva:** publica la app en GCP para quitar el límite de 7 días.
- Pantalla de consentimiento OAuth → "Publicar app"
- Como el scope `gmail.modify` es restringido, Google va a pedir verificación
  formal — para una app de uso personal con un solo usuario, esto suele
  resolverse marcándola como uso interno. Si te bloquea, quédate en modo
  testing y usa la opción rápida.

---

## Troubleshooting

**"Error 400: redirect_uri_mismatch"** — la app tipo "Escritorio" maneja esto
automáticamente. Si aparece, recrea las credenciales asegurándote de elegir
"Aplicación de escritorio" y no "Aplicación web".

**"Access blocked: This app's request is invalid"** — verifica que tu correo
esté agregado como usuario de prueba en la pantalla de consentimiento OAuth.

**El navegador no abre nada** — `auth_setup.py` necesita un puerto local libre.
Si estás en SSH o entorno headless, agrega `--no-browser` (no implementado
todavía, abrir issue si lo necesitas).
