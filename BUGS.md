# Bugs Pendientes

## Abiertos

<!-- Agregar bugs aquí -->

## Cerrados

### BUG-001 — Parser conteo físico: fecha del archivo sobreescribía la fecha del usuario
**Síntoma:** Al subir el cierre físico de una fecha (ej. 23/04), el archivo guardaba los datos bajo el 24/04 porque el Excel internamente tenía timestamp del día siguiente (guardado después de medianoche). El checklist no cambiaba y parecía que "no pasó nada".  
**Fix:** `parsers.js` — eliminar `parsedFecha` del conteo físico y usar siempre `fechaUsuario`.

### BUG-002 — Upload: ítems ya cargados no permitían re-subir
**Síntoma:** Al hacer clic en un ítem ya cargado (verde) no abría el picker de archivos.  
**Fix 1:** `upload.js` — remover guard `!isDone` del onClick para permitir re-subir.  
**Fix 2:** `upload.js` — usar `activeItemRef` (ref síncrono) en lugar de `setTimeout` para llamar `fileInputRef.current?.click()` dentro del gesto del usuario.  
**Fix 3:** `upload.js` — agregar `.xlsm` al `accept` del file input.

### BUG-003 — Comprobación: totales SAP usaban solo stock_libre
**Síntoma:** Los totales de Inv. Líquido y Envase en comprobación solo sumaban `stock_libre`, ignorando `stock_bloqueado` y `stock_calidad`.  
**Fix:** `comprobacion.js` + `parsers.js` — sumar las 3 columnas (`stock_libre + stock_bloqueado + stock_calidad`) tanto en la página como en el parser del conteo físico.

### BUG-004 — Parser conteo físico: real en piso se calculaba como U−AF en lugar de leer col AI
**Síntoma:** `total_fisico_real` se calculaba restando merma al total bruto, en vez de leer directamente la columna AI ("Fisico") del Excel.  
**Fix:** `parsers.js` — mapear `total_fisico_real` a índice 34 (col AI) directamente.
