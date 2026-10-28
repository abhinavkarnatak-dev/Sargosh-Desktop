import koffi from 'koffi';
export function registerStoreRestart(){
  const kernel=koffi.load('kernel32.dll');
  const register=kernel.func('int32_t __stdcall RegisterApplicationRestart(const char16_t *arguments, uint32_t flags)');
  // Restart for updates, not for crashes or hangs. Register the Electron main process,
  // never the native bridge that Windows may terminate with the rest of the package.
  if(register('',3)<0)throw new Error('Windows could not register the update restart.');
}
