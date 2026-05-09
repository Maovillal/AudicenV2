import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFechaGlobal } from '@/lib/useFecha'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { bebasNeue } from './_app'

// Convierte 'HH:MM' o 'HH:MM:SS' → minutos desde 00:00. Null si no parsea.
function hhmmToMin(s) {
  if (!s) return null
  const parts = String(s).split(':').map((x) => parseFloat(x))
  if (!Number.isFinite(parts[0])) return null
  return (parts[0] || 0) * 60 + (parts[1] || 0)
}

function minToHHMM(m) {
  if (m == null) return '—'
  const h = Math.floor(m / 60).toString().padStart(2, '0')
  const min = (m % 60).toString().padStart(2, '0')
  return `${h}:${min}`
}

// Definición de las fases del día. Cada una tiene un color y de dónde sacar
// los minutos de inicio/fin por ruta.
const FASES = [
  {
    id: 'armado',
    label: 'Armado de cargas',
    color: '#2E9944',
    bg: 'bg-verde-fresco',
    descripcion: 'Preparación de cargas (para el día siguiente)',
    source: 'tiempos_carga',
    pickStart: (r) => hhmmToMin(r.inicio_carga),
    pickEnd: (r) => hhmmToMin(r.fin_carga),
  },
  {
    id: 'embarque',
    label: 'Embarque',
    color: '#F5C800',
    bg: 'bg-dorado',
    descripcion: 'Carga del producto al camión',
    source: 'tiempos_carga',
    pickStart: (r) => hhmmToMin(r.inicio_embarque),
    pickEnd: (r) => hhmmToMin(r.fin_embarque),
  },
  {
    id: 'ruta',
    label: 'Salida → Entrada',
    color: '#1A6B2F',
    bg: 'bg-verde-campo',
    descripcion: 'Ruta en la calle (salida hasta retorno)',
    source: 'nivel_servicio',
    pickStart: (r) => hhmmToMin(r.hora_inicio),
    pickEnd: (r) => hhmmToMin(r.hora_termino),
  },
]

const FASES_PENDIENTES = [
  { id: 'liquidacion', label: 'Liquidación', color: '#9333ea', descripcion: 'Liquidación post-retorno (datos por integrar)' },
  { id: 'fulles', label: 'Atención a fulles', color: '#ea580c', descripcion: 'Atención a camiones full (datos por integrar)' },
]

// Eje del Gantt: cada 2 horas. 13 marcas para 00:00 → 24:00.
const HORAS_EJE = Array.from({ length: 13 }, (_, i) => i * 2)

