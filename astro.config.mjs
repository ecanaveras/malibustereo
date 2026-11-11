import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	vite: {
		server: {
			// `npm run build` escribe en dist/. Sin esto, el watcher de desarrollo
			// falla con EBUSY en Windows al compilar mientras `npm run dev` está activo.
			watch: { ignored: ['**/dist/**'] },
		},
	},
});
