import { useCallback, useEffect, useState } from 'react'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { bebasNeue } from './_app'

const DEFAULTS = [
  { clave: 'dias_inventario_alerta', valor: '14', descripcion: 'Días restantes para mostrar alerta amarilla de inventario' },
  { clave: 'dias_inventario_critico', valor: '7', descripcion: 'Días restantes para mostrar alerta roja de inventario' },
  { clave: 'ns_objetivo', valor: '60', descripcion: 'Porcentaje objetivo de nivel de servicio (%)' },
  { clave: 'diferencia_merma_alerta', valor: '10', descripcion: 'Unidades de diferencia para disparar alerta de merma en dashboard' },
  { clave: 'diferencia_conteo_alerta', valor: '3', descripcion: 'Cajas mínimas de diferencia para mostrar SKU en desglose de conteo físico' },
]

const NUMERIC_KEYS = ['dias_inventario_alerta', 'dias_inventario_critico', 'ns_objetivo', 'diferencia_merma_alerta', 'diferencia_conteo_alerta']

export default function ConfiguracionPage() {
  const [rows, setRows] = useState([])
  const [draft, setDraft] = useState({})
  const [errors, setErrors] = useState({})
  const [msg, setMsg] = useState({ text: '', ok: true })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAllRows((from, to) =>
        supabase.from('configuracion').select('*').order('clave').range(from, to)
      )
      const existing = new Set(data.map((r) => r.clave))
      const missing = DEFAULTS.filter((d) => !existing.has(d.clave))
      if (missing.length > 0) {
        await supabase.from('configuracion').upsert(missing, { onConflict: 'clave' })
        const refreshed = await fetchAllRows((from, to) =>
          supabase.from('configuracion').select('*').order('clave').range(from, to)
        )
        setRows(refreshed)
        const d = {}
        for (const r of refreshed) d[r.clave] = r.valor ?? ''
        setDraft(d)
      } else {
        setRows(data)
        const d = {}
        for (const r of data) d[r.clave] = r.valor ?? ''
        setDraft(d)
      }
    } catch {
      setRows([])
      setDraft({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function validate(d) {
    const errs = {}
    for (const key of NUMERIC_KEYS) {
      if (key in d && d[key] !== '' && isNaN(Number(d[key]))) {
        errs[key] = 'Debe ser un número'
      }
    }
    return errs
  }

  function handleChange(clave, value) {
    setDraft((prev) => ({ ...prev, [clave]: value }))
    if (errors[clave]) setErrors((prev) => { const e = { ...prev }; delete e[clave]; return e })
    setMsg({ text: '', ok: true })
  }

  async function guardar() {
    const errs = validate(draft)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setSaving(true)
    setMsg({ text: '', ok: true })
    try {
      const payload = rows.map((r) => ({
        clave: r.clave,
        valor: draft[r.clave] ?? '',
        descripcion: r.descripcion,
      }))
      const { error } = await supabase.from('configuracion').upsert(payload, { onConflict: 'clave' })
      if (error) throw error
      setMsg({ text: 'Cambios guardados correctamente.', ok: true })
      await load()
    } catch (e) {
      setMsg({ text: e?.message || 'Error al guardar', ok: false })
    } finally {
      setSaving(false)
    }
  }

  async function sembrarDefaults() {
    setSeeding(true)
    setMsg({ text: '', ok: true })
    try {
      const { error } = await supabase.from('configuracion').upsert(DEFAULTS, { onConflict: 'clave' })
      if (error) throw error
      setMsg({ text: 'Valores por defecto cargados correctamente.', ok: true })
      await load()
    } catch (e) {
      setMsg({ text: e?.message || 'Error al sembrar defaults', ok: false })
    } finally {
      setSeeding(false)
    }
  }

  const hasChanges = rows.some((r) => (draft[r.clave] ?? '') !== (r.valor ?? ''))

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>CONFIGURACIÓN</h1>
          </div>

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-[12px] border border-gris-claro bg-white p-8 shadow-card text-center space-y-4">
              <p className="text-gris-texto">No hay parámetros configurados todavía.</p>
              <button
                type="button"
                onClick={sembrarDefaults}
                disabled={seeding}
                className="rounded-lg bg-verde-fresco px-6 py-3 font-bold text-blanco transition-colors duration-150 hover:bg-verde-campo disabled:opacity-50"
              >
                {seeding ? 'Cargando…' : 'Cargar valores por defecto'}
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                <table className="table-audicen">
                  <thead>
                    <tr>
                      <th>Clave</th>
                      <th>Valor</th>
                      <th>Descripción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const changed = (draft[r.clave] ?? '') !== (r.valor ?? '')
                      return (
                        <tr key={r.clave} className={changed ? 'bg-[#FFFBEB]' : ''}>
                          <td className="font-semibold font-mono text-sm">{r.clave}</td>
                          <td>
                            <input
                              className={`w-full rounded border px-2 py-1 focus:outline-none ${
                                errors[r.clave]
                                  ? 'border-rojo focus:border-rojo'
                                  : 'border-gris-claro focus:border-verde-fresco'
                              }`}
                              value={draft[r.clave] ?? ''}
                              onChange={(e) => handleChange(r.clave, e.target.value)}
                            />
                            {errors[r.clave] && (
                              <p className="text-xs text-rojo mt-1">{errors[r.clave]}</p>
                            )}
                          </td>
                          <td className="text-gris-texto text-sm">{r.descripcion ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={guardar}
                  disabled={saving || !hasChanges}
                  className="rounded-lg bg-verde-fresco px-6 py-3 font-bold text-blanco transition-colors duration-150 hover:bg-verde-campo disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Guardando…' : 'Guardar cambios'}
                </button>

                {hasChanges && !saving && (
                  <span className="text-sm text-dorado font-medium">
                    Hay cambios sin guardar
                  </span>
                )}
              </div>

              {msg.text ? (
                <p
                  className={`rounded-[12px] border px-4 py-3 text-sm shadow-card ${
                    msg.ok
                      ? 'border-verde-fresco bg-white text-verde-campo'
                      : 'border-rojo bg-[#FEE2E2] text-rojo'
                  }`}
                >
                  {msg.text}
                </p>
              ) : null}
            </>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
