import { useCallback, useEffect, useMemo, useState } from 'react'
import { subDays, format } from 'date-fns'
import { useFechaGlobal } from '@/lib/useFecha'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { parseNumber } from '@/lib/format'
import { bebasNeue } from './_app'

async function loadConfigKeys() {
  const rows = await fetchAllRows((from, to) =>
    supabase
      .from('configuracion')
      .select('clave,valor')
      .in('clave', ['dias_inventario_alerta', 'dias_inventario_critico'])
      .range(from, to)
  )
  const map = {}
  for (const r of rows) {
    map[r.clave] = parseNumber(r.valor)
  }
  return {
    alerta: map.dias_inventario_alerta || 14,
    critico: map.dias_inventario_critico || 7,
  }
}

function semaforoColor(dias, alerta, critico) {
  if (dias === null || dias === undefined || Number.isNaN(dias)) return 'text-gris-texto'
  if (dias > alerta) return 'text-verde-fresco font-bold'
  if (dias >= critico && dias <= alerta) return 'text-dorado font-bold'
  if (dias < critico) return 'text-rojo font-bold'
  return 'text-gris-texto'
}

export default function InventarioPage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [tab, setTab] = useState('liquido')
  const [search, setSearch] = useState('')
  const [liquido, setLiquido] = useState([])
  const [envase, setEnvase] = useState([])
  const [promediosSku, setPromediosSku] = useState(new Map())
  const [cfg, setCfg] = useState({ alerta: 14, critico: 7 })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const c = await loadConfigKeys()
      setCfg(c)

      const desde = format(subDays(new Date(fecha + 'T12:00:00'), 30), 'yyyy-MM-dd')
      const salidas = await fetchAllRows((from, to) =>
        supabase
          .from('salidas_rutas')
          .select('sku,cantidad,cajas,fecha')
          .gte('fecha', desde)
          .lte('fecha', fecha)
          .range(from, to)
      )

      const skuTotals = new Map()
      for (const s of salidas) {
        const sku = s.sku
        if (!sku) continue
        const qty = parseNumber(s.cantidad ?? s.cajas)
        skuTotals.set(sku, (skuTotals.get(sku) || 0) + qty)
      }
      const diasVentana = 30
      const promMap = new Map()
      for (const [sku, total] of skuTotals.entries()) {
        promMap.set(sku, total / diasVentana)
      }
      setPromediosSku(promMap)

      // Líquido = conteo físico del día (T3 cierre, lo real en piso).
      // Excluimos la fila agregada con sku='TOTALES' (esa es para el KPI
      // del dashboard, no aplica al detalle por SKU).
      const liqRows = await fetchAllRows((from, to) =>
        supabase
          .from('conteo_fisico')
          .select('sku,sku_sap,descripcion,total_fisico_real,total_sistema,diferencia,total_fisico,merma_total')
          .eq('fecha', fecha)
          .neq('sku', 'TOTALES')
          .range(from, to)
      )

      // Envase = inventario SAP al cierre del T2 (lo más reciente del día
      // según la lógica del supervisor). Si todavía no hay T2 cierre, cae al
      // último snapshot disponible para no dejar la pestaña vacía.
      let envRows = await fetchAllRows((from, to) =>
        supabase
          .from('inventario_envase')
          .select('*')
          .eq('fecha', fecha)
          .eq('turno', 2)
          .eq('momento', 'cierre')
          .range(from, to)
      )
      if (envRows.length === 0) {
        const { data: latest } = await supabase
          .from('inventario_envase')
          .select('turno, momento')
          .eq('fecha', fecha)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (latest) {
          envRows = await fetchAllRows((from, to) =>
            supabase
              .from('inventario_envase')
              .select('*')
              .eq('fecha', fecha)
              .eq('turno', latest.turno)
              .eq('momento', latest.momento)
              .range(from, to)
          )
        }
      }

      // Orden descendente por físico real (líquido) o stock libre (envase).
      liqRows.sort((a, b) => parseNumber(b.total_fisico_real) - parseNumber(a.total_fisico_real))
      envRows.sort((a, b) => parseNumber(b.stock_libre) - parseNumber(a.stock_libre))
      console.log('[inventario] cargado', { liquido: liqRows.length, envase: envRows.length, fecha })
      setLiquido(liqRows)
      setEnvase(envRows)
    } catch (e) {
      console.error('[inventario] error cargando data:', e)
      setLiquido([])
      setEnvase([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => {
    load()
  }, [load])

  const filteredLiquido = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return liquido
    return liquido.filter((r) => {
      const sku = String(r.sku ?? '').toLowerCase()
      const desc = String(r.descripcion ?? '').toLowerCase()
      return sku.includes(q) || desc.includes(q)
    })
  }, [liquido, search])

  const filteredEnvase = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return envase
    return envase.filter((r) => {
      const sku = String(r.sku ?? '').toLowerCase()
      const desc = String(r.descripcion ?? '').toLowerCase()
      return sku.includes(q) || desc.includes(q)
    })
  }, [envase, search])

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>INVENTARIO</h1>
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

          <input
            type="search"
            placeholder="Buscar por SKU o descripción…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-xl rounded-lg border border-gris-claro px-4 py-2 focus:border-verde-fresco focus:outline-none"
          />

          <div className="flex gap-2 border-b border-gris-claro pb-2">
            <button
              type="button"
              onClick={() => setTab('liquido')}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors duration-150 ${
                tab === 'liquido' ? 'bg-verde-campo text-blanco' : 'bg-gris-claro text-negro hover:bg-verde-campo/20'
              }`}
            >
              Líquido (2000)
            </button>
            <button
              type="button"
              onClick={() => setTab('envase')}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors duration-150 ${
                tab === 'envase' ? 'bg-verde-campo text-blanco' : 'bg-gris-claro text-negro hover:bg-verde-campo/20'
              }`}
            >
              Envase (2010)
            </button>
          </div>

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
          ) : tab === 'liquido' ? (
            <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
              <table className="table-audicen">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>SKU SAP</th>
                    <th>Descripción</th>
                    <th>Físico Real</th>
                    <th>Sistema (SAP)</th>
                    <th>Diferencia</th>
                    <th>Días Restantes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLiquido.map((r) => {
                    const fisicoReal = parseNumber(r.total_fisico_real)
                    const prom = promediosSku.get(r.sku) || 0
                    const diasRest = prom > 0 ? fisicoReal / prom : null
                    const diasLabel =
                      prom > 0 && Number.isFinite(diasRest) ? diasRest.toFixed(1) : '—'
                    const colorClass =
                      prom > 0 && Number.isFinite(diasRest)
                        ? semaforoColor(diasRest, cfg.alerta, cfg.critico)
                        : 'text-gris-texto'
                    const dif = parseNumber(r.diferencia)
                    const difColor = dif === 0
                      ? 'text-gris-texto'
                      : dif < 0 ? 'text-rojo font-semibold' : 'text-verde-fresco font-semibold'
                    return (
                      <tr key={r.id ?? `${r.sku}-${r.fecha}`}>
                        <td className="font-semibold">{r.sku}</td>
                        <td className="text-gris-texto">{r.sku_sap ?? '—'}</td>
                        <td>{r.descripcion ?? '—'}</td>
                        <td className="font-semibold">{r.total_fisico_real ?? '—'}</td>
                        <td>{r.total_sistema ?? '—'}</td>
                        <td className={difColor}>{r.diferencia ?? '—'}</td>
                        <td className={colorClass}>{diasLabel}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
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
                  {filteredEnvase.map((r) => (
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
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
