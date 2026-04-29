import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFechaGlobal } from '@/lib/useFecha'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { formatDateLong, formatDateTime, formatTime, parseNumber, formatNumber } from '@/lib/format'
import { bebasNeue } from './_app'

function sumField(rows, field) {
  return rows.reduce((acc, r) => acc + parseNumber(r[field]), 0)
}

function sumAbs(rows, field) {
  return rows.reduce((acc, r) => acc + Math.abs(parseNumber(r[field])), 0)
}

export default function DashboardPage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [kpiLiquido, setKpiLiquido] = useState(0)
  const [kpiEnvase, setKpiEnvase] = useState(0)
  const [kpiCajas, setKpiCajas] = useState(0)
  const [kpiDiff, setKpiDiff] = useState(0)
  const [kpiHLDia, setKpiHLDia] = useState(0)
  const [kpiHLMes, setKpiHLMes] = useState(0)
  const [kpiHLMeta, setKpiHLMeta] = useState(0)
  const [uploads, setUploads] = useState([])
  const [alertas, setAlertas] = useState([])
  const [latestFecha, setLatestFecha] = useState(null)
  const [loading, setLoading] = useState(true)

  const subtitle = useMemo(() => formatDateLong(new Date()), [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const liq = await fetchAllRows((from, to) =>
        supabase.from('inventario_liquido').select('stock_libre').eq('fecha', fecha).range(from, to)
      )
      const env = await fetchAllRows((from, to) =>
        supabase.from('inventario_envase').select('stock_libre').eq('fecha', fecha).range(from, to)
      )
      const sal = await fetchAllRows((from, to) =>
        supabase.from('salidas_rutas').select('cantidad').eq('fecha', fecha).range(from, to)
      )
      const cf = await fetchAllRows((from, to) =>
        supabase.from('conteo_fisico').select('diferencia').eq('fecha', fecha).range(from, to)
      )

      setKpiLiquido(sumField(liq, 'stock_libre'))
      setKpiEnvase(sumField(env, 'stock_libre'))
      setKpiCajas(sumField(sal, 'cantidad'))
      setKpiDiff(sumAbs(cf, 'diferencia'))

      const { data: hlData } = await supabase.rpc('get_hl_stats', { p_fecha: fecha })
      if (hlData?.[0]) {
        setKpiHLDia(parseNumber(hlData[0].hl_dia))
        setKpiHLMes(parseNumber(hlData[0].hl_mes))
        setKpiHLMeta(parseNumber(hlData[0].meta_hl))
      }

      const { data: lastFechaRow } = await supabase
        .from('conteo_fisico')
        .select('fecha')
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle()

      const fechaAlertas = lastFechaRow?.fecha
      setLatestFecha(fechaAlertas || null)

      if (fechaAlertas) {
        const alertRows = await fetchAllRows((from, to) =>
          supabase
            .from('conteo_fisico')
            .select('sku,descripcion,diferencia')
            .eq('fecha', fechaAlertas)
            .range(from, to)
        )
        const filtered = alertRows
          .filter((r) => Math.abs(parseNumber(r.diferencia)) > 10)
          .sort((a, b) => parseNumber(a.diferencia) - parseNumber(b.diferencia))
        setAlertas(filtered)
      } else {
        setAlertas([])
      }

      const { data: upData } = await supabase
        .from('upload_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5)

      setUploads(upData || [])
    } catch {
      setKpiLiquido(0)
      setKpiEnvase(0)
      setKpiCajas(0)
      setKpiDiff(0)
      setKpiHLDia(0)
      setKpiHLMes(0)
      setKpiHLMeta(0)
      setUploads([])
      setAlertas([])
    } finally {
      setLoading(false)
    }
  }, [fecha])

  useEffect(() => {
    load()
  }, [load])

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>DASHBOARD</h1>
              <p className="text-lg capitalize text-gris-texto">{subtitle}</p>
            </div>
            <label className="text-sm font-semibold">
              Fecha de datos
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="ml-2 rounded-lg border border-gris-claro px-3 py-2 focus:border-verde-fresco focus:outline-none"
              />
            </label>
          </div>

          {loading ? (
            <p className="text-gris-texto">Cargando KPIs…</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Stock Líquido"
                value={kpiLiquido}
                color="text-verde-fresco"
                icon={
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.498-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
                    />
                  </svg>
                }
              />
              <KpiCard
                label="Stock Envase"
                value={kpiEnvase}
                color="text-ambar"
                icon={
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.092 1.209-.138 2.43-.138 3.662s.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.092-1.209.138-2.43.138-3.662z"
                    />
                  </svg>
                }
              />
              <KpiCard
                label="Cajas Despachadas"
                value={kpiCajas}
                color="text-verde-campo"
                icon={
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.496 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.25 2.25 0 00-1.227-1.027l-.07-.035m-5.813 10.5H7.88a1.125 1.125 0 01-1.125-1.125V11.25c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v4.125c0 .621-.504 1.125-1.125 1.125zm-8.25-4.875h3.375c.621 0 1.125.504 1.125 1.125V17.25"
                    />
                  </svg>
                }
              />
              <KpiCard
                label="Diferencia Total"
                value={kpiDiff}
                color={kpiDiff > 0 ? 'text-rojo' : 'text-verde-fresco'}
                icon={
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  </svg>
                }
              />
            </div>
          )}

          <section>
            <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>Hectolitros</h2>
            {loading ? (
              <p className="text-gris-texto">Cargando HL…</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <KpiCard
                  label="HL Vendidos Hoy"
                  value={kpiHLDia}
                  color="text-verde-fresco"
                  unit="HL"
                  icon={
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                      />
                    </svg>
                  }
                />
                <KpiCardMeta
                  label="HL Acumulado del Mes"
                  value={kpiHLMes}
                  meta={kpiHLMeta}
                />
              </div>
            )}
          </section>

          <section>
            <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>Últimas Cargas</h2>
            <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
              <table className="table-audicen min-w-full">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo de Archivo</th>
                    <th>Registros</th>
                    <th>Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {(uploads || []).map((u) => (
                    <tr key={u.id ?? u.created_at}>
                      <td>{formatDateTime(u.created_at).split(' ')[0]}</td>
                      <td>{u.tipo_archivo ?? u.tipo ?? '—'}</td>
                      <td>{u.registros ?? u.cantidad_registros ?? '—'}</td>
                      <td>{formatTime(u.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>Alertas</h2>
            <p className="mb-3 text-sm text-gris-texto">
              SKUs con |diferencia| &gt; 10 en la fecha más reciente de conteo
              {latestFecha ? ` (${latestFecha})` : ''}.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {alertas.length === 0 ? (
                <p className="text-gris-texto">Sin alertas para esa fecha.</p>
              ) : (
                alertas.map((a) => (
                  <div
                    key={`${a.sku}-${a.diferencia}`}
                    className="rounded-[12px] border border-red-200 bg-[#FEE2E2] p-4 shadow-card"
                  >
                    <p className="font-bold text-negro">{a.sku}</p>
                    <p className="text-sm text-gris-texto">{a.descripcion ?? '—'}</p>
                    <p className="mt-2 font-semibold text-rojo">Diferencia: {a.diferencia}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </Layout>
    </AuthGuard>
  )
}

function KpiCard({ label, value, color, icon, unit }) {
  return (
    <div className="flex flex-col justify-between rounded-[12px] border border-gris-claro bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`${bebasNeue.className} text-4xl ${color}`}>
            {formatNumber(value)}{unit ? <span className="ml-1 text-2xl">{unit}</span> : null}
          </p>
          <p className="mt-2 text-sm font-semibold text-gris-texto">{label}</p>
        </div>
        <div className={color}>{icon}</div>
      </div>
    </div>
  )
}

function KpiCardMeta({ label, value, meta }) {
  const pct = meta > 0 ? Math.min(Math.round((value / meta) * 100), 100) : 0
  const color = pct >= 100 ? 'bg-verde-fresco' : pct >= 60 ? 'bg-ambar' : 'bg-rojo'
  const textColor = pct >= 100 ? 'text-verde-fresco' : pct >= 60 ? 'text-ambar' : 'text-rojo'
  return (
    <div className="flex flex-col justify-between rounded-[12px] border border-gris-claro bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className={`${bebasNeue.className} text-4xl ${textColor}`}>
            {formatNumber(value)} <span className="text-2xl">HL</span>
          </p>
          <p className="mt-2 text-sm font-semibold text-gris-texto">{label}</p>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-gris-texto">
              <span>{pct}% de meta</span>
              <span>Meta: {formatNumber(meta)} HL</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gris-claro">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
        <svg className={`h-8 w-8 shrink-0 ${textColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0"
          />
        </svg>
      </div>
    </div>
  )
}
