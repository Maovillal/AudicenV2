import { useCallback, useEffect, useMemo, useState } from 'react'
import { eachDayOfInterval, format, parseISO } from 'date-fns'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { parseNumber } from '@/lib/format'
import { bebasNeue } from './_app'

export default function AuditoriaPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [desde, setDesde] = useState(today)
  const [hasta, setHasta] = useState(today)
  const [fechaComparativo, setFechaComparativo] = useState(today)
  const [rows, setRows] = useState([])
  const [selectedDay, setSelectedDay] = useState(null)
  const [comparativo, setComparativo] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAllRows((from, to) =>
        supabase
          .from('conteo_fisico')
          .select('*')
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .range(from, to)
      )
      setRows(data)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [desde, hasta])

  useEffect(() => {
    load()
  }, [load])

  const recurrentes = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const sku = r.sku
      if (!sku) continue
      if (!map.has(sku)) {
        map.set(sku, {
          sku,
          descripcion: r.descripcion,
          fechasNeg: new Set(),
          diffAcum: 0,
        })
      }
      const item = map.get(sku)
      if (parseNumber(r.diferencia) < 0) {
        item.fechasNeg.add(r.fecha)
      }
      item.diffAcum += parseNumber(r.diferencia)
      if (r.descripcion) item.descripcion = r.descripcion
    }
    return [...map.values()]
      .filter((x) => x.fechasNeg.size > 3)
      .map((x) => ({
        sku: x.sku,
        descripcion: x.descripcion,
        fechasMerma: x.fechasNeg.size,
        diffAcum: x.diffAcum,
      }))
      .sort((a, b) => b.fechasMerma - a.fechasMerma)
  }, [rows])

  const porDia = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const f = r.fecha
      if (!f) continue
      map.set(f, (map.get(f) || 0) + Math.abs(parseNumber(r.diferencia)))
    }
    let start = parseISO(desde)
    let end = parseISO(hasta)
    if (start > end) {
      const t = start
      start = end
      end = t
    }
    let days = []
    try {
      days = eachDayOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM-dd'))
    } catch {
      days = []
    }
    return days.map((d) => ({
      fecha: d,
      total: map.get(d) || 0,
    }))
  }, [rows, desde, hasta])

  const detalleDia = useMemo(() => {
    if (!selectedDay) return []
    return rows
      .filter((r) => r.fecha === selectedDay)
      .sort((a, b) => Math.abs(parseNumber(b.diferencia)) - Math.abs(parseNumber(a.diferencia)))
  }, [rows, selectedDay])

  const loadComparativo = useCallback(async () => {
    try {
      const [cf, liq] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase.from('conteo_fisico').select('*').eq('fecha', fechaComparativo).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('inventario_liquido').select('*').eq('fecha', fechaComparativo).range(from, to)
        ),
      ])
      const sapBySku = new Map(liq.map((r) => [r.sku, r]))
      const merged = cf.map((c) => {
        const sap = sapBySku.get(c.sku)
        const fisico = parseNumber(c.total_fisico)
        const stockSap = parseNumber(sap?.stock_libre)
        return {
          sku: c.sku,
          fisico,
          sap: stockSap,
          discrepancia: fisico - stockSap,
        }
      })
      setComparativo(merged)
    } catch {
      setComparativo([])
    }
  }, [fechaComparativo])

  useEffect(() => {
    loadComparativo()
  }, [loadComparativo])

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>AUDITORÍA</h1>
            <div className="flex flex-wrap gap-3 text-sm font-semibold">
              <label>
                Desde
                <input
                  type="date"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                  className="ml-2 rounded-lg border border-gris-claro px-2 py-1"
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                  className="ml-2 rounded-lg border border-gris-claro px-2 py-1"
                />
              </label>
            </div>
          </div>

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
          ) : (
            <>
              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>
                  SKUs con Merma Recurrente
                </h2>
                <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <table className="table-audicen">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Descripción</th>
                        <th>Fechas con Merma</th>
                        <th>Diferencia Acumulada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recurrentes.map((r) => (
                        <tr key={r.sku}>
                          <td className="font-semibold">{r.sku}</td>
                          <td>{r.descripcion ?? '—'}</td>
                          <td>{r.fechasMerma}</td>
                          <td>{r.diffAcum}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>Diferencias por Día</h2>
                <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <table className="table-audicen">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Suma |diferencia|</th>
                      </tr>
                    </thead>
                    <tbody>
                      {porDia.map((d) => (
                        <tr
                          key={d.fecha}
                          className={selectedDay === d.fecha ? 'bg-dorado/20' : 'cursor-pointer'}
                          onClick={() => setSelectedDay((prev) => (prev === d.fecha ? null : d.fecha))}
                        >
                          <td className="font-semibold">{d.fecha}</td>
                          <td>{d.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedDay ? (
                  <div className="mt-4 overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                    <p className="border-b border-gris-claro bg-verde-botella px-3 py-2 text-sm font-bold text-white">
                      Detalle {selectedDay}
                    </p>
                    <table className="table-audicen">
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Descripción</th>
                          <th>Diferencia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalleDia.map((r) => (
                          <tr key={`${r.sku}-${r.id}`}>
                            <td className="font-semibold">{r.sku}</td>
                            <td>{r.descripcion ?? '—'}</td>
                            <td>{r.diferencia}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>

              <section>
                <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <h2 className={`${bebasNeue.className} text-2xl text-verde-botella`}>
                    Comparativo Conteo vs SAP
                  </h2>
                  <label className="text-sm font-semibold">
                    Fecha
                    <input
                      type="date"
                      value={fechaComparativo}
                      onChange={(e) => setFechaComparativo(e.target.value)}
                      className="ml-2 rounded-lg border border-gris-claro px-2 py-1"
                    />
                  </label>
                </div>
                <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <table className="table-audicen">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Físico (conteo)</th>
                        <th>SAP (stock_libre)</th>
                        <th>Discrepancia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparativo.map((r) => (
                        <tr key={r.sku}>
                          <td className="font-semibold">{r.sku}</td>
                          <td>{r.fisico}</td>
                          <td>{Number.isFinite(r.sap) ? r.sap : '—'}</td>
                          <td className="font-semibold">{r.discrepancia}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
