/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/web/views/**/*.ejs'],
  theme: {
    extend: {
      colors: {
        brand: {
          500: '#d8ac57', // Your primary logo color
          600: '#c79b43', // A slightly darker shade for hover
        },
        'bg-dark': '#34342f', // Your logo background color
        'bg-light': '#3f3f37ff', // The new color for cards and boxes
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
    require('@tailwindcss/line-clamp'),
  ],
};