import { useCallback, useEffect, useMemo, useState } from 'react'
import { subDays, format } from 'date-fns'
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
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
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

      const liqRows = await fetchAllRows((from, to) =>
        supabase.from('inventario_liquido').select('*').eq('fecha', fecha).range(from, to)
      )
      const envRows = await fetchAllRows((from, to) =>
        supabase.from('inventario_envase').select('*').eq('fecha', fecha).range(from, to)
      )

      liqRows.sort((a, b) => parseNumber(b.stock_libre) - parseNumber(a.stock_libre))
      setLiquido(liqRows)
      setEnvase(envRows)
    } catch {
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
                    <th>Descripción</th>
                    <th>Stock Libre</th>
                    <th>Bloqueado</th>
                    <th>Calidad</th>
                    <th>Total</th>
                    <th>Días Restantes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLiquido.map((r) => {
                    const stockLibre = parseNumber(r.stock_libre)
                    const prom = promediosSku.get(r.sku) || 0
                    const diasRest =
                      prom > 0 ? stockLibre / prom : null
                    const diasLabel =
                      prom > 0 && Number.isFinite(diasRest) ? diasRest.toFixed(1) : '—'
                    const colorClass =
                      prom > 0 && Number.isFinite(diasRest)
                        ? semaforoColor(diasRest, cfg.alerta, cfg.critico)
                        : 'text-gris-texto'
                    return (
                      <tr key={r.id ?? `${r.sku}-${r.fecha}`}>
                        <td className="font-semibold">{r.sku}</td>
                        <td>{r.descripcion ?? '—'}</td>
                        <td>{r.stock_libre ?? '—'}</td>
                        <td>{r.stock_bloqueado ?? r.bloqueado ?? '—'}</td>
                        <td>{r.stock_calidad ?? r.calidad ?? '—'}</td>
                        <td>
                          {r.total ??
                            parseNumber(r.stock_libre) +
                              parseNumber(r.stock_bloqueado ?? r.bloqueado ?? 0) +
                              parseNumber(r.stock_calidad ?? r.calidad ?? 0)}
                        </td>
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
