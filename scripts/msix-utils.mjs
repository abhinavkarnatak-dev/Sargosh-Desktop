import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function storeVersion(version) {
  const parts = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!parts || parts.slice(1).some(part => Number(part) > 65535)) throw new Error('MSIX requires a numeric major.minor.patch version, each at most 65535.');
  return `${version}.0`;
}
function xml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}
export function manifest(identity, version) {
  for (const field of ['name', 'publisher', 'publisherDisplayName', 'displayName', 'applicationId', 'minVersion', 'maxVersionTested']) {
    if (typeof identity[field] !== 'string' || !identity[field].trim()) throw new Error(`Missing MSIX identity field: ${field}`);
  }
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identity.name) || !/^[A-Za-z][A-Za-z0-9.]*$/.test(identity.applicationId)) throw new Error('Invalid MSIX package or application name.');
  if (!/^CN=.+/.test(identity.publisher)) throw new Error('Use the exact Publisher value from Partner Center.');
  for (const value of [identity.minVersion, identity.maxVersionTested]) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(value) || value.split('.').some(part => Number(part) > 65535)) throw new Error('Invalid Windows target version.');
  }
  const config = Object.fromEntries(Object.entries(identity).map(([key, value]) => [key, xml(value)]));
  return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap rescap">
 <Identity Name="${config.name}" Publisher="${config.publisher}" Version="${storeVersion(version)}" ProcessorArchitecture="x64" />
 <Properties>
  <DisplayName>${config.displayName}</DisplayName>
  <PublisherDisplayName>${config.publisherDisplayName}</PublisherDisplayName>
  <Description>Speak naturally and turn your voice into text across Windows apps.</Description>
  <Logo>StoreAssets\\StoreLogo.png</Logo>
 </Properties>
 <Resources><Resource Language="en-us" /></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="${config.minVersion}" MaxVersionTested="${config.maxVersionTested}" /></Dependencies>
 <Applications>
  <Application Id="${config.applicationId}" Executable="app\\Sargosh.exe" EntryPoint="Windows.FullTrustApplication">
   <uap:VisualElements DisplayName="${config.displayName}" Description="Voice dictation for Windows" BackgroundColor="#191b19"
    Square150x150Logo="StoreAssets\\Square150x150Logo.png" Square44x44Logo="StoreAssets\\Square44x44Logo.png" />
  </Application>
 </Applications>
 <Capabilities>
  <Capability Name="internetClient" />
  <rescap:Capability Name="runFullTrust" />
  <DeviceCapability Name="microphone" />
 </Capabilities>
</Package>
`;
}
export function payloadFiles(root) {
  const result = [];
  function visit(directory) {
    for (const entry of readdirSync(directory)) {
      const filename = path.join(directory, entry);
      const info = lstatSync(filename);
      if (info.isSymbolicLink()) throw new Error('Links are not allowed in the MSIX payload: ' + filename);
      if (/^(?:\.env(?:\..*)?|\.git|\.codex|\.agents|\.claude|AGENTS\.md|CLAUDE\.md|squirrel\.exe|update\.exe|.*ExecutionStub\.exe)$/i.test(entry)) throw new Error('Unexpected private or installer file in MSIX payload: ' + filename);
      if (info.isDirectory()) visit(filename);
      else if (info.isFile()) result.push(path.relative(root, filename));
      else throw new Error('Unsupported payload entry: ' + filename);
    }
  }
  visit(root);
  return result.sort();
}
export function assertPayloadMatches(source, destination) {
  const sourceFiles = payloadFiles(source);
  const destinationFiles = payloadFiles(destination);
  if (JSON.stringify(sourceFiles) !== JSON.stringify(destinationFiles)) throw new Error('MSIX app file list differs from the verified Electron package.');
  for (const filename of sourceFiles) {
    const digest = root => createHash('sha256').update(readFileSync(path.join(root, filename))).digest('hex');
    if (digest(source) !== digest(destination)) throw new Error('MSIX payload mismatch: ' + filename);
  }
  return sourceFiles.length;
}