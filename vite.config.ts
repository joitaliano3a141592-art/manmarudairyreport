import { defineConfig, loadEnv } from "vite";
import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { powerApps, POWER_APPS_CORS_ORIGINS } from "./plugins/plugin-power-apps";
import { graphProxy } from "./plugins/plugin-graph-proxy";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env / .env.production.local 等からも VITE_* を読み込む
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const appBasePath = env.VITE_APP_BASE_PATH || "/manmarudairyreport/";

  return {
  plugins: [
    react(),
    tailwindcss(),
    powerApps(),
    graphProxy(),
  ],
  base: appBasePath,
  server: {
    cors: {
      origin: POWER_APPS_CORS_ORIGINS
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            // DnD関連
            if (id.includes('@dnd-kit')) return 'dnd-vendor'
            // ユーティリティ（React 非依存）
            if (id.includes('clsx') || id.includes('tailwind-merge') || id.includes('date-fns') || id.includes('class-variance-authority')) {
              return 'utils-vendor'
            }
            // React + 全 React 依存ライブラリ（循環参照回避）
            return 'vendor'
          }
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
  };
})
