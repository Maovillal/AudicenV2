"""
Clasificador de archivos de reportes de almacén.

Recibe un nombre de archivo y determina:
- tipo de reporte (sap_2000, sap_2010, conciliacion_envase, vertical_liquido,
  nivel_servicio, ingreso_envase)
- turno (1, 2, 3) cuando aplica
- momento (inicio, cierre) cuando aplica
- fecha cuando puede inferirse del nombre

Los archivos mensuales (nivel_servicio, ingreso_envase) no llevan turno ni
fecha en el nombre — esos campos quedan en None y la fecha se deriva de la
pestaña al parsear.

Convención de nombre obligatoria
--------------------------------
SAP 2000 tiene dos cierres al día (T1 que también es inicio de T2, y T3
fin de día). Para evitar mezclar snapshots, el filename DEBE marcar el
turno explícitamente. Patrones aceptados:

    INICIO             → T1 inicio (no requiere marcador, el 2000 solo se
                         snapshotea al inicio del T1)
    fin_de_turno / FIN → T3 cierre (alias histórico para fin de día)
    T1, T2, T3         → marcador explícito (ej. 2000_T1_CIERRE_...)
    TURNO_1/2/3        → marcador explícito (estilo 2010)

Si llega un archivo SAP con "CIERRE" pero sin marcador de turno y sin
"fin_de_turno", se levanta AmbiguousClassificationError. La política
es fallar fuerte: preferimos un error en el ingest que un snapshot
silenciosamente etiquetado mal.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from datetime import date
from pathlib import Path
from typing import Optional


MONTHS_ES = {
    "ENERO": 1, "FEBRERO": 2, "MARZO": 3, "ABRIL": 4,
    "MAYO": 5, "JUNIO": 6, "JULIO": 7, "AGOSTO": 8,
    "SEPTIEMBRE": 9, "OCTUBRE": 10, "NOVIEMBRE": 11, "DICIEMBRE": 12,
}

TIPOS = {
    "sap_2000",
    "sap_2010",
    "conciliacion_envase",
    "vertical_liquido",
    "nivel_servicio",
    "ingreso_envase",
    "unknown",
}


class AmbiguousClassificationError(ValueError):
    """Se levanta cuando el filename no permite decidir turno con seguridad."""


@dataclass
class Classification:
    tipo: str
    turno: Optional[int]
    momento: Optional[str]
    fecha: Optional[date]
    filename: str

    def to_dict(self) -> dict:
        d = asdict(self)
        if self.fecha is not None:
            d["fecha"] = self.fecha.isoformat()
        return d


def _norm(name: str) -> str:
    """Normaliza un nombre para matching: minúsculas, espacios → _, sin extensión."""
    stem = Path(name).stem
    return stem.lower().replace(" ", "_").replace("-", "_")


def _detect_tipo(norm: str) -> str:
    # Orden importa: patrones más específicos primero.
    if "conciliacion" in norm and "envase" in norm:
        return "conciliacion_envase"
    if "indicador" in norm or ("nivel" in norm and "servicio" in norm):
        return "nivel_servicio"
    if "ingreso" in norm and "envase" in norm:
        return "ingreso_envase"
    if norm.startswith("2000"):
        return "sap_2000"
    if norm.startswith("2010"):
        return "sap_2010"
    # Vertical de líquido: archivo .xlsx con mes en español + indicador de fin/tarde.
    has_month = any(m.lower() in norm for m in MONTHS_ES)
    has_fin = "fin" in norm or "tarde" in norm
    if has_month and has_fin:
        return "vertical_liquido"
    return "unknown"


def _detect_turno_momento(norm: str, tipo: str) -> tuple[Optional[int], Optional[str]]:
    if tipo in ("nivel_servicio", "ingreso_envase"):
        # Reportes mensuales sin turno explícito.
        return (None, None)

    if tipo == "vertical_liquido":
        # Vertical de líquido se llena al cierre del día (T3 cierre).
        return (3, "cierre")

    if tipo == "conciliacion_envase":
        if "inicio" in norm:
            return (1, "inicio")
        # Sin prefijo "Inicio" → conteo de cierre del día (T2 cierre por convención).
        return (2, "cierre")

    if tipo in ("sap_2000", "sap_2010"):
        # Marcador explícito de turno: "TURNO_N" (estilo 2010) o "_TN_" (corto).
        m = re.search(r"turno_(\d)", norm) or re.search(r"(?:^|_)t(\d)(?:_|$)", norm)
        is_inicio = "inicio" in norm
        is_cierre = "cierre" in norm
        is_fin = "fin_de_turno" in norm or norm.endswith("_fin") or "_fin_" in norm

        if m:
            turno = int(m.group(1))
            momento = "inicio" if is_inicio else ("cierre" if is_cierre or is_fin else None)
            return (turno, momento)

        # Sin marcador explícito: solo dos casos seguros para 2000.
        if is_inicio and not is_cierre:
            # El 2000 solo se snapshotea al inicio en T1.
            return (1, "inicio")
        if is_fin:
            # "fin_de_turno" / "_FIN" → fin de día, T3 cierre.
            return (3, "cierre")
        if is_cierre:
            # Ambiguo: podría ser T1 cierre o T3 cierre. No adivinar.
            raise AmbiguousClassificationError(
                f"SAP cierre sin marcador de turno: '{norm}'. "
                "Renombra incluyendo T1/T2/T3 (ej. 2000_T1_CIERRE_dd_mm_yyyy.XLS) "
                "o usa 'fin_de_turno' para el cierre de T3."
            )

    return (None, None)


def _detect_fecha(norm: str) -> Optional[date]:
    # Patrón dd_mm_yyyy: "02_05_2026"
    m = re.search(r"(\d{2})_(\d{2})_(20\d{2})(?!\d)", norm)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return _safe_date(y, mo, d)

    # Patrón dd_mm_yy: "02_05_26" (no precedido ni seguido por dígito)
    m = re.search(r"(?<!\d)(\d{2})_(\d{2})_(\d{2})(?!\d)", norm)
    if m:
        d, mo, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # Asumimos siglo 2000.
        return _safe_date(2000 + yy, mo, d)

    # Patrón dd_yyyy con nombre de mes: "02_2026_..._MAYO_..."
    m_dy = re.search(r"(?<!\d)(\d{2})_(20\d{2})(?!\d)", norm)
    if m_dy:
        for name, num in MONTHS_ES.items():
            if name.lower() in norm:
                d, y = int(m_dy.group(1)), int(m_dy.group(2))
                return _safe_date(y, num, d)

    return None


def _safe_date(year: int, month: int, day: int) -> Optional[date]:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def classify(filename: str) -> Classification:
    """Clasifica un archivo según su nombre."""
    norm = _norm(filename)
    tipo = _detect_tipo(norm)
    turno, momento = _detect_turno_momento(norm, tipo)
    fecha = _detect_fecha(norm)
    return Classification(
        tipo=tipo,
        turno=turno,
        momento=momento,
        fecha=fecha,
        filename=filename,
    )


if __name__ == "__main__":
    samples = [
        "2000_02_05_2026_INICIO.XLS",
        "2010__TURNO_2_CIERRE_02_05_26.XLS",
        "Inicio_CONCILIACION_ENVASE_2026.xlsx",
        "CONCILIACION_ENVASE_2026.xlsx",
        "2000_fin_de_turno.XLS",
        "02_2026_TARDE__MAYO__-FIN.xlsx",
        "Indicador_nivel_de_Servicio_Rutas_MAYO_2026.xlsx",
        "Ingreso_Envase__MAYO__2026_GP.xlsx",
    ]
    for s in samples:
        print(s, "→", classify(s).to_dict())
