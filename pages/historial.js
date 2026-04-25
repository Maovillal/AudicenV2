import { useCallback, useEffect, useState } from 'react'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { supabase } from '../lib/supabase'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { bebasNeue } from './_app'

const PAGE_SIZE = 20

export default function HistorialPage() {
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1
      const { data, error, count } = await supabase
        .from('upload_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)
      if (error) throw error
      setRows(data || [])
      setTotal(count ?? 0)
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <AuthGuard>
      <Layout>
        <div className="space-y-6">
          <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>HISTORIAL DE CARGAS</h1>

          {loading ? (
            <p className="text-gris-texto">Cargando…</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-[12px] border border-gris-claro bg-white shadow-card">
                <table className="table-audicen">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tipo de Archivo</th>
                      <th>Registros</th>
                      <th>Subido por</th>
                      <th>Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => {
                      let fechaCol = '—'
                      let horaCol = '—'
                      if (u.created_at) {
                        try {
                          const d = parseISO(u.created_at)
                          fechaCol = format(d, 'dd/MM/yyyy', { locale: es })
                          horaCol = format(d, 'HH:mm', { locale: es })
                        } catch {
                          /* ignore */
                        }
                      }
                      return (
                        <tr key={u.id ?? u.created_at}>
                          <td>{fechaCol}</td>
                          <td>{u.tipo_archivo ?? u.tipo ?? '—'}</td>
                          <td>{u.registros ?? u.cantidad_registros ?? '—'}</td>
                          <td>{u.uploaded_by ?? u.usuario ?? u.email ?? '—'}</td>
                          <td>{horaCol}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded-lg border border-gris-claro px-4 py-2 text-sm font-semibold transition-colors duration-150 hover:bg-gris-claro disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-gris-claro px-4 py-2 text-sm font-semibold transition-colors duration-150 hover:bg-gris-claro disabled:opacity-40"
                >
                  Siguiente
                </button>
                <span className="text-sm text-gris-texto">
                  Página {page + 1} de {totalPages} ({total} registros)
                </span>
              </div>
            </>
          )}
        </div>
      </Layout>
    </AuthGuard>
  )
}
