import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, addDays, parseISO, subDays } from 'date-fns'
import { useFechaGlobal } from '@/lib/useFecha'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { parseNumber } from '@/lib/format'
import { bebasNeue } from './_app'

// ─── Helpers de tiempo ─────────────────────────────────────────────────────

function hhmmToMin(s) {
  if (!s) return null
  const p = String(s).split(':').map((x) => parseFloat(x))
  if (!Number.isFinite(p[0])) return null
  return (p[0] || 0) * 60 + (p[1] || 0)
}
function minToHHMM(m) {
  if (m == null || !Number.isFinite(m)) return '—'
  const total = Math.round(m) % (24 * 60)
  const h = Math.floor(total / 60).toString().padStart(2, '0')
  const min = (total % 60).toString().padStart(2, '0')
  return `${h}:${min}`
}

// Regresión lineal simple. Devuelve { slope, intercept } o null si n<2.
function regresionLineal(pairs) {
  const n = pairs.length
  if (n < 2) return null
  let sx = 0, sy = 0, sxy = 0, sx2 = 0
  for (const [x, y] of pairs) { sx += x; sy += y; sxy += x * y; sx2 += x * x }
  const denom = n * sx2 - sx * sx
  if (denom === 0) return null  // todos los X iguales → no podemos sacar pendiente
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  return { slope, intercept }
}

function predicccion(pairs, cajas, globalRatio) {
  const n = pairs.length
  if (n >= 2) {
    const reg = regresionLineal(pairs)
    if (reg) return reg.slope * cajas + reg.intercept
  }
  if (n >= 1) {
    // Ratio simple por ruta
    const totMin = pairs.reduce((a, [, y]) => a + y, 0)
    const totCajas = pairs.reduce((a, [x]) => a + x, 0)
    if (totCajas > 0) return (totMin / totCajas) * cajas
  }
  // Fallback: ratio global de todas las rutas
  if (globalRatio != null) return globalRatio * cajas
  return null
}

function nivelConfianza(n) {
  if (n >= 10) return { label: 'Alta', color: 'bg-verde-fresco text-blanco', icon: '●' }
  if (n >= 3)  return { label: 'Media', color: 'bg-dorado text-negro', icon: '●' }
  if (n >= 1)  return { label: 'Baja', color: 'bg-ambar text-blanco', icon: '●' }
  return { label: 'Estimado global', color: 'bg-rojo text-blanco', icon: '◐' }
}

// ─── Componente ────────────────────────────────────────────────────────────

