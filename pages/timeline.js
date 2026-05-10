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
    id: 'armado', label: 'Armado de cargas', color: '#2E9944',
    descripcion: 'Preparación de cargas (legacy: tiempos_carga)',
  },
  {
    id: 'embarque', label: 'Embarque', color: '#F5C800',
    descripcion: 'Carga del producto al camión (legacy: tiempos_carga)',
  },
  {
    id: 'tetra', label: 'Tetra', color: '#0EA5E9',
    descripcion: 'Operación Tetra (captura por pegado)',
  },
  {
    id: 'rutas', label: 'Salida → Entrada', color: '#1A6B2F',
    descripcion: 'Ruta en la calle (captura por pegado o nivel_servicio)',
  },
  {
    id: 'liquidacion', label: 'Liquidación', color: '#9333EA',
    descripcion: 'Liquidación post-retorno (captura por pegado)',
  },
  {
    id: 'fulles', label: 'Atención a fulles', color: '#EA580C',
    descripcion: 'Camiones full (captura por pegado)',
  },
]

const FASES_PENDIENTES = []

// Eje del Gantt: cada 2 horas. 13 marcas para 00:00 → 24:00.
const HORAS_EJE = Array.from({ length: 13 }, (_, i) => i * 2)

export default function TimelinePage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [tiemposCarga, setTiemposCarga] = useState([])
  const [nivelServicio, setNivelServicio] = useState([])
  const [tiemposOp, setTiemposOp] = useState([])  // captura por pegado
  const [proyecciones, setProyecciones] = useState([])  // hora_termino predicha
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tc, ns, op, pr] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase.from('tiempos_carga').select('*').eq('fecha', fecha).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('nivel_servicio').select('*').eq('fecha', fecha).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('tiempos_operacion').select('*').eq('fecha', fecha).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('proyecciones_rutas').select('*').eq('fecha', fecha).range(from, to)
        ),
      ])
      setTiemposCarga(tc)
      setNivelServicio(ns)
      setTiemposOp(op)
      setProyecciones(pr)
    } catch (e) {
      console.error('[timeline] error:', e)
      setTiemposCarga([])
      setNivelServicio([])
      setTiemposOp([])
      setProyecciones([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => { load() }, [load])

  // Combinar las fuentes en una estructura por ruta. Cada fase guarda {start, end}.
  // tiempos_carga (legacy) → armado, embarque
  // nivel_servicio (legacy) → rutas (fallback si no hay captura por pegado)
  // tiempos_operacion (captura) → todas las fases si están registradas
  const rutasData = useMemo(() => {
    const byRuta = new Map()

    function get(key) {
      if (!byRuta.has(key)) byRuta.set(key, { ruta: key })
      return byRuta.get(key)
    }

    // Legacy: tiempos_carga
    for (const r of tiemposCarga) {
      const key = String(r.ruta || '').trim()
      if (!key) continue
      const acc = get(key)
      const armadoStart = hhmmToMin(r.inicio_carga)
      const armadoEnd = hhmmToMin(r.fin_carga)
      const embStart = hhmmToMin(r.inicio_embarque)
      const embEnd = hhmmToMin(r.fin_embarque)
      if (armadoStart != null && armadoEnd != null) acc.armado = { start: armadoStart, end: armadoEnd }
      if (embStart != null && embEnd != null) acc.embarque = { start: embStart, end: embEnd }
    }

    // Legacy: nivel_servicio (fallback para 'rutas' si no se capturó por pegado)
    for (const r of nivelServicio) {
      const key = String(r.ruta || '').trim()
      if (!key) continue
      const acc = get(key)
      const start = hhmmToMin(r.hora_inicio)
      const end = hhmmToMin(r.hora_termino)
      if (start != null && end != null && !acc.rutas) {
        acc.rutas = { start, end }
      }
    }

    // Nuevo: tiempos_operacion (captura por pegado)
    for (const r of tiemposOp) {
      const key = String(r.entidad || '').trim()
      if (!key) continue
      const acc = get(key)
      const start = hhmmToMin(r.inicio)
      const end = hhmmToMin(r.fin)
      if (start != null && end != null) {
        acc[r.tipo] = { start, end }
      }
    }

    // Agregar hora_termino proyectada por ruta (si está guardada).
    for (const p of proyecciones) {
      const key = String(p.ruta || '').trim()
      if (!key) continue
      const acc = get(key)
      const proyectado = hhmmToMin(p.hora_termino_proyectada)
      if (proyectado != null) acc.proyeccion = proyectado
    }

    return [...byRuta.values()].sort((a, b) => a.ruta.localeCompare(b.ruta))
  }, [tiemposCarga, nivelServicio, tiemposOp, proyecciones])

  // Para el resumen — incluye también rutas que solo tienen proyección guardada
  const rutasConData = rutasData.filter((r) =>
    FASES.some((f) => r[f.id]) || r.proyeccion != null
  )

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
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-l-2 border-dashed border-rojo" />
              <span className="font-semibold">Llegada proyectada</span>
              <span className="text-gris-texto text-xs">— guardada desde /proyecciones</span>
            </div>
          </div>
          {proyecciones.length > 0 && (
            <div className="text-xs text-gris-texto">
              {proyecciones.length} ruta{proyecciones.length !== 1 ? 's' : ''} con proyección guardada para esta fecha.
            </div>
          )}

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
                    <div className="flex-1 relative h-14">
                      {/* Líneas verticales del eje, repetidas en cada fila */}
                      {HORAS_EJE.map((h) => (
                        <div
                          key={h}
                          className="absolute top-0 bottom-0 border-l border-gris-claro/40"
                          style={{ left: `${(h / 24) * 100}%` }}
                        />
                      ))}
                      {/* Línea vertical punteada en la hora_termino proyectada */}
                      {r.proyeccion != null && (
                        <div
                          className="absolute top-0 bottom-0 border-l-2 border-dashed border-rojo z-10"
                          style={{ left: `${(r.proyeccion / (24 * 60)) * 100}%` }}
                          title={`Llegada proyectada: ${minToHHMM(r.proyeccion)}`}
                        >
                          <div className="absolute -top-1 -translate-x-1/2 text-[9px] font-bold text-rojo bg-white px-1 rounded whitespace-nowrap">
                            ▼ {minToHHMM(r.proyeccion)}
                          </div>
                        </div>
                      )}
                      {/* Barras de cada fase */}
                      {FASES.map((f, idx) => {
                        const fase = r[f.id]
                        if (!fase) return null
                        const left = (fase.start / (24 * 60)) * 100
                        const width = Math.max(1, ((fase.end - fase.start) / (24 * 60)) * 100)
                        // Apilar verticalmente para que no se solapen visualmente cuando
                        // dos fases tienen rangos coincidentes.
                        const top = 1 + (idx % 3) * 14  // 3 niveles de stacking
                        return (
                          <div
                            key={f.id}
                            className="absolute h-3 rounded text-[9px] text-white font-semibold flex items-center justify-center px-1"
                            style={{
                              top: `${top}px`,
                              left: `${left}%`,
                              width: `${width}%`,
                              backgroundColor: f.color,
                              minWidth: '20px',
                            }}
                            title={`${f.label}: ${minToHHMM(fase.start)} → ${minToHHMM(fase.end)} (${fase.end - fase.start} min)`}
                          >
                            {width > 8 ? `${minToHHMM(fase.start)}-${minToHHMM(fase.end)}` : ''}
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
                    {FASES.map((f) => <th key={f.id}>{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rutasConData.map((r) => (
                    <tr key={r.ruta}>
                      <td className="font-semibold text-verde-botella">{r.ruta}</td>
                      {FASES.map((f) => {
                        const fase = r[f.id]
                        return (
                          <td key={f.id} className="text-sm">
                            {fase ? `${minToHHMM(fase.start)}–${minToHHMM(fase.end)}` : '—'}
                          </td>
                        )
                      })}
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
