import * as XLSX from 'xlsx'
import { supabase, fetchAllRows, deleteAndInsert } from './supabase'

/**
 * @typedef {object} ParseResult
 * @property {boolean} success
 * @property {number} registros
 * @property {string} [error]
 * @property {string} [fechaDatos] Fecha guardada (p. ej. conteo puede leerla del xlsx)
 */

const BATCH = 500

export const IMPLEMENTED_UPLOAD_TYPES = new Set([
  'inventario_liquido',
  'inventario_envase',
  'conteo_fisico',
  'salidas_rutas',
  'mb51_2000',
  'mb51_2010',
  'conciliacion_envase',
  'ingreso_envase',
  'tiempos_carga',
])

const HEADER_INVENTARIO_LIQUIDO = [
  'Ce.',
  'Material',
  'Texto breve de material',
  'Alm.',
  'UMB',
  'LibrUtiliz',
  'Bloqueado',
  'En CtrlCal',
]

const HEADER_INVENTARIO_ENVASE = [
  'Material',
  'Texto breve de material',
  'Alm.',
  'Ce.',
  'UMB',
  'LibrUtiliz',
  'En CtrlCal',
  'Bloqueado',
]

const HEADER_SALIDAS = [
  'Centro',
  'Ruta',
  'Transporte',
  'Fecha de Entrega',
  'Material',
  'Descripción',
  'Cantidad',
  'UM venta',
]

const HEADER_MB51_MIN = ['Pedido', 'Alm.', 'Material', 'Texto breve de material']

/**
 * Quita separadores de miles y devuelve número finito o null. Maneja negativos.
 * @param {unknown} raw
 */
export function cleanNumericString(raw) {
  if (raw === null || raw === undefined) return null
  let s = String(raw).trim()
  if (s === '' || s === '-' || s === '—') return null
  s = s.replace(/\s/g, '')
  s = s.replace(/,/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/**
 * @param {File} file
 */
export async function readFileAsTextSap(file) {
  const name = (file.name || '').toLowerCase()
  const buf = await file.arrayBuffer()
  const u8 = new Uint8Array(buf)

  if (name.endsWith('.csv')) {
    return new TextDecoder('utf-8').decode(u8)
  }

  if (u8.length >= 2) {
    if (u8[0] === 0xff && u8[1] === 0xfe) {
      return new TextDecoder('utf-16le').decode(u8)
    }
    if (u8[0] === 0xfe && u8[1] === 0xff) {
      return new TextDecoder('utf-16be').decode(u8)
    }
  }

  return new TextDecoder('utf-16le').decode(u8)
}

function splitTsvLine(line) {
  return line.split('\t').map((c) => c.replace(/\r$/, '').trim())
}

function findHeaderLineIndex(lines, requiredSubstrings) {
  const need = requiredSubstrings.map((h) => h.toLowerCase())
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    if (!L || !L.trim()) continue
    const low = L.toLowerCase()
    if (need.every((h) => low.includes(h))) return i
  }
  return -1
}

function findHeaderRowIndexInGrid(rows, requiredSubstrings) {
  const need = requiredSubstrings.map((h) => h.toLowerCase())
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r.length) continue
    const joined = r.map((c) => String(c)).join('\t').toLowerCase()
    if (need.every((h) => joined.includes(h))) return i
  }
  return -1
}

function rowObjectFromHeader(headerCells, valueCells) {
  /** @type {Record<string, string>} */
  const o = {}
  const n = Math.max(headerCells.length, valueCells.length)
  for (let i = 0; i < n; i++) {
    const h = (headerCells[i] || `col_${i}`).trim()
    o[h] = valueCells[i] != null ? String(valueCells[i]) : ''
  }
  return o
}

function getCellByHeaderName(row, name, opts) {
  const n = name.trim()
  for (const k of Object.keys(row)) {
    if (k.trim() === n) return row[k] ?? ''
  }
  const nl = n.toLowerCase()
  for (const k of Object.keys(row)) {
    if (k.trim().toLowerCase() === nl) return row[k] ?? ''
  }
  if (opts?.isTextoBreve) {
    for (const k of Object.keys(row)) {
      if (/texto breve de material|texto breve/i.test(k)) return row[k] ?? ''
    }
  }
  if (opts?.isMaterial) {
    for (const k of Object.keys(row)) {
      if (k.trim().toLowerCase() === 'material' && !/texto breve|descripci/i.test(k)) return row[k] ?? ''
    }
    for (const k of Object.keys(row)) {
      if (/^material$/i.test(k.trim())) return row[k] ?? ''
    }
    for (const k of Object.keys(row)) {
      if (/material/i.test(k) && !/texto breve|descripci/i.test(k)) return row[k] ?? ''
    }
  }
  for (const k of Object.keys(row)) {
    if (k.toLowerCase().includes(nl)) return row[k] ?? ''
  }
  return ''
}

