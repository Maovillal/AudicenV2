/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        'verde-botella': '#0D3B1E',
        'verde-campo': '#1A6B2F',
        'verde-fresco': '#2E9944',
        'verde-claro': '#4DBD6A',
        rojo: '#C0341A',
        dorado: '#F5C800',
        ambar: '#C8882A',
        blanco: '#F7F3EC',
        'gris-claro': '#E8E4DC',
        'gris-texto': '#888888',
        negro: '#111111',
      },
      fontFamily: {
        display: ['Bebas Neue', 'sans-serif'],
        body: ['Nunito', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
}
