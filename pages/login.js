import { useState } from 'react'
import { useRouter } from 'next/router'
import { signIn } from '@/lib/auth'
import { bebasNeue } from './_app'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      await router.replace('/')
    } catch (err) {
      setError(err?.message || 'No se pudo iniciar sesión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-10 font-body"
      style={{
        background: 'linear-gradient(135deg, #0D3B1E 0%, #1A6B2F 60%, #2E9944 100%)',
      }}
    >
      <div className="w-full max-w-md rounded-[12px] bg-blanco p-8 shadow-card">
        <h1 className={`${bebasNeue.className} text-center text-5xl text-verde-botella`}>AUDICEN</h1>
        <p className="mt-2 text-center text-sm text-gris-texto">Sistema de Control de Almacén</p>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-1 block text-sm font-semibold text-negro" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gris-claro px-3 py-2 outline-none transition-colors duration-150 focus:border-verde-fresco focus:ring-2 focus:ring-verde-fresco/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-negro" htmlFor="password">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gris-claro px-3 py-2 outline-none transition-colors duration-150 focus:border-verde-fresco focus:ring-2 focus:ring-verde-fresco/30"
            />
          </div>
          {error ? <p className="text-sm font-semibold text-rojo">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-verde-fresco py-3 font-bold text-blanco transition-colors duration-150 hover:bg-verde-campo disabled:opacity-60"
          >
            {loading ? 'Ingresando…' : 'Iniciar Sesión'}
          </button>
        </form>
      </div>
    </div>
  )
}