function mapInventarioRow(row) {
  const material = getCellByHeaderName(row, 'Material', { isMaterial: true })
  if (!String(material || '').trim()) return null

  let enCtrl = getCellByHeaderName(row, 'En CtrlCal')
  if (!enCtrl) {
    for (const k of Object.keys(row)) {
      if (/en\s*ctrl|ctrlcal|control.*cal/i.test(k)) {
        enCtrl = row[k] ?? ''
        break
      }
    }
  }
  let libreU = getCellByHeaderName(row, 'LibrUtiliz')
  if (!libreU) {
    for (const k of Object.keys(row)) {
      if (/librutil|libr\.\s*util|lib\.\s*util|stock\s*libre|libre.*utiliz/i.test(k)) {
        libreU = row[k] ?? ''
        break
      }
    }
  }

  return {
    Material: String(material).trim(),
    'Texto breve de material': getCellByHeaderName(row, 'Texto breve de material', { isTextoBreve: true }),
    UMB: getCellByHeaderName(row, 'UMB'),
    LibrUtiliz: libreU,
    Bloqueado: getCellByHeaderName(row, 'Bloqueado'),
    'En CtrlCal': enCtrl,
  }
}

function parseTsvDataLines(text, headerMarkers) {
  const lines = text.split(/\r\n|\n|\r/)
  const headerIdx = findHeaderLineIndex(lines, headerMarkers)
  if (headerIdx < 0) {
    throw new Error('No se encontró la fila de encabezados esperada.')
  }
  const headerCells = splitTsvLine(lines[headerIdx])
  const out = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    const t = line.trim()
    if (t.startsWith('*') || t.startsWith('**')) continue
    const cells = splitTsvLine(line)
    if (cells.length === 0) continue
    const raw = rowObjectFromHeader(headerCells, cells)
    const m = mapInventarioRow(raw)
    if (!m) continue
    out.push(m)
  }
  return out
}

function parseInventarioFromXlsxGrid(aoa, headerMarkers) {
  const hIdx = findHeaderRowIndexInGrid(aoa, headerMarkers)
  if (hIdx < 0) throw new Error('No se encontró la fila de encabezados en el Excel.')
  const headerCells = aoa[hIdx].map((c) => String(c).trim())
  const out = []
  for (let r = hIdx + 1; r < aoa.length; r++) {
    const row = aoa[r]
    if (!row || row.every((c) => !String(c || '').trim())) continue
    const first = String(row[0] ?? '').trim()
    if (first.startsWith('*') || first.startsWith('**')) continue
    const values = row.map((c) => (c == null ? '' : String(c)))
    const raw = rowObjectFromHeader(headerCells, values)
    const m = mapInventarioRow(raw)
    if (!m) continue
    out.push(m)
  }
  return out
}

/**
 * @param {File} file
 * @param {string[]} headerMarkers
 */
async function readInventarioFileAsMappedRows(file, headerMarkers) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const ab = await file.arrayBuffer()
    const wb = XLSX.read(ab, { type: 'array', cellDates: true })
    const first = wb.SheetNames[0]
    if (!first) throw new Error('El archivo Excel no tiene hojas.')
    const sheet = wb.Sheets[first]
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })
    if (!Array.isArray(aoa) || aoa.length === 0) throw new Error('Hoja vacía.')
    return parseInventarioFromXlsxGrid(aoa, headerMarkers)
  }
  const text = await readFileAsTextSap(file)
  return parseTsvDataLines(text, headerMarkers)
}

function toInventarioRecords(mapped, fecha, momento, turno) {
  return mapped.map((m) => ({
    fecha,
    momento,
    turno,
    sku: String(m.Material ?? '').trim(),
    descripcion: String(m['Texto breve de material'] ?? '').trim() || null,
    unidad: String(m.UMB ?? '').trim() || null,
    stock_libre: cleanNumericString(m.LibrUtiliz),
    stock_bloqueado: cleanNumericString(m.Bloqueado),
    stock_calidad: cleanNumericString(m['En CtrlCal']),
  }))
}

export function parseTurnoFromFileName(fileName) {
  const f = (fileName || '').toLowerCase()
  if (f.includes('turno_3') || f.includes('turno3') || f.includes('tarde')) return 3
  if (f.includes('turno_1') || f.includes('turno1')) return 1
  return 1
}

export function parseMomentoFromFileName(fileName) {
  const f = (fileName || '').toLowerCase()
  if (f.includes('inicio')) return 'inicio'
  return 'cierre'
}

