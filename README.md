<div align="center">

# 🧊 Manifold Showcase

**An interactive playground for [Manifold-3d](https://github.com/elalish/manifold) modeling operations, rendered live with [Three.js](https://threejs.org/).**

[中文文档](./README.CN.md) · [Report Bug](#) · [Request Feature](#)

</div>

<div align="center">

![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-0.184-000000?logo=three.js&logoColor=white)
![Manifold-3D](https://img.shields.io/badge/manifold--3d-3.5-FF6B35)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## ✨ Features

A curated set of interactive cases demonstrating core **Manifold-3d** operations, each with live three-dimensional visualization and a tweakable `lil-gui` control panel.

| # | Case | What it shows |
|---|------|---------------|
| 1 | **Base Shapes** | Built-in primitives (cube, sphere, cylinder, …) via Manifold |
| 2 | **Extrude** | 2D cross-sections extruded along the Z-axis into 3D solids |
| 3 | **Revolve** | 2D cross-sections revolved around the Y-axis |
| 4 | **2D Boolean** | `CrossSection` union / intersection / difference (line-rendered) |
| 5 | **3D Boolean** | `Manifold` union / intersection / difference on solid meshes |
| 6 | **Smooth** | `Manifold.smooth` + `refine` for G1-continuous surfaces with optional hard edges |
| 7 | **Import / Export** | Round-trip models through `gltf` / `glb` / `3mf` via `@gltf-transform` |

---

## 📸 Screenshots

> Place screenshots under `docs/screenshots/` using the same `<case-key>` as in `src/cases/index.ts`.

<div align="center">
  <img src="docs/index.png" alt="Hero screenshot" width="80%" />
</div>

---

## 🚀 Quick Start

### Prerequisites

- **Node.js ≥ 18**
- **pnpm** (recommended) or `npm` / `yarn`

### Install

```bash
pnpm install
```

### Run

```bash
pnpm dev          # start Vite dev server
pnpm build        # type-check (tsc --noEmit) + production build
pnpm preview      # preview the production build
pnpm typecheck    # run TypeScript checks only
```

Open <http://localhost:5173> and pick a case from the left sidebar. The URL hash routes to the active case (`#/case/<key>`) and is shareable.

---

## 🧱 Tech Stack

| Library | Version | Role |
|---|---|---|
| [`manifold-3d`](https://www.npmjs.com/package/manifold-3d) | ^3.5.1 | CSG modeling kernel (WASM) |
| [`three`](https://www.npmjs.com/package/three) | ^0.184.0 | WebGL renderer & scene graph |
| [`@gltf-transform/*`](https://gltf-transform.dev/) | ^4.4.0 | glTF / glb / 3mf I/O |
| [`lil-gui`](https://www.npmjs.com/package/lil-gui) | ^0.21.0 | Per-case parameter panel |
| [`vite`](https://vitejs.dev/) | ^8.0.0 | Dev server & bundler |
| [`typescript`](https://www.typescriptlang.org/) | ^6.0.0 | Type safety |

---

## 🏗️ Architecture

```
src/
├── main.ts                 # entry: bootstraps SceneApp
├── style.css
├── core/
│   ├── SceneApp.ts         # wires Sidebar + Stage + CaseManager, handles routing
│   ├── Sidebar.ts          # left-side case picker
│   ├── Stage.ts            # Three.js canvas + camera/orbit controls
│   ├── CaseManager.ts      # mounts/unmounts the active case
│   ├── registry.ts         # central case registration + lazy loaders
│   ├── router.ts           # parse / build #/case/<key> hash routes
│   └── types.ts
├── cases/                  # one folder per demo (lazy-loaded)
│   ├── index.ts            # registerCase(...) entries
│   ├── base-shape/
│   ├── extrude-shape/
│   ├── revolve/
│   ├── 2d-boolean/
│   ├── 3d-boolean/
│   ├── smooth/
│   └── import-export/
├── utils/
│   ├── manifold.ts         # wasm init + helpers
│   └── three.ts            # three.js helpers
└── assets/
```

### Case registration

Each demo lives in its own folder and is registered through a single `registerCase(...)` call in [`src/cases/index.ts`](./src/cases/index.ts). The shell renders the sidebar **before** the case module is downloaded; that is why `name` and `description` are duplicated there — they must be known eagerly.

### Routing

The hash format is `#/case/<key>`. An empty or invalid hash falls back to the first registered case without rewriting the URL.

---

## ➕ Add a New Case

1. **Create** `src/cases/<your-case>/index.ts` and `export default` a `Case` instance.
2. **Register** it in `src/cases/index.ts`:

   ```ts
   registerCase({
     key: 'your-case',
     name: 'Your Case',
     description: 'Short description shown in the sidebar',
     load: () => import('./your-case').then((m) => m.default),
   });
   ```

That is it — the sidebar entry, the lazy chunk, and the `#/case/your-case` route are all generated automatically.

---

## 📜 Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start the Vite dev server with HMR |
| `pnpm build` | Type-check and build for production |
| `pnpm preview` | Serve the production build locally |
| `pnpm typecheck` | Run `tsc --noEmit` only |

---

## 📄 License

[MIT](./LICENSE) © 2026 — feel free to learn from, fork, and build on top of it.

---

<div align="center">
  <sub>Built with ❤️ using Manifold-3d and Three.js.</sub>
</div>