export default function ProyeccionesPage() {
  const [fechaActual] = useFechaGlobal()
  const [fechaObjetivo, setFechaObjetivo] = useState(format(addDays(parseISO(fechaActual), 1), 'yyyy-MM-dd'))
  const [historico, setHistorico] = useState([])  // { fecha, ruta, cajas, minutos }
  const [horaInicioPorRuta, setHoraInicioPorRuta] = useState(new Map())
  const [planeadasInput, setPlaneadasInput] = useState({})  // { ruta: cajas } manual
  const [loading, setLoading] = useState(true)

  // Ventana histórica = últimos 60 días antes de fechaObjetivo
  const desde = useMemo(
    () => format(subDays(parseISO(fechaObjetivo), 60), 'yyyy-MM-dd'),
    [fechaObjetivo],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Histórico para PROYECCIÓN DE LLEGADA = solo tiempos_operacion tipo='rutas'
      // (lo que el supervisor captura como "ruta en campo"). NO usamos
      // nivel_servicio porque ese mide otra cosa: tiempo de liquidación
      // post-llegada (cuánto tarda el supervisor en cerrar la ruta).
      const [salidas, op] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase.from('salidas_rutas').select('fecha,ruta,cantidad')
            .gte('fecha', desde).lt('fecha', fechaObjetivo).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('tiempos_operacion').select('fecha,entidad,inicio,fin')
            .eq('tipo', 'rutas').gte('fecha', desde).lt('fecha', fechaObjetivo).range(from, to)
        ),
      ])

      // Index salidas: cajas por (fecha, ruta)
      const cajasMap = new Map()
      for (const s of salidas) {
        const key = `${s.fecha}|${s.ruta}`
        cajasMap.set(key, (cajasMap.get(key) || 0) + parseNumber(s.cantidad))
      }

      // Construir minutos en campo + horas de salida desde la captura.
      const minutosMap = new Map()
      const horasInicio = new Map()  // ruta → [hora_inicio_min, ...]
      for (const r of op) {
        const mIni = hhmmToMin(r.inicio)
        const mFin = hhmmToMin(r.fin)
        if (mIni == null || mFin == null) continue
        let dur = mFin - mIni
        if (dur < 0) dur += 24 * 60
        const key = `${r.fecha}|${r.entidad}`
        minutosMap.set(key, dur)
        if (!horasInicio.has(r.entidad)) horasInicio.set(r.entidad, [])
        horasInicio.get(r.entidad).push(mIni)
      }

      // Combinar: pares (fecha, ruta) que existen en AMBOS
      const hist = []
      for (const [key, cajas] of cajasMap) {
        const minutos = minutosMap.get(key)
        if (minutos == null) continue
        const [fecha, ruta] = key.split('|')
        if (cajas > 0) hist.push({ fecha, ruta, cajas, minutos })
      }
      setHistorico(hist)

      // Promedio de hora_inicio por ruta
      const avgHora = new Map()
      for (const [ruta, lista] of horasInicio) {
        if (lista.length > 0) {
          avgHora.set(ruta, lista.reduce((a, b) => a + b, 0) / lista.length)
        }
      }
      setHoraInicioPorRuta(avgHora)
    } catch (e) {
      console.error('[proyecciones] error:', e)
      setHistorico([])
      setHoraInicioPorRuta(new Map())
    } finally {
      setLoading(false)
    }
  }, [desde, fechaObjetivo])

  useEffect(() => { load() }, [load])

  // Lista de rutas conocidas (las que aparecen en el histórico) + las que el
  // usuario escriba a mano en planeadasInput.
  const rutasConocidas = useMemo(() => {
    const set = new Set(historico.map((h) => h.ruta))
    for (const r of Object.keys(planeadasInput)) set.add(r)
    return [...set].sort()
  }, [historico, planeadasInput])

  // Pairs por ruta para la regresión
  const pairsPorRuta = useMemo(() => {
    const m = new Map()
    for (const h of historico) {
      if (!m.has(h.ruta)) m.set(h.ruta, [])
      m.get(h.ruta).push([h.cajas, h.minutos])
    }
    return m
  }, [historico])

  // Ratio global (denominador para fallback) usando todos los pairs
  const ratioGlobal = useMemo(() => {
    let totMin = 0, totCajas = 0
    for (const h of historico) { totMin += h.minutos; totCajas += h.cajas }
    return totCajas > 0 ? totMin / totCajas : null
  }, [historico])

  // Filas de proyección
  const filas = useMemo(() => {
    return rutasConocidas.map((ruta) => {
      const cajas = parseNumber(planeadasInput[ruta]) || 0
      const pairs = pairsPorRuta.get(ruta) || []
      const horaIni = horaInicioPorRuta.get(ruta)
      const minutosPred = cajas > 0 ? predicccion(pairs, cajas, ratioGlobal) : null
      const horaTermPred = (horaIni != null && minutosPred != null) ? horaIni + minutosPred : null
      const conf = nivelConfianza(pairs.length)
      return {
        ruta, cajas, n: pairs.length,
        horaInicio: horaIni,
        minutos: minutosPred,
        horaTermino: horaTermPred,
        conf,
      }
    })
  }, [rutasConocidas, planeadasInput, pairsPorRuta, horaInicioPorRuta, ratioGlobal])

  const setPlaneadas = (ruta, value) => {
    setPlaneadasInput((p) => ({ ...p, [ruta]: value }))
  }

  const agregarRuta = () => {
    const nombre = prompt('Nombre de la ruta nueva (ej. RK1621):')
    if (!nombre) return
    setPlaneadasInput((p) => ({ ...p, [nombre.trim()]: '' }))
  }

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>PROYECCIONES DE LLEGADA</h1>
              <p className="text-sm text-gris-texto mt-1">
                Estima la hora en que cada ruta retorna a la base, usando solo los
                tiempos de ruta en campo que has capturado (Captura Tiempos →
                «Rutas»). Se recalibra solo conforme capturas más días.
              </p>
            </div>
            <label className="text-sm font-semibold">
              Fecha a proyectar
              <input
                type="date"
                value={fechaObjetivo}
                onChange={(e) => setFechaObjetivo(e.target.value)}
                className="ml-2 rounded-lg border border-gris-claro px-3 py-2 focus:border-verde-fresco focus:outline-none"
              />
            </label>
          </div>

          {/* Resumen de calidad de data */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Días en historial" value={new Set(historico.map((h) => h.fecha)).size} />
            <KpiCard label="Rutas con datos" value={pairsPorRuta.size} />
            <KpiCard label="Pares (cajas, min)" value={historico.length} />
            <KpiCard
              label="Ratio global (min/caja)"
              value={ratioGlobal != null ? ratioGlobal.toFixed(2) : '—'}
            />
          </div>

          {/* Acción: agregar ruta nueva */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-gris-texto">
              Llena las cajas planeadas para cada ruta. La proyección se actualiza al instante.
            </p>
            <button
              onClick={agregarRuta}
              className="rounded-lg border border-verde-botella text-verde-botella px-3 py-1.5 text-xs font-bold hover:bg-verde-botella hover:text-blanco"
            >
              + Agregar ruta
            </button>
          </div>

          {loading ? (
            <p className="text-gris-texto">Cargando histórico…</p>
          ) : filas.length === 0 ? (
            <div className="rounded-[12px] border border-gris-claro bg-white px-6 py-12 text-center shadow-card">
              <p className="text-gris-texto">No hay rutas conocidas todavía.</p>
              <p className="mt-1 text-sm text-gris-texto">
                Agrega manualmente la primera ruta o captura tiempos en /captura-tiempos para empezar a poblar el histórico.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
              <table className="table-audicen">
                <thead>
                  <tr>
                    <th>Ruta</th>
                    <th>Cajas planeadas</th>
                    <th>Datos históricos</th>
                    <th>Confianza</th>
                    <th>Hora salida típica</th>
                    <th>Minutos estimados</th>
                    <th>Hora llegada estimada</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.ruta}>
                      <td className="font-semibold text-verde-botella">{f.ruta}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={planeadasInput[f.ruta] ?? ''}
                          onChange={(e) => setPlaneadas(f.ruta, e.target.value)}
                          placeholder="—"
                          className="w-24 rounded border border-gris-claro px-2 py-1 text-sm focus:border-verde-fresco focus:outline-none"
                        />
                      </td>
                      <td className="text-center text-sm">{f.n}</td>
                      <td>
                        <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${f.conf.color}`}>
                          {f.conf.label}
                        </span>
                      </td>
                      <td className="font-mono text-sm">{minToHHMM(f.horaInicio)}</td>
                      <td className="text-sm">
                        {f.minutos != null ? `${Math.round(f.minutos)} min` : '—'}
                      </td>
                      <td className="font-mono font-bold text-verde-botella">
                        {minToHHMM(f.horaTermino)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Leyenda */}
          <div className="text-xs text-gris-texto bg-gris-claro/30 p-3 rounded">
            <p className="font-semibold mb-1">¿Cómo se calcula?</p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><strong>≥ 10 datos</strong> de la ruta: regresión lineal (minutos = pendiente × cajas + tiempo fijo)</li>
              <li><strong>3-9 datos</strong>: misma regresión con menos puntos (mayor margen de error)</li>
              <li><strong>1-2 datos</strong>: promedio simple de minutos por caja</li>
              <li><strong>0 datos</strong>: ratio global de todas las rutas (estimado grueso)</li>
            </ul>
            <p className="mt-2">
              Mientras más tiempos captures en <strong>/captura-tiempos</strong> tipo «Rutas», las predicciones suben de confianza automáticamente.
            </p>
          </div>
        </div>
      </Layout>
    </AuthGuard>
  )
}

function KpiCard({ label, value }) {
  return (
    <div className="bg-blanco rounded-lg shadow-card p-4">
      <p className="text-xs uppercase tracking-wide text-gris-texto">{label}</p>
      <p className={`${bebasNeue.className} text-3xl mt-1 text-verde-botella`}>{value}</p>
    </div>
  )
}