/**
 * @param {string} tipoArchivo
 * @param {number} registros
 * @param {string} fechaDatos
 * @param {import('@supabase/supabase-js').User | null | undefined} user Objeto de Supabase Auth; se usa `user.id` (UUID) en `uploaded_by`
 */
async function logUpload(tipoArchivo, registros, fechaDatos, user, turno, momento) {
  const { error } = await supabase.from('upload_log').insert({
    tipo_archivo: tipoArchivo,
    registros,
    uploaded_by: user?.id ?? null,
    fecha: fechaDatos,
    turno: turno ?? null,
    momento: momento ?? null,
  })
  if (error) throw error
}

/**
 * @param {File} file
 * @param {string} fecha
 * @param {import('@supabase/supabase-js').User | null | undefined} [user]
 * @returns {Promise<ParseResult>}
 */
export async function parseInventarioLiquido(file, fecha, user, turno, momento) {
  if (!file || !fecha) {
    return { success: false, registros: 0, error: 'Falta archivo o fecha.' }
  }
  try {
    const raw = await readInventarioFileAsMappedRows(file, HEADER_INVENTARIO_LIQUIDO)
    const records = toInventarioRecords(raw, fecha, momento, turno)
    await deleteAndInsert(
      'inventario_liquido',
      { fecha, momento, turno },
      records,
      BATCH
    )
    await logUpload('inventario_liquido', records.length, fecha, user, turno, momento)
    return { success: true, registros: records.length, fechaDatos: fecha }
  } catch (e) {
    return { success: false, registros: 0, error: e?.message || String(e) }
  }
}

/**
 * @param {File} file
 * @param {string} fecha
 * @param {import('@supabase/supabase-js').User | null | undefined} [user]
 * @returns {Promise<ParseResult>}
 */
export async function parseInventarioEnvase(file, fecha, user, turno, momento) {
  if (!file || !fecha) {
    return { success: false, registros: 0, error: 'Falta archivo o fecha.' }
  }
  try {
    const raw = await readInventarioFileAsMappedRows(file, HEADER_INVENTARIO_ENVASE)
    const records = toInventarioRecords(raw, fecha, momento, turno)
    await deleteAndInsert('inventario_envase', { fecha, momento, turno }, records, BATCH)
    await logUpload('inventario_envase', records.length, fecha, user, turno, momento)
    return { success: true, registros: records.length, fechaDatos: fecha }
  } catch (e) {
    return { success: false, registros: 0, error: e?.message || String(e) }
  }
}

function mapSalidasRow(row) {
  const sku = getCellByHeaderName(row, 'Material', { isMaterial: true })
  if (!String(sku || '').trim()) return null
  return {
    sku: String(sku).trim(),
    centro: getCellByHeaderName(row, 'Centro'),
    ruta: getCellByHeaderName(row, 'Ruta'),
    transporte: getCellByHeaderName(row, 'Transporte'),
    descripcion: getCellByHeaderName(row, 'Descripción') || getCellByHeaderName(row, 'Descripcion'),
    cantidad: cleanNumericString(
      getCellByHeaderName(row, 'Cantidad') || getCellByHeaderName(row, 'Ctd')
    ),
    unidad: getCellByHeaderName(row, 'UM venta') || getCellByHeaderName(row, 'UMVenta'),
  }
}

function parseSalidasFromText(text) {
  const lines = text.split(/\r\n|\n|\r/)
  const headerIdx = findHeaderLineIndex(lines, HEADER_SALIDAS)
  if (headerIdx < 0) throw new Error('No se encontró la fila de encabezados (Salidas / Rutas).')
  const headerCells = splitTsvLine(lines[headerIdx])
  const out = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    const t = line.trim()
    if (t.startsWith('*') || t.startsWith('**')) continue
    const cells = splitTsvLine(line)
    const raw = rowObjectFromHeader(headerCells, cells)
    const m = mapSalidasRow(raw)
    if (!m) continue
    out.push(m)
  }
  return out
}

/**
 * @param {File} file
 * @param {string} fecha
 * @param {import('@supabase/supabase-js').User | null | undefined} [user]
 * @returns {Promise<ParseResult>}
 */
