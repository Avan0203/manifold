
import type { ManifoldToplevel } from 'manifold-3d';
import type { SceneApp } from './core/SceneApp';

declare global {
    interface Window {
        wasm: ManifoldToplevel;
        __app?: SceneApp;
    }
}
