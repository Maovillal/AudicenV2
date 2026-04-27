import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFechaGlobal } from '@/lib/useFecha'
import {
  Bar,
  BarChart,
  CartesianGrid,
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

export default function MermaPage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [allRows, setAllRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAllRows((from, to) =>
        supabase.from('conteo_fisico').select('*').eq('fecha', fecha).range(from, to)
      )
      setAllRows(data)
    } catch {
      setAllRows([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(
    () => allRows.filter((r) => parseNumber(r.diferencia) !== 0),
    [allRows]
  )

  const resumen = useMemo(() => {
    return allRows.reduce(
      (acc, r) => ({
        op: acc.op + parseNumber(r.merma_operativa ?? r.merma_op),
        cm: acc.cm + parseNumber(r.merma_cm),
        dora: acc.dora + parseNumber(r.merma_dora),
      }),
      { op: 0, cm: 0, dora: 0 }
    )
  }, [allRows])

  const chartData = useMemo(() => {
    return [...rows]
      .map((r) => ({
        sku: r.sku,
        abs: Math.abs(parseNumber(r.diferencia)),
      }))
      .sort((a, b) => b.abs - a.abs)
      .slice(0, 10)
  }, [rows])

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>MERMA Y DIFERENCIAS</h1>
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
              <p className="text-sm text-gris-texto">Total merma operativa</p>
              <p className={`${bebasNeue.className} text-3xl text-verde-campo`}>{resumen.op}</p>
            </div>
            <div className="card border border-gris-claro p-4">
              <p className="text-sm text-gris-texto">Total merma CM</p>
              <p className={`${bebasNeue.className} text-3xl text-ambar`}>{resumen.cm}</p>
            </div>
            <div className="card border border-gris-claro p-4">
              <p className="text-sm text-gris-texto">Total merma DORA</p>
              <p className={`${bebasNeue.className} text-3xl text-rojo`}>{resumen.dora}</p>
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
                      <th>SKU</th>
                      <th>Descripción</th>
                      <th>Físico</th>
                      <th>Sistema</th>
                      <th>Diferencia</th>
                      <th>Merma Op.</th>
                      <th>Merma CM</th>
                      <th>Merma DORA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const neg = parseNumber(r.diferencia) < 0
                      return (
                        <tr key={r.id ?? `${r.sku}-${r.fecha}`} className={neg ? 'bg-[#FEE2E2]' : ''}>
                          <td className="font-semibold">{r.sku}</td>
                          <td>{r.descripcion ?? '—'}</td>
                          <td>{r.total_fisico ?? '—'}</td>
                          <td>{r.total_sistema ?? '—'}</td>
                          <td>{r.diferencia ?? '—'}</td>
                          <td>{r.merma_operativa ?? r.merma_op ?? '—'}</td>
                          <td>{r.merma_cm ?? '—'}</td>
                          <td>{r.merma_dora ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>
                  Top 10 diferencias absolutas
                </h2>
                <div className="card h-80 border border-gris-claro p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sku" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="abs" fill="#2E9944" name="|Diferencia|" />
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