export async function parseSalidasRutas(file, fecha, user, turno, momento) {
  if (!file || !fecha) {
    return { success: false, registros: 0, error: 'Falta archivo o fecha.' }
  }
  try {
    const name = (file.name || '').toLowerCase()
    let mapped
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
      const ab = await file.arrayBuffer()
      const wb = XLSX.read(ab, { type: 'array', cellDates: true })
      const first = wb.SheetNames[0]
      if (!first) throw new Error('El archivo Excel no tiene hojas.')
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, defval: '', raw: true })
      const hIdx = findHeaderRowIndexInGrid(aoa, HEADER_SALIDAS)
      if (hIdx < 0) throw new Error('No se encontró encabezado de salidas.')
      const headerCells = aoa[hIdx].map((c) => String(c).trim())
      mapped = []
      for (let r = hIdx + 1; r < aoa.length; r++) {
        const row = aoa[r]
        if (!row || row.every((c) => !String(c || '').trim())) continue
        const firstC = String(row[0] ?? '').trim()
        if (firstC.startsWith('*') || firstC.startsWith('**')) continue
        const values = row.map((c) => (c == null ? '' : String(c)))
        const raw = rowObjectFromHeader(headerCells, values)
        const m = mapSalidasRow(raw)
        if (m) mapped.push(m)
      }
    } else {
      const text = await readFileAsTextSap(file)
      mapped = parseSalidasFromText(text)
    }

    const records = mapped.map((m) => ({
      fecha,
      turno: turno ?? null,
      momento: momento ?? null,
      centro: m.centro || null,
      ruta: m.ruta || null,
      transporte: m.transporte || null,
      sku: m.sku,
      descripcion: m.descripcion || null,
      cantidad: m.cantidad,
      unidad: m.unidad || null,
    }))

    const filter = turno != null && momento != null ? { fecha, turno, momento } : { fecha }
    await deleteAndInsert('salidas_rutas', filter, records, BATCH)
    await logUpload('salidas_rutas', records.length, fecha, user, turno, momento)
    return { success: true, registros: records.length, fechaDatos: fecha }
  } catch (e) {
    return { success: false, registros: 0, error: e?.message || String(e) }
  }
}

/**
 * @param {unknown} v
 */
function cellToYyyyMmDd(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10)
  }
  if (typeof v === 'number' && XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
    const d = XLSX.SSF.parse_date_code(v)
    if (d) {
      const y = d.y
      const m = String(d.m).padStart(2, '0')
      const day = String(d.d).padStart(2, '0')
      return `${y}-${m}-${day}`
    }
  }
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = Date.parse(s)
  if (!isNaN(t)) return new Date(t).toISOString().slice(0, 10)
  return null
}

/**
 * @param {unknown[][]} aoa
 */
function findFechaInRow0(aoa) {
  const row0 = aoa[0] || []
  for (let j = 0; j < row0.length; j++) {
    const label = String(row0[j] ?? '')
      .trim()
      .toLowerCase()
    if (label === 'fecha:' || label === 'fecha' || (label.includes('fecha') && label.length < 12)) {
      const val = row0[j + 1]
      const iso = cellToYyyyMmDd(val)
      if (iso) return iso
    }
  }
  for (let j = 0; j < row0.length - 1; j++) {
    const label = String(row0[j] ?? '')
      .trim()
      .toLowerCase()
    if (label.includes('fecha')) {
      const iso = cellToYyyyMmDd(row0[j + 1])
      if (iso) return iso
    }
  }
  return null
}

/**
 * @param {File} file
 * @param {string} fechaUsuario
 * @param {import('@supabase/supabase-js').User | null | undefined} [user]
 * @returns {Promise<ParseResult>}
 */
