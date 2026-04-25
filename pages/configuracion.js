import { useCallback, useEffect, useState } from 'react'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase, fetchAllRows } from '../lib/supabase'
import { bebasNeue } from './_app'

export default function ConfiguracionPage() {
  const [rows, setRows] = useState([])
  const [draft, setDraft] = useState({})
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAllRows((from, to) =>
        supabase.from('configuracion').select('*').order('clave').range(from, to)
      )
      setRows(data)
      const d = {}
      for (const r of data) {
        d[r.clave] = r.valor ?? ''
      }
      setDraft(d)
    } catch {
      setRows([])
      setDraft({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function guardar() {
    setMsg('')
    try {
      const payload = rows.map((r) => ({
        clave: r.clave,
        valor: draft[r.clave] ?? '',
        descripcion: r.descripcion,
      }))
      const { error } = await supabase.from('configuracion').upsert(payload, { onConflict: 'clave' })
      if (error) throw error
      setMsg('Cambios guardados correctamente.')
      await load()
    } catch (e) {
      setMsg(e?.message || 'Error al guardar')
    }
  }

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>CONFIGURACIÓN</h1>

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
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
                    {rows.map((r) => (
                      <tr key={r.clave}>
                        <td className="font-semibold">{r.clave}</td>
                        <td>
                          <input
                            className="w-full rounded border border-gris-claro px-2 py-1 focus:border-verde-fresco focus:outline-none"
                            value={draft[r.clave] ?? ''}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [r.clave]: e.target.value,
                              }))
                            }
                          />
                        </td>
                        <td>{r.descripcion ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                onClick={guardar}
                className="rounded-lg bg-verde-fresco px-6 py-3 font-bold text-blanco transition-colors duration-150 hover:bg-verde-campo"
              >
                Guardar cambios
              </button>

              {msg ? (
                <p
                  className={`rounded-[12px] border px-4 py-3 text-sm shadow-card ${
                    msg.includes('Error') ? 'border-rojo bg-[#FEE2E2] text-rojo' : 'border-verde-fresco bg-white text-verde-campo'
                  }`}
                >
                  {msg}
                </p>
              ) : null}
            </>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
