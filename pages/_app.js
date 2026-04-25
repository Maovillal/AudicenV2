import { Bebas_Neue, Nunito } from 'next/font/google'
import '@/styles/globals.css'

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
})

const nunito = Nunito({
  weight: ['400', '600', '700', '800', '900'],
  subsets: ['latin'],
})

export { bebasNeue }

export default function App({ Component, pageProps }) {
  return (
    <div className={`${nunito.className} min-h-screen bg-blanco text-negro antialiased`}>
      <Component {...pageProps} />
    </div>
  )
}
