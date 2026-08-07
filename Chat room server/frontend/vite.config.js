import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'

// 以 src/assets/柴郡.png 为唯一默认头像源，打包时保留稳定的访问路径。
const defaultAvatarPlugin = {
  name: 'default-avatar',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: '柴郡.png',
      source: readFileSync(new URL('./src/assets/柴郡.png', import.meta.url)),
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), defaultAvatarPlugin],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8091',
      '/ws': { target: 'ws://127.0.0.1:8091', ws: true },
    },
  },
})
