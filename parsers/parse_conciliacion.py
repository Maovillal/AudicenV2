"""
Parser para el archivo de conciliación de envase (.xlsx).

El archivo tiene 518+ pestañas (una por día). Solo se lee la ÚLTIMA pestaña,
que corresponde al conteo más reciente. La primera fila que contiene los
encabezados ("Presentacion", "SKU", "Descripcion", etc.) puede no estar en
la fila 1 — buscamos la fila de header dinámicamente.

Salida: lista de dicts con
    sku, descripcion, presentacion, tarimas_completas, restos, factor, total_cajas
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

import openpyxl


# Tokens de header que pueden aparecer (incluye typos vistos en archivos reales).
HEADER_TOKENS = {
    "presentacion": "presentacion",
    "sku": "sku",
    "descripcion": "descripcion",
    "descrpcion": "descripcion",
    "tarimas_comp": "tarimas_completas",
    "tarimas_completas": "tarimas_completas",
    "restos": "restos",
    "total_comp": "total_completas",
    "total": "total_cajas",
}

# Tokens que marcan el inicio de la sección de resumen — al verlos, dejamos de leer.
SUMMARY_TOKENS = {"fisico", "sistema", "diferencia"}


def _norm_cell(v) -> str:
    if v is None:
        return ""
    return re.sub(r"\s+", "_", str(v).strip().lower())


def _is_header_row(row: tuple) -> bool:
    """Una fila es header si contiene SKU + (Presentacion o Descripcion)."""
    norms = {_norm_cell(c) for c in row if c is not None}
    has_sku = "sku" in norms
    has_other = bool(norms & {"presentacion", "descripcion", "descrpcion"})
    return has_sku and has_other


def _build_col_map(header: tuple) -> dict[str, int]:
    """Mapea nombre canónico → índice de columna. La primera coincidencia gana."""
    col_map: dict[str, int] = {}
    for i, cell in enumerate(header):
        norm = _norm_cell(cell)
        if norm in HEADER_TOKENS:
            canonical = HEADER_TOKENS[norm]
            if canonical not in col_map:
                col_map[canonical] = i
    return col_map


def _extract_factor(presentacion: Optional[str]) -> Optional[int]:
    """De 'Caguama x77' → 77. Retorna None si no se puede extraer."""
    if not presentacion:
        return None
    m = re.search(r"x\s*(\d+)", str(presentacion), flags=re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


def _to_int(v) -> Optional[int]:
    if v is None or v == "":
        return None
    if isinstance(v, str):
        s = v.strip().replace(",", "")
        if not s:
            return None
        # Si quedó una fórmula sin evaluar (data_only=False fallback), descartar.
        if s.startswith("="):
            return None
        try:
            return int(float(s))
        except ValueError:
            return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None


def parse_conciliacion(file_path: str | Path) -> list[dict]:
    """
    Parsea la última pestaña del archivo de conciliación de envase.
    Lee en read_only para soportar archivos con cientos de pestañas.
    """
    path = Path(file_path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheet_name = wb.sheetnames[-1]
        ws = wb[sheet_name]

        # Materializamos las filas porque iter_rows en read_only es forward-only
        # y necesitamos ubicar el header antes de los datos.
        rows = [tuple(r) for r in ws.iter_rows(values_only=True)]
    finally:
        wb.close()

    header_idx = next((i for i, r in enumerate(rows) if _is_header_row(r)), None)
    if header_idx is None:
        raise ValueError(
            f"No se encontró fila de header en pestaña '{sheet_name}' de {path.name}"
        )

    header = rows[header_idx]
    col_map = _build_col_map(header)

    results: list[dict] = []
    for row in rows[header_idx + 1:]:
        if not row or all(c is None or c == "" for c in row):
            continue

        # ¿Llegamos a la sección de resumen?
        first_norms = {_norm_cell(c) for c in row[:3] if c is not None}
        if first_norms & SUMMARY_TOKENS:
            break

        sku_idx = col_map.get("sku")
        if sku_idx is None or sku_idx >= len(row):
            continue
        sku_raw = row[sku_idx]
        if sku_raw is None or str(sku_raw).strip() == "":
            continue
        sku = str(sku_raw).strip()
        # Saltar filas donde SKU no es un identificador real (encabezados de sección).
        if not re.search(r"\d", sku):
            continue

        def cell(name: str):
            i = col_map.get(name)
            if i is None or i >= len(row):
                return None
            return row[i]

        presentacion = cell("presentacion")
        if isinstance(presentacion, str):
            presentacion = presentacion.strip()

        descripcion = cell("descripcion")
        if isinstance(descripcion, str):
            descripcion = descripcion.strip()

        record = {
            "sku": sku,
            "descripcion": descripcion,
            "presentacion": presentacion,
            "tarimas_completas": _to_int(cell("tarimas_completas")) or 0,
            "restos": _to_int(cell("restos")) or 0,
            "factor": _extract_factor(presentacion),
            "total_cajas": _to_int(cell("total_cajas")),
        }

        # Si no llegó "total" en el archivo pero tenemos factor + tarimas + restos,
        # calcularlo: cajas = tarimas_completas * factor + restos.
        if record["total_cajas"] is None and record["factor"] is not None:
            record["total_cajas"] = record["tarimas_completas"] * record["factor"] + record["restos"]

        results.append(record)

    return results


if __name__ == "__main__":
    import json
    import sys

    if len(sys.argv) < 2:
        print("Uso: python parse_conciliacion.py <archivo.xlsx>")
        sys.exit(1)

    out = parse_conciliacion(sys.argv[1])
    print(f"Filas parseadas: {len(out)}")
    print(json.dumps(out[:5], indent=2, ensure_ascii=False, default=str))
