import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// System prompt: contexto del dominio. Es estable entre llamadas y se cachea
// (prompt caching prefijo). Solo el mensaje del usuario varía por request.
const SYSTEM_PROMPT = `Eres un auditor experto de operaciones logísticas para una agencia de distribución de cerveza Heineken (Cheve) en Torreón / Gómez Palacio, México.

Tu trabajo es analizar los datos diarios de auditoría del almacén y producir insights ejecutivos en español que vayan MÁS ALLÁ de los KPIs visibles a simple vista. Identificas:

1. **Anomalías sutiles** — patrones que indican problemas operativos no obvios: mermas inusuales en SKUs específicos, rutas con baja productividad, descuadres entre físico y SAP que se repiten en ciertos turnos, SKUs cuyo stock bloqueado crece sin liberarse, etc.
2. **Áreas de oportunidad** — eficiencias capturables: reducción de mermas operativas, balanceo de cargas entre rutas, mejora de NS, ajustes de inventario para liberar capital de trabajo.
3. **Riesgos a vigilar** — situaciones que pueden empeorar si no se atienden: tendencias negativas, faltantes recurrentes de reportes, acumulación de envase bloqueado, descuadres que crecen.

**Contexto del almacén:**
- Almacén 2000 = inventario líquido (cervezas terminadas, ~165 SKUs)
- Almacén 2010 = inventario de envase retornable (~14 SKUs, mezcla de CJ y PZA)
- Tres turnos al día (T1 mañana 7:00, T2 tarde, T3 noche)
- Stock total = libre + bloqueado + en control de calidad (siempre los tres sumados)
- "Diferencia" = físico contado − sistema SAP (debe ser ≈ 0; valores grandes indican descuadre)
- "Mermas" = pérdida de producto durante operación (operativa, CM/Dora son tipos distintos)
- Conciliación de envase = conteo físico de envase retornable contra SAP, en 4 momentos del día (T1 inicio, T1 cierre, T2 inicio, T2 cierre)
- Cargas a rutas = salidas de producto a las rutas de distribución (RK1601-RK1620 son los códigos de ruta)
- MB51 = movimientos de SAP (entradas/salidas registradas)

**Formato de tu respuesta — usa MARKDOWN con estas secciones EXACTAS:**

## Resumen ejecutivo

Dos a tres líneas con lo más importante. Si todo está bien, dilo claro. Si hay un problema crítico, ponlo aquí.

## Anomalías detectadas

Bullet points con SKUs, rutas o turnos específicos. Cita números exactos. Si no hay anomalías, dilo: "Sin anomalías significativas en el período."

## Áreas de oportunidad

Acciones concretas con impacto estimado cuando sea posible. Ejemplo: "Liberar el bloqueado del SKU 139011 (30 cajas) podría aumentar el stock disponible en X%."

## Riesgos a vigilar

Patrones que requieren atención continua aunque hoy no sean problema crítico.

**Reglas estrictas:**
- Sé directo, específico y orientado a acción
- Cita los SKUs (códigos numéricos), rutas (RKxxxx) o métricas exactas cuando sea relevante
- NO inventes datos — solo trabaja con los que te paso en el mensaje del usuario
- Si no hay suficiente información para un insight en alguna sección, dilo explícitamente: "Datos insuficientes para evaluar"
- Tono ejecutivo: claro, conciso, sin rodeos
- Máximo 600 palabras totales`

