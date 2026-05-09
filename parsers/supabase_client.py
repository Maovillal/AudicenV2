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
    "fisico_total", "sistema_total", "diferencia_total",
)


def _conciliacion_row(**values) -> dict:
    """Garantiza que todas las filas tengan las mismas llaves (PostgREST lo exige)."""
    base = {k: None for k in _CONCILIACION_KEYS}
    base.update(values)
    # presentacion es NOT NULL en el schema.
    if base.get("presentacion") is None:
        base["presentacion"] = ""
    return base


def _to_conciliacion_records(parsed: dict, fecha: date, turno: int, momento: str) -> list[dict]:
    """
    Traduce salida de parse_conciliacion (dict con sub-dicts t1 y t2) → una
    fila de conciliacion_envase con los totales del recuadro correspondiente
    al turno + momento del correo.

    Reglas (validadas con el supervisor 2026-05-08):
    - INICIO_T1 / CIERRE_T1: la celda Fisico del recuadro T1 se sobrescribe
      entre mañana y tarde. El subject distingue qué snapshot es. Guardamos
      Fisico, Fin SAP y Diferencia tal como están en el archivo en ese
      momento.
    - INICIO_T2: solo el Inicio SAP del recuadro T2 está poblado.
    - CIERRE_T2: el Fin SAP y la Diferencia del recuadro T2 ya están
      poblados. El Fisico de T2 vive en otro Excel (queda None aquí).

    Las filas por SKU y la tabla auxiliar de movimientos están fuera de
    scope por ahora.
    """
    fecha_str = fecha.isoformat() if isinstance(fecha, date) else fecha
    t1 = parsed.get("t1", {}) or {}
    t2 = parsed.get("t2", {}) or {}

    base_fields = dict(
        fecha=fecha_str,
        turno=turno,
        momento=momento,
        presentacion="Recuadro Totales",
        sku="TOTAL",
    )

    if turno == 1:
        return [_conciliacion_row(
            **base_fields,
            fisico_total=t1.get("fisico"),
            sistema_total=t1.get("fin_sap"),
            diferencia_total=t1.get("diferencia"),
        )]

    if turno == 2:
        if momento == "inicio":
            return [_conciliacion_row(
                **base_fields,
                sistema_total=t2.get("inicio_sap"),
            )]
        # cierre
        return [_conciliacion_row(
            **base_fields,
            # fisico_total para T2 cierre vive en otro Excel; queda None
            sistema_total=t2.get("fin_sap"),
            diferencia_total=t2.get("diferencia"),
        )]

    # Turno desconocido: una fila vacía marcadora.
    return [_conciliacion_row(**base_fields)]


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
