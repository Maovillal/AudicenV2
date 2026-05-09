import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO, subDays, startOfMonth } from 'date-fns'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { useFechaGlobal } from '@/lib/useFecha'
import { formatNumber, parseNumber } from '@/lib/format'
import { bebasNeue } from './_app'

// CHECKLIST esperado por turno (mismo que /upload). Se usa para detectar
// reportes faltantes — si el upload_log del período no tiene una entrada
// para uno de estos, se reporta como faltante.
const CHECKLIST_DIA = [
  { id: 't1_inicio_liq',   tipo: 'inventario_liquido',  turno: 1, momento: 'inicio', label: 'Inicio 2000 (T1)' },
  { id: 't1_inicio_env',   tipo: 'inventario_envase',   turno: 1, momento: 'inicio', label: 'Inicio 2010 (T1)' },
  { id: 't1_inicio_conc',  tipo: 'conciliacion_envase', turno: 1, momento: 'inicio', label: 'Conciliación T1 inicio' },
  { id: 't1_cierre_liq',   tipo: 'inventario_liquido',  turno: 1, momento: 'cierre', label: 'Cierre 2000 (T1)' },
  { id: 't1_cierre_env',   tipo: 'inventario_envase',   turno: 1, momento: 'cierre', label: 'Cierre 2010 (T1)' },
  { id: 't1_cierre_conc',  tipo: 'conciliacion_envase', turno: 1, momento: 'cierre', label: 'Conciliación T1 cierre' },
  { id: 't2_cierre_env',   tipo: 'inventario_envase',   turno: 2, momento: 'cierre', label: 'Cierre 2010 (T2)' },
  { id: 't2_cierre_conc',  tipo: 'conciliacion_envase', turno: 2, momento: 'cierre', label: 'Conciliación T2 cierre' },
  { id: 't2_cierre_ing',   tipo: 'ingreso_envase',      turno: 2, momento: 'cierre', label: 'Ingreso de envase' },
  { id: 't3_cierre_liq',   tipo: 'inventario_liquido',  turno: 3, momento: 'cierre', label: 'Cierre 2000 (T3)' },
  { id: 't3_cierre_fis',   tipo: 'conteo_fisico',       turno: 3, momento: 'cierre', label: 'Conteo físico' },
]

