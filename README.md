# malibustereo

Contador de visitantes y chat público en vivo: [configuración en Azure](docs/azure-community.md).

## Ejecutar el sitio localmente

Requisitos: [Node.js](https://nodejs.org/) 18 o superior (probado con Node 24) y npm.

```bash
# 1. Instalar dependencias (solo la primera vez o tras cambiar package.json)
npm install

# 2. Arrancar el servidor de desarrollo
npm run dev
```

El sitio queda disponible en <http://localhost:4321/>.

El servidor recarga los cambios automáticamente (hot reload): no hace falta reiniciarlo al editar archivos de `src/`.

### Opciones útiles

```bash
# Exponer el sitio en la red local (útil para probar desde el móvil)
npm run dev -- --host

# Usar otro puerto si el 4321 está ocupado
npm run dev -- --port 4322
```

### Contador de visitantes y chat (API local)

`npm run dev` sirve solo el sitio estático de Astro; las rutas `/api/community/*` viven en una Azure Function (`api/`) y responden **404** en el servidor de desarrollo. Es normal: el resto del sitio funciona, pero el contador y el chat no.

Para probarlos completos en local, usa el doble de prueba incluido:

```bash
npm run build                      # genera dist/
npm install --prefix api           # dependencias de la Function (una vez)
node api/test/local-server.cjs     # sitio + API + WebSockets
```

Queda disponible en <http://localhost:4322/>. Es un doble de prueba que escucha solo en loopback y no requiere claves; no se usa en producción. Más detalle en [docs/azure-community.md](docs/azure-community.md#verificación-local).

### Compilar y previsualizar la versión de producción

```bash
npm run build      # genera el sitio estático en dist/
npm run preview    # sirve dist/ localmente para revisarlo
```

### Estructura rápida

- `src/pages/` — páginas y rutas del sitio.
- `src/components/` y `src/layouts/` — componentes y plantillas reutilizables.
- `src/content/` — contenido en Markdown (el contador/chat vive en `api/`).
- `public/` — archivos estáticos servidos tal cual.
- `api/` e `infra/` — backend serverless y despliegue en Azure (ver [docs/azure-community.md](docs/azure-community.md)).

## Otros enlaces

- [Edit on StackBlitz ⚡️](https://stackblitz.com/edit/malibu-stereo)
