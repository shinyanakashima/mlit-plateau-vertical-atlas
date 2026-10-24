import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const cesiumBuild = 'node_modules/cesium/Build/Cesium'

// Relative base: the same build works at the domain root (Cloudflare Pages) and under
// /<repo>/ (GitHub Pages).  Override with VITE_BASE if absolute URLs are needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((d) => ({
        src: `${cesiumBuild}/${d}`,
        dest: 'cesium',
        rename: { stripBase: 4 },
      })),
    }),
  ],
  build: {
    chunkSizeWarningLimit: 6000,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000,
  },
} as never)
