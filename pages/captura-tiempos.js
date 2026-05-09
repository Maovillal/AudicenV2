import { useCallback, useMemo, useState } from 'react'
import { useFechaGlobal } from '@/lib/useFecha'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase } from '../lib/supabase'
import { bebasNeue } from './_app'

// Tipos soportados con metadata para parsear y mostrar.
const TIPOS = {
  tetra: {
    label: 'Tetra',
    descripcion: 'Tiempos de operación Tetra Pak',
    entidadLabel: 'Ruta / Identificador',
    aliases: { entidad: ['ruta', 'rk', 'identificador', 'tetra'] },
  },
  fulles: {
    label: 'Fulles',
    descripcion: 'Atención a camiones full',
    entidadLabel: 'Full',
    aliases: { entidad: ['full', 'fk', 'camion', 'identificador'] },
  },
  rutas: {
    label: 'Rutas (recorridos)',
    descripcion: 'Salida y entrada de rutas',
    entidadLabel: 'Ruta',
    aliases: { entidad: ['ruta', 'rk', 'recorrido'] },
  },
  liquidacion: {
    label: 'Liquidación',
    descripcion: 'Tiempo en liquidar rutas (post-retorno)',
    entidadLabel: 'Ruta',
    aliases: { entidad: ['ruta', 'rk'] },
  },
}

// Aliases comunes para columnas de tiempo.
const ALIASES_INICIO = ['inicio', 'salida', 'start', 'entrada', 'comienzo']
const ALIASES_FIN = ['fin', 'termino', 'término', 'final', 'end', 'cierre']
const ALIASES_OBS = ['observ', 'notas', 'obs', 'comentario']

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function matchAlias(headerNorm, aliases) {
  return aliases.some((a) => headerNorm.includes(a))
}

// Parsea texto pegado como TSV (lo que sale del clipboard de Sheets/Excel).
function parsePastedTSV(text) {
  if (!text) return { headers: [], rows: [] }
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }
  // Si no hay tabs, intentar coma como separador (algunas pegadas ASIs vienen)
  const sep = lines[0].includes('\t') ? '\t' : ','
  const headers = lines[0].split(sep).map((c) => c.trim())
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(sep).map((c) => c.trim())
    const obj = {}
    headers.forEach((h, i) => { obj[h] = cells[i] ?? '' })
    return obj
  })
  return { headers, rows }
}

// Mapea filas del paste al schema de tiempos_operacion según el tipo.
function mapToRecords(parsed, tipo, fecha) {
  const def = TIPOS[tipo]
  if (!def) return { records: [], errors: ['Tipo desconocido'] }

  const { headers, rows } = parsed
  const headerNorms = headers.map(norm)

  // Detectar índices de columnas relevantes
  let iEntidad = headerNorms.findIndex((h) => matchAlias(h, def.aliases.entidad))
  let iInicio = headerNorms.findIndex((h) => matchAlias(h, ALIASES_INICIO))
  let iFin = headerNorms.findIndex((h) => matchAlias(h, ALIASES_FIN))
  let iObs = headerNorms.findIndex((h) => matchAlias(h, ALIASES_OBS))

  const errors = []
  if (iEntidad < 0) errors.push(`No se encontró columna de ${def.entidadLabel.toLowerCase()} (intenta encabezados como: ${def.aliases.entidad.join(', ')})`)
  if (iInicio < 0) errors.push(`No se encontró columna de inicio (intenta: ${ALIASES_INICIO.join(', ')})`)
  if (iFin < 0) errors.push(`No se encontró columna de fin (intenta: ${ALIASES_FIN.join(', ')})`)
  if (errors.length > 0) return { records: [], errors }

  const records = rows
    .map((row) => {
      const cells = headers.map((h) => row[h])
      const entidad = (cells[iEntidad] || '').trim()
      const inicio = normalizeTime(cells[iInicio])
      const fin = normalizeTime(cells[iFin])
      const observaciones = iObs >= 0 ? (cells[iObs] || '').trim() || null : null
      return { fecha, tipo, entidad, inicio, fin, observaciones }
    })
    .filter((r) => r.entidad)  // saltar filas sin entidad

  return { records, errors: [] }
}

