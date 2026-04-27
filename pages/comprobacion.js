import { useCallback, useEffect, useMemo, useState } from 'react'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { parseNumber } from '@/lib/format'
import { bebasNeue } from './_app'

function prevDay(fechaStr) {
  const d = new Date(fechaStr + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

function sumField(rows, field) {
  return rows.reduce((acc, r) => acc + parseNumber(r[field]), 0)
}

function fmt(val) {
  if (val === null || val === undefined) return '—'
  return val.toLocaleString('es-MX', { maximumFractionDigits: 2 })
}

export default function ComprobacionPage() {
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  const ayer = useMemo(() => prevDay(fecha), [fecha])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const q = (table, filters) =>
        fetchAllRows((f, t) => {
          let q = supabase.from(table).select('*')
          for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
          return q.range(f, t)
        })

      const [
        liqT1Ini,
        liqT1Cie,
        liqT3Cie,
        fisicoAyer,
        fisicoHoy,
        envT1Ini,
        envT1Cie,
        envT2Cie,
        envT2CieAyer,
        concT1Ini,
        concT1Cie,
        concT2Cie,
        concT2CieAyer,
        mb51_2000,
        mb51_2010,
        ingreso,
        cargas,
      ] = await Promise.all([
        q('inventario_liquido',  { fecha, turno: 1, momento: 'inicio' }),
        q('inventario_liquido',  { fecha, turno: 1, momento: 'cierre' }),
        q('inventario_liquido',  { fecha, turno: 3, momento: 'cierre' }),
        q('conteo_fisico',       { fecha: ayer }),
        q('conteo_fisico',       { fecha }),
        q('inventario_envase',   { fecha, turno: 1, momento: 'inicio' }),
        q('inventario_envase',   { fecha, turno: 1, momento: 'cierre' }),
        q('inventario_envase',   { fecha, turno: 2, momento: 'cierre' }),
        q('inventario_envase',   { fecha: ayer, turno: 2, momento: 'cierre' }),
        q('conciliacion_envase', { fecha, turno: 1, momento: 'inicio' }),
        q('conciliacion_envase', { fecha, turno: 1, momento: 'cierre' }),
        q('conciliacion_envase', { fecha, turno: 2, momento: 'cierre' }),
        q('conciliacion_envase', { fecha: ayer, turno: 2, momento: 'cierre' }),
        q('movimientos_mb51',    { fecha, almacen: '2000' }),
        q('movimientos_mb51',    { fecha, almacen: '2010' }),
        q('ingreso_envase',      { fecha }),
        q('salidas_rutas',       { fecha, turno: 3, momento: 'inicio' }),
      ])

      setData({
        liqT1Ini, liqT1Cie, liqT3Cie,
        fisicoAyer, fisicoHoy,
        envT1Ini, envT1Cie, envT2Cie, envT2CieAyer,
        concT1Ini, concT1Cie, concT2Cie, concT2CieAyer,
        mb51_2000, mb51_2010, ingreso, cargas,
      })
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [fecha, ayer])

  useEffect(() => { load() }, [load])

  const checks = useMemo(() => {
    if (!data) return []

    const has = (arr) => arr && arr.length > 0
    const s = {
      liqT1Ini:      sumField(data.liqT1Ini,      'stock_libre'),
      liqT1Cie:      sumField(data.liqT1Cie,      'stock_libre'),
      liqT3Cie:      sumField(data.liqT3Cie,      'stock_libre'),
      fisicoAyer:    sumField(data.fisicoAyer,    'total_fisico_real'),
      fisicoHoy:     sumField(data.fisicoHoy,     'total_fisico_real'),
      envT1Ini:      sumField(data.envT1Ini,      'stock_libre'),
      envT1Cie:      sumField(data.envT1Cie,      'stock_libre'),
      envT2Cie:      sumField(data.envT2Cie,      'stock_libre'),
      envT2CieAyer:  sumField(data.envT2CieAyer,  'stock_libre'),
      concT1Ini:     sumField(data.concT1Ini,     'fisico_total'),
      concT1Cie:     sumField(data.concT1Cie,     'fisico_total'),
      concT2Cie:     sumField(data.concT2Cie,     'fisico_total'),
      concT2CieAyer: sumField(data.concT2CieAyer, 'fisico_total'),
      mb51_2000:     sumField(data.mb51_2000,      'cantidad'),
      mb51_2010:     sumField(data.mb51_2010,      'cantidad'),
      ingreso:       sumField(data.ingreso,        'total'),
      cargas:        sumField(data.cargas,         'cantidad'),
    }

    const check = ({ id, formula, lhsLabel, lhsVal, rhsLabel, rhsVal, hasData }) => {
      if (!hasData) {
        return { id, formula, lhsLabel, rhsLabel, lhsVal: null, rhsVal: null, diff: null, status: 'sin_datos' }
      }
      const diff = lhsVal - rhsVal
      return {
        id, formula, lhsLabel, rhsLabel, lhsVal, rhsVal, diff,
        status: Math.abs(diff) < 0.01 ? 'ok' : 'anomalia',
      }
    }

    return [
      check({
        id: 1,
        formula: 'Inicio 2000 T1 = Cierre Físico 2000 (día anterior)',
        lhsLabel: 'Inv. Líquido T1 Inicio',
        lhsVal: s.liqT1Ini,
        rhsLabel: `Conteo Físico ${ayer}`,
        rhsVal: s.fisicoAyer,
        hasData: has(data.liqT1Ini) && has(data.fisicoAyer),
      }),
      check({
        id: 2,
        formula: 'Inicio 2010 T1 = Cierre 2010 T2 (día anterior)',
        lhsLabel: 'Inv. Envase T1 Inicio',
        lhsVal: s.envT1Ini,
        rhsLabel: `Inv. Envase T2 Cierre ${ayer}`,
        rhsVal: s.envT2CieAyer,
        hasData: has(data.envT1Ini) && has(data.envT2CieAyer),
      }),
      check({
        id: 3,
        formula: 'Inicio 2010 T1 = Cierre Conciliación Envase T2 (día anterior)',
        lhsLabel: 'Inv. Envase T1 Inicio',
        lhsVal: s.envT1Ini,
        rhsLabel: `Conc. Envase T2 Cierre ${ayer}`,
        rhsVal: s.concT2CieAyer,
        hasData: has(data.envT1Ini) && has(data.concT2CieAyer),
      }),
      check({
        id: 4,
        formula: 'Conciliación Envase T1 Inicio = Inicio 2010 T1',
        lhsLabel: 'Conc. Envase T1 Inicio',
        lhsVal: s.concT1Ini,
        rhsLabel: 'Inv. Envase T1 Inicio',
        rhsVal: s.envT1Ini,
        hasData: has(data.concT1Ini) && has(data.envT1Ini),
      }),
      check({
        id: 5,
        formula: 'Cierre 2000 T1 = Inicio 2000 T1 + MB51 2000',
        lhsLabel: 'Inv. Líquido T1 Cierre',
        lhsVal: s.liqT1Cie,
        rhsLabel: 'T1 Inicio + MB51 2000',
        rhsVal: s.liqT1Ini + s.mb51_2000,
        hasData: has(data.liqT1Cie) && has(data.liqT1Ini) && has(data.mb51_2000),
      }),
      check({
        id: 6,
        formula: 'Cierre 2010 T1 = Inicio 2010 T1 − MB51 2010',
        lhsLabel: 'Inv. Envase T1 Cierre',
        lhsVal: s.envT1Cie,
        rhsLabel: 'T1 Inicio − MB51 2010',
        rhsVal: s.envT1Ini - s.mb51_2010,
        hasData: has(data.envT1Cie) && has(data.envT1Ini) && has(data.mb51_2010),
      }),
      check({
        id: 7,
        formula: 'Cierre Conciliación Envase T1 = Cierre 2010 T1',
        lhsLabel: 'Conc. Envase T1 Cierre',
        lhsVal: s.concT1Cie,
        rhsLabel: 'Inv. Envase T1 Cierre',
        rhsVal: s.envT1Cie,
        hasData: has(data.concT1Cie) && has(data.envT1Cie),
      }),
      check({
        id: 8,
        formula: 'Cierre 2010 T2 = Cierre 2010 T1 + Ingresos de Envase',
        lhsLabel: 'Inv. Envase T2 Cierre',
        lhsVal: s.envT2Cie,
        rhsLabel: 'T1 Cierre + Ingresos',
        rhsVal: s.envT1Cie + s.ingreso,
        hasData: has(data.envT2Cie) && has(data.envT1Cie) && has(data.ingreso),
      }),
      check({
        id: 9,
        formula: 'Conciliación Envase Cierre T2 = Cierre 2010 T2',
        lhsLabel: 'Conc. Envase T2 Cierre',
        lhsVal: s.concT2Cie,
        rhsLabel: 'Inv. Envase T2 Cierre',
        rhsVal: s.envT2Cie,
        hasData: has(data.concT2Cie) && has(data.envT2Cie),
      }),
      check({
        id: 10,
        formula: 'Cierre 2000 T3 = Cierre 2000 T1 − Cargas a Salir',
        lhsLabel: 'Inv. Líquido T3 Cierre',
        lhsVal: s.liqT3Cie,
        rhsLabel: 'T1 Cierre − Cargas T3',
        rhsVal: s.liqT1Cie - s.cargas,
        hasData: has(data.liqT3Cie) && has(data.liqT1Cie) && has(data.cargas),
      }),
      check({
        id: 11,
        formula: 'Conteo Físico 2000 Cierre = Cierre 2000 T3',
        lhsLabel: 'Conteo Físico (hoy)',
        lhsVal: s.fisicoHoy,
        rhsLabel: 'Inv. Líquido T3 Cierre',
        rhsVal: s.liqT3Cie,
        hasData: has(data.fisicoHoy) && has(data.liqT3Cie),
      }),
    ]
  }, [data, ayer])

  const anomalias = checks.filter((c) => c.status === 'anomalia')
  const sinDatos  = checks.filter((c) => c.status === 'sin_datos')
  const ok        = checks.filter((c) => c.status === 'ok')

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-8">
          {/* Header */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>COMPROBACIÓN</h1>
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
          ) : (
            <>
              {/* Resumen */}
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-[12px] border border-red-200 bg-red-50 p-4 text-center shadow-card">
                  <p className="text-3xl font-bold text-red-600">{anomalias.length}</p>
                  <p className="mt-1 text-sm font-semibold text-red-700">Anomalías</p>
                </div>
                <div className="rounded-[12px] border border-green-200 bg-green-50 p-4 text-center shadow-card">
                  <p className="text-3xl font-bold text-green-700">{ok.length}</p>
                  <p className="mt-1 text-sm font-semibold text-green-800">Correctas</p>
                </div>
                <div className="rounded-[12px] border border-gris-claro bg-white p-4 text-center shadow-card">
                  <p className="text-3xl font-bold text-gris-texto">{sinDatos.length}</p>
                  <p className="mt-1 text-sm font-semibold text-gris-texto">Sin datos</p>
                </div>
              </div>

              {/* Banner de anomalías */}
              {anomalias.length > 0 && (
                <div className="rounded-[12px] border border-red-300 bg-red-50 p-4 shadow-card">
                  <p className={`${bebasNeue.className} mb-2 text-xl text-red-700`}>ANOMALÍAS DETECTADAS</p>
                  <ul className="space-y-1 text-sm text-red-800">
                    {anomalias.map((c) => (
                      <li key={c.id} className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 font-bold">#{c.id}</span>
                        <span>
                          <span className="font-semibold">{c.formula}</span>
                          {' — '}diferencia:{' '}
                          <span className="font-mono font-bold">{fmt(c.diff)}</span>
                          {' '}({c.lhsLabel}: {fmt(c.lhsVal)} vs {c.rhsLabel}: {fmt(c.rhsVal)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tabla de fórmulas */}
              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>
                  Detalle de Fórmulas — {fecha}
                </h2>
                <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <table className="table-audicen">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Fórmula</th>
                        <th>{/* lado izq */}Valor LHS</th>
                        <th>{/* lado der */}Valor RHS</th>
                        <th>Diferencia</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map((c) => (
                        <tr
                          key={c.id}
                          className={
                            c.status === 'anomalia'
                              ? 'bg-red-50'
                              : c.status === 'ok'
                              ? 'bg-green-50'
                              : ''
                          }
                        >
                          <td className="font-bold text-gris-texto">{c.id}</td>
                          <td>
                            <p className="font-semibold text-verde-botella">{c.formula}</p>
                            {c.status !== 'sin_datos' && (
                              <p className="mt-0.5 text-xs text-gris-texto">
                                {c.lhsLabel} vs {c.rhsLabel}
                              </p>
                            )}
                          </td>
                          <td className="font-mono">
                            {c.lhsVal !== null ? fmt(c.lhsVal) : <span className="text-gris-texto">—</span>}
                            {c.status !== 'sin_datos' && (
                              <p className="text-xs text-gris-texto">{c.lhsLabel}</p>
                            )}
                          </td>
                          <td className="font-mono">
                            {c.rhsVal !== null ? fmt(c.rhsVal) : <span className="text-gris-texto">—</span>}
                            {c.status !== 'sin_datos' && (
                              <p className="text-xs text-gris-texto">{c.rhsLabel}</p>
                            )}
                          </td>
                          <td className="font-mono font-semibold">
                            {c.diff !== null ? (
                              <span className={c.diff !== 0 ? 'text-red-600' : 'text-green-700'}>
                                {fmt(c.diff)}
                              </span>
                            ) : (
                              <span className="text-gris-texto">—</span>
                            )}
                          </td>
                          <td>
                            {c.status === 'ok' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">
                                ✓ OK
                              </span>
                            )}
                            {c.status === 'anomalia' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                                ⚠ Anomalía
                              </span>
                            )}
                            {c.status === 'sin_datos' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                                Sin datos
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Referencia de valores usados */}
              <section>
                <h2 className={`${bebasNeue.className} mb-3 text-2xl text-verde-botella`}>
                  Valores de Referencia
                </h2>
                <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <table className="table-audicen">
                    <thead>
                      <tr>
                        <th>Fuente</th>
                        <th>Filtros</th>
                        <th>Suma</th>
                        <th>Registros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: 'Inv. Líquido T1 Inicio',        rows: data.liqT1Ini,      field: 'stock_libre',  filtros: `${fecha} · T1 · inicio` },
                        { label: 'Inv. Líquido T1 Cierre',        rows: data.liqT1Cie,      field: 'stock_libre',  filtros: `${fecha} · T1 · cierre` },
                        { label: 'Inv. Líquido T3 Cierre',        rows: data.liqT3Cie,      field: 'stock_libre',  filtros: `${fecha} · T3 · cierre` },
                        { label: 'Conteo Físico Real (ayer)',      rows: data.fisicoAyer,    field: 'total_fisico_real', filtros: `${ayer} (U−AF)` },
                        { label: 'Conteo Físico Real (hoy)',       rows: data.fisicoHoy,     field: 'total_fisico_real', filtros: `${fecha} (U−AF)` },
                        { label: 'Inv. Envase T1 Inicio',         rows: data.envT1Ini,      field: 'stock_libre',  filtros: `${fecha} · T1 · inicio` },
                        { label: 'Inv. Envase T1 Cierre',         rows: data.envT1Cie,      field: 'stock_libre',  filtros: `${fecha} · T1 · cierre` },
                        { label: 'Inv. Envase T2 Cierre',         rows: data.envT2Cie,      field: 'stock_libre',  filtros: `${fecha} · T2 · cierre` },
                        { label: 'Inv. Envase T2 Cierre (ayer)',  rows: data.envT2CieAyer,  field: 'stock_libre',  filtros: `${ayer} · T2 · cierre` },
                        { label: 'Conc. Envase T1 Inicio',        rows: data.concT1Ini,     field: 'fisico_total', filtros: `${fecha} · T1 · inicio` },
                        { label: 'Conc. Envase T1 Cierre',        rows: data.concT1Cie,     field: 'fisico_total', filtros: `${fecha} · T1 · cierre` },
                        { label: 'Conc. Envase T2 Cierre',        rows: data.concT2Cie,     field: 'fisico_total', filtros: `${fecha} · T2 · cierre` },
                        { label: 'Conc. Envase T2 Cierre (ayer)', rows: data.concT2CieAyer, field: 'fisico_total', filtros: `${ayer} · T2 · cierre` },
                        { label: 'MB51 2000',                     rows: data.mb51_2000,     field: 'cantidad',     filtros: `${fecha} · almacén 2000` },
                        { label: 'MB51 2010',                     rows: data.mb51_2010,     field: 'cantidad',     filtros: `${fecha} · almacén 2010` },
                        { label: 'Ingresos de Envase',            rows: data.ingreso,       field: 'total',        filtros: `${fecha}` },
                        { label: 'Cargas a Salir (T3 Inicio)',    rows: data.cargas,        field: 'cantidad',     filtros: `${fecha} · T3 · inicio` },
                      ].map(({ label, rows, field, filtros }) => (
                        <tr key={label}>
                          <td className="font-semibold">{label}</td>
                          <td className="text-xs text-gris-texto">{filtros}</td>
                          <td className="font-mono">{rows.length > 0 ? fmt(sumField(rows, field)) : <span className="text-gris-texto">—</span>}</td>
                          <td className="text-gris-texto">{rows.length}</td>
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
