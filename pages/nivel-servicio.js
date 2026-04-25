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
import { parseNumber } from '@/lib/format'
import { bebasNeue } from './_app'

export default function NivelServicioPage() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState([])
  const [objetivo, setObjetivo] = useState(60)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cfgRows = await fetchAllRows((from, to) =>
        supabase.from('configuracion').select('clave,valor').eq('clave', 'ns_objetivo').range(from, to)
      )
      if (cfgRows[0]) setObjetivo(parseNumber(cfgRows[0].valor) || 60)

      const data = await fetchAllRows((from, to) =>
        supabase.from('nivel_servicio').select('*').eq('fecha', fecha).range(from, to)
      )
      setRows(data)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => {
    load()
  }, [load])

  const stats = useMemo(() => {
    const mins = rows.map((r) => parseNumber(r.minutos))
    const avg = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0
    const dentro = mins.filter((m) => m < objetivo).length
    const pct = mins.length ? (dentro / mins.length) * 100 : 0
    return { avg, rutas: rows.length, pct }
  }, [rows, objetivo])

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        ruta: r.ruta ?? '—',
        minutos: parseNumber(r.minutos),
      })),
    [rows]
  )

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>NIVEL DE SERVICIO</h1>
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

          <div className="grid gap-4 md:grid-cols-3">
            <div className="card border border-gris-claro p-4">
              <p className="text-sm text-gris-texto">Promedio de minutos</p>
              <p className={`${bebasNeue.className} text-3xl text-verde-campo`}>{stats.avg.toFixed(1)}</p>
            </div>
            <div className="card border border-gris-claro p-4">
              <p className="text-sm text-gris-texto">Rutas atendidas</p>
              <p className={`${bebasNeue.className} text-3xl text-verde-fresco`}>{stats.rutas}</p>
            </div>
            <div className="card border border-gris-claro p-4">
              <p className="text-sm text-gris-texto">% dentro del objetivo (&lt; {objetivo} min)</p>
              <p className={`${bebasNeue.className} text-3xl text-ambar`}>{stats.pct.toFixed(1)}%</p>
            </div>
          </div>

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                <table className="table-audicen">
                  <thead>
                    <tr>
                      <th>Ruta</th>
                      <th>Hora Inicio</th>
                      <th>Hora Término</th>
                      <th>Minutos</th>
                      <th>Observaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const m = parseNumber(r.minutos)
                      const warn = m > objetivo
                      return (
                        <tr key={r.id ?? `${r.ruta}-${r.hora_inicio}`} className={warn ? 'bg-yellow-100' : ''}>
                          <td className="font-semibold">{r.ruta ?? '—'}</td>
                          <td>{r.hora_inicio ?? r.inicio ?? '—'}</td>
                          <td>{r.hora_termino ?? r.termino ?? '—'}</td>
                          <td>{r.minutos ?? '—'}</td>
                          <td>{r.observaciones ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>
                  Minutos por ruta
                </h2>
                <div className="card h-[420px] border border-gris-claro p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={chartData} margin={{ left: 16, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis type="category" dataKey="ruta" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <ReferenceLine x={objetivo} stroke="#C0341A" strokeDasharray="4 4" label="Objetivo" />
                      <Bar dataKey="minutos" fill="#2E9944" name="Minutos" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
