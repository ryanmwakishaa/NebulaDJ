# Free deployment (hybrid setup)

NebulaDJ's frontend can be hosted free, but the full DJ backend cannot be reliably hosted for $0 with a 1–10 GB local music library. Free cloud web services have ephemeral filesystems, so songs, SQLite playlists, and rendered mixes can disappear on restart/redeploy. Keep the music and backend on your PC for this free setup.

## 1. Deploy the frontend to Vercel

1. Open https://vercel.com and sign in with GitHub.
2. Import `ryanmwakishaa/NebulaDJ`.
3. Set **Root Directory** to `Frontend`.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Before deploying, add environment variable `VITE_API_BASE_URL` with the public backend tunnel URL (instructions below). Do not add `/api` to this value.
7. Deploy. Copy the resulting frontend URL, for example `https://your-project.vercel.app`.

If you deploy the frontend before the tunnel is ready, add the variable later and redeploy.

## 2. Run the backend on your PC

Keep the music files in `Backend/songs` (or make sure the paths in `Backend/library.csv` point to the real files). Open PowerShell:

```powershell
cd C:\Projects\NebulaDJ\Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Install FFmpeg on Windows if it is not already installed and ensure `ffmpeg` is on PATH. Then start the API:

```powershell
$env:NEBULADJ_ALLOWED_ORIGINS="https://your-project.vercel.app"
uvicorn main:app --host 0.0.0.0 --port 8000
```

Replace the example origin with your actual Vercel URL. Check locally at http://127.0.0.1:8000/api/health.

## 3. Give the frontend a temporary public route to your PC

For a quick personal test, install Cloudflare Tunnel (`cloudflared`) and, in a second PowerShell window, run:

```powershell
cloudflared tunnel --url http://localhost:8000
```

Cloudflare will print a temporary `https://....trycloudflare.com` URL. Set that URL as Vercel's `VITE_API_BASE_URL` value, then redeploy the frontend. Keep both the backend and tunnel running, and keep your PC awake and connected to the internet.

Quick Tunnel URLs can change when restarted. If it changes, update `VITE_API_BASE_URL` in Vercel and redeploy.

## Important limitations

- This is a **personal test setup**, not a secure public service. The backend currently has no user authentication; anyone who discovers the tunnel URL may be able to call its API while the tunnel is running. Stop the tunnel when you're done.
- Your PC must remain on for audio streaming and mix rendering. If it sleeps or disconnects, the deployed UI cannot reach your music.
- Playlist SQLite data and generated mix state stay local. Back up `nebula_playlists.db`.
- Do not upload your 1–10 GB music collection or generated mixes to GitHub. GitHub is for source code, not a music file host.
- A fully cloud-hosted version with persistent 1–10 GB storage is not achievable on Render's free web service tier: free services have ephemeral filesystems and cannot attach persistent disks. To make the backend independent of your PC, you would need an external storage setup or paid persistent storage and additional backend changes.

## Frontend settings

Vercel uses the Vite project root at `Frontend`. `Frontend/vercel.json` includes SPA fallback routing so client-side routes resolve correctly.
