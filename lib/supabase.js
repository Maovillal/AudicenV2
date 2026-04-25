import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

console.log('SUPABASE_URL:', supabaseUrl);
console.log('SUPABASE_KEY exists:', !!supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Ejecuta una consulta en páginas de 1000 filas hasta agotar resultados.
 * @param {(from: number, to: number) => Promise<{ data: unknown[] | null, error: Error | null }>} runQuery
 * @param {number} [pageSize=1000]
 * @returns {Promise<unknown[]>}
 */
export async function fetchAllRows(runQuery, pageSize = 1000) {
  const all = []
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await runQuery(from, to)
    if (error) throw error
    const rows = data || []
    if (rows.length === 0) break
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return all
}

/**
 * Inserta filas en lotes. Devuelve el número de filas insertadas.
 * @param {string} table
 * @param {Record<string, unknown>[]} rows
 * @param {number} [batchSize=500]
 * @returns {Promise<number>}
 */
export async function insertBatch(table, rows, batchSize = 500) {
  if (!rows || rows.length === 0) return 0
  let inserted = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from(table).insert(batch)
    if (error) throw error
    inserted += batch.length
  }
  return inserted
}

/**
 * Borra por igualdad en `filters` e inserta `rows` en lotes.
 * @param {string} table
 * @param {Record<string, string | number>} filters
 * @param {Record<string, unknown>[]} rows
 * @param {number} [batchSize=500]
 * @returns {Promise<number>}
 */
export async function deleteAndInsert(table, filters, rows, batchSize = 500) {
  let query = supabase.from(table).delete()
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value)
  }
  const { error: deleteError } = await query
  if (deleteError) throw deleteError
  return insertBatch(table, rows, batchSize)
}

/**
 * @deprecated Usar insertBatch
 */
export async function insertBatches(client, table, rows, batchSize = 500) {
  if (!rows || rows.length === 0) return
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const { error } = await client.from(table).insert(chunk)
    if (error) throw error
  }
}
