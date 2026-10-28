import { readFileSync } from 'node:fs';
import path from 'node:path';

// Source and compiled server directories both sit two levels below the app root.
export const API_VERSION: string = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')
).version;