export async function parseConteoFisico(file, fechaUsuario, user, turno, momento) {
  if (!file || !fechaUsuario) {
    return { success: false, registros: 0, error: 'Falta archivo o fecha.' }
  }
  const name = (file.name || '').toLowerCase()
  if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
    return { success: false, registros: 0, error: 'Conteo físico debe ser un archivo .xlsx' }
  }
  try {
    const ab = await file.arrayBuffer()
    const wb = XLSX.read(ab, { type: 'array', cellDates: true })
    const sheetName =
      wb.SheetNames.find((s) => s.trim().toLowerCase() === 'vertical liquido') || wb.SheetNames[0]
    if (!sheetName) throw new Error('No se encontró la hoja "vertical liquido".')
    const sheet = wb.Sheets[sheetName]
    if (!sheet) throw new Error(`Hoja "${sheetName}" no encontrada.`)
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })
    if (!Array.isArray(aoa) || aoa.length < 3) throw new Error('Hoja con datos insuficientes.')

    const parsedFecha = findFechaInRow0(aoa)
    const effectiveFecha = parsedFecha || fechaUsuario

    const invRows = await fetchAllRows((from, to) =>
      supabase
        .from('inventario_liquido')
        .select('sku, stock_libre')
        .eq('fecha', effectiveFecha)
        .range(from, to)
    )
    /** @type {Map<string, number>} */
    const invBySku = new Map()
    for (const ir of invRows) {
      const k = String(ir.sku ?? '').trim()
      if (!k) continue
      const add = cleanNumericString(ir.stock_libre) ?? 0
      invBySku.set(k, (invBySku.get(k) || 0) + add)
    }

    const COL = {
      sku: 0,
      sku_sap: 1,
      descripcion: 2,
      cajas_por_tarima: 5,
      total_tarimas: 15,
      cajas_en_tarimas: 16,
      total_fisico: 20,
      merma_operativa: 30,
      merma_cm: 31,
      merma_dora: 32,
      total_picos: 33,
    }

    const records = []
    for (let r = 2; r < aoa.length; r++) {
      const row = aoa[r]
      if (!row) continue
      const sku = row[COL.sku]
      if (sku == null || String(sku).trim() === '') continue
      const skuS = String(sku).trim()
      const skuSap = String(row[COL.sku_sap] ?? '').trim() || null
      const descripcion = row[COL.descripcion] != null ? String(row[COL.descripcion]) : null

      const totalFis = cleanNumericString(row[COL.total_fisico])
      let totalSist = null
      if (skuSap && invBySku.has(skuSap)) {
        totalSist = invBySku.get(skuSap) ?? null
      } else if (skuS && invBySku.has(skuS)) {
        totalSist = invBySku.get(skuS) ?? null
      }

      let diferencia = null
      if (totalFis != null && totalSist != null) {
        diferencia = totalFis - totalSist
      } else if (totalFis != null && totalSist == null) {
        diferencia = totalFis
      }

      records.push({
        fecha: effectiveFecha,
        sku: skuS,
        sku_sap: skuSap,
        descripcion,
        cajas_por_tarima: cleanNumericString(row[COL.cajas_por_tarima]),
        total_tarimas: cleanNumericString(row[COL.total_tarimas]),
        cajas_en_tarimas: cleanNumericString(row[COL.cajas_en_tarimas]),
        total_fisico: totalFis,
        total_sistema: totalSist,
        diferencia,
        merma_operativa: cleanNumericString(row[COL.merma_operativa]),
        merma_cm: cleanNumericString(row[COL.merma_cm]),
        merma_dora: cleanNumericString(row[COL.merma_dora]),
        total_picos: cleanNumericString(row[COL.total_picos]),
      })
    }

    await deleteAndInsert('conteo_fisico', { fecha: effectiveFecha }, records, BATCH)
    await logUpload('conteo_fisico', records.length, effectiveFecha, user, turno, momento)
    return { success: true, registros: records.length, fechaDatos: effectiveFecha }
  } catch (e) {
    return { success: false, registros: 0, error: e?.message || String(e) }
  }
}

/**
 * @param {Record<string, string>} row
 * @param {string} almacenParam
 */
function getMb51Cantidad(row, almacenParam) {
  const prefer = almacenParam === '2010' ? ['Cantidad', 'Ctd.en UME', 'CtdEn UME'] : ['Ctd.en UME', 'CtdEn UME', 'Cantidad']
  for (const name of prefer) {
    for (const k of Object.keys(row)) {
      if (k.trim() === name || k.replace(/\s/g, ' ').trim() === name) {
        const v = cleanNumericString(row[k])
        if (v != null) return v
      }
    }
  }
  for (const k of Object.keys(row)) {
    const kn = k.replace(/\s/g, '').toLowerCase()
    if (kn.includes('ctdenume') || (kn.includes('ctd') && kn.includes('ume')) || /^cantidad$/i.test(k.trim())) {
      const v = cleanNumericString(row[k])
      if (v != null) return v
    }
  }
  return null
}

/**
 * @param {File} file
 * @param {string} fecha
 * @param {string} almacen
 * @param {import('@supabase/supabase-js').User | null | undefined} [user]
 * @returns {Promise<ParseResult>}
 */
