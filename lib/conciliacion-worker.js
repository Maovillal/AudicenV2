import { read, utils } from 'xlsx'

function cleanNumericString(raw) {
  if (raw === null || raw === undefined) return null
  let s = String(raw).trim()
  if (s === '' || s === '-' || s === '—') return null
  s = s.replace(/\s/g, '').replace(/,/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function normalize(v) {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

self.onmessage = function ({ data: { arrayBuffer } }) {
  try {
    const wbMeta = read(arrayBuffer, { type: 'array', bookSheets: true })
    const sheetName = wbMeta.SheetNames[wbMeta.SheetNames.length - 1]
    const wb = read(arrayBuffer, {
      type: 'array',
      cellDates: false,
      cellFormula: false,
      cellText: false,
      sheets: sheetName,
    })
    const aoa = utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null })

    // Buscar el último "Fin SAP" en cualquier columna
    // El valor está en la columna inmediata siguiente a la etiqueta
    let finSapVal = null
    for (let r = aoa.length - 1; r >= 0; r--) {
      const row = aoa[r]
      if (!row) continue
      for (let c = 0; c < row.length; c++) {
        if (normalize(row[c]) === 'finsap') {
          // Buscar el primer valor numérico a la derecha
          for (let nc = c + 1; nc < row.length; nc++) {
            const v = cleanNumericString(row[nc])
            if (v != null) { finSapVal = v; break }
          }
          if (finSapVal != null) break
        }
      }
      if (finSapVal != null) break
    }

    if (finSapVal == null) {
      self.postMessage({ error: 'No se encontró el valor "Fin SAP" en el archivo.' })
      return
    }

    // Guardar un único registro con el total agregado
    self.postMessage({
      dataRows: [
        {
          presentacion: 'Fin SAP',
          sku: 'TOTAL',
          descripcion: null,
          fisico_total: finSapVal,
        },
      ],
    })
  } catch (e) {
    self.postMessage({ error: e.message || String(e) })
  }
}
