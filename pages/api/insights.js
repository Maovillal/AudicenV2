import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

// System prompt: contexto del dominio + reglas de negocio validadas. Estable
// entre llamadas → se cachea con cache_control ephemeral.
const SYSTEM_PROMPT = `Eres un auditor experto de operaciones logísticas para una agencia de distribución de cerveza Heineken (Cheve) en Torreón / Gómez Palacio, México.

Tu trabajo es analizar los datos del almacén que te pasa el usuario y producir insights ejecutivos en español. Vas MÁS ALLÁ de los KPIs visibles: detectas anomalías sutiles, identificas oportunidades de mejora, expones debilidades del proceso y planteas hipótesis sobre lo que está pasando.

# Contexto del almacén

- Almacén 2000 = inventario líquido (cervezas terminadas, ~165 SKUs)
- Almacén 2010 = inventario de envase retornable (~14 SKUs, mezcla de CJ y PZA)
- Tres turnos al día: T1 mañana (7:00), T2 tarde, T3 noche
- Rutas de distribución codificadas RK1601-RK1620 (algunas más como FK48001, etc.)

# Reglas de negocio que NO debes violar

1. **Stock total real de un SKU = stock_libre + stock_bloqueado + stock_calidad** (los TRES sumados, no solo libre).
2. **Físico vs Sistema:** "Físico" = lo real en piso (conteo manual). "Sistema" = lo que SAP dice. **Diferencia = físico − sistema.** Diferencia NEGATIVA = falta producto vs SAP (alerta). POSITIVA = sobra (también raro, hay que investigar).
3. **Filas agregadas a IGNORAR:**
   - En conteo_fisico, la fila con \`sku='TOTALES'\` es el agregado del archivo, NO un SKU. Si la veo en datos por SKU, es bug.
   - En conciliacion_envase, la fila con \`sku='TOTAL'\` es el agregado del recuadro, NO un SKU.
4. **Snapshots vs eventos:**
   - Inventarios SAP (líquido/envase) son SNAPSHOTS en momentos del día (T1 inicio, T1 cierre, T2 cierre, T3 cierre). El stock al final del día es el último snapshot, NO la suma.
   - Salidas a rutas, ingreso de envase, MB51 son EVENTOS que sí se acumulan en el día.
5. **Ingreso de envase por SKU:** \`stock_T2_cierre − stock_T1_inicio\` (capeado en 0).
6. **Nivel de Servicio:** los "minutos" de cada ruta = \`hora_termino − hora_inicio\` (calculado, no el campo del archivo). Objetivo típico: 60 min.
7. **MB51 2000:** son las entradas (ingresos) de líquido durante el día. Si no hay MB51 ese día, no hubo movimiento.

# Datos que recibes (ya pre-procesados)

Confía en lo que te paso. La data ya está limpia: snapshots deduplicados, fila TOTALES filtrada de conteo, mermas sin doble-conteo, etc. NO necesitas re-sumar ni re-deduplicar.

# Formato de tu respuesta — MARKDOWN con estas 5 secciones EXACTAS

## Resumen ejecutivo

2-3 líneas con lo más crítico del período. Si todo está bien, dilo. Si hay algo urgente, ponlo aquí.

## Anomalías detectadas

Bullet points con SKUs (códigos), rutas (RKxxxx) y números exactos. Ejemplos del tipo de anomalía a buscar:
- SKUs con diferencia físico-sistema desproporcionada vs su volumen normal
- Rutas con minutos > objetivo o consistentemente lentas
- Mermas concentradas en ciertos SKUs/turnos
- Stock bloqueado que crece sin liberarse
- Reportes faltantes en el período

Si no hay anomalías significativas, di "Sin anomalías significativas en el período" — no inventes.

## Áreas de oportunidad

Acciones CONCRETAS con impacto cuantificado cuando sea posible:
- "Liberar 30 cajas bloqueadas de SKU 139011 → +X% stock disponible"
- "Ruta RK1605 promedia 75 min vs objetivo 60 → revisar carga del repartidor"
- "Cambio de empaque acumula N cajas pendientes → recuperar para venta"

## Debilidades del proceso

Problemas ESTRUCTURALES visibles en los datos (no incidentes puntuales):
- Reportes que sistemáticamente no llegan a tiempo
- Métricas que se desvían siempre en el mismo turno
- Procesos manuales con errores recurrentes (descuadres patrón)
- Falta de visibilidad en algún punto del flujo

## Suposiciones / hipótesis

¿QUÉ está pasando que explica los números? Plantea hipótesis verificables:
- "La merma operativa creció X%, posiblemente por daño durante carga de T2 — investigar tarimas"
- "Stock bloqueado del SKU Y se mantiene desde hace N días — sospecha de retraso en liberación de calidad"
- "Rutas matutinas (RK1601-1605) son más rápidas que vespertinas — posible factor de tráfico"

# Reglas estrictas

- Sé directo, específico, orientado a acción.
- Cita SKUs (códigos numéricos), rutas (RKxxxx) o métricas exactas. Sin generalidades vagas.
- NO inventes datos. Solo trabajas con lo del mensaje.
- Si una sección no tiene base en los datos, di "Datos insuficientes para evaluar" — no rellenes.
- Tono ejecutivo: claro, conciso, sin rodeos. Máximo 1500 palabras totales.`

