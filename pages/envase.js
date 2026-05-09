import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFechaGlobal } from '@/lib/useFecha'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { parseNumber } from '@/lib/format'
import { bebasNeue } from './_app'

// Helpers de formato.
function fmt2(v) {
  if (v == null || v === '') return '—'
  const n = parseNumber(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(num, den) {
  if (num == null || den == null) return '—'
  const n = parseNumber(num)
  const d = parseNumber(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return '—'
  return ((n / d) * 100).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}
function stockTotalRow(r) {
  return parseNumber(r?.stock_libre) + parseNumber(r?.stock_bloqueado) + parseNumber(r?.stock_calidad)
}

export default function EnvasePage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [inv, setInv] = useState([])
  const [conc, setConc] = useState([])
  const [ing, setIng] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Inventario envase: T2 cierre (lo más reciente del día). Si no existe,
      // fallback al último snapshot disponible.
      let invRows = await fetchAllRows((from, to) =>
        supabase.from('inventario_envase').select('*')
          .eq('fecha', fecha).eq('turno', 2).eq('momento', 'cierre').range(from, to)
      )
      if (invRows.length === 0) {
        const { data: latest } = await supabase.from('inventario_envase')
          .select('turno,momento').eq('fecha', fecha)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (latest) {
          invRows = await fetchAllRows((from, to) =>
            supabase.from('inventario_envase').select('*')
              .eq('fecha', fecha).eq('turno', latest.turno).eq('momento', latest.momento).range(from, to)
          )
        }
      }

      // T1 inicio para baseline del cálculo de ingreso del día por SKU.
      const invInicio = await fetchAllRows((from, to) =>
        supabase.from('inventario_envase')
          .select('sku,stock_libre,stock_bloqueado,stock_calidad')
          .eq('fecha', fecha).eq('turno', 1).eq('momento', 'inicio').range(from, to)
      )
      const inicioBySku = new Map()
      for (const r of invInicio) inicioBySku.set(r.sku, stockTotalRow(r))

      // Enriquecer con _stockActual, _stockInicial, _ingreso del día.
      invRows = invRows.map((r) => {
        const stockActualVal = stockTotalRow(r)
        const stockInicialVal = inicioBySku.has(r.sku) ? inicioBySku.get(r.sku) : null
        const ingreso = stockInicialVal != null ? Math.max(0, stockActualVal - stockInicialVal) : null
        return { ...r, _stockActual: stockActualVal, _stockInicial: stockInicialVal, _ingreso: ingreso }
      })

      const [b, c] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase.from('conciliacion_envase').select('*').eq('fecha', fecha).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('ingreso_envase').select('*').eq('fecha', fecha).range(from, to)
        ),
      ])
      setInv(invRows)
      setConc(b)
      setIng(c)
    } catch (e) {
      console.error('[envase] error cargando data:', e)
      setInv([])
      setConc([])
      setIng([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => {
    load()
  }, [load])

  // Total ingresado del día (denominador para % del ingreso).
  const totalIngresoEnvase = useMemo(
    () => inv.reduce((acc, r) => acc + (parseNumber(r._ingreso) || 0), 0),
    [inv],
  )

  const empty = !loading && inv.length === 0 && conc.length === 0 && ing.length === 0

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>ENVASE</h1>
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
          ) : empty ? (
            <p className="rounded-[12px] border border-gris-claro bg-white p-4 text-gris-texto shadow-card">
              Sin datos para esta fecha. Carga los archivos en Cargar Datos.
            </p>
          ) : (
            <>
              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>Inventario envase</h2>
                <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <table className="table-audicen">
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Descripción</th>
                        <th>Stock Libre</th>
                        <th>Ingreso del día</th>
                        <th>% aumento</th>
                        <th>% del ingreso</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.map((r) => (
                        <tr key={r.id ?? `${r.sku}-${r.fecha}`}>
                          <td className="font-semibold">{r.sku}</td>
                          <td>{r.descripcion ?? '—'}</td>
                          <td>{fmt2(r.stock_libre)}</td>
                          <td className="font-semibold">{fmt2(r._ingreso)}</td>
                          <td>{fmtPct(r._ingreso, r._stockInicial)}</td>
                          <td>{fmtPct(r._ingreso, totalIngresoEnvase)}</td>
                          <td>{fmt2(r._stockActual)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>Conciliación</h2>
                <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <table className="table-audicen">
                    <thead>
                      <tr>
                        <th>Presentación</th>
                        <th>T1</th>
                        <th>T2</th>
                        <th>Total</th>
                        <th>Eventos</th>
                        <th>Merma</th>
                        <th>Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conc.map((r) => (
                        <tr key={r.id ?? `${r.presentacion}-${r.fecha}`}>
                          <td className="font-semibold">{r.presentacion ?? r.presentacion_nombre ?? '—'}</td>
                          <td>{r.t1 ?? '—'}</td>
                          <td>{r.t2 ?? '—'}</td>
                          <td>{r.total ?? '—'}</td>
                          <td>{r.eventos ?? '—'}</td>
                          <td>{r.merma ?? '—'}</td>
                          <td>{r.diferencia ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>Ingreso por ruta</h2>
                <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <table className="table-audicen">
                    <thead>
                      <tr>
                        <th>Ruta</th>
                        <th>Repartidor</th>
                        <th>Envase recibido</th>
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ing.map((r) => (
                        <tr key={r.id ?? `${r.ruta}-${r.fecha}`}>
                          <td className="font-semibold">{r.ruta ?? '—'}</td>
                          <td>{r.repartidor ?? '—'}</td>
                          <td>{r.env_rec ?? r.envase_recibido ?? r.envase ?? '—'}</td>
                          <td>{r.porcentaje ?? r.pct ?? '—'}</td>
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
