# Setup de Anthropic API para `/reportes` con IA

La sección "Análisis con IA" en `/reportes` usa la API de Claude Opus 4.7. Este es el setup de una sola vez para que funcione en tu deployment de Vercel.

**Tiempo estimado:** 5 minutos.

---

## 1. Generar la API key

1. Ve a <https://console.anthropic.com/>
2. Si no tienes cuenta, créala (puede ser con tu Gmail personal)
3. Una vez dentro, click en tu nombre arriba a la derecha → **API Keys**
4. Click **Create Key**
5. Nombre: `audicen-vercel-prod`
6. Click **Create Key**
7. Aparece una cadena que empieza con `sk-ant-api03-...` (muy larga)
8. **Cópiala AHORA** — Anthropic no te la vuelve a mostrar después. Si la pierdes, tienes que generar otra.

---

## 2. Cargar saldo en la cuenta (importante)

Las llaves nuevas no funcionan hasta que tengas saldo:

1. En console.anthropic.com → **Plans & Billing** (lateral)
2. Si no tienes plan, click **Get started**
3. Carga al menos **$5 USD** con tarjeta. Para uso normal de Audicen ($0.04 por análisis con prompt caching), eso te alcanza para ~125 análisis. Empieza con $20 y ajustas.

---

## 3. Pegar la key en Vercel

1. Ve a <https://vercel.com/dashboard>
2. Click en tu proyecto **AudicenV2**
3. Settings → **Environment Variables**
4. Click **Add New**
   - **Key:** `ANTHROPIC_API_KEY`
   - **Value:** la cadena `sk-ant-api03-...` que copiaste
   - **Environments:** marca **Production**, **Preview** y **Development** (los tres)
5. Click **Save**

**También necesitas `SUPABASE_SERVICE_KEY` en Vercel** (si no la habías agregado antes):

1. Add New
   - **Key:** `SUPABASE_SERVICE_KEY`
   - **Value:** el `service_role` key de Supabase (el mismo que está en `parsers/.env` local, lo puedes copiar de ahí)
   - **Environments:** los tres
2. Save

---

## 4. Re-deployar

Vercel **NO** auto-deploya cuando cambias env vars. Tienes que disparar un deploy:

1. En el dashboard de Vercel del proyecto → pestaña **Deployments**
2. En el deployment más reciente, click los tres puntos `⋯` → **Redeploy**
3. Confirmar

Tarda 1-2 minutos. Cuando termine, abre `/reportes` en la app desplegada → debería aparecer la sección "Análisis con IA" con el botón **Generar análisis**.

---

## 5. Probar

1. Abre `/reportes` en la app
2. Selecciona fecha 2026-05-08 (o cualquiera con datos)
3. Click **Generar análisis**
4. Tarda 10-20 segundos. Vas a ver el análisis aparecer en streaming (palabra por palabra)
5. Al final, debajo del texto aparece: `Tokens: input X · cache leído Y · cache escrito Z · output W`

**La primera corrida del día va a tener `cache leído = 0`** (escribe el cache). De ahí en adelante hasta 5 min después debería tener `cache leído ≈ 1500` (system prompt cacheado), lo que reduce el costo a ~$0.005 por llamada en lugar de $0.04.

---

## Costos esperados

Por análisis (con prompt caching activo):
- Cache hit (segunda + corrida en ventana de 5 min): **~$0.005**
- Cache miss (primera corrida): **~$0.04**

Asumiendo 5 análisis al día:
- Día típico (4 hits + 1 miss): **~$0.06/día**
- Mensual: **~$2 USD**

Si gastas más, son señales:
- Bug en cache (system prompt está variando) — checa los tokens reportados en la UI
- Estás generando más análisis de los necesarios (cada vez que cambias período resetea el cache después de 5 min)

---

## Setup local (opcional, solo para testing)

Si quieres probar `/reportes` con IA en `npm run dev` antes de deployar:

1. Crea archivo `.env.local` en la raíz del proyecto (ya está en `.gitignore`)
2. Agrega:
```
ANTHROPIC_API_KEY=sk-ant-api03-...
NEXT_PUBLIC_SUPABASE_URL=https://wyqautsfjurfueppevhc.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key
SUPABASE_SERVICE_KEY=tu_service_role_key
```
3. Reinicia `npm run dev`

---

## Troubleshooting

**Error en la UI: "ANTHROPIC_API_KEY no configurada en el servidor"**
→ La env var no se aplicó al deployment. Confirma que existe en Vercel y re-deploya.

**Error: "401 Authentication Error"**
→ La key está mal copiada o es de otra cuenta. Genera una nueva en console.anthropic.com.

**Error: "529 Overloaded"**
→ Anthropic tuvo carga alta momentánea. Reintenta en 1-2 min.

**El análisis sale vacío o cortado**
→ Probable timeout. Revisa logs de Vercel (`vercel logs`). El streaming puede fallar en planes gratuitos de Vercel con timeout de 10 segundos — considera plan Pro si pasa seguido.

**Costos mucho más altos de lo esperado**
→ Verifica que `cache leído > 0` en llamadas consecutivas. Si siempre es 0, hay un bug en el system prompt (algo lo está cambiando entre requests).
