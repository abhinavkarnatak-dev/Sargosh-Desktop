// Hand-traced S silhouette. This path is never animated.
export const sPath = 'M251 118C203 118 171 147 171 190C171 231 195 245 238 252L269 258C295 263 308 279 308 307C308 336 285 355 251 355C224 355 204 341 194 320L169 328C182 361 212 380 251 380C299 380 330 350 330 307C330 264 307 244 268 237L236 231C208 226 194 216 194 190C194 161 219 141 251 141C278 141 297 157 307 181L329 172C317 139 289 118 251 118Z';

// Self-contained factory is also embedded in the browser sign-in completion page.
export function createLogoWavePaths() {
const smoothstep = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
// Fixed x samples prevent the curve folding or bunching up as it moves.
const wings = [
  { start:16, end:196, fromY:249, toY:243, crest:85, fadeIn:45, fadeOut:27 },
  { start:308, end:484, fromY:249, toY:249, crest:379, fadeIn:28, fadeOut:45 },
];
function curve(points: number[][]) {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0,i-1)], b = points[i], c = points[i+1], e = points[Math.min(points.length-1,i+2)];
    d += `C${(b[0]+(c[0]-a[0])/6).toFixed(2)} ${(b[1]+(c[1]-a[1])/6).toFixed(2)} ${(c[0]-(e[0]-b[0])/6).toFixed(2)} ${(c[1]-(e[1]-b[1])/6).toFixed(2)} ${c[0].toFixed(2)} ${c[1].toFixed(2)}`;
  }
  return d;
}
return function logoWavePaths(elapsed = 0) {
  // One full wavelength every 2.4 seconds, always travelling left to right.
  // Modulo wraps the phase at an identical shape and velocity, with no pause.
  const phase = ((elapsed % 2400) / 2400) * Math.PI * 2;
  return wings.map(wing => curve(Array.from({length:49}, (_, i) => {
    const u = i / 48;
    const x = wing.start + (wing.end-wing.start) * u;
    const baseline = wing.fromY + (wing.toY-wing.fromY) * u;
    const envelope = smoothstep((x-wing.start)/wing.fadeIn) * smoothstep((wing.end-x)/wing.fadeOut);
    const y = baseline - 38 * envelope * Math.cos((x-wing.crest) / 70 * Math.PI * 2 - phase);
    return [x,y];
  })));
}
}
export const logoWavePaths = createLogoWavePaths();
