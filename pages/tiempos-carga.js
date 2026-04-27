import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { bebasNeue } from './_app'

function minToHHMM(min) {
  if (min == null || isNaN(min)) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function TiemposCargaPage() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState([])
  const [limite, setLimite] = useState(30)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tiempos, config] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase
            .from('tiempos_carga')
            .select('*')
            .eq('fecha', fecha)
            .order('tiempo_carga', { ascending: false, nullsFirst: false })
            .range(from, to)
        ),
        supabase
          .from('configuracion')
          .select('valor')
          .eq('clave', 'tiempo_carga_maximo')
          .maybeSingle(),
      ])
      setRows(tiempos)
      const val = Number(config.data?.valor)
      if (!isNaN(val) && val > 0) setLimite(val)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => {
    if (!rows.length) return null
    const mins = rows.map((r) => r.tiempo_carga).filter((v) => v != null && !isNaN(v))
    if (!mins.length) return null
    const promedio = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length)
    const fuera = rows.filter((r) => (r.tiempo_carga ?? 0) > limite)
    const max = rows[0]
    return { promedio, fuera: fuera.length, total: rows.length, rutaLenta: max?.ruta, maxMin: max?.tiempo_carga }
  }, [rows, limite])

  const chartData = useMemo(() =>
    rows
      .filter((r) => r.tiempo_carga != null)
      .map((r) => ({ ruta: r.ruta, minutos: r.tiempo_carga, cajas: r.cajas ?? 0 })),
    [rows]
  )

  function barColor(value) {
    return value > limite ? '#C0392B' : '#2E7D32'
  }

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>TIEMPOS DE CARGA</h1>
              <p className="text-sm text-gris-texto">
                Límite configurado: <span className="font-semibold text-negro">{limite} min</span>
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

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-[12px] border border-gris-claro bg-white px-6 py-12 text-center shadow-card">
              <p className="text-gris-texto">No hay datos de tiempos de carga para esta fecha.</p>
              <p className="mt-1 text-sm text-gris-texto">Sube la hoja de Tiempos de Cargas en Turno 3 Cierre.</p>
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div className="rounded-[12px] border border-gris-claro bg-white px-5 py-4 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gris-texto">Rutas cargadas</p>
                  <p className={`${bebasNeue.className} mt-1 text-4xl text-verde-campo`}>{stats?.total ?? 0}</p>
                </div>
                <div className="rounded-[12px] border border-gris-claro bg-white px-5 py-4 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gris-texto">Promedio carga</p>
                  <p className={`${bebasNeue.className} mt-1 text-4xl ${(stats?.promedio ?? 0) > limite ? 'text-rojo' : 'text-verde-campo'}`}>
                    {stats ? minToHHMM(stats.promedio) : '—'}
                  </p>
                </div>
                <div className={`rounded-[12px] border bg-white px-5 py-4 shadow-card ${(stats?.fuera ?? 0) > 0 ? 'border-rojo' : 'border-gris-claro'}`}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gris-texto">Fuera de límite</p>
                  <p className={`${bebasNeue.className} mt-1 text-4xl ${(stats?.fuera ?? 0) > 0 ? 'text-rojo' : 'text-verde-campo'}`}>
                    {stats?.fuera ?? 0}
                  </p>
                </div>
                <div className="rounded-[12px] border border-gris-claro bg-white px-5 py-4 shadow-card">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gris-texto">Ruta más lenta</p>
                  <p className={`${bebasNeue.className} mt-1 text-2xl text-negro`}>{stats?.rutaLenta ?? '—'}</p>
                  <p className="text-xs text-gris-texto">{stats?.maxMin != null ? minToHHMM(stats.maxMin) : ''}</p>
                </div>
              </div>

              {/* Chart */}
              {chartData.length > 0 && (
                <div className="rounded-[12px] border border-gris-claro bg-white p-5 shadow-card">
                  <h2 className={`${bebasNeue.className} mb-4 text-xl text-verde-botella`}>MINUTOS POR RUTA</h2>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis
                        dataKey="ruta"
                        tick={{ fontSize: 11 }}
                        angle={-45}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis tick={{ fontSize: 11 }} unit=" min" />
                      <Tooltip
                        formatter={(value, name) => [minToHHMM(value), 'Tiempo de carga']}
                        labelFormatter={(label) => `Ruta: ${label}`}
                      />
                      <ReferenceLine
                        y={limite}
                        stroke="#C0392B"
                        strokeDasharray="5 5"
                        label={{ value: `Límite ${limite}m`, position: 'insideTopRight', fontSize: 11, fill: '#C0392B' }}
                      />
                      <Bar
                        dataKey="minutos"
                        radius={[4, 4, 0, 0]}
                        fill="#2E7D32"
                        isAnimationActive={false}
                        cell={chartData.map((d, i) => (
                          <rect key={i} fill={barColor(d.minutos)} />
                        ))}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                <table className="table-audicen">
                  <thead>
                    <tr>
                      <th>Ruta</th>
                      <th className="text-center">Cajas</th>
                      <th className="text-center">Inicio</th>
                      <th className="text-center">Fin</th>
                      <th className="text-center">T. Carga</th>
                      <th className="text-center">T. Embarque</th>
                      <th className="text-center">Cj/min</th>
                      <th className="text-center">Equipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const excede = (r.tiempo_carga ?? 0) > limite
                      return (
                        <tr key={i} className={excede ? 'bg-[#FEE2E2]' : ''}>
                          <td className="font-semibold">
                            {r.ruta}
                            {excede && (
                              <span className="ml-2 rounded bg-rojo px-1.5 py-0.5 text-xs font-bold text-white">
                                ↑
                              </span>
                            )}
                          </td>
                          <td className="text-center">{r.cajas ?? '—'}</td>
                          <td className="text-center font-mono text-sm">{r.inicio_carga ?? '—'}</td>
                          <td className="text-center font-mono text-sm">{r.fin_carga ?? '—'}</td>
                          <td className={`text-center font-bold ${excede ? 'text-rojo' : ''}`}>
                            {minToHHMM(r.tiempo_carga)}
                          </td>
                          <td className="text-center">{minToHHMM(r.tiempo_embarque)}</td>
                          <td className="text-center">{r.cajas_por_segundo ?? '—'}</td>
                          <td className="text-center text-sm text-gris-texto">{r.equipo ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
