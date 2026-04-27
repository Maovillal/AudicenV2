import { useCallback, useState } from 'react'

const KEY = 'audicen_fecha'

function hoy() {
  return new Date().toISOString().slice(0, 10)
}

export function useFechaGlobal() {
  const [fecha, setFechaState] = useState(() => {
    if (typeof window === 'undefined') return hoy()
    return localStorage.getItem(KEY) || hoy()
  })

  const setFecha = useCallback((val) => {
    setFechaState(val)
    if (typeof window !== 'undefined') {
      localStorage.setItem(KEY, val)
    }
  }, [])

  return [fecha, setFecha]
}
