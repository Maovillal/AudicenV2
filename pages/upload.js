import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { runParser, isParserImplemented } from '@/lib/parsers'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { bebasNeue } from './_app'

const CHECKLIST = [
  // Turno 1 - Inicio
  { id: 't1_inicio_liq',    turno: 1, momento: 'inicio', tipo: 'inventario_liquido',  label: 'Inicio 2000' },
  { id: 't1_inicio_env',    turno: 1, momento: 'inicio', tipo: 'inventario_envase',   label: 'Inicio 2010' },
  { id: 't1_inicio_conc',   turno: 1, momento: 'inicio', tipo: 'conciliacion_envase', label: 'Conciliación de Envase' },
  // Turno 1 - Cierre
  { id: 't1_cierre_liq',    turno: 1, momento: 'cierre', tipo: 'inventario_liquido',  label: 'Cierre 2000' },
  { id: 't1_cierre_env',    turno: 1, momento: 'cierre', tipo: 'inventario_envase',   label: 'Cierre 2010' },
  { id: 't1_cierre_conc',   turno: 1, momento: 'cierre', tipo: 'conciliacion_envase', label: 'Conciliación de Envase' },
  { id: 't1_cierre_mb2000', turno: 1, momento: 'cierre', tipo: 'mb51_2000',           label: 'MB51 2000' },
  { id: 't1_cierre_mb2010', turno: 1, momento: 'cierre', tipo: 'mb51_2010',           label: 'MB51 2010' },
  // Turno 2 - Cierre
  { id: 't2_cierre_env',    turno: 2, momento: 'cierre', tipo: 'inventario_envase',   label: 'Cierre 2010' },
  { id: 't2_cierre_conc',   turno: 2, momento: 'cierre', tipo: 'conciliacion_envase', label: 'Conciliación de Envase' },
  { id: 't2_cierre_rutas',  turno: 2, momento: 'cierre', tipo: 'salidas_rutas',       label: 'Atención a Rutas' },
  { id: 't2_cierre_ingreso',turno: 2, momento: 'cierre', tipo: 'ingreso_envase',      label: 'Ingreso de Envase' },
  // Turno 3 - Inicio
  { id: 't3_inicio_cargas', turno: 3, momento: 'inicio', tipo: 'salidas_rutas',       label: 'Cargas a Salir' },
  { id: 't3_inicio_tarimas',turno: 3, momento: 'inicio', tipo: 'tarimas',             label: 'Reporte de Tarimas Completas' },
  // Turno 3 - Cierre
  { id: 't3_cierre_liq',    turno: 3, momento: 'cierre', tipo: 'inventario_liquido',  label: 'Cierre 2000' },
  { id: 't3_cierre_fisico', turno: 3, momento: 'cierre', tipo: 'conteo_fisico',       label: 'Cierre Físico Líquido' },
  { id: 't3_cierre_tiempos',turno: 3, momento: 'cierre', tipo: 'tiempos_carga',       label: 'Hoja de Tiempos de Cargas' },
]

const TURNOS = [
  { turno: 1, label: 'Turno 1', secciones: ['inicio', 'cierre'] },
  { turno: 2, label: 'Turno 2', secciones: ['cierre'] },
  { turno: 3, label: 'Turno 3', secciones: ['inicio', 'cierre'] },
]

function logKey(tipo, turno, momento) {
  return `${tipo}|${turno}|${momento}`
}

