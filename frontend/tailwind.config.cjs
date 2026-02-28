/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
            // we will inject dynamic colors here via style props based on agent generation
        }
      },
    },
    plugins: [],
  }
