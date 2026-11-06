/**
 * Preview-oriented GLB -> SVG projection using the same 'three' dependency
 * already used by the upstream CAD viewer. This produces editable SVG polygon
 * paths but is not a CAD-accurate HLR/vector engineering export.
 */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Color, LoadingManager, Mesh, Vector3 } from 'three';

type Tri = { z: number; xy: [number,number][]; fill: string };
const iso = (v: Vector3): [number,number] => [
  (v.x - v.y) * 0.70710678118,
  (v.x + v.y) * 0.40824829 - v.z * 0.81649658
];
const eye = new Vector3(0.56,0.56,0.61).normalize();
const light = new Vector3(-.45,.35,.82).normalize();
export function createProjectionLoadingManager(): LoadingManager {
  const manager = new LoadingManager();
  manager.setURLModifier(url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    throw Error(`Vector projection requires a self-contained GLB; external resource rejected: ${url}`);
  });
  return manager;
}
function colorOf(mesh:Mesh, index:number): string {
  const material = Array.isArray(mesh.material) ? mesh.material[index] || mesh.material[0] : mesh.material;
  const candidate = material as unknown as {color?:Color};
  return candidate.color?.getHexString ? '#' + candidate.color.getHexString() : '#a9b9c6';
}
function channel(hex:string, brightness:number):string {
  const c=new Color(hex);
  return '#' + [c.r,c.g,c.b].map(x=>Math.round(Math.max(0,Math.min(1,x*brightness))*255).toString(16).padStart(2,'0')).join('');
}
export async function projectGLB(file: File, maxTriangles=30000): Promise<string> {
  if(file.size>45_000_000) throw Error('GLB exceeds 45 MB viewer projection limit');
  const data=await file.arrayBuffer();
  const gltf=await new GLTFLoader(createProjectionLoadingManager()).parseAsync(data,'');
  gltf.scene.updateMatrixWorld(true);
  const result:Tri[]=[];
  gltf.scene.traverse(node=>{
    if(!(node instanceof Mesh))return;
    const geo=node.geometry;
    const positions=geo.getAttribute('position');
    if(!positions)return;
    const idx=geo.getIndex();
    const faceCount=Math.floor((idx?.count ?? positions.count)/3);
    if(result.length+faceCount>maxTriangles)throw Error('More than '+maxTriangles+' triangles; simplify the mesh first');
    const groupFor=(i:number)=>geo.groups.find((g:{start:number;count:number;materialIndex?:number})=>i>=g.start && i<g.start+g.count)?.materialIndex ?? 0;
    const a=new Vector3(),b=new Vector3(),c=new Vector3();
    const ab=new Vector3(),ac=new Vector3(),norm=new Vector3();
    for(let i=0;i<faceCount;i++){
      const ia=idx?idx.getX(i*3):i*3, ib=idx?idx.getX(i*3+1):i*3+1, ic=idx?idx.getX(i*3+2):i*3+2;
      a.fromBufferAttribute(positions,ia).applyMatrix4(node.matrixWorld);
      b.fromBufferAttribute(positions,ib).applyMatrix4(node.matrixWorld);
      c.fromBufferAttribute(positions,ic).applyMatrix4(node.matrixWorld);
      ab.subVectors(b,a);ac.subVectors(c,a);norm.crossVectors(ab,ac).normalize();
      if(norm.lengthSq()<1e-10 || norm.dot(eye)<-.06)continue;
      const base=colorOf(node,groupFor(i*3));
      const intensity=Math.max(.42,Math.min(1.16,.76+.28*norm.dot(light)));
      result.push({z:(a.dot(eye)+b.dot(eye)+c.dot(eye))/3,xy:[iso(a),iso(b),iso(c)],fill:channel(base,intensity)});
    }
  });
  if(result.length===0)throw Error('No supported triangular mesh faces');
  const xs=result.flatMap(t=>t.xy.map(p=>p[0])),ys=result.flatMap(t=>t.xy.map(p=>p[1]));
  let loX=Infinity,loY=Infinity,hiX=-Infinity,hiY=-Infinity;
  for (const value of xs) { loX=Math.min(loX,value); hiX=Math.max(hiX,value); }
  for (const value of ys) { loY=Math.min(loY,value); hiY=Math.max(hiY,value); }
  const scale=Math.min(1200/Math.max(1e-5,hiX-loX),800/Math.max(1e-5,hiY-loY));
  const w=Math.max(64,Math.ceil((hiX-loX)*scale+24)),h=Math.max(64,Math.ceil((hiY-loY)*scale+24));
  const polys=result.sort((a,b)=>a.z-b.z).map(tri=>'<polygon points="'+tri.xy.map(p=>((p[0]-loX)*scale+12).toFixed(2)+','+((p[1]-loY)*scale+12).toFixed(2)).join(' ')+'" fill="'+tri.fill+'"/>').join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'"><title>GLB isometric projection</title><desc>Illustrative projection of mesh triangles. Not a CAD hidden-line drawing.</desc>'+polys+'</svg>';
}
