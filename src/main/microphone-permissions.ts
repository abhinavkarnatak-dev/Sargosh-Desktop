interface FrameDetails { isMainFrame: boolean; requestingUrl?: string }
function trustedFrame(contentsUrl: string | undefined, details: FrameDetails, trusted: (url: string) => boolean) {
  return Boolean(contentsUrl && trusted(contentsUrl) && details.isMainFrame && details.requestingUrl && trusted(details.requestingUrl));
}
export function microphoneCheck(contentsUrl: string | undefined, permission: string, details: FrameDetails & { mediaType?: string }, trusted: (url: string) => boolean) {
  // A file origin is serialized as file:// rather than the full installed page URL.
  // Trust the actual requesting main-frame document, never every file origin.
  return permission === 'media' && details.mediaType === 'audio' && trustedFrame(contentsUrl, details, trusted);
}
export function microphoneRequest(contentsUrl: string | undefined, permission: string, details: FrameDetails & { mediaTypes?: string[] }, trusted: (url: string) => boolean) {
  const types = details.mediaTypes ?? [];
  return permission === 'media' && types.length > 0 && types.every(type => type === 'audio') && trustedFrame(contentsUrl, details, trusted);
}