export async function parseMB51(file, fecha, almacen, user, turno, momento) {
  if (!file || !fecha || !almacen) {
    return { success: false, registros: 0, error: 'Falta archivo, fecha o almacén.' }
  }
  const tipoLog = almacen === '2010' ? 'mb51_2010' : 'mb51_2000'

  try {
    const text = await readFileAsTextSap(file)
    const lines = text.split(/\r\n|\n|\r/)
    const headerIdx = findHeaderLineIndex(lines, HEADER_MB51_MIN)
    if (headerIdx < 0) {
      throw new Error('No se encontró la fila de encabezados (MB51).')
    }
    const headerLine = lines[headerIdx]
    const headerCells = splitTsvLine(headerLine)
    const out = []
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!line || !line.trim()) continue
      const t = line.trim()
      if (t.startsWith('*') || t.startsWith('**')) continue
      const cells = splitTsvLine(line)
      const raw = rowObjectFromHeader(headerCells, cells)
      const mat = getCellByHeaderName(raw, 'Material', { isMaterial: true })
      if (!String(mat || '').trim()) continue
      const almCell = getCellByHeaderName(raw, 'Alm.')
      out.push({
        almacen: (almCell && String(almCell).trim()) || almacen,
        pedido: getCellByHeaderName(raw, 'Pedido') || getCellByHeaderName(raw, 'Orden') || null,
        referencia: getCellByHeaderName(raw, 'Referencia') || getCellByHeaderName(raw, 'Texto de referencia') || null,
        sku: String(mat).trim(),
        descripcion: getCellByHeaderName(raw, 'Texto breve de material', { isTextoBreve: true }) || null,
        cantidad: getMb51Cantidad(raw, almacen),
        unidad: getCellByHeaderName(raw, 'UME') || getCellByHeaderName(raw, 'UM') || null,
        documento_material:
          getCellByHeaderName(raw, 'Doc.mat.') || getCellByHeaderName(raw, 'Doc. mat') || getCellByHeaderName(raw, 'Documento de material') || null,
        lote: getCellByHeaderName(raw, 'Lote') || null,
        clase_movimiento: getCellByHeaderName(raw, 'CMv') || getCellByHeaderName(raw, 'Clase de movimiento') || null,
        usuario: getCellByHeaderName(raw, 'Usuario') || null,
      })
    }

    const records = out.map((m) => ({
      fecha,
      almacen: m.almacen != null && String(m.almacen).trim() !== '' ? String(m.almacen).trim() : almacen,
      pedido: m.pedido != null && String(m.pedido).trim() !== '' ? String(m.pedido) : null,
      referencia: m.referencia != null && String(m.referencia).trim() !== '' ? String(m.referencia) : null,
      sku: m.sku,
      descripcion: m.descripcion,
      cantidad: m.cantidad,
      unidad: m.unidad,
      documento_material: m.documento_material,
      lote: m.lote,
      clase_movimiento: m.clase_movimiento,
      usuario: m.usuario,
    }))

    await deleteAndInsert('movimientos_mb51', { fecha, almacen }, records, BATCH)
    await logUpload(tipoLog, records.length, fecha, user, turno, momento)
    return { success: true, registros: records.length, fechaDatos: fecha }
  } catch (e) {
    return { success: false, registros: 0, error: e?.message || String(e) }
  }
}

function findSheetByFecha(wb, fecha) {
  const [y, m, d] = fecha.split('-')
  const target = `${d}.${m}.${y}`
  return wb.SheetNames.find((name) => name.trim().startsWith(target)) ?? wb.SheetNames[wb.SheetNames.length - 1]
}

function excelTimeToHHMM(v) {
  if (v == null || v === '' || v === 0) return null
  // Si ya es string "HH:MM" (raw:false), devolverlo directo
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2}):(\d{2})$/)
    if (m) return `${String(m[1]).padStart(2, '0')}:${m[2]}`
    return null
  }
  // Fracción de día numérica (fallback)
  const num = parseFloat(v)
  if (isNaN(num)) return null
  const totalMin = Math.round(num * 24 * 60)
  const h = Math.floor(totalMin / 60) % 24
  const min = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function excelTimeToMin(v) {
  if (v == null || v === '') return null
  // Si ya es string "H:MM" (duración, ej. "1:05" = 65 min)
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d+):(\d{2})$/)
    if (m) {
      const mins = parseInt(m[1]) * 60 + parseInt(m[2])
      return mins > 0 ? mins : null
    }
    // Podría ser número como string "65"
    const n = parseFloat(v)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null
  }
  // Fracción de día numérica (fallback)
  const num = parseFloat(v)
  if (isNaN(num) || num <= 0) return null
  return Math.round(num * 24 * 60)
}

export async function parseConciliacionEnvase(file, fecha, user, turno, momento) {
  if (!file || !fecha) return { success: false, registros: 0, error: 'Falta archivo o fecha.' }
  try {
    const ab = await file.arrayBuffer()
    const wb = XLSX.read(ab, { type: 'array', cellDates: false })
    const sheetName = findSheetByFecha(wb, fecha)
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null })

    const headerRow = aoa.findIndex((row) => row && String(row[1] ?? '').toLowerCase().includes('sku'))
    if (headerRow < 0) throw new Error('No se encontró fila de encabezados.')

    let fisico_total = null, sistema_total = null, diferencia_total = null
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r]
      if (!row) continue
      const label = String(row[0] ?? '').trim().toLowerCase()
      if (label === 'fisico') fisico_total = cleanNumericString(row[1])
      if (label === 'sistema') sistema_total = cleanNumericString(row[1])
      if (label === 'diferencia') diferencia_total = cleanNumericString(row[1])
    }

    let presentacionActual = null
    const records = []
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r]
      if (!row) continue
      const col0 = String(row[0] ?? '').trim()
      const skuRaw = row[1]
      if (skuRaw == null || String(skuRaw).trim() === '') continue
      const skuNum = cleanNumericString(skuRaw)
      if (skuNum == null) continue
      if (col0) presentacionActual = col0

      records.push({
        fecha,
        turno: turno ?? null,
        momento: momento ?? null,
        presentacion: presentacionActual,
        sku: String(skuRaw).trim(),
        descripcion: row[2] != null ? String(row[2]).trim() : null,
        tarimas_comp_t1: cleanNumericString(row[3]),
        restos_t1: cleanNumericString(row[4]),
        tarimas_comp_t2: cleanNumericString(row[5]),
        restos_t2: cleanNumericString(row[6]),
        unidades_por_tarima: cleanNumericString(row[7]),
        total_comp: cleanNumericString(row[8]),
        total: cleanNumericString(row[10]),
        fisico_total,
        sistema_total,
        diferencia_total,
      })
    }

    await deleteAndInsert('conciliacion_envase', { fecha, turno, momento }, records, BATCH)
    await logUpload('conciliacion_envase', records.length, fecha, user, turno, momento)
    return { success: true, registros: records.length, fechaDatos: fecha }
  } catch (e) {
    return { success: false, registros: 0, error: e?.message || String(e) }
  }
}

