import { translator } from '@cad/ui/i18n';
import { projectGLB } from './glbProjection';
import { isolateSvg, sanitizeSvg } from './svgSafety';
import { persistCommittedDraft, readVectorDraft } from './vectorDraft';
import { parseVectorProject, type VectorAsset as Asset, type VectorItem as Item, type VectorProject as Project } from './vectorProject';
import { createVectorState, reduceVectorState, type VectorEditorAction } from './vectorState';
import { useEffect, useMemo, useReducer, useRef, useState, type ComponentProps, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@cad/ui/primitives/button';
import { Box, ChevronDown, ChevronUp, Copy, Download, Eye, EyeOff, FolderOpen, Grid3X3, Layers, Lock, LockOpen, Plus, Redo2, RotateCcw, Save, Search, Trash2, Undo2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import './vector.css';

/**
 * Vector Studio lives in the existing CAD web host, uses @cad/ui controls and design tokens,
 * and never invokes the CAD engine or changes its document. CAD remains an independent mode.
 * Source SVGs imported from assets/ are optional and intentionally not vendored in this fork.
 */
const NS = 'http://www.w3.org/2000/svg';
const builtin: Asset[] = [
  { id: 'room-shell', name: 'Room shell · starter', category: 'Building', provenance: 'user-import', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 130"><path d="M10 42 108 10l82 37-98 36Z" fill="#b4c6d2" stroke="#64748b"/><path d="M10 42v65l82 20V83Z" fill="#e0e7ee" stroke="#64748b"/><path d="M92 83v44l98-39V47Z" fill="#93aabc" stroke="#64748b"/></svg>' },
  { id: 'demo-unit', name: 'Equipment block · starter', category: 'Equipment', provenance: 'user-import', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 100"><path d="M8 28 130 4l42 21-120 26Z" fill="#d7e1ea" stroke="#4b6173"/><path d="M8 28v47l44 20V51Z" fill="#b9ced9" stroke="#4b6173"/><path d="M52 51v44l120-25V25Z" fill="#8ca8b8" stroke="#4b6173"/><circle cx="87" cy="63" r="19" fill="#324e64" stroke="#e4f0f4" stroke-width="3"/><path d="M87 48v30M72 63h30" stroke="#e4f0f4" stroke-width="3"/></svg>' }
];
// Vite supplies `glob`; the Node test bundle deliberately does not. Keep the optional
// source-derived catalog out of non-Vite hosts rather than making App imports crash.
const rawLibrary = typeof import.meta.glob === 'function'
  ? import.meta.glob('./assets/**/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  : {};
const bundledAssets: Asset[] = Object.entries(rawLibrary).map(([path, svg]) => ({
  id: 'extracted:' + path, name: path.split('/').pop()?.replace(/\.svg$/i, '').replace(/[_-]/g, ' ') || 'Component',
  category: path.split('/').slice(-2, -1)[0] || 'Extracted', svg, provenance: 'source-derived'
}));
const id = () => 'vs-' + crypto.randomUUID();
const download = (name: string, data: Blob) => {
  const url = URL.createObjectURL(data), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
};
const empty = (): Project => ({ schema: 'cad-vector-studio/v1', name: 'Untitled vector assembly', items: [], assets: [], width: 1200, height: 760 });
function load(): Project {
  return readVectorDraft(sessionStorage) ?? empty();
}
export default function VectorWorkspace({ locale }: { locale: string }) {
  const tr = translator(locale);
  const [editor, dispatch] = useReducer(reduceVectorState, undefined, () => createVectorState(load()));
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const project = editor.project;
  const history = editor.past;
  const future = editor.future;
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('');
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({x:0,y:0});
  const [tab, setTab] = useState<'assets'|'layers'>('assets');
  const [message, setMessage] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState('');
  const drag = useRef<{id:string;px:number;py:number;ox:number;oy:number;baseline:Project}|null>(null);
  const stage = useRef<SVGSVGElement|null>(null);
  const selectedItem = project.items.find(i => i.id === selected);
  const assetMap = useMemo(() => new Map([...builtin, ...bundledAssets, ...project.assets].map(a => [a.id,a])), [project.assets]);
  useEffect(() => {
    const item = project.items.find(i => i.id === selected);
    setSourceDraft(item ? assetMap.get(item.assetId)?.svg || '' : '');
    setSourceOpen(false);
  }, [selected]);
  const assets = [...builtin, ...bundledAssets, ...project.assets].filter(a => (a.name + ' ' + a.category).toLowerCase().includes(filter.toLowerCase()));
  const apply = (action: VectorEditorAction) => {
    const next = reduceVectorState(editorRef.current, action);
    dispatch(action);
    const result = persistCommittedDraft(sessionStorage, action, next.project);
    if (result && !result.ok) {
      if (result.error === 'quota') setMessage(tr('vector.draftQuota'));
      else if (result.error === 'blocked') setMessage(tr('vector.draftUnavailable'));
      else setMessage(tr('vector.draftInvalid'));
    }
    return result;
  };
  const commit = (next: Project | ((p:Project) => Project), baseline?: Project) => {
    const current = editorRef.current.project;
    const projectNext = typeof next === 'function' ? next(current) : next;
    apply({ type: 'commit', project: projectNext, baseline });
  };
  const undo = () => { apply({ type: 'undo' }); };
  const redo = () => { apply({ type: 'redo' }); };
  const change = (patch:Partial<Item>) => selected && commit(p => ({...p,items:p.items.map(i => i.id===selected?{...i,...patch}:i)}));
  const insert = (a:Asset) => {
    const next:Item = {id:id(),assetId:a.id,name:a.name,x:330+project.items.length*24,y:150+project.items.length*20,w:240,h:160,rotate:0,opacity:1,hidden:false,locked:false};
    commit(p=>({...p,items:[...p.items,next]}));setSelected(next.id);setMessage('Added '+a.name);
  };
  const point = (event:ReactPointerEvent<SVGElement>) => {
    const scene=stage.current!;
    const ctm=scene.getScreenCTM();
    if (!ctm) return {x:0,y:0};
    const cursor=scene.createSVGPoint();
    cursor.x=event.clientX; cursor.y=event.clientY;
    const v=cursor.matrixTransform(ctm.inverse());
    return {x:(v.x-pan.x)/zoom,y:(v.y-pan.y)/zoom};
  };
  const onDown = (event:ReactPointerEvent<SVGElement>, item:Item) => {
    if (item.locked) return; const p=point(event);
    setSelected(item.id);
    drag.current={id:item.id,px:p.x,py:p.y,ox:item.x,oy:item.y,baseline:editorRef.current.project};
    stage.current?.setPointerCapture(event.pointerId);
  };
  const onMove = (event:ReactPointerEvent<SVGSVGElement>) => {
    const d=drag.current;if(!d)return;
    const pt=point(event), grid=(n:number)=>snap?Math.round(n/20)*20:n;
    apply({
      type: 'preview',
      project: {
        ...editorRef.current.project,
        items: editorRef.current.project.items.map(i => i.id===d.id
          ? {...i,x:grid(d.ox+pt.x-d.px),y:grid(d.oy+pt.y-d.py)}
          : i),
      },
    });
  };
  const onUp = () => {
    if (!drag.current) return;
    const d = drag.current;
    drag.current = null;
    commit(editorRef.current.project, d.baseline);
  };
  const editFile = async (files: FileList|null) => {
    if(!files)return;const imported:Asset[]=[];
    for(const file of Array.from(files).slice(0,1000)) {
      if(!file.name.toLowerCase().endsWith('.svg'))continue;
      try {const svg=sanitizeSvg(await file.text());imported.push({id:id(),name:file.name.replace(/\.svg$/i,''),category:'Imported',svg,provenance:'user-import'});}
      catch(e){setMessage('Skipped '+file.name+': '+String(e));}
    }
    if(imported.length){commit(p=>({...p,assets:[...p.assets,...imported]}));setMessage('Imported '+imported.length+' SVG files');}
  };
  const importGlb = async (file:File|undefined) => {
    if(!file)return;
    setMessage('Projecting GLB mesh…');
    try {
      const svg=await projectGLB(file);
      const asset:Asset={id:id(),name:file.name.replace(/\.glb$/i,'')+' · isometric',category:'CAD projection',svg:sanitizeSvg(svg),provenance:'user-import'};
      const node:Item={id:id(),assetId:asset.id,name:asset.name,x:300,y:150,w:360,h:240,rotate:0,opacity:1,hidden:false,locked:false};
      // Asset and instance must enter history together.
      commit(p=>({...p,assets:[...p.assets,asset],items:[...p.items,node]}));
      setSelected(node.id);
      setMessage('GLB projected into editable SVG polygons; verify visibility and scale');
    } catch(e) { setMessage('GLB projection failed: '+String(e)); }
  };
  const saveProject = () => {
    // Self-contained JSON: include only catalog assets actually used, not all 713 installed files.
    const used = new Set(project.items.map(item => item.assetId));
    const custom = new Map(project.assets.map(asset => [asset.id, asset]));
    for (const assetId of used) {
      if (custom.has(assetId)) continue;
      const asset = assetMap.get(assetId);
      if (asset) custom.set(assetId, asset);
    }
    const portable = { ...project, assets: [...custom.values()] };
    download((project.name||'vector-project').replace(/[^a-z0-9_-]/gi,'_')+'.json',
      new Blob([JSON.stringify(portable,null,2)],{type:'application/json'}));
  };
  const loadProject = async (file:File|undefined) => {
    if(!file)return;
    try {
      const next = parseVectorProject(await file.text());
      const cleaned: Project = {
        ...next,
        assets: next.assets.map(a => ({ ...a, svg: sanitizeSvg(a.svg) })),
      };
      // Re-validate after sanitization in case SVG rewrite changes aggregate budgets.
      parseVectorProject(JSON.stringify(cleaned));
      const write = apply({ type: 'replace', project: cleaned });
      setSelected('');
      if (!write || write.ok) setMessage('Project loaded');
    } catch(e){setMessage('Cannot open project: '+String(e));}
  };
  const exportSvg = () => {
    const output = document.createElementNS(NS,'svg'); output.setAttribute('xmlns',NS);
    output.setAttribute('viewBox', '0 0 '+project.width+' '+project.height);
    output.setAttribute('width',String(project.width)); output.setAttribute('height',String(project.height));
    project.items.filter(i=>!i.hidden).forEach(i=>{
      const asset=assetMap.get(i.assetId);if(!asset)return;
      const doc = new DOMParser().parseFromString(isolateSvg(asset.svg,i.id),'image/svg+xml');
      const el=doc.documentElement; const nested=document.createElementNS(NS,'svg');
      nested.setAttribute('x',String(i.x));nested.setAttribute('y',String(i.y));nested.setAttribute('width',String(i.w));
      nested.setAttribute('height',String(i.h));nested.setAttribute('viewBox',el.getAttribute('viewBox')||'0 0 200 150');
      nested.setAttribute('preserveAspectRatio','xMidYMid meet');
      nested.setAttribute('transform', 'rotate('+i.rotate+' '+(i.x+i.w/2)+' '+(i.y+i.h/2)+')');
      nested.setAttribute('opacity',String(i.opacity));
      nested.setAttribute('data-component-id',i.id);
      for(const child of Array.from(el.childNodes))nested.appendChild(document.importNode(child,true));
      output.appendChild(nested);
    });
    download((project.name||'design').replace(/[^a-z0-9_-]/gi,'_')+'.svg',new Blob([new XMLSerializer().serializeToString(output)],{type:'image/svg+xml'}));
  };
  const applySource = () => {
    if (!selectedItem || !sourceDraft) return;
    try {
      const sanitized = sanitizeSvg(sourceDraft);
      const base = assetMap.get(selectedItem.assetId);
      if (!base) throw Error('Component source missing');
      const copy:Asset = {...base, id:id(), name:selectedItem.name+' · edited', category:base.category,
        provenance:'user-import',svg:sanitized};
      commit(p=>({...p,assets:[...p.assets,copy],
        items:p.items.map(i=>i.id===selectedItem.id?{...i,assetId:copy.id}:i)}));
      setSourceDraft(sanitized);
      setMessage(tr('vector.sourceSaved'));
    } catch(e) {
      setMessage(tr('vector.sourceFailed')+': '+String(e));
    }
  };
  const doDuplicate=()=>{if(!selectedItem)return;const copy={...selectedItem,id:id(),x:selectedItem.x+24,y:selectedItem.y+24};commit(p=>({...p,items:[...p.items,copy]}));setSelected(copy.id);};
  const doDelete=()=>{if(!selected)return;commit(p=>({...p,items:p.items.filter(i=>i.id!==selected)}));setSelected('');};
  const ButtonSmall=(props:ComponentProps<typeof Button>)=><Button variant="ghost" size="icon-sm" {...props}/>;
  return <div className="vs-root bg-background text-foreground">
    <div className="vs-header border-b border-border bg-background">
      <div className="flex items-center gap-2 min-w-0"><Box className="size-4 text-muted-foreground"/><input className="vs-title" aria-label={tr('vector.projectName')} value={project.name} onChange={e=>commit({ ...editorRef.current.project, name: e.target.value })}/><span className="vs-subtitle">{tr('vector.workspace')}</span></div>
      <div className="flex items-center gap-1">
        <ButtonSmall aria-label={tr('vector.undo')} title={tr('vector.undo')} disabled={!history.length} onClick={undo}><Undo2/></ButtonSmall>
        <ButtonSmall aria-label={tr('vector.redo')} title={tr('vector.redo')} disabled={!future.length} onClick={redo}><Redo2/></ButtonSmall>
        <ButtonSmall aria-label={tr('vector.duplicate')} title={tr('vector.duplicate')} disabled={!selected} onClick={doDuplicate}><Copy/></ButtonSmall>
        <ButtonSmall aria-label={tr('vector.delete')} title={tr('vector.delete')} disabled={!selected} onClick={doDelete}><Trash2/></ButtonSmall>
        <label className="vs-file-button"><FolderOpen className="size-3.5"/> {tr('vector.open')} <input type="file" hidden accept=".json" onChange={e=>void loadProject(e.target.files?.[0])}/></label>
        <Button size="sm" variant="outline" onClick={saveProject}><Save/> {tr('vector.saveProject')}</Button>
        <Button size="sm" onClick={exportSvg}><Download/> {tr('vector.exportSvg')}</Button>
      </div>
    </div>
    <div className="vs-main">
      <aside className="vs-left bg-sidebar border-r border-sidebar-border">
        <div className="vs-switch">
          <Button size="sm" variant={tab==='assets'?'secondary':'ghost'} onClick={()=>setTab('assets')}><Grid3X3/> {tr('vector.library')}</Button>
          <Button size="sm" variant={tab==='layers'?'secondary':'ghost'} onClick={()=>setTab('layers')}><Layers/> {tr('vector.layers')}</Button>
        </div>
        {tab==='assets'?<><div className="vs-search"><Search className="size-4 text-muted-foreground"/><input value={filter} onChange={e=>setFilter(e.target.value)} placeholder={tr('vector.search')} aria-label={tr('vector.search')}/></div>
          <label className="vs-import"><Upload className="size-4"/> {tr('vector.importSvg')} <input type="file" hidden multiple accept=".svg" onChange={e=>void editFile(e.target.files)}/></label>
          <label className="vs-import"><Box className="size-4"/> {tr('vector.importGlb')} <input type="file" hidden accept=".glb,model/gltf-binary" onChange={e=>void importGlb(e.target.files?.[0])}/></label>
          <div className="vs-catalog">{assets.map(a=><button key={a.id} type="button" onClick={()=>insert(a)} className="vs-asset" title={tr('vector.add')+' '+a.name}>
            <span className="vs-asset-icon"><Box className="size-5"/></span><span className="min-w-0"><strong>{a.name}</strong><small>{a.category} · {a.provenance==='source-derived'?tr('vector.extracted'):tr('vector.local')}</small></span><Plus className="size-3.5 text-muted-foreground"/></button>)}
            {assets.length===0?<p className="vs-muted">{tr('vector.noAssets')}</p>:null}</div>
        </>:<div className="vs-catalog">{[...project.items].reverse().map(item=><div key={item.id} className={'vs-layer '+(selected===item.id?'vs-selected':'')} onClick={()=>setSelected(item.id)}>
          <span className="truncate flex-1">{item.name}</span>
          <ButtonSmall title={tr('vector.hideLayer')} onClick={e=>{e.stopPropagation();commit(p=>({...p,items:p.items.map(i=>i.id===item.id?{...i,hidden:!i.hidden}:i)}));}}>{item.hidden?<EyeOff/>:<Eye/>}</ButtonSmall>
          <ButtonSmall title={tr('vector.lockLayer')} onClick={e=>{e.stopPropagation();commit(p=>({...p,items:p.items.map(i=>i.id===item.id?{...i,locked:!i.locked}:i)}));}}>{item.locked?<Lock/>:<LockOpen/>}</ButtonSmall></div>)}</div>}
      </aside>
      <section className="vs-center bg-background">
        <div className="vs-toolbar border-b border-border">
          <span className="vs-muted">{project.items.length} {tr('vector.components')}</span><div className="flex items-center gap-1">
            <ButtonSmall title={tr('vector.grid')} aria-label={tr('vector.grid')} onClick={()=>setShowGrid(v=>!v)}><Grid3X3/></ButtonSmall>
            <label className="vs-tiny-check"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> {tr('vector.snap')}</label>
            <ButtonSmall title={tr('vector.zoomOut')} aria-label={tr('vector.zoomOut')} onClick={()=>setZoom(z=>Math.max(.25,z*.8))}><ZoomOut/></ButtonSmall>
            <span className="vs-zoom">{Math.round(zoom*100)}%</span>
            <ButtonSmall title={tr('vector.zoomIn')} aria-label={tr('vector.zoomIn')} onClick={()=>setZoom(z=>Math.min(3,z*1.25))}><ZoomIn/></ButtonSmall>
            <ButtonSmall title={tr('vector.resetView')} aria-label={tr('vector.resetView')} onClick={()=>{setZoom(1);setPan({x:0,y:0});}}><RotateCcw/></ButtonSmall>
          </div></div>
        <div className="vs-canvas-wrap">
          <svg ref={stage} className="vs-canvas" viewBox={'0 0 '+project.width+' '+project.height} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerDown={e=>{if(e.target===e.currentTarget)setSelected('');}} aria-label={tr('vector.canvas')}>
            <g transform={'translate('+pan.x+' '+pan.y+') scale('+zoom+')'}>
              {showGrid?<defs><pattern id="vs-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="currentColor" opacity=".10" strokeWidth="1"/></pattern></defs>:null}
              {showGrid?<rect width={project.width} height={project.height} fill="url(#vs-grid)" pointerEvents="none"/>:null}
              {project.items.map(i=>{const asset=assetMap.get(i.assetId);if(!asset||i.hidden)return null;
                const root=new DOMParser().parseFromString(isolateSvg(sanitizeSvg(asset.svg),i.id),'image/svg+xml').documentElement;
                return <g key={i.id} transform={'rotate('+i.rotate+' '+(i.x+i.w/2)+' '+(i.y+i.h/2)+')'} opacity={i.opacity} onPointerDown={e=>{e.stopPropagation();onDown(e,i);}}>
                  <svg x={i.x} y={i.y} width={i.w} height={i.h} viewBox={root.getAttribute('viewBox')||'0 0 200 150'} preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{__html:root.innerHTML}} style={{pointerEvents:'none'}}/>
                  <rect x={i.x} y={i.y} width={i.w} height={i.h} fill="transparent" pointerEvents={i.locked ? 'none' : 'all'} />
                  {selected===i.id?<rect x={i.x} y={i.y} width={i.w} height={i.h} fill="none" stroke="var(--primary)" strokeWidth={2/zoom} strokeDasharray="6 4" pointerEvents="none"/>:null}
                </g>;
              })}
            </g>
          </svg>
        </div>
        <div className="vs-status border-t border-border">{message||tr('vector.ready')} <span className="ml-auto">{tr('vector.themeNote')}</span></div>
      </section>
      <aside className="vs-right border-l border-border bg-sidebar">
        <div className="vs-inspector-title"><Layers className="size-4"/> {tr('vector.properties')}</div>
        {selectedItem?<div className="vs-properties">
          <label>{tr('vector.componentName')}<input value={selectedItem.name} onChange={e=>change({name:e.target.value})}/></label>
          <div className="vs-fields">{(['x','y','w','h','rotate','opacity'] as const).map(k=><label key={k}>{k==='rotate'?tr('vector.rotation'):k==='opacity'?tr('vector.opacity'):k.toUpperCase()}<input type="number" step={k==='opacity'?.05:1} min={k==='opacity'?0:undefined} max={k==='opacity'?1:undefined} value={selectedItem[k]} onChange={e=>change({[k]:Number(e.target.value)})}/></label>)}</div>
          <div className="vs-source-editor">
            <Button size="sm" variant="outline" onClick={()=>setSourceOpen(open=>!open)}>
              {tr('vector.sourceEditor')} {sourceOpen ? '−' : '+'}
            </Button>
            {sourceOpen ? <div className="vs-source-body">
              <p className="vs-muted">{tr('vector.sourceHint')}</p>
              <textarea aria-label={tr('vector.sourceEditor')} spellCheck={false} value={sourceDraft}
                onChange={e=>setSourceDraft(e.target.value)} rows={9} />
              <Button size="sm" onClick={applySource}>{tr('vector.applySource')}</Button>
            </div> : null}
          </div>
          <div className="vs-properties-actions"><Button size="sm" variant="outline" onClick={()=>{const idx=project.items.findIndex(i=>i.id===selected);if(idx<project.items.length-1)commit(p=>({...p,items:[...p.items.slice(0,idx),...p.items.slice(idx+1,idx+2),p.items[idx],...p.items.slice(idx+2)]}));}}><ChevronUp/> {tr('vector.forward')}</Button>
          <Button size="sm" variant="outline" onClick={()=>{const idx=project.items.findIndex(i=>i.id===selected);if(idx>0)commit(p=>{const a=[...p.items];[a[idx-1],a[idx]]=[a[idx],a[idx-1]];return {...p,items:a};});}}><ChevronDown/> {tr('vector.backward')}</Button></div>
          <p className="vs-muted">{tr('vector.vectorNote')}</p>
        </div>:<div className="vs-properties"><p className="vs-muted">{tr('vector.emptySelect')}</p></div>}
        <div className="vs-inspector-title border-t border-border">{tr('vector.workflow')}</div><div className="vs-properties"><p className="vs-muted">{tr('vector.cadIndependent')}</p><p className="vs-muted">{tr('vector.projectNote')}</p></div>
      </aside>
    </div>
  </div>;
}
