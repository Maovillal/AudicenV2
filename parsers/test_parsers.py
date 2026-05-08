"""
Tests rápidos para los parsers.

Uso:
    # Con datos sintéticos (no requiere archivos reales):
    python test_parsers.py

    # Con un archivo real:
    python test_parsers.py sap path/al/archivo.XLS [almacen_hint]
    python test_parsers.py conciliacion path/al/archivo.xlsx
    python test_parsers.py classify path/al/archivo
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import openpyxl

from classifier import AmbiguousClassificationError, classify
from parse_conciliacion import parse_conciliacion
from parse_sap import parse_sap


# --- Fixtures sintéticos ---------------------------------------------------

def _make_synthetic_sap_xls(path: Path, almacen: int = 2000) -> None:
    """Genera un .XLS UTF-16-LE TSV imitando una exportación de SAP."""
    headers = ["Ce.", "Material", "Texto breve de material", "Alm.", "UMB",
               "LibrUtiliz", "Bloqueado", "En CtrlCal"]
    body = [
        ["5618", "100123", "CARTA BLANCA 24/355",  str(almacen), "CJ", "1,129.9",   "0",   "0"],
        ["5618", "100124", "TECATE 24/355",        str(almacen), "CJ", "523",       "10",  "0"],
        ["5618", "100125", "INDIO 24/355",         str(almacen), "CJ", "0",         "0",   "5"],
        # Fila de totales (debe filtrarse)
        ["",     "",       "",                     "",           "",   "*",         "",    ""],
    ]
    text = "\t".join(headers) + "\r\n" + "\r\n".join("\t".join(r) for r in body) + "\r\n"
    raw = b"\xff\xfe" + text.encode("utf-16-le")
    path.write_bytes(raw)


def _make_synthetic_conciliacion_xlsx(path: Path) -> None:
    wb = openpyxl.Workbook()
    # Simula varias pestañas viejas; solo la última debe leerse.
    wb.active.title = "01.05.2026"
    wb.active["A1"] = "datos viejos"
    last = wb.create_sheet("07.05.2026")

    # Algunas filas de preámbulo y luego el header en la fila 7 (como dice CLAUDE.md).
    last["A1"] = "Conciliación de Envase"
    last["A3"] = "Fecha: 07/05/2026"
    last["A7"] = "Presentacion"
    last["B7"] = "SKU"
    last["C7"] = "Descripcion"
    last["D7"] = "Tarimas Comp"
    last["E7"] = "Restos"
    last["F7"] = "Total"

    rows = [
        ("Caguama x77",  "200001", "CARTA BLANCA CAG 12/940",   3,  10, None),
        ("Cuartito x171","200002", "TECATE CUARTO 24/250",      5,  20, None),
        ("Media x128",   "200003", "INDIO MEDIA 24/325",        2,   0, 256),
        ("Bohemia x180", "200004", "BOHEMIA 24/355",            1,  50, None),
    ]
    for i, r in enumerate(rows, start=8):
        for j, val in enumerate(r):
            last.cell(row=i, column=j + 1, value=val)

    # Sección de resumen — el parser debe detenerse aquí.
    last["A14"] = "Fisico"
    last["B14"] = 1234
    last["A15"] = "Sistema"
    last["B15"] = 1230
    last["A16"] = "Diferencia"
    last["B16"] = 4

    wb.save(path)


# --- Tests -----------------------------------------------------------------

def test_classifier() -> None:
    cases = [
        ("2000_02_05_2026_INICIO.XLS",          ("sap_2000",            1, "inicio", "2026-05-02")),
        ("2010__TURNO_2_CIERRE_02_05_26.XLS",   ("sap_2010",            2, "cierre", "2026-05-02")),
        ("Inicio_CONCILIACION_ENVASE_2026.xlsx",("conciliacion_envase", 1, "inicio", None)),
        ("CONCILIACION_ENVASE_2026.xlsx",       ("conciliacion_envase", 2, "cierre", None)),
        ("2000_fin_de_turno.XLS",               ("sap_2000",            3, "cierre", None)),
        ("02_2026_TARDE__MAYO__-FIN.xlsx",      ("vertical_liquido",    3, "cierre", "2026-05-02")),
        ("Indicador_nivel_de_Servicio_Rutas_MAYO_2026.xlsx",
                                                ("nivel_servicio",   None, None,     None)),
        ("Ingreso_Envase__MAYO__2026_GP.xlsx",  ("ingreso_envase",   None, None,     None)),
        # Convención nueva: marcador T1/T3 explícito en SAP cierre.
        ("2000_T1_CIERRE_02_05_2026.XLS",       ("sap_2000",            1, "cierre", "2026-05-02")),
        ("2000_T3_CIERRE_02_05_2026.XLS",       ("sap_2000",            3, "cierre", "2026-05-02")),
    ]
    failures = 0
    for filename, expected in cases:
        c = classify(filename)
        actual = (
            c.tipo, c.turno, c.momento,
            c.fecha.isoformat() if c.fecha else None,
        )
        ok = actual == expected
        mark = "OK" if ok else "FAIL"
        print(f"  [{mark}] {filename}")
        if not ok:
            print(f"        esperado: {expected}")
            print(f"        actual:   {actual}")
            failures += 1

    # Caso ambiguo: SAP cierre sin marcador → debe levantar error.
    ambiguous = "2000_CIERRE_02_05_2026.XLS"
    try:
        classify(ambiguous)
    except AmbiguousClassificationError:
        print(f"  [OK] {ambiguous} → AmbiguousClassificationError (esperado)")
    else:
        print(f"  [FAIL] {ambiguous} debió levantar AmbiguousClassificationError")
        failures += 1

    if failures:
        raise AssertionError(f"classifier: {failures} casos fallaron")


def test_parse_sap() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "synthetic_2000.XLS"
        _make_synthetic_sap_xls(path, almacen=2000)
        rows = parse_sap(path, almacen_hint=2000)

    assert len(rows) == 3, f"esperaba 3 filas (sin totales), obtuve {len(rows)}"
    r0 = rows[0]
    assert r0["material"] == "100123"
    assert r0["descripcion"] == "CARTA BLANCA 24/355"
    assert r0["almacen"] == 2000
    assert r0["umb"] == "CJ"
    assert r0["libre_utilizacion"] == 1129.9, f"limpieza de coma falló: {r0}"
    assert r0["bloqueado"] == 0.0
    assert r0["en_ctrl_calidad"] == 0.0
    assert rows[1]["libre_utilizacion"] == 523.0
    assert rows[2]["en_ctrl_calidad"] == 5.0
    print(f"  [OK] parse_sap: {len(rows)} filas, totales filtrados, números limpios")


def test_parse_conciliacion() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "synthetic_conciliacion.xlsx"
        _make_synthetic_conciliacion_xlsx(path)
        rows = parse_conciliacion(path)

    assert len(rows) == 4, f"esperaba 4 filas (resumen ignorado), obtuve {len(rows)}"
    by_sku = {r["sku"]: r for r in rows}

    r1 = by_sku["200001"]
    assert r1["presentacion"] == "Caguama x77"
    assert r1["factor"] == 77
    assert r1["tarimas_completas"] == 3
    assert r1["restos"] == 10
    # 3 * 77 + 10 = 241 (computado porque la fila no traía Total).
    assert r1["total_cajas"] == 241, f"total computado: {r1}"

    r3 = by_sku["200003"]
    assert r3["factor"] == 128
    assert r3["total_cajas"] == 256, "Total venía en el archivo, no se debe sobrescribir"

    print(f"  [OK] parse_conciliacion: {len(rows)} filas, resumen ignorado, factor extraído")


# --- Modo CLI: parsear archivo real ----------------------------------------

def _run_real(mode: str, path: str, *extra: str) -> None:
    if mode == "classify":
        print(json.dumps(classify(path).to_dict(), indent=2, ensure_ascii=False))
    elif mode == "sap":
        hint = int(extra[0]) if extra else None
        out = parse_sap(path, almacen_hint=hint)
        print(f"Filas: {len(out)}")
        print(json.dumps(out[:5], indent=2, ensure_ascii=False, default=str))
    elif mode == "conciliacion":
        out = parse_conciliacion(path)
        print(f"Filas: {len(out)}")
        print(json.dumps(out[:5], indent=2, ensure_ascii=False, default=str))
    else:
        print(f"Modo desconocido: {mode}")
        sys.exit(2)


def main() -> None:
    if len(sys.argv) > 1:
        _run_real(sys.argv[1], sys.argv[2], *sys.argv[3:])
        return

    print("→ classifier")
    test_classifier()
    print("→ parse_sap (datos sintéticos)")
    test_parse_sap()
    print("→ parse_conciliacion (datos sintéticos)")
    test_parse_conciliacion()
    print("\nTodos los tests pasaron.")


if __name__ == "__main__":
    main()
