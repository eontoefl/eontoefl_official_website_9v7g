import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 정적 공홈 페이지가 <script>로 그냥 불러다 쓸 수 있게
// React+BlockNote를 한 덩어리(IIFE)로 묶어 ../js/ 에 떨군다.
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: resolve(__dirname, "../js"),
    emptyOutDir: false, // js/ 에 있는 기존 앱 코드를 지우지 않도록 반드시 false
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/main.jsx"),
      name: "BookEditorBundle",
      formats: ["iife"],
      fileName: () => "book-editor.bundle.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "book-editor.bundle.[ext]",
      },
    },
  },
});
