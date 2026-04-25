import { Children, cloneElement, isValidElement, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { getSession, onAuthStateChange } from '@/lib/auth'

export default function AuthGuard({ children }) {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        const session = await getSession()
        if (!mounted) return
        if (!session?.user) {
          await router.replace('/login')
          setUser(null)
        } else {
          setUser(session.user)
        }
      } catch {
        if (mounted) await router.replace('/login')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    init()

    const subscription = onAuthStateChange((session) => {
      if (!session?.user) {
        setUser(null)
        if (router.pathname !== '/login') router.replace('/login')
      } else {
        setUser(session.user)
      }
    })

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  }, [router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-blanco font-body">
        <div
          className="h-12 w-12 animate-spin rounded-full border-4 border-verde-campo border-t-transparent"
          aria-label="Cargando"
        />
      </div>
    )
  }

  if (!user) {
    return null
  }

  return Children.map(children, (child) =>
    isValidElement(child) ? cloneElement(child, { user }) : child
  )
}
