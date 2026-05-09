"""
Ingest desde Gmail dedicado.

Lee correos nuevos del buzón, descarga los adjuntos, los clasifica con
classifier.py, y los organiza en samples/YYYY-MM/turno_N/.

Para evitar procesar dos veces el mismo correo, le agrega la etiqueta
'auditor-procesado'. La búsqueda excluye los que ya tengan esa etiqueta.

**El asunto del correo es la fuente de verdad para (turno, momento, fecha).**
Convención del supervisor: `INICIO_T1_08.05.2026`, `CIERRE_T2_08.05.2026`, etc.
- El nombre de archivo solo decide el TIPO (sap_2000, conciliacion, etc.).
- El asunto decide CUÁNDO (turno + momento + fecha).
- Si el asunto no machea el patrón → el correo se considera ajeno a Audicen
  y se marca como procesado sin tocar adjuntos (filtra correos de otros
  temas que vienen del mismo remitente).

Variables de entorno requeridas:
    GMAIL_CLIENT_ID
    GMAIL_CLIENT_SECRET
    GMAIL_REFRESH_TOKEN
    SUPABASE_URL
    SUPABASE_SERVICE_KEY

Pendientes (TODO):
    - Manejar paginación cuando lleguen >100 mensajes pendientes
    - Decodificar nombres de adjunto en RFC 2047 (acentos)
"""

from __future__ import annotations

import base64
import os
import re
import sys
from datetime import date
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable, Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Carga variables de entorno desde parsers/.env si existe (uso local).
# En GitHub Actions las variables vienen del runtime, no de .env.
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    pass

from classifier import AmbiguousClassificationError, Classification, classify
from parse_conciliacion import parse_conciliacion
from parse_sap import parse_sap
from supabase_client import (
    SUPPORTED_TIPOS,
    SupabaseError,
    log_upload,
    upload_records,
)


# --- Configuración ---------------------------------------------------------

ALLOWED_SENDERS = (
    "almacen.cartablanca@gmail.com",
    "franciscobaldomero.acevedoibarra@heineken.com",
)

PROCESSED_LABEL = "auditor-procesado"
SAMPLES_DIR = Path(__file__).parent / "samples"
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


def _build_query() -> str:
    senders = " OR ".join(f"from:{s}" for s in ALLOWED_SENDERS)
    return f"({senders}) has:attachment -label:{PROCESSED_LABEL}"


# --- Auth ------------------------------------------------------------------

