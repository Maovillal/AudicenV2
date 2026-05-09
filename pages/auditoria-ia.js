import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO, subDays, startOfMonth } from 'date-fns'
import ReactMarkdown from 'react-markdown'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { useFechaGlobal } from '@/lib/useFecha'
import { parseNumber } from '@/lib/format'
import { bebasNeue } from './_app'

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
]

function rangoFechas(fecha, periodo) {
  const f = parseISO(fecha)
  if (periodo === 'hoy') return { desde: fecha, hasta: fecha }
  if (periodo === 'semana') return { desde: format(subDays(f, 6), 'yyyy-MM-dd'), hasta: fecha }
  if (periodo === 'mes') return { desde: format(startOfMonth(f), 'yyyy-MM-dd'), hasta: fecha }
  return { desde: fecha, hasta: fecha }
}

function fmt2(v) {
  if (v == null || v === '') return '—'
  const n = parseNumber(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmt0(v) {
  if (v == null || v === '') return '—'
  const n = parseNumber(v)
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('es-MX')
}

export default function AuditoriaIAPage() {
  const [fecha, setFecha] = useFechaGlobal()
  const [periodo, setPeriodo] = useState('hoy')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiData, setAiData] = useState(null)
  const [aiUsage, setAiUsage] = useState(null)

  const { desde, hasta } = useMemo(() => rangoFechas(fecha, periodo), [fecha, periodo])

  // Reset cuando cambia el período/fecha.
  useEffect(() => {
    setAiText('')
    setAiError('')
    setAiData(null)
    setAiUsage(null)
  }, [desde, hasta])

  const generar = useCallback(async () => {
    setAiLoading(true)
    setAiError('')
    setAiText('')
    setAiData(null)
    setAiUsage(null)
    try {
      const resp = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodo, desde, hasta }),
      })
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${resp.status}`)
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const ev of events) {
          if (!ev.startsWith('data: ')) continue
          try {
            const obj = JSON.parse(ev.slice(6))
            if (obj.text) setAiText((p) => p + obj.text)
            if (obj.error) setAiError(obj.error)
            if (obj.done) {
              if (obj.data) setAiData(obj.data)
              if (obj.usage) setAiUsage(obj.usage)
            }
          } catch {}
        }
      }
    } catch (e) {
      setAiError(e.message || String(e))
    } finally {
      setAiLoading(false)
    }
  }, [periodo, desde, hasta])

  const onPrint = useCallback(() => {
    window.print()
  }, [])

  return (
    <AuthGuard>
      <Layout>
        <style jsx global>{`
          @media print {
            nav, header, button, input[type="date"] { display: none !important; }
            .no-print { display: none !important; }
            body { background: white !important; }
            .print-break { page-break-before: always; }
            section { break-inside: avoid; }
          }
        `}</style>

        <div className="space-y-6">
          {/* Header con controles (no se imprimen) */}
          <div className="no-print flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>AUDITORÍA CON IA</h1>
              <p className="text-gris-texto text-sm mt-1">
                Período: <span className="font-semibold">{desde === hasta ? desde : `${desde} → ${hasta}`}</span>
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <label className="text-sm font-semibold">
                Fecha tope:
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="ml-2 rounded-lg border border-gris-claro px-3 py-2 focus:border-verde-fresco focus:outline-none"
                />
              </label>
            </div>
          </div>

          <div className="no-print flex flex-wrap gap-2 border-b border-gris-claro pb-2">
            {PERIODOS.map((p) => {
              const active = periodo === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => setPeriodo(p.id)}
                  className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors duration-150 ${
                    active ? 'bg-verde-botella text-blanco' : 'bg-gris-claro text-gris-texto hover:bg-verde-claro hover:text-blanco'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
            <div className="ml-auto flex gap-2">
              <button
                onClick={generar}
                disabled={aiLoading}
                className={`rounded-lg px-4 py-2 text-sm font-bold ${
                  aiLoading ? 'bg-gris-claro text-gris-texto cursor-not-allowed'
                    : 'bg-verde-botella text-blanco hover:bg-verde-fresco'
                }`}
              >
                {aiLoading ? 'Generando…' : aiText ? 'Regenerar análisis' : 'Generar análisis'}
              </button>
              <button
                onClick={onPrint}
                disabled={!aiText && !aiData}
                className="rounded-lg px-4 py-2 text-sm font-bold border border-verde-botella text-verde-botella hover:bg-verde-botella hover:text-blanco disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Imprimir / PDF
              </button>
            </div>
          </div>

          {aiError && (
            <div className="bg-rojo/10 border border-rojo text-rojo rounded p-3 text-sm">
              Error: {aiError}
            </div>
          )}

          {!aiText && !aiData && !aiLoading && !aiError && (
            <div className="bg-blanco rounded-lg shadow-card p-10 text-center text-gris-texto italic">
              Selecciona el período y click en «Generar análisis» para producir un reporte de auditoría completo con gráficas e insights de IA.
            </div>
          )}

          {(aiData || aiLoading) && (
            <>
              {/* Header impreso (solo se ve en PDF) */}
              <div className="hidden print:block">
                <h1 className={`${bebasNeue.className} text-3xl text-verde-botella`}>AUDITORÍA — {desde === hasta ? desde : `${desde} → ${hasta}`}</h1>
                <p className="text-sm text-gris-texto">Generado: {format(new Date(), 'yyyy-MM-dd HH:mm')}</p>
              </div>

              {aiData && <KpisGrid data={aiData} />}
              {aiData && <Graficas data={aiData} />}
              {aiData && <Tablas data={aiData} />}

              {/* Análisis IA */}
              <section className="bg-blanco rounded-lg shadow-card p-5">
                <h2 className={`${bebasNeue.className} text-2xl text-verde-botella mb-3`}>Análisis con IA</h2>
                {aiLoading && !aiText && <p className="text-gris-texto italic">Pensando…</p>}
                {aiText && (
                  <div className="prose prose-sm max-w-none
                                  prose-headings:text-verde-botella prose-headings:font-bold
                                  prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-2
                                  prose-p:text-negro prose-p:leading-relaxed
                                  prose-strong:text-verde-botella
                                  prose-ul:list-disc prose-ul:pl-5 prose-li:my-1">
                    <ReactMarkdown>{aiText}</ReactMarkdown>
                  </div>
                )}
              </section>

              {aiUsage && (
                <p className="no-print text-xs text-gris-texto">
                  Tokens: input {aiUsage.input} · cache leído {aiUsage.cache_read} · cache escrito {aiUsage.cache_write} · output {aiUsage.output}
                </p>
              )}
            </>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}

function KpisGrid({ data }) {
  const k = data?.kpis_finales || {}
  const cards = [
    { label: 'Stock líquido (final)', value: fmt0(k.stock_liquido_final), color: 'verde-botella' },
    { label: 'Stock envase (final)', value: fmt0(k.stock_envase_final), color: 'verde-campo' },
    { label: 'Cajas despachadas', value: fmt0(k.cajas_despachadas_periodo), color: 'verde-fresco' },
    { label: 'Ingreso de envase', value: fmt0(k.ingreso_envase_periodo), color: 'ambar' },
    { label: 'Físico oficial (TOTALES)', value: fmt0(k.total_fisico_oficial), color: 'verde-botella' },
    { label: 'Mermas (operativa)', value: fmt0(k.mermas?.operativa), color: 'rojo' },
    { label: 'MB51 2000 (entradas)', value: fmt0(k.mb51?.almacen_2000_total), color: 'verde-campo' },
    { label: 'NS promedio (min)', value: k.promedio_minutos_ns != null ? fmt2(k.promedio_minutos_ns) : '—', color: 'ambar' },
  ]
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-blanco rounded-lg shadow-card p-4">
          <p className="text-xs uppercase tracking-wide text-gris-texto">{c.label}</p>
          <p className={`${bebasNeue.className} text-3xl mt-1 text-${c.color}`}>{c.value}</p>
        </div>
      ))}
    </section>
  )
}

function Graficas({ data }) {
  const topDiffs = (data?.top_diferencias_fisico_vs_sistema || []).slice(0, 10).map((r) => ({
    sku: r.sku,
    diferencia: r.diferencia,
    color: r.diferencia < 0 ? '#C0341A' : '#2E9944',
  }))
  const rutasNS = (data?.rutas_fuera_de_objetivo_ns || []).slice(0, 10).map((r) => ({
    ruta: r.ruta, minutos: r.minutos,
  }))
  const ingresoRutas = (data?.rutas_ingreso_envase || [])
    .filter((r) => r.env_rec > 0)
    .sort((a, b) => b.env_rec - a.env_rec)
    .slice(0, 10)
    .map((r) => ({ ruta: r.ruta, env_rec: r.env_rec }))

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Top diferencias físico vs sistema (10 mayores)">
        {topDiffs.length === 0 ? <Empty /> : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topDiffs}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sku" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
              <YAxis />
              <Tooltip />
              <ReferenceLine y={0} stroke="#888" />
              <Bar dataKey="diferencia">
                {topDiffs.map((r, i) => <Cell key={i} fill={r.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Rutas fuera de objetivo NS (>60 min)">
        {rutasNS.length === 0 ? <Empty msg="Todas las rutas dentro del objetivo" /> : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rutasNS}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="ruta" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
              <YAxis />
              <Tooltip />
              <ReferenceLine y={60} stroke="#C0341A" strokeDasharray="3 3" label="Objetivo" />
              <Bar dataKey="minutos" fill="#F5C800" name="Minutos" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Top 10 rutas por ingreso de envase">
        {ingresoRutas.length === 0 ? <Empty /> : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={ingresoRutas}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="ruta" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="env_rec" fill="#2E9944" name="Env. recibido" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Mermas por tipo">
        <MermasBars mermas={data?.kpis_finales?.mermas} />
      </ChartCard>
    </section>
  )
}

function MermasBars({ mermas }) {
  const m = mermas || {}
  const data = [
    { tipo: 'Operativa', valor: parseNumber(m.operativa) },
    { tipo: 'DORA', valor: parseNumber(m.dora) },
    { tipo: 'Total (archivo)', valor: parseNumber(m.total_archivo) },
  ]
  if (data.every((d) => d.valor === 0)) return <Empty msg="Sin mermas en el período" />
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="tipo" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="valor" fill="#C0341A" name="Cajas" />
      </BarChart>
    </ResponsiveContainer>
  )
}

function Tablas({ data }) {
  const bloqueados = data?.skus_con_stock_bloqueado || []
  const concDescuadres = data?.conciliacion_descuadres || []
  const faltantes = data?.reportes_faltantes_en_periodo || []

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-blanco rounded-lg shadow-card p-5">
        <h3 className={`${bebasNeue.className} text-xl text-verde-botella mb-3`}>Stock bloqueado por SKU</h3>
        {bloqueados.length === 0 ? <Empty msg="Sin SKUs bloqueados significativos" /> : (
          <table className="w-full text-sm">
            <thead className="text-left text-gris-texto border-b border-gris-claro">
              <tr><th className="py-1">SKU</th><th>Descripción</th><th className="text-right">Bloqueado</th></tr>
            </thead>
            <tbody>
              {bloqueados.slice(0, 10).map((r, i) => (
                <tr key={i} className="border-b border-gris-claro">
                  <td className="py-1 font-mono">{r.sku}</td>
                  <td className="py-1">{r.descripcion}</td>
                  <td className="py-1 text-right text-rojo font-semibold">{fmt2(r.bloqueado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-blanco rounded-lg shadow-card p-5">
        <h3 className={`${bebasNeue.className} text-xl text-verde-botella mb-3`}>Reportes faltantes / Descuadres conciliación</h3>
        <p className="text-xs text-gris-texto uppercase tracking-wide mb-1">Faltantes en el período</p>
        {faltantes.length === 0 ? (
          <p className="text-verde-fresco text-sm font-semibold">Todos los reportes esperados llegaron.</p>
        ) : (
          <ul className="text-sm mb-3">
            {faltantes.map((t) => <li key={t} className="text-rojo">• {t}</li>)}
          </ul>
        )}
        <p className="text-xs text-gris-texto uppercase tracking-wide mt-3 mb-1">Descuadres conciliación</p>
        {concDescuadres.length === 0 ? (
          <p className="text-gris-texto text-sm">Sin descuadres reportados.</p>
        ) : (
          <ul className="text-sm">
            {concDescuadres.slice(0, 5).map((r, i) => (
              <li key={i}>
                <span className="text-gris-texto">{r.fecha} T{r.turno} {r.momento}:</span>{' '}
                <span className="font-semibold">Δ {fmt2(r.diferencia)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function ChartCard({ title, children }) {
  return (
    <div className="bg-blanco rounded-lg shadow-card p-4">
      <h3 className={`${bebasNeue.className} text-xl text-verde-botella mb-2`}>{title}</h3>
      {children}
    </div>
  )
}

function Empty({ msg = 'Sin datos en el período' }) {
  return <p className="text-gris-texto text-sm italic py-12 text-center">{msg}</p>
}
