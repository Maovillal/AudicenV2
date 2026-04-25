import Link from 'next/link'
import { useRouter } from 'next/router'
import { Children, cloneElement, isValidElement, useCallback, useState } from 'react'
import { signOut } from '@/lib/auth'
import { bebasNeue } from '@/pages/_app'

const navItems = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/inventario', label: 'Inventario', icon: 'box' },
  { href: '/rutas', label: 'Rutas', icon: 'truck' },
  { href: '/merma', label: 'Merma', icon: 'trending' },
  { href: '/auditoria', label: 'Auditoría', icon: 'shield' },
  { href: '/envase', label: 'Envase', icon: 'recycle' },
  { href: '/nivel-servicio', label: 'Nivel de Servicio', icon: 'clock' },
  { href: '/upload', label: 'Cargar Datos', icon: 'upload' },
  { href: '/historial', label: 'Historial', icon: 'calendar' },
  { href: '/configuracion', label: 'Configuración', icon: 'settings' },
]

function NavIcon({ name }) {
  const cls = 'h-5 w-5 shrink-0'
  switch (name) {
    case 'dashboard':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
        </svg>
      )
    case 'box':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.5a1.125 1.125 0 01-1.12 1.06H5.495a1.125 1.125 0 01-1.12-1.06L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      )
    case 'truck':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.496 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.25 2.25 0 00-1.227-1.027l-.07-.035m-5.813 10.5H7.88a1.125 1.125 0 01-1.125-1.125V11.25c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v4.125c0 .621-.504 1.125-1.125 1.125zm-8.25-4.875h3.375c.621 0 1.125.504 1.125 1.125V17.25" />
        </svg>
      )
    case 'trending':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286M11.25 21H3.75a2.25 2.25 0 01-2.25-2.25v-6.75m18 0V18A2.25 2.25 0 0118 20.25h-4.5m-7.5-9l9-9" />
        </svg>
      )
    case 'shield':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      )
    case 'recycle':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.092 1.209-.138 2.43-.138 3.662s.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.092-1.209.138-2.43.138-3.662z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    case 'clock':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'upload':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      )
    case 'calendar':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
      )
    case 'settings':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.396 2.417a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.398 2.418a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.397-2.418a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.397-2.418a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    default:
      return null
  }
}

export default function Layout({ children, user }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const close = useCallback(() => setOpen(false), [])

  async function handleSignOut() {
    await signOut()
    router.push('/login')
  }

  const displayName =
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'Usuario'

  const sidebar = (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col bg-verde-botella text-gris-claro transition-transform duration-200 md:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="border-b border-white/10 px-5 py-6">
        <p className={`${bebasNeue.className} text-3xl tracking-wide text-blanco`}>AUDICEN</p>
        <p className="mt-1 text-xs text-gris-claro">Sistema de Control</p>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
        {navItems.map((item) => {
          const active = router.pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors duration-150 ${
                active
                  ? 'border-l-[3px] border-dorado bg-verde-campo text-blanco'
                  : 'border-l-[3px] border-transparent hover:bg-verde-campo/50'
              }`}
            >
              <NavIcon name={item.icon} />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-white/10 p-4">
        <p className="truncate text-sm font-semibold text-blanco">{displayName}</p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-verde-campo/80 px-3 py-2 text-sm font-semibold text-blanco transition-colors duration-150 hover:bg-verde-fresco"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </aside>
  )

  return (
    <div className="min-h-screen bg-blanco font-body">
      <div
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity md:hidden ${
          open ? 'opacity-100 pointer-events-auto' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden="true"
        onClick={close}
      />
      {sidebar}
      <div className="md:pl-[260px]">
        <header className="fixed top-0 left-0 right-0 z-20 flex items-center justify-between bg-verde-botella px-4 py-3 text-blanco md:hidden">
          <button
            type="button"
            className="rounded-lg p-2 transition-colors duration-150 hover:bg-white/10"
            onClick={() => setOpen((v) => !v)}
            aria-label="Abrir menú"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className={`${bebasNeue.className} text-xl tracking-wide`}>AUDICEN</span>
          <span className="w-10" />
        </header>
        <main className="min-h-screen bg-blanco px-6 pb-10 pt-[72px] md:px-6 md:pt-6">
          {Children.map(children, (child) =>
            isValidElement(child) ? cloneElement(child, { user }) : child
          )}
        </main>
      </div>
    </div>
  )
}
