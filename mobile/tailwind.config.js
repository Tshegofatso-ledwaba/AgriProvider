/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#173F35',
        surface: '#F4F1ED',
        border: '#E1E4E1',
        ink: '#13271F',
        muted: '#5C6D67',
        danger: '#A83131',
        selected: '#DDECE3',
        element: '#FFFFFF',
        'dark-surface': '#121914',
        'dark-element': '#1C261F',
        'dark-selected': '#26392C',
        'dark-ink': '#F1F5F0',
        'dark-muted': '#A6B3A8',
        'dark-primary': '#245C38',
        'dark-border': '#344238',
      },
    },
  },
  plugins: [],
};
