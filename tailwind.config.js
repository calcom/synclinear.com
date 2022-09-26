/** @type {import('tailwindcss').Config} */

const colors = require("tailwindcss/colors");

module.exports = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}"
    ],
    theme: {
        extend: {
            transitionProperty: {
                rounded: "border-radius"
            }
        },
        colors: {
            transparent: "transparent",
            white: colors.white,
            gray: colors.neutral,
            black: colors.black,
            yellow: colors.amber,
            orange: colors.orange,
            red: colors.red,
            purple: colors.purple,
            indigo: colors.indigo,
            blue: colors.blue,
            green: colors.green
        }
    },
    plugins: []
};