// Convierte "8:30", "08:30", "8:30:00", "08:30 AM" → "HH:MM:SS" o null si no parsea.
function normalizeTime(s) {
  if (!s) return null
  const cleaned = String(s).trim()
  if (!cleaned) return null
  // Match HH:MM o HH:MM:SS, opcional AM/PM
  const m = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const sec = m[3] ? parseInt(m[3], 10) : 0
  const ampm = m[4]?.toLowerCase()
  if (ampm === 'pm' && h < 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  if (h > 23 || min > 59 || sec > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export default function CapturaTiemposPage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [tipo, setTipo] = useState('rutas')
  const [pasted, setPasted] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(null)
  const [error, setError] = useState('')

  // Re-parsear cada vez que cambia lo pegado o el tipo
  const parsed = useMemo(() => parsePastedTSV(pasted), [pasted])
  const mapping = useMemo(() => mapToRecords(parsed, tipo, fecha), [parsed, tipo, fecha])

  const handlePaste = (e) => {
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (text) {
      e.preventDefault()
      setPasted(text)
      setSavedCount(null)
      setError('')
    }
  }

  const guardar = useCallback(async () => {
    if (mapping.records.length === 0) return
    setSaving(true)
    setError('')
    try {
      // delete + insert por (fecha, tipo) para hacer el guardado idempotente
      const { error: delErr } = await supabase
        .from('tiempos_operacion')
        .delete()
        .eq('fecha', fecha)
        .eq('tipo', tipo)
      if (delErr) throw delErr

      const { error: insErr } = await supabase
        .from('tiempos_operacion')
        .insert(mapping.records)
      if (insErr) throw insErr

      setSavedCount(mapping.records.length)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }, [mapping, fecha, tipo])

  const limpiar = () => {
    setPasted('')
    setSavedCount(null)
    setError('')
  }

  const def = TIPOS[tipo]

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>CAPTURA DE TIEMPOS</h1>
              <p className="text-sm text-gris-texto mt-1">
                Pega celdas directamente desde Google Sheets o Excel. Se guardan en la timeline operativa.
              </p>
            </div>
            <label className="text-sm font-semibold">
              Fecha
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="ml-2 rounded-lg border border-gris-claro px-3 py-2 focus:border-verde-fresco focus:outline-none"
              />
            </label>
          </div>

          {/* Tipo selector */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(TIPOS).map(([id, t]) => (
              <button
                key={id}
                onClick={() => { setTipo(id); setSavedCount(null); setError('') }}
                className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                  tipo === id
                    ? 'bg-verde-botella text-blanco'
                    : 'bg-gris-claro text-gris-texto hover:bg-verde-claro hover:text-blanco'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Instrucciones */}
          <div className="bg-verde-claro/10 border-l-4 border-verde-fresco p-4 rounded text-sm">
            <p className="font-semibold mb-2">{def.descripcion}</p>
            <p className="text-gris-texto">
              Columnas esperadas (mínimo): <strong>{def.entidadLabel}</strong>, <strong>Inicio</strong>, <strong>Fin</strong>.
              Opcional: <strong>Observaciones</strong>.
            </p>
            <p className="text-gris-texto mt-1 text-xs">
              Acepta encabezados flexibles: «Salida», «Hora inicio», «RK», «Recorrido», «Término», etc.
              Tiempos en formato HH:MM o HH:MM:SS.
            </p>
          </div>

          {/* Textarea de paste */}
          <div className="bg-blanco rounded-lg shadow-card p-4">
            <label className="block text-sm font-semibold mb-2">
              Pega aquí los datos (incluye la fila de encabezados):
            </label>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              onPaste={handlePaste}
              placeholder={`Ejemplo:\nRuta\tInicio\tFin\nRK1601\t08:30\t13:45\nRK1602\t08:35\t14:10`}
              className="w-full h-40 rounded-lg border border-gris-claro p-3 font-mono text-sm focus:border-verde-fresco focus:outline-none"
            />
            <div className="flex justify-between items-center mt-2 text-xs text-gris-texto">
              <span>{parsed.rows.length} fila(s) detectada(s)</span>
              {pasted && (
                <button onClick={limpiar} className="text-rojo hover:underline">
                  Limpiar
                </button>
              )}
            </div>
          </div>

          {/* Errores de mapping */}
          {pasted && mapping.errors.length > 0 && (
            <div className="bg-rojo/10 border border-rojo text-rojo rounded p-3 text-sm">
              <p className="font-semibold mb-1">No puedo procesar lo que pegaste:</p>
              <ul className="list-disc pl-5">
                {mapping.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          {/* Preview */}
          {mapping.records.length > 0 && (
            <div className="bg-blanco rounded-lg shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-gris-claro flex justify-between items-center">
                <h3 className={`${bebasNeue.className} text-xl text-verde-botella`}>
                  Preview ({mapping.records.length} {mapping.records.length === 1 ? 'fila' : 'filas'})
                </h3>
                <button
                  onClick={guardar}
                  disabled={saving}
                  className={`rounded-lg px-4 py-2 text-sm font-bold ${
                    saving
                      ? 'bg-gris-claro text-gris-texto cursor-not-allowed'
                      : 'bg-verde-botella text-blanco hover:bg-verde-fresco'
                  }`}
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="table-audicen">
                  <thead>
                    <tr>
                      <th>{def.entidadLabel}</th>
                      <th>Inicio</th>
                      <th>Fin</th>
                      <th>Duración</th>
                      <th>Observaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.records.slice(0, 50).map((r, i) => (
                      <tr key={i}>
                        <td className="font-semibold">{r.entidad}</td>
                        <td className="font-mono text-sm">{r.inicio || '—'}</td>
                        <td className="font-mono text-sm">{r.fin || '—'}</td>
                        <td className="text-gris-texto text-sm">{durationLabel(r.inicio, r.fin)}</td>
                        <td className="text-gris-texto text-xs">{r.observaciones || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {mapping.records.length > 50 && (
                  <p className="px-4 py-2 text-xs text-gris-texto">…y {mapping.records.length - 50} filas más</p>
                )}
              </div>
            </div>
          )}

          {/* Estado */}
          {savedCount != null && (
            <div className="bg-verde-fresco/15 border border-verde-fresco text-verde-botella rounded p-3 text-sm font-semibold">
              ✓ Guardadas {savedCount} filas en {def.label} para {fecha}.
            </div>
          )}
          {error && (
            <div className="bg-rojo/10 border border-rojo text-rojo rounded p-3 text-sm">
              Error guardando: {error}
            </div>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}

function durationLabel(inicio, fin) {
  if (!inicio || !fin) return '—'
  const [h1, m1] = inicio.split(':').map(Number)
  const [h2, m2] = fin.split(':').map(Number)
  let diff = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (diff < 0) diff += 24 * 60
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