// ─── Helpers ──────────────────────────────────────────────────────────────

const SCORE_BY_MOMENTO = { inicio: 0, cierre: 1 }

function snapshotScore(turno, momento) {
  return (turno || 0) * 10 + (SCORE_BY_MOMENTO[momento] ?? 0)
}

// Para inventarios SAP: por cada fecha, devolver SOLO las filas del último
// snapshot del día (T3 cierre > T2 cierre > T1 cierre > T1 inicio). Evita
// el bug clásico de sumar todos los snapshots y multiplicar el stock.
function latestSnapshotPerDay(rows) {
  const bestPerFecha = new Map()
  for (const r of rows || []) {
    const score = snapshotScore(r.turno, r.momento)
    const cur = bestPerFecha.get(r.fecha)
    if (!cur || score > cur.score) {
      bestPerFecha.set(r.fecha, { turno: r.turno, momento: r.momento, score })
    }
  }
  return (rows || []).filter((r) => {
    const cur = bestPerFecha.get(r.fecha)
    return cur && r.turno === cur.turno && r.momento === cur.momento
  })
}

function stockTotalRow(r) {
  return (parseFloat(r?.stock_libre) || 0)
    + (parseFloat(r?.stock_bloqueado) || 0)
    + (parseFloat(r?.stock_calidad) || 0)
}