export default function TimelinePage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [tiemposCarga, setTiemposCarga] = useState([])
  const [nivelServicio, setNivelServicio] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tc, ns] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase.from('tiempos_carga').select('*').eq('fecha', fecha).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('nivel_servicio').select('*').eq('fecha', fecha).range(from, to)
        ),
      ])
      setTiemposCarga(tc)
      setNivelServicio(ns)
    } catch (e) {
      console.error('[timeline] error:', e)
      setTiemposCarga([])
      setNivelServicio([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => { load() }, [load])

  // Combinar las dos fuentes en una estructura por ruta:
  // { ruta: 'RK1601', armado: {start,end}, embarque: {start,end}, ruta: {start,end} }
  const rutasData = useMemo(() => {
    const byRuta = new Map()

    for (const r of tiemposCarga) {
      const key = String(r.ruta || '').trim()
      if (!key) continue
      if (!byRuta.has(key)) byRuta.set(key, { ruta: key })
      const acc = byRuta.get(key)
      const armadoStart = hhmmToMin(r.inicio_carga)
      const armadoEnd = hhmmToMin(r.fin_carga)
      const embarqueStart = hhmmToMin(r.inicio_embarque)
      const embarqueEnd = hhmmToMin(r.fin_embarque)
      if (armadoStart != null && armadoEnd != null) acc.armado = { start: armadoStart, end: armadoEnd }
      if (embarqueStart != null && embarqueEnd != null) acc.embarque = { start: embarqueStart, end: embarqueEnd }
    }

    for (const r of nivelServicio) {
      const key = String(r.ruta || '').trim()
      if (!key) continue
      if (!byRuta.has(key)) byRuta.set(key, { ruta: key })
      const acc = byRuta.get(key)
      const start = hhmmToMin(r.hora_inicio)
      const end = hhmmToMin(r.hora_termino)
      if (start != null && end != null) acc.ruta_calle = { start, end }
    }

    return [...byRuta.values()].sort((a, b) => a.ruta.localeCompare(b.ruta))
  }, [tiemposCarga, nivelServicio])

  // Para el resumen
  const rutasConData = rutasData.filter((r) => r.armado || r.embarque || r.ruta_calle)

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>TIMELINE OPERATIVA</h1>
              <p className="text-sm text-gris-texto mt-1">
                Vista cronológica del día por ruta · {rutasConData.length} ruta{rutasConData.length !== 1 ? 's' : ''} con datos
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

          {/* Leyenda */}
          <div className="flex flex-wrap gap-3 text-sm">
            {FASES.map((f) => (
              <div key={f.id} className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: f.color }} />
                <span className="font-semibold">{f.label}</span>
                <span className="text-gris-texto text-xs">— {f.descripcion}</span>
              </div>
            ))}
            {FASES_PENDIENTES.map((f) => (
              <div key={f.id} className="flex items-center gap-2 opacity-50">
                <div className="w-4 h-4 rounded border border-dashed" style={{ borderColor: f.color }} />
                <span className="font-semibold">{f.label}</span>
                <span className="text-gris-texto text-xs">— {f.descripcion}</span>
              </div>
            ))}
          </div>

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
          ) : rutasConData.length === 0 ? (
            <div className="rounded-[12px] border border-gris-claro bg-white px-6 py-12 text-center shadow-card">
              <p className="text-gris-texto">No hay datos de tiempos para esta fecha.</p>
              <p className="mt-1 text-sm text-gris-texto">Sube los archivos de Tiempos de Cargas y Nivel de Servicio.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
              <div className="min-w-[800px]">
                {/* Eje del tiempo */}
                <div className="flex border-b border-gris-claro bg-gris-claro/30">
                  <div className="w-24 shrink-0 px-3 py-2 text-xs font-bold text-gris-texto">RUTA</div>
                  <div className="flex-1 relative h-8">
                    {HORAS_EJE.map((h) => (
                      <div
                        key={h}
                        className="absolute top-0 bottom-0 border-l border-gris-claro text-[10px] text-gris-texto pl-1 pt-1"
                        style={{ left: `${(h / 24) * 100}%` }}
                      >
                        {String(h).padStart(2, '0')}:00
                      </div>
                    ))}
                  </div>
                </div>

                {/* Filas por ruta */}
                {rutasConData.map((r) => (
                  <div key={r.ruta} className="flex border-b border-gris-claro hover:bg-gris-claro/20">
                    <div className="w-24 shrink-0 px-3 py-3 text-sm font-semibold text-verde-botella border-r border-gris-claro">
                      {r.ruta}
                    </div>
                    <div className="flex-1 relative h-12">
                      {/* Líneas verticales del eje, repetidas en cada fila */}
                      {HORAS_EJE.map((h) => (
                        <div
                          key={h}
                          className="absolute top-0 bottom-0 border-l border-gris-claro/40"
                          style={{ left: `${(h / 24) * 100}%` }}
                        />
                      ))}
                      {/* Barras de cada fase */}
                      {FASES.map((f) => {
                        const fase = f.id === 'ruta' ? r.ruta_calle : r[f.id]
                        if (!fase) return null
                        const left = (fase.start / (24 * 60)) * 100
                        const width = Math.max(1, ((fase.end - fase.start) / (24 * 60)) * 100)
                        return (
                          <div
                            key={f.id}
                            className="absolute top-1 h-10 rounded text-[10px] text-white font-semibold flex items-center justify-center px-1 shadow-sm"
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              backgroundColor: f.color,
                              minWidth: '24px',
                            }}
                            title={`${f.label}: ${minToHHMM(fase.start)} → ${minToHHMM(fase.end)} (${fase.end - fase.start} min)`}
                          >
                            {width > 6 ? `${minToHHMM(fase.start)}-${minToHHMM(fase.end)}` : ''}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabla de detalle */}
          {!loading && rutasConData.length > 0 && (
            <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
              <table className="table-audicen">
                <thead>
                  <tr>
                    <th>Ruta</th>
                    <th>Armado</th>
                    <th>Embarque</th>
                    <th>Salida → Entrada</th>
                    <th>Liquidación</th>
                    <th>Atención fulles</th>
                  </tr>
                </thead>
                <tbody>
                  {rutasConData.map((r) => (
                    <tr key={r.ruta}>
                      <td className="font-semibold text-verde-botella">{r.ruta}</td>
                      <td>{r.armado ? `${minToHHMM(r.armado.start)}–${minToHHMM(r.armado.end)}` : '—'}</td>
                      <td>{r.embarque ? `${minToHHMM(r.embarque.start)}–${minToHHMM(r.embarque.end)}` : '—'}</td>
                      <td>{r.ruta_calle ? `${minToHHMM(r.ruta_calle.start)}–${minToHHMM(r.ruta_calle.end)}` : '—'}</td>
                      <td className="text-gris-texto italic text-xs">pendiente</td>
                      <td className="text-gris-texto italic text-xs">pendiente</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
