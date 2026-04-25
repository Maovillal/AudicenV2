import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { bebasNeue } from './_app'

function sum(nums) {
  return nums.reduce((a, b) => a + b, 0)
}

function topSkusForRoute(allRows, ruta) {
  const skuMap = new Map()
  for (const r of allRows) {
    const key = r.ruta ?? r.nombre_ruta ?? 'Sin ruta'
    if (key !== ruta) continue
    const sku = r.sku || '—'
    skuMap.set(sku, (skuMap.get(sku) || 0) + Number(r.cantidad ?? r.cajas ?? 0))
  }
  return [...skuMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([sku, cantidad]) => ({ sku, cantidad }))
}

export default function RutasPage() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState([])
  const [promedios, setPromedios] = useState([])
  const [expanded, setExpanded] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const salidas = await fetchAllRows((from, to) =>
        supabase.from('salidas_rutas').select('*').eq('fecha', fecha).range(from, to)
      )

      const { data: rpcData, error: rpcError } = await supabase.rpc('promedios_por_ruta', {})
      if (!rpcError && Array.isArray(rpcData)) {
        setPromedios(rpcData)
      } else {
        setPromedios([])
      }

      setRows(salidas)
    } catch {
      setRows([])
      setPromedios([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => {
    load()
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const key = r.ruta ?? r.nombre_ruta ?? 'Sin ruta'
      if (!map.has(key)) {
        map.set(key, {
          ruta: key,
          transporte: r.transporte ?? r.tipo_transporte ?? '—',
          cajas: 0,
        })
      }
      const g = map.get(key)
      g.cajas += Number(r.cantidad ?? r.cajas ?? 0)
      if (r.transporte || r.tipo_transporte) {
        g.transporte = r.transporte ?? r.tipo_transporte ?? g.transporte
      }
    }
    return Array.from(map.values())
  }, [rows])

  const totalCajas = useMemo(() => sum(grouped.map((g) => g.cajas)), [grouped])
  const numRutas = grouped.length
  const promedioPorRuta = numRutas ? totalCajas / numRutas : 0

  function promedioHistorico(ruta) {
    const row = promedios.find((p) => (p.ruta ?? p.nombre_ruta) === ruta)
    const val = row?.promedio ?? row?.promedio_cajas ?? row?.avg
    return Number(val) || 0
  }

  function toggleExpand(ruta) {
    setExpanded((prev) => ({ ...prev, [ruta]: !prev[ruta] }))
  }

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>SALIDAS POR RUTA</h1>
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

          <div className="grid gap-4 md:grid-cols-3">
            <div className="card border border-gris-claro p-4">
              <p className="text-sm text-gris-texto">Total cajas despachadas</p>
              <p className={`${bebasNeue.className} text-3xl text-verde-campo`}>{totalCajas}</p>
            </div>
            <div className="card border border-gris-claro p-4">
              <p className="text-sm text-gris-texto">Rutas activas</p>
              <p className={`${bebasNeue.className} text-3xl text-verde-fresco`}>{numRutas}</p>
            </div>
            <div className="card border border-gris-claro p-4">
              <p className="text-sm text-gris-texto">Promedio por ruta</p>
              <p className={`${bebasNeue.className} text-3xl text-ambar`}>{promedioPorRuta.toFixed(1)}</p>
            </div>
          </div>

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
          ) : (
            <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
              <table className="table-audicen min-w-full">
                <thead>
                  <tr>
                    <th>Ruta</th>
                    <th>Transporte</th>
                    <th>Total Cajas</th>
                    <th>Δ% vs Promedio</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((g) => {
                    const hist = promedioHistorico(g.ruta)
                    const deltaPct = hist ? ((g.cajas - hist) / hist) * 100 : 0
                    const open = expanded[g.ruta]
                    const tops = topSkusForRoute(rows, g.ruta)
                    return (
                      <Fragment key={g.ruta}>
                        <tr className="cursor-pointer" onClick={() => toggleExpand(g.ruta)}>
                          <td className="font-semibold text-verde-botella">{g.ruta}</td>
                          <td>{g.transporte}</td>
                          <td>{g.cajas}</td>
                          <td
                            className={
                              deltaPct > 0
                                ? 'font-semibold text-verde-fresco'
                                : deltaPct < 0
                                  ? 'font-semibold text-rojo'
                                  : ''
                            }
                          >
                            {hist ? `${deltaPct.toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                        {open ? (
                          <tr>
                            <td colSpan={4} className="bg-gris-claro/40">
                              <div className="p-4">
                                <p className="mb-2 text-sm font-bold text-verde-botella">Top 10 SKUs</p>
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-gris-texto">
                                        <th className="pb-2">SKU</th>
                                        <th className="pb-2">Cantidad</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {tops.map((t) => (
                                        <tr key={t.sku}>
                                          <td className="py-1">{t.sku}</td>
                                          <td className="py-1">{t.cantidad}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
