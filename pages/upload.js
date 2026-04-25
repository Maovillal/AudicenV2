import { useCallback, useState } from 'react'
import Link from 'next/link'
import AuthGuard from '@/components/AuthGuard'
import Layout from '@/components/Layout'
import { runParser, isParserImplemented } from '@/lib/parsers'
import { bebasNeue } from './_app'

const TIPOS = [
  { value: 'inventario_liquido', label: 'Inventario Líquido (2000)', href: '/inventario', linkText: 'Ver en Inventario' },
  { value: 'inventario_envase', label: 'Inventario Envase (2010)', href: '/envase', linkText: 'Ver en Envase' },
  { value: 'conteo_fisico', label: 'Conteo Físico', href: '/merma', linkText: 'Ver en Merma y Diferencias' },
  { value: 'salidas_rutas', label: 'Salidas / Cargas', href: '/rutas', linkText: 'Ver en Salidas por ruta' },
  { value: 'mb51_2000', label: 'MB51 Entradas Líquido (2000)', href: '/historial', linkText: 'Ver historial de cargas' },
  { value: 'mb51_2010', label: 'MB51 Salidas Envase (2010)', href: '/historial', linkText: 'Ver historial de cargas' },
  { value: 'conciliacion_envase', label: 'Conciliación de Envase', href: null, linkText: null },
  { value: 'nivel_servicio', label: 'Nivel de Servicio', href: '/nivel-servicio', linkText: 'Ver Nivel de servicio' },
  { value: 'ingreso_envase', label: 'Ingreso de Envase', href: '/envase', linkText: 'Ver en Envase' },
  { value: 'tiempos_carga', label: 'Tiempos de Carga', href: '/historial', linkText: 'Ver historial de cargas' },
]

function tipoMeta(value) {
  return TIPOS.find((t) => t.value === value) || { label: value, href: null, linkText: null }
}

export default function UploadPage({ user }) {
  const [tipo, setTipo] = useState(TIPOS[0].value)
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [file, setFile] = useState(null)
  const [drag, setDrag] = useState(false)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState(null)

  const onFiles = useCallback((files) => {
    const f = files?.[0]
    if (!f) return
    setFile(f)
    setStatus('')
    setSummary(null)
  }, [])

  async function handleCargar() {
    if (!file || !fecha) return
    if (!isParserImplemented(tipo)) {
      setSummary(null)
      setStatus(`Parser pendiente de implementación para ${tipoMeta(tipo).label}`)
      return
    }
    setLoading(true)
    setStatus('Procesando…')
    setSummary(null)
    try {
      const res = await runParser(tipo, file, fecha, user)
      if (res.success) {
        setStatus(`Cargado exitosamente: ${res.registros} registros`)
        const meta = tipoMeta(tipo)
        setSummary({
          registros: res.registros,
          fecha: res.fechaDatos || fecha,
          tipo,
          label: meta.label,
          linkHref: meta.href,
          linkText: meta.linkText,
        })
      } else {
        setStatus(res.error || 'Error al procesar el archivo.')
      }
    } catch (e) {
      setStatus(`Error: ${e?.message || String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = Boolean(file && fecha)

  return (
    <AuthGuard>
      <Layout>
        <div className="max-w-3xl space-y-6">
          <h1 className={`${bebasNeue.className} text-4xl text-verde-botella`}>CARGAR DATOS</h1>

          <p className="text-sm text-gris-texto">
            <span className="mr-2 inline-block text-verde-fresco" aria-hidden>
              ✓
            </span>
            Parser listo
            <span className="mx-3">·</span>
            <span className="mr-2 inline-block text-dorado" aria-hidden>
              ⏱
            </span>
            Pendiente
          </p>

          <div className="space-y-2">
            <label className="text-sm font-semibold" htmlFor="upload-tipo">
              Tipo de archivo
            </label>
            <select
              id="upload-tipo"
              value={tipo}
              onChange={(e) => {
                setTipo(e.target.value)
                setSummary(null)
                setStatus('')
              }}
              className="w-full rounded-lg border border-gris-claro px-3 py-2 focus:border-verde-fresco focus:outline-none"
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {isParserImplemented(t.value) ? '✓ ' : '⏱ '}
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold" htmlFor="upload-fecha">
              Fecha de los datos
            </label>
            <input
              id="upload-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full rounded-lg border border-gris-claro px-3 py-2 focus:border-verde-fresco focus:outline-none"
            />
          </div>

          <div
            className={`rounded-[12px] border-2 border-dashed px-6 py-12 text-center transition-colors duration-150 ${
              drag ? 'border-verde-fresco bg-verde-fresco/5' : 'border-gris-claro bg-white'
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              onFiles(e.dataTransfer.files)
            }}
          >
            <p className="font-semibold text-negro">Arrastra aquí tu archivo</p>
            <p className="mt-1 text-sm text-gris-texto">.xls, .xlsx o .csv (según tipo)</p>
            <input
              type="file"
              accept=".xls,.xlsx,.csv"
              className="mt-4"
              onChange={(e) => onFiles(e.target.files)}
            />
            {file ? <p className="mt-3 text-sm text-verde-campo">Seleccionado: {file.name}</p> : null}
          </div>

          <button
            type="button"
            disabled={!canSubmit || loading}
            onClick={handleCargar}
            className="rounded-lg bg-verde-fresco px-6 py-3 font-bold text-blanco transition-colors duration-150 hover:bg-verde-campo disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Procesando…' : 'Cargar'}
          </button>

          {status ? (
            <p className="rounded-[12px] border border-gris-claro bg-white p-4 text-sm text-negro shadow-card">{status}</p>
          ) : null}

          {summary ? (
            <div className="card space-y-2 border border-gris-claro bg-white p-4 shadow-card">
              <p className="font-bold text-verde-botella">Resumen de la carga</p>
              <ul className="list-inside list-disc text-sm text-negro">
                <li>
                  <span className="text-gris-texto">Registros insertados:</span> {summary.registros}
                </li>
                <li>
                  <span className="text-gris-texto">Fecha de los datos:</span> {summary.fecha}
                </li>
                <li>
                  <span className="text-gris-texto">Tipo de archivo:</span> {summary.label}
                </li>
              </ul>
              {summary.linkHref && summary.linkText ? (
                <p className="pt-1">
                  <Link
                    href={summary.linkHref}
                    className="font-semibold text-verde-campo underline transition-colors duration-150 hover:text-verde-fresco"
                  >
                    {summary.linkText} →
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Layout>
    </AuthGuard>
  )
}
