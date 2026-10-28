// Match the main window's resolved preference, including System mode, without
// reading history or changing any recording state in the floating window.
export function syncOverlayTheme() {
  const query=window.matchMedia('(prefers-color-scheme: dark)');
  const apply=(theme:'light'|'dark')=>{if(theme==='light'||theme==='dark')document.documentElement.dataset.theme=theme;};
  const system=()=>apply(query.matches?'dark':'light');
  system();
  let active=true,received=false;
  const release=window.sargosh?.onWindowTheme?.(theme=>{received=true;if(active)apply(theme);});
  void window.sargosh?.windowTheme?.().then(theme=>{if(active&&!received)apply(theme);}).catch(()=>{});
  if(!release)query.addEventListener('change',system);
  return()=>{active=false;release?.();if(!release)query.removeEventListener('change',system);};
}
