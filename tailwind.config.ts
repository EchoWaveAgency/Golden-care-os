import type { Config } from "tailwindcss";

// Golden Care design tokens — derived from the falcon logo.
// Brand colors are separate from status colors; orange is a highlight, never an error.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ivory: { DEFAULT: "#FBF7EF", 50: "#FFFDF8", 100: "#FBF7EF", 200: "#F3ECDD", 300: "#E8DCC4" },
        gold: { DEFAULT: "#B8872F", 50: "#FBF4E4", 100: "#F5E6C4", 300: "#E4C27A", 500: "#B8872F", 700: "#8A6420", 800: "#6B4D18" },
        teal: { DEFAULT: "#0F5E63", 50: "#E8F3F3", 100: "#CFE6E7", 500: "#15797F", 700: "#0F5E63", 900: "#0A3F43" },
        navy: { DEFAULT: "#14304A", 500: "#23496B", 700: "#14304A", 900: "#0C1E2F" },
        ember: { DEFAULT: "#D9692B", 100: "#FBE7DA" },
        ok: { DEFAULT: "#1F7A4D", 50: "#E6F4EC" },
        warn: { DEFAULT: "#9A6700", 50: "#FFF4D6" },
        danger: { DEFAULT: "#B42318", 50: "#FDECEA" },
        info: { DEFAULT: "#1D5FA8", 50: "#E8F0FA" },
        ink: { DEFAULT: "#1F2328", 500: "#57606A", 300: "#8C959F" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "IBM Plex Sans Arabic", "Noto Sans Arabic", "Segoe UI", "Tahoma", "sans-serif"],
      },
      borderRadius: { xl: "0.9rem" },
      boxShadow: { card: "0 1px 2px rgba(20,48,74,.06), 0 4px 16px rgba(20,48,74,.05)" },
    },
  },
  plugins: [],
};
export default config;
