import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export function formatDateLong(date) {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, "EEEE d 'de' MMMM, yyyy", { locale: es })
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), "dd/MM/yyyy HH:mm", { locale: es })
  } catch {
    return '—'
  }
}

export function formatTime(iso) {
  if (!iso) return '—'
  try {
    const d = typeof iso === 'string' ? parseISO(iso) : iso
    return format(d, 'HH:mm', { locale: es })
  } catch {
    return '—'
  }
}

export function parseNumber(val) {
  if (val === null || val === undefined || val === '') return 0
  const n = Number(val)
  return Number.isFinite(n) ? n : 0
}

export function formatNumber(val, decimals = 2) {
  const n = typeof val === 'number' ? val : parseNumber(val)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}