const DATA_TABLE_MAP = {
  inventario_liquido:  { table: 'inventario_liquido',  filters: (f, t, m) => ({ fecha: f, turno: t, momento: m }) },
  inventario_envase:   { table: 'inventario_envase',   filters: (f, t, m) => ({ fecha: f, turno: t, momento: m }) },
  conteo_fisico:       { table: 'conteo_fisico',       filters: (f)       => ({ fecha: f }) },
  salidas_rutas:       { table: 'salidas_rutas',       filters: (f, t, m) => ({ fecha: f, turno: t, momento: m }) },
  mb51_2000:           { table: 'movimientos_mb51',    filters: (f)       => ({ fecha: f, almacen: '2000' }) },
  mb51_2010:           { table: 'movimientos_mb51',    filters: (f)       => ({ fecha: f, almacen: '2010' }) },
  conciliacion_envase: { table: 'conciliacion_envase', filters: (f, t, m) => ({ fecha: f, turno: t, momento: m }) },
  ingreso_envase:      { table: 'ingreso_envase',      filters: (f, t, m) => ({ fecha: f, turno: t, momento: m }) },
  tiempos_carga:       { table: 'tiempos_carga',       filters: (f, t, m) => ({ fecha: f, turno: t, momento: m }) },
  tarimas:             { table: 'tarimas_completas',   filters: (f, t, m) => ({ fecha: f, turno: t, momento: m }) },
}

