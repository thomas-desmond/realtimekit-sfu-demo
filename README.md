# RealtimeKit SFU Globe Visualization

An interactive visualization demonstrating how RealtimeKit uses Cloudflare's global network as a distributed SFU (Selective Forwarding Unit) for real-time audio and video.

![RealtimeKit SFU Demo](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)

## Live Demo

**[View Live Demo](https://realtimekit-sfu-demo.thomas-development.workers.dev)**

## Features

- **Interactive World Map**: Click to add participants anywhere on the globe
- **100+ Cloudflare Datacenters**: Visualizes the global Cloudflare network
- **Real-time Connection Visualization**:
  - User → Datacenter connections (orange lines)
  - Datacenter → Datacenter backbone routing (yellow dashed lines)
- **Two Connection Modes**:
  - **Full Mesh**: All participants connected through their nearest DCs
  - **Speaker Mode**: Star topology with one broadcaster
- **Pan & Zoom**: Scroll to zoom, drag to pan, double-click to zoom in
- **Animated Demo**: Watch participants join from around the world

## How It Works

The visualization demonstrates key concepts from Cloudflare Calls:

1. **Anycast Routing**: Users automatically connect to their nearest Cloudflare datacenter
2. **Global SFU**: Media routes through Cloudflare's backbone - no single central server
3. **Edge Processing**: Packet loss recovery happens at the edge for lower latency

Learn more:
- [Announcing Cloudflare Calls](https://blog.cloudflare.com/announcing-cloudflare-calls/)
- [Cloudflare Calls: Anycast WebRTC](https://blog.cloudflare.com/cloudflare-calls-anycast-webrtc/)

## Controls

| Action | Result |
|--------|--------|
| Single click | Add a participant |
| Double click | Zoom in |
| Drag | Pan the map |
| Scroll wheel | Zoom in/out |
| `+` / `-` keys | Zoom in/out |
| `0` key | Reset view |

## Local Development

```bash
# Install dependencies
pnpm install

# Run locally
pnpm dev
```

Then open http://localhost:8787

## Deployment

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account

### Deploy to Cloudflare Workers

1. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```

2. **Update `wrangler.toml`** with your account ID:
   ```toml
   account_id = "your-account-id-here"
   ```
   
   Find your account ID in the [Cloudflare Dashboard](https://dash.cloudflare.com) URL or run `wrangler whoami`.

3. **Deploy**:
   ```bash
   pnpm deploy
   ```

Your site will be available at `https://realtimekit-sfu-demo.<your-subdomain>.workers.dev`

## Project Structure

```
├── public/
│   └── index.html      # Main visualization (single HTML file)
├── src/
│   └── worker.js       # Cloudflare Worker for serving assets
├── package.json
├── wrangler.toml       # Cloudflare Workers configuration
└── README.md
```

## Tech Stack

- Pure HTML/CSS/JavaScript (no framework)
- SVG for map rendering
- [World Atlas TopoJSON](https://github.com/topojson/world-atlas) for map data
- Cloudflare Workers for hosting

## License

MIT
