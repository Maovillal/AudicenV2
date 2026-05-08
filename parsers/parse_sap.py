"""
Parser para archivos de inventario SAP (almacén 2000 = líquido, 2010 = envase).

Los archivos vienen con extensión .XLS pero NO son Excel binarios — son
texto plano UTF-16 Little Endian, separado por tabs, exportado directo de SAP.

Salida: lista de dicts con las llaves
    material, descripcion, almacen, umb,
    libre_utilizacion, bloqueado, en_ctrl_calidad
"""

from __future__ import annotations

from io import StringIO
from pathlib import Path
from typing import Optional

import pandas as pd


# Mapeo flexible: cualquier header normalizado del SAP → nombre canónico.
# El SAP a veces cambia el orden o agrega espacios — normalizamos antes de mapear.
HEADER_MAP = {
    "material": "material",
    "texto_breve_de_material": "descripcion",
    "texto_breve_mat": "descripcion",
    "descripcion": "descripcion",
    "alm": "almacen",
    "almacen": "almacen",
    "umb": "umb",
    "librutiliz": "libre_utilizacion",
    "libr_utiliz": "libre_utilizacion",
    "libre_utilizacion": "libre_utilizacion",
    "bloqueado": "bloqueado",
    "en_ctrlcal": "en_ctrl_calidad",
    "en_ctrl_cal": "en_ctrl_calidad",
    "en_control_calidad": "en_ctrl_calidad",
}

NUMERIC_FIELDS = ("libre_utilizacion", "bloqueado", "en_ctrl_calidad")


def _normalize_header(h: str) -> str:
    return (
        str(h).strip().lower()
        .replace(".", "")
        .replace(" ", "_")
        .replace("__", "_")
    )


def _decode_utf16(raw: bytes) -> str:
    # Saltar BOM \xff\xfe si está presente.
    if raw.startswith(b"\xff\xfe"):
        raw = raw[2:]
    return raw.decode("utf-16-le", errors="replace")


def _clean_number(val) -> Optional[float]:
    """Convierte '1,129.9' → 1129.9. Retorna None si vacío o no parseable."""
    if val is None:
        return None
    s = str(val).strip()
    if not s or s in ("-", "*"):
        return None
    # SAP usa coma como separador de miles; eliminarla.
    s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _is_total_row(row: pd.Series) -> bool:
    """Una fila es total si alguna celda contiene un '*' aislado."""
    for v in row:
        if isinstance(v, str) and v.strip() == "*":
            return True
    return False


def parse_sap(file_path: str | Path, almacen_hint: Optional[int] = None) -> list[dict]:
    """
    Parsea un archivo SAP 2000 o 2010 y retorna una lista de filas limpias.

    almacen_hint: si se conoce el almacén (2000 o 2010), se usa para llenar el
    campo 'almacen' cuando la columna Alm. del archivo viene vacía.
    """
    path = Path(file_path)
    raw = path.read_bytes()
    text = _decode_utf16(raw)

    df = pd.read_csv(StringIO(text), sep="\t", dtype=str, keep_default_na=False)

    # Normalizar headers y mapear a nombres canónicos.
    canonical_cols: dict[str, str] = {}
    for col in df.columns:
        norm = _normalize_header(col)
        if norm in HEADER_MAP:
            canonical_cols[col] = HEADER_MAP[norm]

    if "material" not in canonical_cols.values():
        raise ValueError(
            f"No se encontró columna Material en {path.name}. "
            f"Headers detectados: {list(df.columns)}"
        )

    # Filtrar filas de totales (contienen '*').
    df = df[~df.apply(_is_total_row, axis=1)].copy()

    rows: list[dict] = []
    for _, r in df.iterrows():
        out: dict = {
            "material": None,
            "descripcion": None,
            "almacen": almacen_hint,
            "umb": None,
            "libre_utilizacion": None,
            "bloqueado": None,
            "en_ctrl_calidad": None,
        }
        for src_col, canonical in canonical_cols.items():
            val = r[src_col]
            if canonical in NUMERIC_FIELDS:
                out[canonical] = _clean_number(val)
            else:
                s = str(val).strip() if val is not None else ""
                out[canonical] = s or None

        # Saltar filas sin material (líneas vacías o residuales).
        if not out["material"]:
            continue

        # Convertir almacen a int cuando viene como string.
        if isinstance(out["almacen"], str):
            try:
                out["almacen"] = int(out["almacen"])
            except ValueError:
                pass

        rows.append(out)

    return rows


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Uso: python parse_sap.py <archivo.XLS> [almacen_hint]")
        sys.exit(1)

    hint = int(sys.argv[2]) if len(sys.argv) > 2 else None
    out = parse_sap(sys.argv[1], almacen_hint=hint)
    print(f"Filas parseadas: {len(out)}")
    print(json.dumps(out[:5], indent=2, ensure_ascii=False, default=str))
