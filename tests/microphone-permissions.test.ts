import { expect, it } from 'vitest';
import { microphoneCheck, microphoneRequest } from '../src/main/microphone-permissions';
const installed = 'file:///C:/Users/Test/AppData/Local/Sargosh/resources/app.asar/dist/renderer/index.html';
const development = 'http://127.0.0.1:5173/';
const trusted = (url: string) => [installed, development].includes(url.split('#')[0]);
for (const url of [installed, development]) {
  it('allows audio discovery and capture from the trusted main document: ' + new URL(url).protocol, () => {
    expect(microphoneCheck(url, 'media', {isMainFrame:true,requestingUrl:url,mediaType:'audio'}, trusted)).toBe(true);
    expect(microphoneRequest(url, 'media', {isMainFrame:true,requestingUrl:url,mediaTypes:['audio']}, trusted)).toBe(true);
  });
}
it('rejects arbitrary local files, remote documents, subframes, and missing document identities', () => {
  for (const requestingUrl of ['file:///C:/untrusted.html', 'https://example.com/', undefined]) {
    expect(microphoneCheck(installed,'media',{isMainFrame:true,requestingUrl,mediaType:'audio'},trusted)).toBe(false);
    expect(microphoneRequest(installed,'media',{isMainFrame:true,requestingUrl,mediaTypes:['audio']},trusted)).toBe(false);
  }
  expect(microphoneCheck(undefined,'media',{isMainFrame:true,requestingUrl:installed,mediaType:'audio'},trusted)).toBe(false);
  expect(microphoneCheck('file:///C:/other.html','media',{isMainFrame:true,requestingUrl:installed,mediaType:'audio'},trusted)).toBe(false);
  expect(microphoneCheck(installed,'media',{isMainFrame:false,requestingUrl:installed,mediaType:'audio'},trusted)).toBe(false);
  expect(microphoneRequest(installed,'media',{isMainFrame:false,requestingUrl:installed,mediaTypes:['audio']},trusted)).toBe(false);
});
it('denies camera, unknown media, mixed camera/mic requests, and unrelated permissions', () => {
  for (const mediaType of ['video','unknown',undefined]) expect(microphoneCheck(installed,'media',{isMainFrame:true,requestingUrl:installed,mediaType},trusted)).toBe(false);
  for (const mediaTypes of [['video'],['audio','video'],[],undefined]) expect(microphoneRequest(installed,'media',{isMainFrame:true,requestingUrl:installed,mediaTypes},trusted)).toBe(false);
  expect(microphoneCheck(installed,'geolocation',{isMainFrame:true,requestingUrl:installed,mediaType:'audio'},trusted)).toBe(false);
});
