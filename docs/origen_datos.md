# Origen de los datos por reporte

Documento que asienta de dónde sale cada valor de cada Excel y cómo se mapea a Supabase, para que las comparaciones de la página `/comprobacion` sean correctas.

Se va llenando reporte por reporte conforme se valida con el equipo.

---

## 1. SAP 2000 — Inventario Líquido (validado 2026-05-08)

**Origen:** exportación directa del SAP corporativo de Heineken. Archivo `.XLS` que NO es Excel binario — es texto plano UTF-16 separado por tabs.

**Frecuencia:** se exporta varias veces al día. Lo procesa Audicen en T1 inicio, T1 cierre y T3 cierre (la misma exportación de SAP, en diferentes momentos del día).

**Almacén:** 2000 (líquido — cervezas terminadas listas para distribución).

**SKUs por exportación:** ~165.

### Columnas que vienen en el archivo

| Columna | Descripción | Ejemplo |
|---|---|---|
| (col 1, vacía) | reservada para `*` de filas de totales | — |
| (col 2, vacía) | reservada | — |
| `Ce.` | centro / agencia | `MCMI` |
| `Material` | código del SKU en SAP | `139011` |
| `Texto breve de material` | descripción del producto | `TECATE LIGHT 1x12 LAT 355ml V` |
| `Alm.` | almacén SAP | `2000` (constante) |
| `UMB` | unidad de medida base | `CJ` (caja) |
| `LibrUtiliz` | stock LIBRE de utilización | `29929.093` |
| `Bloqueado` | stock bloqueado (no se puede vender hasta que se libere) | `30.330` |
| `En CtrlCal` | stock en control de calidad (esperando aprobación) | `9.004` |

### Mapeo a Supabase (`inventario_liquido`)

| Columna del Excel | Columna en DB |
|---|---|
| `Material` | `sku` |
| `Texto breve de material` | `descripcion` |
| `UMB` | `unidad` |
| `LibrUtiliz` | `stock_libre` |
| `Bloqueado` | `stock_bloqueado` |
| `En CtrlCal` | `stock_calidad` |

**Se ignoran:** `Ce.` (siempre `MCMI`), `Alm.` (siempre `2000`, redundante con la tabla destino), columnas vacías, filas con `*` (son los totales que SAP imprime al final).

### Reglas de comparación importantes

**El stock total real de un SKU = `stock_libre + stock_bloqueado + stock_calidad`** — siempre los tres sumados, no solo el libre. Esta es la regla que se usa en `/comprobacion` y en el cruce contra el conteo físico (`conteo_fisico`).

(Ver BUG-003 en `BUGS.md` — antes V2 sumaba solo `stock_libre` y ese era el bug.)

---

## 2. SAP 2010 — Inventario Envase (validado 2026-05-08)

**Origen:** mismo SAP corporativo de Heineken, exportación distinta (almacén 2010). Mismo formato `.XLS` UTF-16 TSV.

**Frecuencia:** se exporta en T1 inicio, T1 cierre y T2 cierre (envase se monitorea más seguido por las salidas de las rutas).

**Almacén:** 2010 (envase retornable — bultos vacíos, cuartos, medias, tarimas físicas).

**SKUs por exportación:** ~14.

### Columnas que vienen en el archivo

| Columna | Descripción | Ejemplo |
|---|---|---|
| `Material` | código del SKU en SAP | `170264` |
| `Texto breve de material` | descripción del envase | `ENV GENERICO CCM Lt/4` |
| `Alm.` | almacén | `2010` (constante) |
| `Ce.` | centro / agencia | `MCMI` |
| `UMB` | unidad | `CJ` para envases, `PZA` para tarimas físicas |
| `LibrUtiliz` | stock libre | `2706.0` |
| `En CtrlCal` | en control calidad (casi siempre `0`) | `0.0` |
| `Bloqueado` | bloqueado (casi siempre `0`) | `0.0` |

⚠️ **El orden de columnas es DIFERENTE al SAP 2000** — `En CtrlCal` y `Bloqueado` vienen invertidos, y `Material` viene antes que `Ce.`. El parser usa los nombres de columna (no posición), así que es transparente.

### Mapeo a Supabase (`inventario_envase`)

Idéntico al SAP 2000:

| Columna del Excel | Columna en DB |
|---|---|
| `Material` | `sku` |
| `Texto breve de material` | `descripcion` |
| `UMB` | `unidad` (mantiene `CJ` o `PZA`) |
| `LibrUtiliz` | `stock_libre` |
| `Bloqueado` | `stock_bloqueado` |
| `En CtrlCal` | `stock_calidad` |

### Notas operativas

- **Tarimas físicas (UMB=`PZA`)** entran a la misma tabla `inventario_envase`, no se separan. La comprobación las maneja igual que un envase más, contando piezas en lugar de cajas.
- **`En CtrlCal` y `Bloqueado` casi siempre son 0 para envase**, pero pueden traer valor en casos excepcionales — por eso se siguen guardando y sumando.
- **Total real del SKU = `stock_libre + stock_bloqueado + stock_calidad`** (mismo cálculo que líquido).
