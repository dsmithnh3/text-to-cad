const blockedElements = new Set(['script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'image', 'animate', 'animatetransform', 'set']);
const resourceAttributes = new Set(['fill', 'stroke', 'filter', 'clip-path', 'mask']);
const localUrl = /^url\(\s*['"]?#([A-Za-z_][\w:.-]*)['"]?\s*\)$/;
const localHref = /^#([A-Za-z_][\w:.-]*)$/;

export function sanitizeSvg(input: string): string {
  if (input.length > 2_000_000) throw Error('SVG exceeds 2 MB asset limit');
  const parsed = new DOMParser().parseFromString(input, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw Error('Invalid SVG XML');
  const root = parsed.documentElement;
  if (root.localName.toLowerCase() !== 'svg') throw Error('Expected an SVG root');
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (blockedElements.has(element.localName.toLowerCase())) element.remove();
  }
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  const declared = new Set<string>();
  for (const element of elements) {
    if (!element.id) continue;
    if (declared.has(element.id)) throw Error(`Duplicate SVG id: ${element.id}`);
    declared.add(element.id);
  }
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const key = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (key.startsWith('on') || key === 'style') {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (key === 'href' || key === 'xlink:href') {
        const target = localHref.exec(value)?.[1];
        if (!target || !declared.has(target)) element.removeAttribute(attribute.name);
        continue;
      }
      if (/javascript\s*:|data\s*:/i.test(value)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (resourceAttributes.has(key) && /url\s*\(/i.test(value)) {
        const target = localUrl.exec(value)?.[1];
        if (!target || !declared.has(target)) element.removeAttribute(attribute.name);
      }
    }
  }
  if (!root.hasAttribute('viewBox')) {
    const width = Number(root.getAttribute('width')) || 200;
    const height = Number(root.getAttribute('height')) || 150;
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  return new XMLSerializer().serializeToString(root);
}

export function isolateSvg(xml: string, suffix: string): string {
  const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
  const root = doc.documentElement;
  const ids = Array.from(root.querySelectorAll('[id]'));
  const mapping = new Map(ids.map(node => [node.id, `${suffix}-${node.id}`]));
  for (const node of ids) node.id = mapping.get(node.id)!;
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const href = localHref.exec(attribute.value.trim());
      if (href && mapping.has(href[1])) {
        element.setAttribute(attribute.name, `#${mapping.get(href[1])}`);
        continue;
      }
      const resource = localUrl.exec(attribute.value.trim());
      if (resource && mapping.has(resource[1])) element.setAttribute(attribute.name, `url(#${mapping.get(resource[1])})`);
    }
  }
  return new XMLSerializer().serializeToString(root);
}
