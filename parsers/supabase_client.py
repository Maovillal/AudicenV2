"""
Cliente Supabase mínimo (REST API directa, sin supabase-py).

Evita la dependencia pesada de supabase-py que no compila en Python 3.9.
Implementa solo lo que necesitamos: deleteAndInsert (mismo patrón que V2),
y los mappers que traducen la salida de los parsers Python al schema
de las tablas de AudicenV2.

Tablas escritas:
    inventario_liquido      ← parse_sap (almacén 2000)
    inventario_envase       ← parse_sap (almacén 2010)
    conciliacion_envase     ← parse_conciliacion (detalle por SKU + fila TOTAL)
    upload_log              ← cualquier ingest registrado
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import date
from typing import Any, Iterable


# --- HTTP client -----------------------------------------------------------

class SupabaseError(RuntimeError):
    pass


def _config() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise SupabaseError("Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en el entorno")
    return url, key


def _headers(extra: dict | None = None) -> dict:
    _, key = _config()
    h = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def _request(method: str, path: str, *, params: dict | None = None, body: Any = None) -> Any:
    url, _ = _config()
    full = f"{url}/rest/v1{path}"
    if params:
        from urllib.parse import urlencode
        full += "?" + urlencode(params, safe="=,.()")
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(full, method=method, data=data, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")[:500]
        raise SupabaseError(f"{method} {full} → {e.code} {e.reason}: {body_text}") from e


def _delete(table: str, filters: dict[str, Any]) -> None:
    """DELETE FROM table WHERE col = value AND ..."""
    params = {f"{k}": f"eq.{v}" for k, v in filters.items()}
    _request("DELETE", f"/{table}", params=params)


def _insert(table: str, rows: list[dict], batch_size: int = 500) -> int:
    """Insert en lotes; devuelve filas insertadas."""
    if not rows:
        return 0
    inserted = 0
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        _request(
            "POST", f"/{table}", body=chunk,
        )
        inserted += len(chunk)
    return inserted


def delete_and_insert(table: str, filters: dict[str, Any], rows: list[dict]) -> int:
    """Mismo patrón que V2: borra el slot identificado por filters y reinserta."""
    _delete(table, filters)
    return _insert(table, rows)


# --- Mappers: parser output → DB schema -----------------------------------

def _to_inventario_record(parsed: dict, fecha: date, turno: int, momento: str) -> dict:
    """Traduce salida de parse_sap → fila de inventario_liquido / inventario_envase."""
    return {
        "fecha": fecha.isoformat() if isinstance(fecha, date) else fecha,
        "turno": turno,
        "momento": momento,
        "sku": parsed["material"],
        "descripcion": parsed.get("descripcion"),
        "unidad": parsed.get("umb"),
        "stock_libre": parsed.get("libre_utilizacion"),
        "stock_bloqueado": parsed.get("bloqueado"),
        "stock_calidad": parsed.get("en_ctrl_calidad"),
    }


_CONCILIACION_KEYS = (
    "fecha", "turno", "momento",
    "presentacion", "sku", "descripcion",
    "factor", "total",
    "tarimas_comp_t1", "restos_t1",
    "tarimas_comp_t2", "restos_t2",
    "fisico_total",
)


def _conciliacion_row(**values) -> dict:
    """Garantiza que todas las filas tengan las mismas llaves (PostgREST lo exige)."""
    return {k: values.get(k) for k in _CONCILIACION_KEYS}


def _to_conciliacion_records(parsed_rows: list[dict], fecha: date, turno: int, momento: str) -> list[dict]:
    """
    Traduce salida de parse_conciliacion → filas de conciliacion_envase.

    El schema de V2 separa tarimas/restos por turno (t1 vs t2). Llenamos
    el par correspondiente al turno actual y dejamos el otro en None.
    También agregamos una fila TOTAL con fisico_total = suma de los
    total_cajas, para que el dashboard que ya existe siga viendo el
    agregado.
    """
    fecha_str = fecha.isoformat() if isinstance(fecha, date) else fecha
    out: list[dict] = []
    suma_total = 0
    for r in parsed_rows:
        total_cajas = r.get("total_cajas") or 0
        suma_total += int(total_cajas)
        kwargs = {
            "fecha": fecha_str,
            "turno": turno,
            "momento": momento,
            # presentacion es NOT NULL en el schema; el archivo a veces la deja vacía.
            "presentacion": r.get("presentacion") or "",
            "sku": r["sku"],
            "descripcion": r.get("descripcion"),
            "factor": r.get("factor"),
            "total": total_cajas,
        }
        if turno == 1:
            kwargs["tarimas_comp_t1"] = r.get("tarimas_completas") or 0
            kwargs["restos_t1"] = r.get("restos") or 0
        elif turno == 2:
            kwargs["tarimas_comp_t2"] = r.get("tarimas_completas") or 0
            kwargs["restos_t2"] = r.get("restos") or 0
        out.append(_conciliacion_row(**kwargs))

    # Fila agregada (mantiene el comportamiento histórico de V2).
    out.append(_conciliacion_row(
        fecha=fecha_str,
        turno=turno,
        momento=momento,
        presentacion="Fin SAP",
        sku="TOTAL",
        fisico_total=suma_total or None,
    ))
    return out


# --- Dispatch público ------------------------------------------------------

# tipo (clasificador) → tabla destino
TIPO_TO_TABLE = {
    "sap_2000": "inventario_liquido",
    "sap_2010": "inventario_envase",
    "conciliacion_envase": "conciliacion_envase",
}

# Tipos que ya tienen parser Python listo. Los demás se ignoran por ahora
# (siguen entrando por upload manual de V2).
SUPPORTED_TIPOS = set(TIPO_TO_TABLE.keys())


def upload_records(tipo: str, parsed: list[dict], fecha: date, turno: int, momento: str) -> int:
    """
    Sube records de un parser a Supabase. Pisa el slot (fecha,turno,momento)
    igual que el upload manual de V2.

    Devuelve la cantidad de filas insertadas.
    """
    if tipo not in TIPO_TO_TABLE:
        raise SupabaseError(f"Tipo no soportado para upload: {tipo}")

    table = TIPO_TO_TABLE[tipo]

    if tipo in ("sap_2000", "sap_2010"):
        rows = [_to_inventario_record(p, fecha, turno, momento) for p in parsed]
    elif tipo == "conciliacion_envase":
        rows = _to_conciliacion_records(parsed, fecha, turno, momento)
    else:
        raise SupabaseError(f"Sin mapper para tipo: {tipo}")

    fecha_str = fecha.isoformat() if isinstance(fecha, date) else fecha
    return delete_and_insert(
        table,
        {"fecha": fecha_str, "turno": turno, "momento": momento},
        rows,
    )


def log_upload(tipo: str, registros: int, fecha: date, turno: int, momento: str) -> None:
    """Registra el ingest en upload_log para auditoría. uploaded_by=null marca origen automático.

    IMPORTANTE: la página /upload de V2 lee upload_log.tipo_archivo para
    pintar los checks verdes del checklist. Espera los nombres canónicos de
    V2 (inventario_liquido, inventario_envase, conciliacion_envase). Si
    escribimos nuestros tipos internos (sap_2000, sap_2010), el checklist
    los muestra como NO CARGADOS aunque la data esté en su tabla.
    """
    # Mapear tipo interno (sap_2000, sap_2010) al tipo canónico de V2 (inventario_liquido,
    # inventario_envase). Para los tipos donde el nombre coincide (conciliacion_envase) es no-op.
    v2_tipo = TIPO_TO_TABLE.get(tipo, tipo)
    fecha_str = fecha.isoformat() if isinstance(fecha, date) else fecha
    _insert("upload_log", [{
        "tipo_archivo": v2_tipo,
        "registros": registros,
        "uploaded_by": None,  # null = ingestor automático (vs UUID de usuario en upload manual)
        "fecha": fecha_str,
        "turno": turno,
        "momento": momento,
    }])
