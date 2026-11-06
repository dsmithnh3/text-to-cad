#!/usr/bin/env python3
"""Experimental, dependency-free GLB (glTF 2.0) -> editable isometric SVG.

Designed as an illustration adapter for models exported by text-to-cad. It does
NOT compute exact hidden lines, preserve true CAD topology, certify scale, or
replace the existing text-to-cad CAD/drawing workflow.
"""
from __future__ import annotations
import argparse, json, math, pathlib, struct, sys, xml.sax.saxutils as xml

COMPONENTS={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
SIZES={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def identity():
    return [1.,0,0,0,0,1.,0,0,0,0,1.,0,0,0,0,1.]

def multiply(a,b):
    out=[0.]*16
    for c in range(4):
        for r in range(4):
            out[c*4+r]=sum(a[k*4+r]*b[c*4+k] for k in range(4))
    return out

def transform(m,p):
    x,y,z=p[:3]
    return (m[0]*x+m[4]*y+m[8]*z+m[12],
            m[1]*x+m[5]*y+m[9]*z+m[13],
            m[2]*x+m[6]*y+m[10]*z+m[14])

def node_matrix(n):
    if 'matrix' in n:return [float(v) for v in n['matrix']]
    x,y,z,w=n.get('rotation',[0,0,0,1])
    sx,sy,sz=n.get('scale',[1,1,1]);tx,ty,tz=n.get('translation',[0,0,0])
    return [(1-2*y*y-2*z*z)*sx,(2*x*y+2*z*w)*sx,(2*x*z-2*y*w)*sx,0,
            (2*x*y-2*z*w)*sy,(1-2*x*x-2*z*z)*sy,(2*y*z+2*x*w)*sy,0,
            (2*x*z+2*y*w)*sz,(2*y*z-2*x*w)*sz,(1-2*x*x-2*y*y)*sz,0,
            tx,ty,tz,1]

def read_glb(path):
    raw=path.read_bytes()
    if len(raw)<20 or raw[:4]!=b'glTF':raise ValueError('Not a GLB file')
    magic,version,total=struct.unpack_from('<III',raw)
    if version!=2 or total>len(raw):raise ValueError('Expected complete GLB v2')
    offset=12; model=None; binary=b''
    while offset+8<=total:
        size,kind=struct.unpack_from('<II',raw,offset);offset+=8
        if offset+size>total:raise ValueError('Truncated chunk')
        data=raw[offset:offset+size];offset+=size
        if kind==0x4e4f534a:model=json.loads(data)
        if kind==0x004e4942:binary=data
    if model is None:raise ValueError('Missing GLB JSON')
    return model,binary

def accessor(g,binblob,index):
    a=g['accessors'][index]
    if 'sparse' in a:raise ValueError('Sparse accessor unsupported')
    v=g['bufferViews'][a['bufferView']]
    if v.get('buffer',0)!=0:raise ValueError('External buffers unsupported')
    fmt,size=COMPONENTS[a['componentType']]
    n=SIZES[a['type']];stride=v.get('byteStride',size*n)
    start=v.get('byteOffset',0)+a.get('byteOffset',0)
    return [struct.unpack_from('<'+fmt*n,binblob,start+i*stride) for i in range(a['count'])]

def project(p):
    # Orthographic 3/4 view from +x,+y,+z, z-up engineering convention.
    x,y,z=p
    return ((x-y)*0.70710678, (x+y)*0.40824829-z*0.81649658)

def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('glb',type=pathlib.Path)
    ap.add_argument('-o','--output',type=pathlib.Path,required=True)
    ap.add_argument('--width',type=int,default=1200)
    ap.add_argument('--limit',type=int,default=50000,help='Maximum triangles (default 50000)')
    args=ap.parse_args(argv)
    gltf,bb=read_glb(args.glb)
    polys=[]
    nodes=gltf.get('nodes',[]); meshes=gltf.get('meshes',[])
    def walk(index,parent):
        node=nodes[index]
        world=multiply(parent,node_matrix(node))
        if 'mesh' in node:
            mesh=meshes[node['mesh']]
            for prim in mesh.get('primitives',[]):
                if prim.get('mode',4)!=4 or 'POSITION' not in prim.get('attributes',{}):continue
                pts=accessor(gltf,bb,prim['attributes']['POSITION'])
                idx=[i[0] for i in accessor(gltf,bb,prim['indices'])] if 'indices' in prim else list(range(len(pts)))
                worldpts=[transform(world,p) for p in pts]
                # paint every triangle (with lighting by face normal).
                for j in range(0,len(idx)-2,3):
                    p,q,r=(worldpts[idx[j+k]] for k in range(3))
                    a=(q[0]-p[0],q[1]-p[1],q[2]-p[2])
                    b=(r[0]-p[0],r[1]-p[1],r[2]-p[2])
                    normal=(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
                    length=math.sqrt(sum(t*t for t in normal))
                    if length<1e-12:continue
                    normal=tuple(v/length for v in normal)
                    facing=sum(normal[k]*s for k,s in enumerate((.56,.56,.61)))
                    # Single-sided surfaces only; near backfaces are skipped.
                    if facing<=-0.06:continue
                    light=max(.30,min(.98,.58+.31*sum(normal[k]*v for k,v in enumerate((-.45,.35,.82)))))
                    tone=int(255*light)
                    color=f'#{min(255,int(tone*.95)):02x}{min(255,int(tone*1.02)):02x}{min(255,int(tone*1.10)):02x}'
                    uv=[project(t) for t in (p,q,r)]
                    depth=sum(sum(t[k]*s for k,s in enumerate((.56,.56,.61))) for t in (p,q,r))/3
                    polys.append((depth,uv,color))
                    if len(polys)>args.limit:raise ValueError(f'Triangle budget exceeded ({args.limit}); simplify GLB first')
        for child in node.get('children',[]):walk(child,world)
    scenes=gltf.get('scenes',[])
    if scenes:
        scene=scenes[gltf.get('scene',0)]
        for idx in scene.get('nodes',[]):walk(idx,identity())
    else:
        children={j for node in nodes for j in node.get('children',[])}
        for idx in range(len(nodes)):
            if idx not in children:walk(idx,identity())
    if not polys:raise ValueError('No supported triangle surfaces were found')
    coords=[p for _,tri,_ in polys for p in tri]
    xmin=min(x for x,y in coords);xmax=max(x for x,y in coords)
    ymin=min(y for x,y in coords);ymax=max(y for x,y in coords)
    scale=min((args.width-48)/max(xmax-xmin,1e-7), (args.width*.7-48)/max(ymax-ymin,1e-7))
    width=args.width;height=int(max(160,(ymax-ymin)*scale+48))
    def pt(p):return f'{(p[0]-xmin)*scale+24:.3f},{(p[1]-ymin)*scale+24:.3f}'
    lines=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img">']
    lines.append('<title>Orthographic isometric mesh projection, illustrative</title>')
    lines.append(f'<desc>Experimental triangles from {xml.escape(args.glb.name)}; not an exact hidden-line CAD drawing.</desc>')
    # Far surfaces before near surfaces; approximate painter's ordering.
    for depth,tri,color in sorted(polys,key=lambda r:r[0]):
        lines.append('<polygon points="'+ ' '.join(pt(p) for p in tri)+'" fill="'+color+'" stroke="none"/>')
    lines.append('</svg>')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text('\n'.join(lines),encoding='utf-8')
    print(f'Wrote {args.output}: {len(polys)} triangle polygons, {width}x{height}')
    return 0
if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,IndexError,KeyError,struct.error) as e:
        print('Projection failed:',e,file=sys.stderr);sys.exit(2)
