import { useCallback, useEffect, useState } from 'react'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { bebasNeue } from './_app'

export default function EnvasePage() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [inv, setInv] = useState([])
  const [conc, setConc] = useState([])
  const [ing, setIng] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, b, c] = await Promise.all([
        fetchAllRows((from, to) =>
          supabase.from('inventario_envase').select('*').eq('fecha', fecha).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('conciliacion_envase').select('*').eq('fecha', fecha).range(from, to)
        ),
        fetchAllRows((from, to) =>
          supabase.from('ingreso_envase').select('*').eq('fecha', fecha).range(from, to)
        ),
      ])
      setInv(a)
      setConc(b)
      setIng(c)
    } catch {
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
                        <th>Bloqueado</th>
                        <th>Calidad</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.map((r) => (
                        <tr key={r.id ?? `${r.sku}-${r.fecha}`}>
                          <td className="font-semibold">{r.sku}</td>
                          <td>{r.descripcion ?? '—'}</td>
                          <td>{r.stock_libre ?? '—'}</td>
                          <td>{r.stock_bloqueado ?? r.bloqueado ?? '—'}</td>
                          <td>{r.stock_calidad ?? r.calidad ?? '—'}</td>
                          <td>{r.total ?? '—'}</td>
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
                          <td>{r.envase_recibido ?? r.envase ?? '—'}</td>
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