export default function UploadPage({ user }) {
  const router = useRouter()
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [uploadedKeys, setUploadedKeys] = useState(new Set())
  const [uploadedMeta, setUploadedMeta] = useState({})
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [activeItem, setActiveItem] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [deletingKey, setDeletingKey] = useState(null)
  const [confirmKey, setConfirmKey] = useState(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true)
    try {
      const logs = await fetchAllRows((from, to) =>
        supabase
          .from('upload_log')
          .select('tipo_archivo, turno, momento, created_at, registros')
          .eq('fecha', fecha)
          .range(from, to)
      )
      const keys = new Set()
      const meta = {}
      for (const log of logs) {
        const k = logKey(log.tipo_archivo, log.turno, log.momento)
        keys.add(k)
        if (!meta[k] || log.created_at > meta[k].created_at) {
          meta[k] = log
        }
      }
      setUploadedKeys(keys)
      setUploadedMeta(meta)
    } catch {
      setUploadedKeys(new Set())
      setUploadedMeta({})
    } finally {
      setLoadingLogs(false)
    }
  }, [fecha])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  function handleItemClick(item) {
    if (item.tipo === 'tarimas') {
      router.push(`/tarimas?fecha=${fecha}&turno=${item.turno}&momento=${item.momento}`)
      return
    }
    if (!isParserImplemented(item.tipo)) {
      setError(`"${item.label}" aún no tiene parser implementado.`)
      return
    }
    setError('')
    setActiveItem(item)
    setTimeout(() => fileInputRef.current?.click(), 0)
  }

  async function handleDelete(item) {
    const key = logKey(item.tipo, item.turno, item.momento)
    if (confirmKey !== key) {
      setConfirmKey(key)
      return
    }
    setConfirmKey(null)
    setDeletingKey(key)
    try {
      const mapping = DATA_TABLE_MAP[item.tipo]
      if (mapping) {
        const filters = mapping.filters(fecha, item.turno, item.momento)
        let q = supabase.from(mapping.table).delete()
        for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
        await q
      }
      await supabase.from('upload_log')
        .delete()
        .eq('fecha', fecha)
        .eq('tipo_archivo', item.tipo)
        .eq('turno', item.turno)
        .eq('momento', item.momento)
      await loadLogs()
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setDeletingKey(null)
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file || !activeItem) return
    e.target.value = ''
    setUploading(true)
    setError('')
    try {
      const res = await runParser(activeItem.tipo, file, fecha, user, activeItem.turno, activeItem.momento)
      if (res.success) {
        await loadLogs()
      } else {
        setError(res.error || 'Error al procesar el archivo.')
      }
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setUploading(false)
      setActiveItem(null)
    }
  }

  const total = CHECKLIST.length
  const done = CHECKLIST.filter((item) =>
    uploadedKeys.has(logKey(item.tipo, item.turno, item.momento))
  ).length

  return (
    <AuthGuard>
      <Layout>
        <div className="max-w-3xl space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>CARGAR DATOS</h1>
            <label className="text-sm font-semibold">
              Fecha
              <input
                type="date"
                value={fecha}
                onChange={(e) => { setFecha(e.target.value); setError('') }}
                className="ml-2 rounded-lg border border-gris-claro px-3 py-2 focus:border-verde-fresco focus:outline-none"
              />
            </label>
          </div>

          <div className="flex items-center gap-3 rounded-[12px] border border-gris-claro bg-white px-5 py-3 shadow-card">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-gris-claro">
              <div
                className="h-full rounded-full bg-verde-fresco transition-all duration-500"
                style={{ width: `${total ? (done / total) * 100 : 0}%` }}
              />
            </div>
            <span className="text-sm font-bold text-verde-botella">
              {done}/{total} cargados
            </span>
          </div>

          {error ? (
            <p className="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {loadingLogs ? (
            <p className="text-gris-texto">Cargando estado del día…</p>
          ) : (
            <div className="space-y-4">
              {TURNOS.map(({ turno, label, secciones }) => (
                <div key={turno} className="overflow-hidden rounded-[12px] border border-gris-claro bg-white shadow-card">
                  <div className="border-b border-gris-claro bg-verde-botella px-4 py-2">
                    <h2 className={`${bebasNeue.className} text-xl text-blanco`}>{label}</h2>
                  </div>
                  {secciones.map((momento) => {
                    const items = CHECKLIST.filter((c) => c.turno === turno && c.momento === momento)
                    return (
                      <div key={momento} className="border-b border-gris-claro last:border-0">
                        <p className="bg-gris-fondo px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-gris-texto">
                          {momento === 'inicio' ? '↑ Inicio' : '↓ Cierre'}
                        </p>
                        <ul>
                          {items.map((item) => {
                            const key = logKey(item.tipo, item.turno, item.momento)
                            const isDone = uploadedKeys.has(key)
                            const meta = uploadedMeta[key]
                            const isActive = activeItem?.id === item.id && uploading
                            const implemented = isParserImplemented(item.tipo)

                            return (
                              <li
                                key={item.id}
                                onClick={() => !isDone && !uploading && handleItemClick(item)}
                                className={[
                                  'flex items-center gap-3 px-4 py-3 transition-colors duration-150',
                                  isDone ? 'bg-white' : implemented ? 'cursor-pointer hover:bg-verde-fresco/5' : 'opacity-60',
                                  'border-b border-gris-claro/50 last:border-0',
                                ].join(' ')}
                              >
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors duration-150"
                                  style={isDone
                                    ? { borderColor: '#2E9944', background: '#2E9944', color: '#fff' }
                                    : isActive
                                    ? { borderColor: '#C0A020', background: '#C0A020', color: '#fff' }
                                    : { borderColor: '#C8C8C8', background: '#fff', color: '#C8C8C8' }
                                  }
                                >
                                  {isDone ? '✓' : isActive ? '…' : '○'}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-semibold ${isDone ? 'text-verde-campo' : 'text-negro'}`}>
                                    {item.label}
                                  </p>
                                  {isDone && meta ? (
                                    <p className="text-xs text-gris-texto">
                                      {meta.registros} registros · {new Date(meta.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  ) : !implemented ? (
                                    <p className="text-xs text-dorado">Próximamente</p>
                                  ) : (
                                    <p className="text-xs text-gris-texto">Pendiente — haz clic para subir</p>
                                  )}
                                </div>
                                {isDone && (
                                  confirmKey === key ? (
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(item) }}
                                        disabled={deletingKey === key}
                                        className="text-xs font-bold text-rojo hover:underline"
                                      >
                                        {deletingKey === key ? 'Eliminando…' : 'Confirmar'}
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setConfirmKey(null) }}
                                        className="text-xs text-gris-texto hover:underline"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDelete(item) }}
                                      className="text-gris-texto hover:text-rojo transition-colors"
                                      title="Eliminar registro"
                                    >
                                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                      </svg>
                                    </button>
                                  )
                                )}
                                {!isDone && implemented && !isActive && (
                                  <span className="text-xs font-semibold text-verde-fresco">Subir →</span>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".xls,.xlsx,.csv,.txt,.tsv"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </Layout>
    </AuthGuard>
  )
}