def get_gmail_service():
    """Construye el cliente de Gmail API a partir de las env vars."""
    missing = [k for k in ("GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN")
               if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Faltan variables de entorno: {', '.join(missing)}")

    creds = Credentials(
        token=None,
        refresh_token=os.environ["GMAIL_REFRESH_TOKEN"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.environ["GMAIL_CLIENT_ID"],
        client_secret=os.environ["GMAIL_CLIENT_SECRET"],
        scopes=SCOPES,
    )
    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# --- Operaciones de Gmail --------------------------------------------------

def ensure_label_id(service, name: str) -> str:
    """Devuelve el ID de la etiqueta; la crea si no existe."""
    resp = service.users().labels().list(userId="me").execute()
    for lbl in resp.get("labels", []):
        if lbl["name"] == name:
            return lbl["id"]
    new = service.users().labels().create(
        userId="me",
        body={
            "name": name,
            "labelListVisibility": "labelShow",
            "messageListVisibility": "show",
        },
    ).execute()
    return new["id"]


def list_messages(service, query: str) -> list[dict]:
    resp = service.users().messages().list(userId="me", q=query, maxResults=100).execute()
    return resp.get("messages", [])


def iter_parts(payload: dict) -> Iterable[dict]:
    """Recorre recursivamente todas las partes de un mensaje."""
    if not payload:
        return
    if payload.get("parts"):
        for p in payload["parts"]:
            yield from iter_parts(p)
    else:
        yield payload


def get_message_full(service, msg_id: str) -> dict:
    """Trae el mensaje con cuerpo + headers para extraer fecha de envío y adjuntos."""
    return service.users().messages().get(userId="me", id=msg_id, format="full").execute()


def get_attachments_from_msg(service, msg_id: str, msg: dict) -> list[tuple[str, bytes]]:
    """Devuelve [(filename, content_bytes), ...]. Recibe el mensaje ya cargado para no refetchearlo."""
    out: list[tuple[str, bytes]] = []
    for part in iter_parts(msg.get("payload", {})):
        filename = part.get("filename", "")
        body = part.get("body", {})
        if not filename:
            continue
        att_id = body.get("attachmentId")
        if att_id:
            att = service.users().messages().attachments().get(
                userId="me", messageId=msg_id, id=att_id
            ).execute()
            data = base64.urlsafe_b64decode(att["data"])
        elif body.get("data"):
            # Adjuntos pequeños vienen inline.
            data = base64.urlsafe_b64decode(body["data"])
        else:
            continue
        out.append((filename, data))
    return out


def email_send_date(msg: dict) -> Optional[date]:
    """Extrae la fecha del header 'Date' del correo (cuándo lo mandó el supervisor)."""
    headers = msg.get("payload", {}).get("headers", [])
    raw = next((h["value"] for h in headers if h.get("name", "").lower() == "date"), None)
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        return dt.date()
    except (TypeError, ValueError):
        return None


def email_subject(msg: dict) -> str:
    headers = msg.get("payload", {}).get("headers", [])
    return next((h["value"] for h in headers if h.get("name", "").lower() == "subject"), "")


# Patrón del asunto del supervisor: INICIO_T1_08.05.2026, CIERRE_T2_08-05-26, etc.
# Acepta separadores `_`, `-`, espacio o `.`; turno como T1 o TURNO_1; año a 2 o 4 dígitos.
SUBJECT_PATTERN = re.compile(
    r"(?P<momento>INICIO|CIERRE|FIN)"
    r"[_\s\-]*"
    r"T(?:URNO[_\s\-]*)?(?P<turno>[123])"
    r"(?:[_\s\-]*"
    r"(?P<dia>\d{1,2})[._\-/](?P<mes>\d{1,2})[._\-/](?P<anio>\d{2,4})"
    r")?",
    re.IGNORECASE,
)


def parse_email_subject(subject: str) -> tuple[Optional[int], Optional[str], Optional[date]]:
    """
    Extrae (turno, momento, fecha) del asunto. Si el asunto no machea el
    patrón de Audicen, devuelve (None, None, None) y el caller debe
    descartar el correo (no es para nosotros).
    """
    if not subject:
        return None, None, None
    m = SUBJECT_PATTERN.search(subject)
    if not m:
        return None, None, None

    momento_raw = m.group("momento").upper()
    momento = "inicio" if momento_raw == "INICIO" else "cierre"
    turno = int(m.group("turno"))

    fecha = None
    if m.group("dia"):
        d = int(m.group("dia"))
        mo = int(m.group("mes"))
        y = int(m.group("anio"))
        if y < 100:
            y += 2000
        try:
            fecha = date(y, mo, d)
        except ValueError:
            pass

    return turno, momento, fecha


def mark_processed(service, msg_id: str, label_id: str) -> None:
    service.users().messages().modify(
        userId="me",
        id=msg_id,
        body={"addLabelIds": [label_id]},
    ).execute()


# --- Organización en disco -------------------------------------------------

def organize_path(filename: str, fecha: Optional[date], turno: Optional[int]) -> Path:
    """samples/YYYY-MM/turno_N/<filename>. Agrega sufijo si ya existe."""
    ym = fecha.strftime("%Y-%m") if fecha else date.today().strftime("%Y-%m")
    turno_dir = f"turno_{turno}" if turno else "sin_turno"
    base = SAMPLES_DIR / ym / turno_dir / filename

    if not base.exists():
        return base
    # Colisión: agregar contador antes de la extensión.
    stem, suffix = base.stem, base.suffix
    for i in range(2, 100):
        candidate = base.with_name(f"{stem}__{i}{suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Demasiadas colisiones para {base}")


# --- Loop principal --------------------------------------------------------

def parse_file(tipo: str, path: Path, fecha: date):
    """Dispatcher de parsers según el tipo clasificado.

    Devuelve list[dict] para SAP (uno por SKU) o dict (con sub-dicts t1, t2)
    para conciliación. El mapper en supabase_client maneja cada forma.
    """
    if tipo == "sap_2000":
        return parse_sap(path, almacen_hint=2000)
    if tipo == "sap_2010":
        return parse_sap(path, almacen_hint=2010)
    if tipo == "conciliacion_envase":
        return parse_conciliacion(path, fecha)
    raise ValueError(f"Sin parser para tipo: {tipo}")


def process_message(service, msg_id: str, label_id: str) -> dict:
    """Procesa un mensaje: descarga adjuntos, clasifica, guarda, parsea y sube a Supabase.

    El asunto del correo gobierna (turno, momento, fecha). Si el asunto no
    machea el patrón de Audicen, el correo se ignora y se marca como
    procesado para no volver a evaluarlo.
    """
    summary = {
        "saved": 0, "uploaded_rows": 0,
        "ambiguous": 0, "unknown": 0, "unsupported": 0,
        "filtered": 0, "errors": 0,
    }

    try:
        msg = get_message_full(service, msg_id)
    except HttpError as e:
        print(f"  [ERROR] no se pudo leer mensaje {msg_id}: {e}")
        summary["errors"] += 1
        return summary

    subject = email_subject(msg)
    subj_turno, subj_momento, subj_fecha = parse_email_subject(subject)

    # Gate: si el asunto no machea el patrón de Audicen, no es para nosotros.
    if subj_turno is None or subj_momento is None:
        print(f"  [FILTER] Asunto fuera del patrón Audicen: {subject!r} — ignorado")
        summary["filtered"] += 1
        mark_processed(service, msg_id, label_id)
        return summary

    fallback_date = subj_fecha or email_send_date(msg)
    print(f"  Asunto: {subject!r} → T{subj_turno} {subj_momento}, fecha={fallback_date}")

    try:
        attachments = get_attachments_from_msg(service, msg_id, msg)
    except HttpError as e:
        print(f"  [ERROR] no se pudieron leer adjuntos: {e}")
        summary["errors"] += 1
        return summary

    if not attachments:
        print(f"  mensaje sin adjuntos")
        mark_processed(service, msg_id, label_id)
        return summary

    for filename, data in attachments:
        try:
            cls = classify(filename)
        except AmbiguousClassificationError as e:
            print(f"  [AMBIG] {filename}: {e}")
            summary["ambiguous"] += 1
            continue

        if cls.tipo == "unknown":
            print(f"  [SKIP]  {filename}: tipo desconocido")
            summary["unknown"] += 1
            continue

        # El asunto manda: pisamos el turno/momento/fecha del classifier.
        cls.turno = subj_turno
        cls.momento = subj_momento
        fecha = subj_fecha or cls.fecha or fallback_date or date.today()

        # 1. Guardar el archivo en samples/ para auditoría/respaldo.
        path = organize_path(filename, fecha, cls.turno)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        summary["saved"] += 1
        rel = path.relative_to(SAMPLES_DIR.parent)
        print(f"  [SAVE]  {filename} -> {rel} ({cls.tipo}, T{cls.turno} {cls.momento}, fecha={fecha})")

        # 2. Parsear y subir a Supabase si el tipo está soportado.
        if cls.tipo not in SUPPORTED_TIPOS:
            print(f"  [INFO]  {cls.tipo} aún no se sube automático; sigue por upload manual")
            summary["unsupported"] += 1
            continue

        try:
            parsed = parse_file(cls.tipo, path, fecha)
            inserted = upload_records(cls.tipo, parsed, fecha, cls.turno, cls.momento)
            log_upload(cls.tipo, inserted, fecha, cls.turno, cls.momento)
            summary["uploaded_rows"] += inserted
            print(f"  [DB]    {cls.tipo} → {inserted} filas en Supabase")
        except (SupabaseError, Exception) as e:
            print(f"  [ERROR] parse/upload de {filename} falló: {e}")
            summary["errors"] += 1

    # Solo marcamos procesado si no hubo errores duros.
    if summary["errors"] == 0:
        mark_processed(service, msg_id, label_id)
    return summary


def main() -> int:
    service = get_gmail_service()
    label_id = ensure_label_id(service, PROCESSED_LABEL)
    query = _build_query()

    print(f"Query: {query}")
    msgs = list_messages(service, query)
    print(f"Mensajes nuevos: {len(msgs)}")

    totals = {
        "saved": 0, "uploaded_rows": 0,
        "ambiguous": 0, "unknown": 0, "unsupported": 0,
        "filtered": 0, "errors": 0,
    }
    for m in msgs:
        print(f"\n-- mensaje {m['id']} --")
        s = process_message(service, m["id"], label_id)
        for k in totals:
            totals[k] += s[k]

    print("\n=== Resumen ===")
    print(f"  Adjuntos guardados      : {totals['saved']}")
    print(f"  Filas subidas a DB      : {totals['uploaded_rows']}")
    print(f"  Correos no-Audicen      : {totals['filtered']}")
    print(f"  Tipos sin parser aún    : {totals['unsupported']}")
    print(f"  Nombres ambiguos        : {totals['ambiguous']}")
    print(f"  Tipos desconocidos      : {totals['unknown']}")
    print(f"  Errores                 : {totals['errors']}")
    return 0 if totals["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