export async function parseIngresoEnvase(file, fecha, user, turno, momento) {
  if (!file || !fecha) return { success: false, registros: 0, error: 'Falta archivo o fecha.' }
  try {
    const ab = await file.arrayBuffer()
    const wb = XLSX.read(ab, { type: 'array', cellDates: false })
    const sheetName = findSheetByFecha(wb, fecha)
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null })

    const headerRow = aoa.findIndex((row) => row && String(row[0] ?? '').toUpperCase().includes('RUTA'))
    if (headerRow < 0) throw new Error('No se encontró fila de encabezados.')

    const records = []
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r]
      if (!row) continue
      const ruta = String(row[0] ?? '').trim()
      if (!ruta || ruta.toLowerCase().includes('total')) continue
      const envRec = cleanNumericString(row[7])
      if (envRec == null && cleanNumericString(row[0]) != null) continue

      records.push({
        fecha,
        turno: turno ?? null,
        momento: momento ?? null,
        ruta,
        repartidor: row[1] != null ? String(row[1]).trim() : null,
        md_medio: cleanNumericString(row[2]),
        litro: cleanNumericString(row[3]),
        mega: cleanNumericString(row[4]),
        bud_l: cleanNumericString(row[5]),
        total: cleanNumericString(row[6]),
        env_rec: cleanNumericString(row[7]),
        porcentaje: cleanNumericString(row[8]),
      })
    }

    await deleteAndInsert('ingreso_envase', { fecha, turno, momento }, records, BATCH)
    await logUpload('ingreso_envase', records.length, fecha, user, turno, momento)
    return { success: true, registros: records.length, fechaDatos: fecha }
  } catch (e) {
    return { success: false, registros: 0, error: e?.message || String(e) }
  }
}