const PERIODOS = [
  { id: 'hoy',    label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes',    label: 'Este mes' },
]

function rangoFechas(fecha, periodo) {
  const f = parseISO(fecha)
  if (periodo === 'hoy')    return { desde: fecha, hasta: fecha }
  if (periodo === 'semana') return { desde: format(subDays(f, 6), 'yyyy-MM-dd'), hasta: fecha }
  if (periodo === 'mes')    return { desde: format(startOfMonth(f), 'yyyy-MM-dd'), hasta: fecha }
  return { desde: fecha, hasta: fecha }
}

function sumField(rows, field) {
  return (rows || []).reduce((acc, r) => acc + parseNumber(r[field]), 0)
}

function sumAbs(rows, field) {
  return (rows || []).reduce((acc, r) => acc + Math.abs(parseNumber(r[field])), 0)
}

export default function ReportesPage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [periodo, setPeriodo] = useState('hoy')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  const { desde, hasta } = useMemo(() => rangoFechas(fecha, periodo), [fecha, periodo])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [salidas, ingreso, conteo, mermas, uploads] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase.from('salidas_rutas').select('cantidad,fecha')
            .gte('fecha', desde).lte('fecha', hasta).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('ingreso_envase').select('env_rec,fecha')
            .gte('fecha', desde).lte('fecha', hasta).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('conteo_fisico').select('sku,descripcion,diferencia,fecha')
            .gte('fecha', desde).lte('fecha', hasta).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('conteo_fisico').select('merma_total,merma_operativa,merma_dora,fecha')
            .gte('fecha', desde).lte('fecha', hasta).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('upload_log').select('tipo_archivo,turno,momento,fecha,registros')
            .gte('fecha', desde).lte('fecha', hasta).range(from, to)
        ),
      ])

      // KPIs
      const kpiCajas   = sumField(salidas, 'cantidad')
      const kpiIngreso = sumField(ingreso, 'env_rec')
      const kpiMermas  = sumField(mermas, 'merma_total') + sumField(mermas, 'merma_operativa') + sumField(mermas, 'merma_dora')

      // Anomalías: filas de conteo_fisico con |diferencia| significativa.
      const umbralAnomalia = 10  // cajas — configurable después
      const anomalias = (conteo || [])
        .filter((r) => Math.abs(parseNumber(r.diferencia)) > umbralAnomalia)
      const kpiAnomalias = anomalias.length

      // Top SKUs con mayor desviación absoluta
      const topDiffs = [...(conteo || [])]
        .map((r) => ({ ...r, _abs: Math.abs(parseNumber(r.diferencia)) }))
        .sort((a, b) => b._abs - a._abs)
        .slice(0, 10)

      // Reportes faltantes: por cada día del rango y cada item del CHECKLIST,
      // verificar si existe la entrada correspondiente en upload_log.
      const presentes = new Set(
        (uploads || []).map((u) => `${u.fecha}|${u.tipo_archivo}|${u.turno}|${u.momento}`)
      )
      const faltantes = []
      const dias = diasEntre(desde, hasta)
      for (const d of dias) {
        for (const item of CHECKLIST_DIA) {
          const key = `${d}|${item.tipo}|${item.turno}|${item.momento}`
          if (!presentes.has(key)) {
            faltantes.push({ fecha: d, ...item })
          }
        }
      }

      setData({
        kpiCajas, kpiIngreso, kpiMermas, kpiAnomalias,
        anomalias, topDiffs, faltantes,
      })
    } catch (e) {
      console.error('Error cargando reportes:', e)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [desde, hasta])

  useEffect(() => { load() }, [load])

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>REPORTES & AUDITORÍA</h1>
              <p className="text-gris-texto text-sm mt-1">
                Período: <span className="font-semibold">{labelRango(desde, hasta)}</span>
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <label className="text-sm font-semibold">
                Fecha tope:
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="ml-2 rounded-lg border border-gris-claro px-3 py-2 focus:border-verde-fresco focus:outline-none"
                />
              </label>
            </div>
          </div>

          {/* Selector de período */}
          <div className="flex gap-2 border-b border-gris-claro pb-2">
            {PERIODOS.map((p) => {
              const active = periodo === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => setPeriodo(p.id)}
                  className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors duration-150 ${
                    active
                      ? 'bg-verde-botella text-blanco'
                      : 'bg-gris-claro text-gris-texto hover:bg-verde-claro hover:text-blanco'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          {loading && <p className="text-gris-texto">Cargando…</p>}

          {!loading && data && (
            <>
              {/* KPIs */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard label="Cajas despachadas" value={data.kpiCajas} />
                <KpiCard label="Ingreso de envase" value={data.kpiIngreso} />
                <KpiCard label="Mermas (acum)" value={data.kpiMermas} variant={data.kpiMermas > 0 ? 'warn' : 'ok'} />
                <KpiCard label="Anomalías detectadas" value={data.kpiAnomalias} variant={data.kpiAnomalias > 0 ? 'danger' : 'ok'} />
              </section>

              {/* Reportes faltantes */}
              <section className="bg-blanco rounded-lg shadow-card p-5">
                <h2 className={`${bebasNeue.className} text-2xl text-verde-botella mb-3`}>
                  Reportes faltantes ({data.faltantes.length})
                </h2>
                {data.faltantes.length === 0 ? (
                  <p className="text-verde-fresco font-semibold">Todos los reportes esperados llegaron en el período.</p>
                ) : (
                  <ul className="text-sm divide-y divide-gris-claro">
                    {data.faltantes.slice(0, 30).map((f) => (
                      <li key={`${f.fecha}-${f.id}`} className="py-2 flex justify-between gap-4">
                        <span><span className="text-gris-texto">{f.fecha}</span> — {f.label}</span>
                        <span className="text-rojo font-semibold">FALTA</span>
                      </li>
                    ))}
                    {data.faltantes.length > 30 && (
                      <li className="py-2 text-gris-texto">…y {data.faltantes.length - 30} más</li>
                    )}
                  </ul>
                )}
              </section>

              {/* Top diferencias */}
              <section className="bg-blanco rounded-lg shadow-card p-5">
                <h2 className={`${bebasNeue.className} text-2xl text-verde-botella mb-3`}>
                  Top 10 diferencias por SKU (físico vs sistema)
                </h2>
                {data.topDiffs.length === 0 ? (
                  <p className="text-gris-texto">Sin conteos físicos registrados en el período.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-gris-texto border-b border-gris-claro">
                        <tr>
                          <th className="py-2">Fecha</th>
                          <th className="py-2">SKU</th>
                          <th className="py-2">Descripción</th>
                          <th className="py-2 text-right">Diferencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topDiffs.map((r, i) => (
                          <tr key={`${r.fecha}-${r.sku}-${i}`} className="border-b border-gris-claro">
                            <td className="py-2 text-gris-texto">{r.fecha}</td>
                            <td className="py-2 font-mono">{r.sku}</td>
                            <td className="py-2">{r.descripcion}</td>
                            <td className={`py-2 text-right font-semibold ${
                              parseNumber(r.diferencia) < 0 ? 'text-rojo' : 'text-verde-fresco'
                            }`}>
                              {formatNumber(parseNumber(r.diferencia))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}

          {!loading && !data && (
            <p className="text-rojo">Error cargando datos. Revisa la consola.</p>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}

function KpiCard({ label, value, variant = 'default' }) {
  const colorClass = {
    default: 'text-verde-botella',
    ok:      'text-verde-fresco',
    warn:    'text-ambar',
    danger:  'text-rojo',
  }[variant]
  return (
    <div className="bg-blanco rounded-lg shadow-card p-5">
      <p className="text-xs uppercase tracking-wide text-gris-texto">{label}</p>
      <p className={`${bebasNeue.className} text-4xl mt-2 ${colorClass}`}>
        {formatNumber(value || 0)}
      </p>
    </div>
  )
}

function diasEntre(desdeISO, hastaISO) {
  const out = []
  const d = parseISO(desdeISO)
  const h = parseISO(hastaISO)
  for (let cur = d; cur <= h; cur = new Date(cur.getTime() + 86400000)) {
    out.push(format(cur, 'yyyy-MM-dd'))
  }
  return out
}

function labelRango(desde, hasta) {
  if (desde === hasta) return desde
  return `${desde} → ${hasta}`
}
