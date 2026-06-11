import { BufferAttribute, BufferGeometry } from "three";
import type { Mesh } from 'manifold-3d';

function geometry2ManifoldMesh(geometry: BufferGeometry): Mesh {
    const vertProperties = geometry.attributes.position.array as Float32Array
    const triVerts = geometry.index != null
        ? (geometry.index.array as Uint32Array)
        : new Uint32Array(vertProperties.length / 3).map((_, i) => i)

    const mesh = new window.wasm!.Mesh({ numProp: 3, vertProperties, triVerts })
    mesh.merge();
    return mesh
}

function manifoldMesh2geometry(mesh: Mesh): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(mesh.vertProperties, 3))
    geometry.setIndex(new BufferAttribute(mesh.triVerts, 1))
    return geometry
}

export { geometry2ManifoldMesh, manifoldMesh2geometry }
