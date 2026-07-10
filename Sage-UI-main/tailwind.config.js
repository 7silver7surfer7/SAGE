module.exports = {
  mode: 'jit',
  purge: ['./pages/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class', // or 'media' or 'class'
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'sans-serif'],
      },
      boxShadow: {
        '3xl': '0 35px 60px -15px rgba(0, 0, 0, 0.3)',
        custom: '10px 35px 35px -20px rgba(0, 0, 0, 0.4)',
      },
      width: {
        88: '22rem',
        120: '30rem',
        144: '36rem',
        160: '40rem',
        '2full': '200vw',
      },
      height: {
        88: '22rem',
        120: '30rem',
        144: '36rem',
        160: '40rem',
      },
      spacing: {
        '1/2': '50%',
        full: '100%',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      },
      screens: {
        desktop: '1440px',
      },
      colors: {
        gray: {
          151414: '#151414',
          313131: '#313131',
          878786: '#878786',
        },
        purple: {
          figma: '#4D00FF',
          light: '#783EFD',
        },
        red: {
          figma: '#FF5630',
        },
      },
      rotate: {
        360: '-360deg;',
      },
      scale: {
        101: '1.01',
        102: '1.02',
        103: '1.03',
        104: '1.04',
      },
      animation: {
        'gradient-x': 'gradient-x 3s ease infinite',
        'gradient-y': 'gradient-y 3 ease infinite',
        'gradient-xy': 'gradient-xy 3 ease infinite',
        flash: 'flash 1s ease-in-out infinite',
      },
      keyframes: {
        flutter: {
          '0%, 100%': {
            'background-size': '400% 400%',
            'background-position': 'center top',
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'center center',
          },
        },
        flash: {
          '0%, 100%': {},
          '50%': {
            transform: 'scale(1.15)',
            boxShadow: 'shadow-lg',
          },
        },

        'gradient-y': {
          '0%, 100%': {
            'background-size': '400% 400%',
            'background-position': 'center top',
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'center center',
          },
        },
        'gradient-x': {
          '0%, 100%': {
            'background-size': '200% 200%',
            'background-position': 'left center',
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center',
          },
        },
        'gradient-xy': {
          '0%, 100%': {
            'background-size': '400% 400%',
            'background-position': 'left center',
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center',
          },
        },
      },
    },
  },
  variants: {
    extend: {},
  },
  plugins: [require('@tailwindcss/aspect-ratio')],
};