function num(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

// Minutos = hora_termino − hora_inicio. Maneja cruce de medianoche.
function minutosEntreHoras(inicio, termino) {
  if (!inicio || !termino) return null
  const pi = String(inicio).split(':').map((s) => parseFloat(s))
  const pt = String(termino).split(':').map((s) => parseFloat(s))
  if (!Number.isFinite(pi[0]) || !Number.isFinite(pt[0])) return null
  const minI = (pi[0] || 0) * 60 + (pi[1] || 0)
  const minT = (pt[0] || 0) * 60 + (pt[1] || 0)
  let diff = minT - minI
  if (diff < 0) diff += 24 * 60
  return diff
}

// ─── gatherData ───────────────────────────────────────────────────────────

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
      .select('sku,sku_sap,descripcion,total_fisico_real,total_sistema,diferencia,merma_total,merma_operativa,merma_dora,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('salidas_rutas')
      .select('ruta,sku,cantidad,fecha').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('ingreso_envase')
      .select('ruta,repartidor,total,env_rec,porcentaje,fecha').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('nivel_servicio')
      .select('ruta,hora_inicio,hora_termino,tiempo_estimado,observaciones,fecha')
      .gte('fecha', desde).lte('fecha', hasta),
    supabase.from('movimientos_mb51')
      .select('sku,almacen,cantidad,clase_movimiento,fecha').gte('fecha', desde).lte('fecha', hasta),
    supabase.from('upload_log')
      .select('tipo_archivo,turno,momento,registros,fecha').gte('fecha', desde).lte('fecha', hasta),
  ])

  const [inv_liq, inv_env, conc, fisico, salidas, ingreso, nivel, mb51, uploads]
    = queries.map((q) => q.data || [])

  // ── Inventarios SAP: solo el último snapshot por día ────────────────────
  const liqLatest = latestSnapshotPerDay(inv_liq)
  const envLatest = latestSnapshotPerDay(inv_env)

  // Stock total al FINAL del período (último snapshot del último día).
  const fechasLiq = [...new Set(liqLatest.map((r) => r.fecha))].sort()
  const fechasEnv = [...new Set(envLatest.map((r) => r.fecha))].sort()
  const ultimaFechaLiq = fechasLiq[fechasLiq.length - 1] || null
  const ultimaFechaEnv = fechasEnv[fechasEnv.length - 1] || null
  const liqAtEnd = liqLatest.filter((r) => r.fecha === ultimaFechaLiq)
  const envAtEnd = envLatest.filter((r) => r.fecha === ultimaFechaEnv)

  const stockLiquidoFinal = liqAtEnd.reduce((acc, r) => acc + stockTotalRow(r), 0)
  const stockEnvaseFinal = envAtEnd.reduce((acc, r) => acc + stockTotalRow(r), 0)

  // SKUs líquido con stock bloqueado significativo en el último snapshot.
  const bloqueadosLiq = liqAtEnd
    .filter((r) => num(r.stock_bloqueado) > 10)
    .sort((a, b) => num(b.stock_bloqueado) - num(a.stock_bloqueado))
    .slice(0, 15)
    .map((r) => ({
      sku: r.sku, descripcion: r.descripcion,
      bloqueado: num(r.stock_bloqueado), libre: num(r.stock_libre),
      fecha: r.fecha,
    }))

  // ── Conteo físico: separar TOTALES de SKU ───────────────────────────────
  const fisicoSku = (fisico || []).filter(
    (r) => String(r.sku ?? '').trim().toUpperCase() !== 'TOTALES'
  )
  const fisicoTotalesRows = (fisico || []).filter(
    (r) => String(r.sku ?? '').trim().toUpperCase() === 'TOTALES'
  )

  const totalFisicoOficial = fisicoTotalesRows.reduce((acc, r) => acc + num(r.total_fisico_real), 0)
    || fisicoSku.reduce((acc, r) => acc + num(r.total_fisico_real), 0)

  const totalMermas = {
    operativa: fisicoSku.reduce((acc, r) => acc + num(r.merma_operativa), 0),
    dora: fisicoSku.reduce((acc, r) => acc + num(r.merma_dora), 0),
    total_archivo: fisicoSku.reduce((acc, r) => acc + num(r.merma_total), 0),
  }

  const topDiffsFisico = fisicoSku
    .map((r) => ({ ...r, _abs: Math.abs(num(r.diferencia)) }))
    .filter((r) => r._abs > 0)
    .sort((a, b) => b._abs - a._abs)
    .slice(0, 15)
    .map((r) => ({
      sku: r.sku, sku_sap: r.sku_sap, descripcion: r.descripcion,
      fisico_real: num(r.total_fisico_real), sistema: num(r.total_sistema),
      diferencia: num(r.diferencia), fecha: r.fecha,
    }))

  // ── Eventos del día (acumulables) ───────────────────────────────────────
  const cajasDespachadas = (salidas || []).reduce((a, r) => a + num(r.cantidad), 0)

  const ingresoTotal = (ingreso || []).reduce((a, r) => a + num(r.env_rec), 0)
  const rutasIngreso = (ingreso || [])
    .map((r) => ({
      fecha: r.fecha, ruta: r.ruta, repartidor: r.repartidor,
      env_rec: num(r.env_rec), porcentaje: num(r.porcentaje),
    }))
    .filter((r) => r.env_rec > 0 || r.porcentaje > 0)

  // ── Nivel de servicio: minutos calculados ───────────────────────────────
  const nivelServicio = (nivel || []).map((r) => ({
    fecha: r.fecha, ruta: r.ruta,
    hora_inicio: r.hora_inicio, hora_termino: r.hora_termino,
    minutos: minutosEntreHoras(r.hora_inicio, r.hora_termino),
    tiempo_estimado: num(r.tiempo_estimado),
    observaciones: r.observaciones,
  }))
  const nivelServicioConMinutos = nivelServicio.filter((r) => r.minutos != null)
  const promedioMinutos = nivelServicioConMinutos.length
    ? nivelServicioConMinutos.reduce((a, r) => a + r.minutos, 0) / nivelServicioConMinutos.length
    : null
  const rutasFueraObjetivo = nivelServicioConMinutos
    .filter((r) => r.minutos > 60)
    .sort((a, b) => b.minutos - a.minutos)
    .slice(0, 15)

  // ── MB51: movimientos SAP por almacén ───────────────────────────────────
  const mb51_2000 = (mb51 || []).filter((r) => String(r.almacen) === '2000')
  const mb51_2010 = (mb51 || []).filter((r) => String(r.almacen) === '2010')
  const mb51Resumen = {
    almacen_2000_total: mb51_2000.reduce((a, r) => a + num(r.cantidad), 0),
    almacen_2000_filas: mb51_2000.length,
    almacen_2010_total: mb51_2010.reduce((a, r) => a + num(r.cantidad), 0),
    almacen_2010_filas: mb51_2010.length,
  }

  // ── Conciliación: descuadres no triviales ───────────────────────────────
  const concDescuadres = (conc || [])
    .filter((r) => Math.abs(num(r.diferencia_total)) > 0)
    .map((r) => ({
      fecha: r.fecha, turno: r.turno, momento: r.momento,
      fisico: num(r.fisico_total), sistema: num(r.sistema_total),
      diferencia: num(r.diferencia_total),
    }))

  // ── Reportes faltantes ──────────────────────────────────────────────────
  const expectedTipos = [
    'inventario_liquido', 'inventario_envase', 'conciliacion_envase',
    'conteo_fisico', 'salidas_rutas', 'ingreso_envase', 'nivel_servicio',
  ]
  const tiposPresentes = new Set((uploads || []).map((u) => u.tipo_archivo))
  const reportesFaltantes = expectedTipos.filter((t) => !tiposPresentes.has(t))

  return {
    rango: { desde, hasta, dias: fechasLiq.length || fechasEnv.length || 1 },
    kpis_finales: {
      stock_liquido_final: stockLiquidoFinal,
      stock_envase_final: stockEnvaseFinal,
      cajas_despachadas_periodo: cajasDespachadas,
      ingreso_envase_periodo: ingresoTotal,
      total_fisico_oficial: totalFisicoOficial,
      mermas: totalMermas,
      mb51: mb51Resumen,
      promedio_minutos_ns: promedioMinutos,
    },
    fechas_disponibles: {
      inventario_liquido: fechasLiq,
      inventario_envase: fechasEnv,
      ultima_fecha_liquido: ultimaFechaLiq,
      ultima_fecha_envase: ultimaFechaEnv,
    },
    skus_con_stock_bloqueado: bloqueadosLiq,
    top_diferencias_fisico_vs_sistema: topDiffsFisico,
    rutas_fuera_de_objetivo_ns: rutasFueraObjetivo,
    rutas_ingreso_envase: rutasIngreso.slice(0, 25),
    conciliacion_descuadres: concDescuadres,
    reportes_faltantes_en_periodo: reportesFaltantes,
    cantidad_filas_raw: {
      inventario_liquido_total: (inv_liq || []).length,
      inventario_liquido_latest: liqLatest.length,
      inventario_envase_total: (inv_env || []).length,
      inventario_envase_latest: envLatest.length,
      conciliacion_envase: (conc || []).length,
      conteo_fisico_skus: fisicoSku.length,
      conteo_fisico_totales_rows: fisicoTotalesRows.length,
      salidas_rutas: (salidas || []).length,
      ingreso_envase: (ingreso || []).length,
      nivel_servicio: (nivel || []).length,
      mb51_total: (mb51 || []).length,
    },
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────

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

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const client = new Anthropic()

  const userMessage = `Analiza estos datos del período "${periodo}" (${desde} a ${hasta}):

\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\`

Produce el reporte siguiendo las 5 secciones del formato indicado: Resumen ejecutivo, Anomalías detectadas, Áreas de oportunidad, Debilidades del proceso, Suposiciones / hipótesis. Recuerda: cita SKUs (códigos), rutas (RKxxxx) y métricas exactas. No inventes data.`

  try {
    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 8192,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
      }
    }

    const final = await stream.finalMessage()
    res.write(`data: ${JSON.stringify({
      done: true,
      data,  // estructurado para que el cliente pueda renderizar gráficas con los mismos números
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