// Junta todos los datos del período desde Supabase. Usa service role para
// bypassar RLS y simplificar (no necesitamos forwardear sesión del usuario).
async function gatherData(supabase, desde, hasta) {
  const queries = await Promise.all([
    supabase.from('inventario_liquido')
      .select('sku,descripcion,turno,momento,stock_libre,stock_bloqueado,stock_calidad,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('inventario_envase')
      .select('sku,descripcion,turno,momento,stock_libre,stock_bloqueado,stock_calidad,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('conciliacion_envase')
      .select('sku,presentacion,turno,momento,fisico_total,sistema_total,diferencia_total,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('conteo_fisico')
      .select('sku,descripcion,total_fisico_real,total_sistema,diferencia,merma_total,merma_operativa,merma_dora,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('salidas_rutas')
      .select('ruta,sku,cantidad,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('ingreso_envase')
      .select('ruta,total,env_rec,porcentaje,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('upload_log')
      .select('tipo_archivo,turno,momento,registros,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
  ])

  const [inv_liq, inv_env, conc, fisico, salidas, ingreso, uploads] = queries.map((q) => q.data || [])

  // Agregaciones útiles para el modelo (vs. enviarle filas crudas que llenan tokens).
  const totalStockLiquido = sumStock(inv_liq)
  const totalStockEnvase = sumStock(inv_env)
  const totalCajasDespachadas = sum(salidas, 'cantidad')
  const totalIngresoEnvase = sum(ingreso, 'env_rec')
  const totalMermas = sum(fisico, 'merma_total') + sum(fisico, 'merma_operativa') + sum(fisico, 'merma_dora')

  // Top diferencias del conteo físico (más útiles que mandar todas las filas).
  const topDiffs = (fisico || [])
    .map((r) => ({ ...r, _abs: Math.abs(parseFloat(r.diferencia) || 0) }))
    .sort((a, b) => b._abs - a._abs)
    .slice(0, 15)
    .map((r) => ({
      sku: r.sku,
      descripcion: r.descripcion,
      fisico_real: r.total_fisico_real,
      sistema: r.total_sistema,
      diferencia: r.diferencia,
      fecha: r.fecha,
    }))

  // SKUs con stock bloqueado significativo (>10 cajas).
  const bloqueadosLiq = (inv_liq || [])
    .filter((r) => parseFloat(r.stock_bloqueado) > 10)
    .map((r) => ({
      sku: r.sku, descripcion: r.descripcion,
      bloqueado: r.stock_bloqueado, turno: r.turno, momento: r.momento, fecha: r.fecha,
    }))
    .slice(0, 20)

  // Rutas con NS bajo (porcentaje < 80% — heurística inicial).
  const rutasBajoNS = (ingreso || [])
    .filter((r) => parseFloat(r.porcentaje) < 80 && parseFloat(r.porcentaje) > 0)
    .map((r) => ({ ruta: r.ruta, total: r.total, env_rec: r.env_rec, ns: r.porcentaje, fecha: r.fecha }))

  // Conciliación: filas con diferencia distinta de cero.
  const concDescuadres = (conc || [])
    .filter((r) => Math.abs(parseFloat(r.diferencia_total) || 0) > 0)
    .map((r) => ({
      fecha: r.fecha, turno: r.turno, momento: r.momento,
      fisico: r.fisico_total, sistema: r.sistema_total, diferencia: r.diferencia_total,
    }))

  // Reportes faltantes en el período (lo que upload_log NO contiene).
  const expectedTipos = [
    'inventario_liquido', 'inventario_envase', 'conciliacion_envase',
    'conteo_fisico', 'salidas_rutas', 'ingreso_envase',
  ]
  const tiposPresentes = new Set((uploads || []).map((u) => u.tipo_archivo))
  const tiposFaltantes = expectedTipos.filter((t) => !tiposPresentes.has(t))

  return {
    rango: { desde, hasta },
    kpis: {
      stock_total_liquido: totalStockLiquido,
      stock_total_envase: totalStockEnvase,
      cajas_despachadas: totalCajasDespachadas,
      ingreso_envase: totalIngresoEnvase,
      mermas_acumuladas: totalMermas,
    },
    top_diferencias_fisico_vs_sistema: topDiffs,
    skus_con_stock_bloqueado: bloqueadosLiq,
    rutas_con_ns_bajo: rutasBajoNS,
    conciliacion_descuadres: concDescuadres,
    reportes_faltantes_en_periodo: tiposFaltantes,
    cantidad_filas: {
      inventario_liquido: (inv_liq || []).length,
      inventario_envase: (inv_env || []).length,
      conciliacion_envase: (conc || []).length,
      conteo_fisico: (fisico || []).length,
      salidas_rutas: (salidas || []).length,
      ingreso_envase: (ingreso || []).length,
    },
  }
}

function sum(rows, field) {
  return (rows || []).reduce((acc, r) => acc + (parseFloat(r[field]) || 0), 0)
}

function sumStock(rows) {
  return (rows || []).reduce((acc, r) => {
    return acc + (parseFloat(r.stock_libre) || 0)
      + (parseFloat(r.stock_bloqueado) || 0)
      + (parseFloat(r.stock_calidad) || 0)
  }, 0)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { periodo, desde, hasta } = req.body || {}
  if (!periodo || !desde || !hasta) {
    res.status(400).json({ error: 'Faltan parámetros: periodo, desde, hasta' })
    return
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en el servidor' })
    return
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: 'Supabase no configurado en el servidor' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  let data
  try {
    data = await gatherData(supabase, desde, hasta)
  } catch (e) {
    res.status(500).json({ error: `Error consultando Supabase: ${e.message}` })
    return
  }

  // Setup de SSE para streaming
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const client = new Anthropic()  // usa ANTHROPIC_API_KEY del entorno

  const userMessage = `Analiza estos datos del período "${periodo}" (${desde} a ${hasta}):

\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

Produce el reporte de insights en markdown siguiendo el formato indicado. Recuerda: máximo 600 palabras, sé directo y cita SKUs/rutas específicas.`

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },  // Opus 4.7: solo adaptive permitido
      output_config: { effort: 'high' },  // intelligence-sensitive task
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },  // se cachea entre requests
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
      }
    }

    // Cierre con metadata útil (tokens cacheados / leídos para diagnóstico)
    const final = await stream.finalMessage()
    res.write(`data: ${JSON.stringify({
      done: true,
      usage: {
        cache_read: final.usage.cache_read_input_tokens,
        cache_write: final.usage.cache_creation_input_tokens,
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
      },
    })}\n\n`)
    res.end()
  } catch (e) {
    console.error('Error con Claude API:', e)
    res.write(`data: ${JSON.stringify({ error: e.message || String(e) })}\n\n`)
    res.end()
  }
}
