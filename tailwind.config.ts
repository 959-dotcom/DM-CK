import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070708",
          900: "#0d0d10",
          800: "#15151a",
          700: "#1e1e26",
        },
        ember: {
          400: "#ff5a5a",
          500: "#e11d2e",
          600: "#b91020",
          700: "#8c0c18",
        },
        mist: "#c8c4d0",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 60px rgba(225, 29, 46, 0.18)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
} satisfies Config;