export async function parseTiemposCarga(file, fecha, user, turno, momento) {
  if (!file || !fecha) return { success: false, registros: 0, error: 'Falta archivo o fecha.' }
  try {
    const ab = await file.arrayBuffer()
    const wb = XLSX.read(ab, { type: 'array', cellDates: false })

    // Buscar pestaña cuyo nombre empiece con DD.MM.YYYY de la fecha seleccionada
    const [y, m, d] = fecha.split('-')
    const target = `${d}.${m}.${y}`
    const sheetName = wb.SheetNames.find((n) => n.trim().startsWith(target))
    if (!sheetName) {
      const disponibles = wb.SheetNames.join(', ')
      throw new Error(
        `No se encontró una pestaña para el ${d}/${m}/${y}. ` +
        `Pestañas disponibles: ${disponibles}. ` +
        `Selecciona la fecha correcta al subir el archivo.`
      )
    }
    // raw:false devuelve el texto formateado (ej. "19:11", "378") en lugar de fracciones/nulls
    // Necesario porque las celdas de tiempo/fórmula no tienen caché de valor raw
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: false })

    // Buscar fila de encabezados: la que tenga "CAJAS"
    const SKIP_WORDS = ['total', 'promedio', 'suma', 'subtotal']
    const headerRow = aoa.findIndex((row) =>
      row && row.some((cell) => String(cell ?? '').toUpperCase().includes('CAJAS'))
    )
    if (headerRow < 0) throw new Error(`No se encontró fila de encabezados en pestaña "${sheetName}".`)

    // Detectar índices de columna por nombre del encabezado
    const hdr = aoa[headerRow].map((c) => String(c ?? '').toUpperCase().trim())
    const col = (keywords) => hdr.findIndex((h) => keywords.some((k) => h.includes(k)))

    // Grupos repetidos (INICIO, FIN, TIEMPO aparecen dos veces: carga y embarque)
    // Se busca el índice de la PRIMERA y SEGUNDA ocurrencia
    const allInicio = hdr.reduce((acc, h, i) => { if (h.includes('INICIO')) acc.push(i); return acc }, [])
    const allFin    = hdr.reduce((acc, h, i) => { if (h.includes('FIN'))    acc.push(i); return acc }, [])
    const allTiempo = hdr.reduce((acc, h, i) => { if (h.includes('TIEMPO')) acc.push(i); return acc }, [])

    const iRuta           = col(['CARGA'])
    const iCajas          = col(['CAJAS'])
    const iRestos         = col(['RESTOS'])
    const iInicioCarga    = allInicio[0] ?? -1
    const iFinCarga       = allFin[0]    ?? -1
    const iTiempoCarga    = allTiempo[0] ?? -1
    const iInicioEmbarque = allInicio[1] ?? -1
    const iFinEmbarque    = allFin[1]    ?? -1
    const iTiempoEmbarque = allTiempo[1] ?? -1
    const iCjMin          = col(['CJ X', 'CJ/MIN', 'CAJAS/MIN', 'CAJAS POR'])
    const iEquipo         = col(['EQUIPO'])

    const records = []
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r]
      if (!row) continue
      const ruta = String(row[iRuta >= 0 ? iRuta : 0] ?? '').trim()
      if (!ruta) continue
      if (SKIP_WORDS.some((w) => ruta.toLowerCase().includes(w))) continue

      records.push({
        fecha,
        ruta,
        cajas:            iCajas          >= 0 ? cleanNumericString(row[iCajas])          : null,
        restos:           iRestos         >= 0 ? cleanNumericString(row[iRestos])         : null,
        inicio_carga:     iInicioCarga    >= 0 ? excelTimeToHHMM(row[iInicioCarga])       : null,
        fin_carga:        iFinCarga       >= 0 ? excelTimeToHHMM(row[iFinCarga])          : null,
        tiempo_carga:     iTiempoCarga    >= 0 ? excelTimeToMin(row[iTiempoCarga])        : null,
        inicio_embarque:  iInicioEmbarque >= 0 ? excelTimeToHHMM(row[iInicioEmbarque])   : null,
        fin_embarque:     iFinEmbarque    >= 0 ? excelTimeToHHMM(row[iFinEmbarque])       : null,
        tiempo_embarque:  iTiempoEmbarque >= 0 ? excelTimeToMin(row[iTiempoEmbarque])    : null,
        cajas_por_segundo:iCjMin          >= 0 ? cleanNumericString(row[iCjMin])          : null,
        equipo:           iEquipo         >= 0 && row[iEquipo] != null ? String(row[iEquipo]).trim() : null,
      })
    }

    if (records.length === 0) throw new Error(`No se encontraron rutas en pestaña "${sheetName}".`)

    await deleteAndInsert('tiempos_carga', { fecha }, records, BATCH)
    await logUpload('tiempos_carga', records.length, fecha, user, turno, momento)
    return { success: true, registros: records.length, fechaDatos: fecha }
  } catch (e) {
    return { success: false, registros: 0, error: e?.message || String(e) }
  }
}

export async function parseNivelServicio() {
  return { success: false, registros: 0, error: 'Parser pendiente de implementación' }
}

/**
 * @param {string} tipo
 * @param {File} file
 * @param {string} fecha
 * @param {import('@supabase/supabase-js').User | null | undefined} [user]
 * @returns {Promise<ParseResult>}
 */
export async function runParser(tipo, file, fecha, user, turno, momento) {
  switch (tipo) {
    case 'inventario_liquido':
      return parseInventarioLiquido(file, fecha, user, turno, momento)
    case 'inventario_envase':
      return parseInventarioEnvase(file, fecha, user, turno, momento)
    case 'conteo_fisico':
      return parseConteoFisico(file, fecha, user, turno, momento)
    case 'salidas_rutas':
    case 'salidas':
      return parseSalidasRutas(file, fecha, user, turno, momento)
    case 'mb51_2000':
      return parseMB51(file, fecha, '2000', user, turno, momento)
    case 'mb51_2010':
      return parseMB51(file, fecha, '2010', user, turno, momento)
    case 'conciliacion_envase':
      return parseConciliacionEnvase(file, fecha, user, turno, momento)
    case 'nivel_servicio':
      return parseNivelServicio()
    case 'ingreso_envase':
      return parseIngresoEnvase(file, fecha, user, turno, momento)
    case 'tiempos_carga':
      return parseTiemposCarga(file, fecha, user, turno, momento)
    default:
      return { success: false, registros: 0, error: `Tipo desconocido: ${tipo}` }
  }
}

export function isParserImplemented(tipo) {
  return IMPLEMENTED_UPLOAD_TYPES.has(tipo)
}
