import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useFechaGlobal } from '@/lib/useFecha'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase } from '@/lib/supabase'
import { bebasNeue } from './_app'

const RUTAS = [
  'RK1601','RK1602','RK1603','RK1604','RK1605','RK1607','RK1608',
  'RK1609','RK1610','RK1611','RK1612','RK1613','RK1614','RK1615',
  'RK1616','RK1617','RK1618','RK1619','RK1624','FK48001',
]

function emptyMaterial() {
  return { sku: '', descripcion: '', cant_pallets: '', cant_cajas: '', id_tarima: '' }
}

function emptyRuta() {
  return { transporte: '', ruta: '', materiales: [emptyMaterial()] }
}

export default function TarimasPage({ user }) {
  const router = useRouter()
  const [fecha, setFecha] = useFechaGlobal()
  const [turno, setTurno] = useState(3)
  const [momento, setMomento] = useState('inicio')
  const [rutas, setRutas] = useState([emptyRuta()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!router.isReady) return
    if (router.query.fecha) setFecha(router.query.fecha)
    if (router.query.turno) setTurno(Number(router.query.turno))
    if (router.query.momento) setMomento(router.query.momento)
  }, [router.isReady, router.query])

  function updateRuta(ri, field, value) {
    setRutas((prev) => prev.map((r, i) => i === ri ? { ...r, [field]: value } : r))
  }

  function updateMaterial(ri, mi, field, value) {
    setRutas((prev) => prev.map((r, i) => {
      if (i !== ri) return r
      return { ...r, materiales: r.materiales.map((m, j) => j === mi ? { ...m, [field]: value } : m) }
    }))
  }

  function addMaterial(ri) {
    setRutas((prev) => prev.map((r, i) => i === ri ? { ...r, materiales: [...r.materiales, emptyMaterial()] } : r))
  }

  function removeMaterial(ri, mi) {
    setRutas((prev) => prev.map((r, i) => {
      if (i !== ri) return r
      const mats = r.materiales.filter((_, j) => j !== mi)
      return { ...r, materiales: mats.length ? mats : [emptyMaterial()] }
    }))
  }

  function addRuta() {
    setRutas((prev) => [...prev, emptyRuta()])
  }

  function removeRuta(ri) {
    setRutas((prev) => prev.length > 1 ? prev.filter((_, i) => i !== ri) : prev)
  }

  const totalTarimas = useCallback(() => {
    return rutas.reduce((acc, r) =>
      acc + r.materiales.reduce((a, m) => a + (parseInt(m.cant_pallets) || 0), 0), 0)
  }, [rutas])

  async function handleGuardar() {
    setError('')
    const records = []
    for (const r of rutas) {
      if (!r.ruta) continue
      for (const m of r.materiales) {
        if (!m.sku) continue
        records.push({
          fecha,
          turno,
          momento,
          transporte: r.transporte || null,
          ruta: r.ruta,
          sku: m.sku,
          descripcion: m.descripcion || null,
          cant_pallets: parseInt(m.cant_pallets) || null,
          cant_cajas: parseInt(m.cant_cajas) || null,
          id_tarima: m.id_tarima || null,
          uploaded_by: user?.id ?? null,
        })
      }
    }
    if (!records.length) {
      setError('Agrega al menos una ruta con un material.')
      return
    }
    setSaving(true)
    try {
      const { error: delErr } = await supabase
        .from('tarimas_completas')
        .delete()
        .eq('fecha', fecha)
        .eq('turno', turno)
        .eq('momento', momento)
      if (delErr) throw delErr

      const { error: insErr } = await supabase.from('tarimas_completas').insert(records)
      if (insErr) throw insErr

      await supabase.from('upload_log').insert({
        tipo_archivo: 'tarimas',
        registros: records.length,
        fecha,
        turno,
        momento,
        uploaded_by: user?.id ?? null,
      })

      setSuccess(true)
      setTimeout(() => router.push('/upload'), 1500)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthGuard>
      <Layout>
        <div className="max-w-4xl space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>TARIMAS COMPLETAS</h1>
              <p className="text-sm text-gris-texto">Turno {turno} · {momento === 'inicio' ? 'Inicio' : 'Cierre'}</p>
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

          <div className="flex items-center justify-between rounded-[12px] border border-gris-claro bg-white px-5 py-3 shadow-card">
            <span className="text-sm text-gris-texto">Total de tarimas capturadas</span>
            <span className={`${bebasNeue.className} text-3xl text-verde-campo`}>{totalTarimas()}</span>
          </div>

          {error && (
            <p className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}
          {success && (
            <p className="rounded-[12px] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              Guardado correctamente. Regresando...
            </p>
          )}

          <div className="space-y-4">
            {rutas.map((ruta, ri) => {
              const totalRuta = ruta.materiales.reduce((a, m) => a + (parseInt(m.cant_pallets) || 0), 0)
              return (
                <div key={ri} className="overflow-hidden rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <div className="flex items-center justify-between border-b border-gris-claro bg-verde-botella px-4 py-2">
                    <div className="flex items-center gap-3">
                      <input
                        type="text"
                        placeholder="Transporte"
                        value={ruta.transporte}
                        onChange={(e) => updateRuta(ri, 'transporte', e.target.value)}
                        className="w-32 rounded px-2 py-1 text-sm text-negro focus:outline-none"
                      />
                      <select
                        value={ruta.ruta}
                        onChange={(e) => updateRuta(ri, 'ruta', e.target.value)}
                        className="rounded px-2 py-1 text-sm text-negro focus:outline-none"
                      >
                        <option value="">— Ruta —</option>
                        {RUTAS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <span className={`${bebasNeue.className} text-lg text-blanco`}>
                        {totalRuta} tarima{totalRuta !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {rutas.length > 1 && (
                      <button onClick={() => removeRuta(ri)} className="text-red-300 hover:text-white text-lg font-bold">✕</button>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gris-claro bg-gris-fondo text-left text-xs font-bold uppercase tracking-wide text-gris-texto">
                          <th className="px-3 py-2">Material</th>
                          <th className="px-3 py-2">Descripción</th>
                          <th className="px-3 py-2 text-center">Pallets</th>
                          <th className="px-3 py-2 text-center">Cajas</th>
                          <th className="px-3 py-2">ID Tarima</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {ruta.materiales.map((m, mi) => (
                          <tr key={mi} className="border-b border-gris-claro/50 last:border-0">
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                placeholder="139011"
                                value={m.sku}
                                onChange={(e) => updateMaterial(ri, mi, 'sku', e.target.value)}
                                className="w-24 rounded border border-gris-claro px-2 py-1 focus:border-verde-fresco focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                placeholder="Descripción"
                                value={m.descripcion}
                                onChange={(e) => updateMaterial(ri, mi, 'descripcion', e.target.value)}
                                className="w-48 rounded border border-gris-claro px-2 py-1 focus:border-verde-fresco focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min="0"
                                placeholder="1"
                                value={m.cant_pallets}
                                onChange={(e) => updateMaterial(ri, mi, 'cant_pallets', e.target.value)}
                                className="w-16 rounded border border-gris-claro px-2 py-1 text-center focus:border-verde-fresco focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min="0"
                                placeholder="336"
                                value={m.cant_cajas}
                                onChange={(e) => updateMaterial(ri, mi, 'cant_cajas', e.target.value)}
                                className="w-20 rounded border border-gris-claro px-2 py-1 text-center focus:border-verde-fresco focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                placeholder="001"
                                value={m.id_tarima}
                                onChange={(e) => updateMaterial(ri, mi, 'id_tarima', e.target.value)}
                                className="w-24 rounded border border-gris-claro px-2 py-1 focus:border-verde-fresco focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <button
                                onClick={() => removeMaterial(ri, mi)}
                                className="text-gris-texto hover:text-rojo"
                              >✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="px-4 py-2">
                    <button
                      onClick={() => addMaterial(ri)}
                      className="text-sm font-semibold text-verde-fresco hover:text-verde-campo"
                    >
                      + Agregar material
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col gap-3 md:flex-row">
            <button
              onClick={addRuta}
              className="rounded-lg border-2 border-dashed border-gris-claro px-6 py-3 text-sm font-semibold text-gris-texto transition-colors hover:border-verde-fresco hover:text-verde-fresco"
            >
              + Agregar ruta
            </button>
            <button
              onClick={handleGuardar}
              disabled={saving || success}
              className="rounded-lg bg-verde-fresco px-8 py-3 font-bold text-blanco transition-colors hover:bg-verde-campo disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </Layout>
    </AuthGuard>
  )
}
