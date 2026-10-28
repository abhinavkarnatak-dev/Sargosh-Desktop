// Opt-in provider evaluation. Uses synthetic examples, never customer history.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { loadServerConfig } from '../src/server/config';
import { createCleanupProvider } from '../src/server/cleanup-provider';
import { CLEANUP_PROMPT_VERSION } from '../src/server/cleanup-prompt';
import type { SpeechLanguage } from '../src/shared/transcription';

const cases: { id: string; language: SpeechLanguage; input: string; expected: string; check: (text: string) => boolean }[] = [
  { id: 'corrections', language: 'en', input: "Let's meet on Tuesday... Sorry, Thursday at ten. Send the invite to Rahul. Actually, Neha.",
    expected: 'Thursday at ten/10; Neha. No Tuesday, Rahul or correction markers.',
    check: text => /Thursday/i.test(text) && /Neha/i.test(text) && !/Tuesday|Rahul|\bsorry\b|\bactually\b/i.test(text) },
  { id: 'grammar-fillers-negation', language: 'en', input: 'Um she have finished the report and uh we was planning to review it tomorrow. Please do not delete the backup.',
    expected: 'She has finished; we were planning. Keep do not delete the backup. Remove um/uh.',
    check: text => /she has finished/i.test(text) && /we were planning/i.test(text) && /do not delete the backup/i.test(text) && !/\bum\b|\buh\b|she have|we was/i.test(text) },
  { id: 'list-and-following-prose', language: 'en', input: 'We need these features audio playback transcript copy and recording export. Keep the interface simple.',
    expected: 'Three separate hyphen bullets, plus the final sentence.',
    check: text => text.split('\n').filter(line => /^\s*- /.test(line)).length === 3 && /audio playback/i.test(text) && /transcript copy/i.test(text) && /recording export/i.test(text) && /keep the interface simple/i.test(text) },
  { id: 'emails-and-link', language: 'en', input: 'Email jane dot doe at example dot org, copy Fixed.Name+tag@example.com with uppercase F and N, and open example dot com slash docs. I will be at the office at five.',
    expected: 'jane.doe@example.org, Fixed.Name+tag@example.com, example.com/docs. Keep at the office.',
    check: text => text.includes('jane.doe@example.org') && text.includes('Fixed.Name+tag@example.com') && text.includes('example.com/docs') && /at the office/i.test(text) && !/https?:/i.test(text) },
  { id: 'lowercase-emails', language: 'en', input: 'Send the report to Ananya dot Sharma at Example dot com and copy Ananya.Sharma@Example.com. Ask Ananya Sharma to open example.com/MyDocs.',
    expected: 'Both emails ananya.sharma@example.com; keep Ananya Sharma and URL path MyDocs.',
    check: text => (text.match(/ananya\.sharma@example\.com/g) ?? []).length === 2 && !text.includes('Ananya.Sharma@Example.com') && text.includes('Ananya Sharma') && text.includes('example.com/MyDocs') },
  { id: 'spoken-website', language: 'en', input: 'My portfolio is at Arjun Mehta dot com. Ask Arjun Mehta to open example.com/MyDocs. The dot on the screen is green.',
    expected: 'arjunmehta.com; preserve Arjun Mehta, MyDocs path case and ordinary word dot.',
    check: text => text.includes('arjunmehta.com') && text.includes('Arjun Mehta') && text.includes('example.com/MyDocs') && /dot on the screen/i.test(text) && !/https?:/i.test(text) },
  { id: 'website-correction', language: 'en', input: 'My portfolio is at Arnav Mehta dot com, sorry, Arjun Mehta dot com.',
    expected: 'arjunmehta.com, without rejected arnavmehta.com or correction marker.',
    check: text => text.includes('arjunmehta.com') && !/arnav|sorry/i.test(text) },
  { id: 'hinglish-steps-and-correction', language: 'multi', input: 'पहले settings खोलो फिर microphone select करो और फिर recording start करो। Meeting कल दस बजे, नहीं, ग्यारह बजे रखना।',
    expected: 'Latin-script Hinglish; three numbered steps; gyarah/11 instead of das/10.',
    check: text => !/[\u0900-\u097f]/.test(text) && text.split('\n').filter(line => /^\s*\d+[.)] /.test(line)).length === 3 && /gyarah|gyaarah|11/i.test(text) && !/\bdas\b|\bdus\b|\b10\b/i.test(text) }
];
async function main() {
  if (!process.argv.includes('--live')) throw new Error('LIVE_REQUIRED');
  const config = loadServerConfig();
  const cleanup = createCleanupProvider(config);
  if (!cleanup.configured) throw new Error('KEY_MISSING');
  const caseId = process.argv.find(value => value.startsWith('--case='))?.slice(7);
  const selectedCases = caseId ? cases.filter(test => test.id === caseId) : cases;
  if (!selectedCases.length) throw new Error('UNKNOWN_CASE');
  const results = [];
  console.log('Live cleanup evaluation - ' + cleanup.model + ' - ' + CLEANUP_PROMPT_VERSION);
  for (const test of selectedCases) {
    const start = performance.now();
    try {
      const result = await cleanup.clean({ text: test.input, language: test.language, signal: new AbortController().signal });
      const passed = test.check(result.text);
      const row = { id: test.id, passed, status: passed ? 'passed' : 'quality-failed', durationMs: Math.round(performance.now() - start), serviceTier: result.serviceTier, input: test.input, expected: test.expected, output: result.text };
      results.push(row); console.log(JSON.stringify(row));
    } catch (error) {
      const row = { id: test.id, passed: false, status: 'provider-failed', durationMs: Math.round(performance.now() - start), code: (error as { code?: string }).code ?? 'CHECK_FAILED' };
      results.push(row); console.log(JSON.stringify(row));
    }
    await delay(300);
  }
  const directory = path.resolve('.local/cleanup-evaluation');
  await mkdir(directory, { recursive: true });
  const passed = results.filter(result => result.passed).length;
  const qualityFailures = results.filter(result => result.status === 'quality-failed').length;
  const providerFailures = results.filter(result => result.status === 'provider-failed').length;
  const report = { provider: cleanup.provider, qualityFailures, providerFailures, model: cleanup.model, promptVersion: CLEANUP_PROMPT_VERSION, createdAt: new Date().toISOString(), passed, total: selectedCases.length, results };
  await writeFile(path.join(directory, 'latest.json'), JSON.stringify(report, null, 2));
  console.log('Passed ' + passed + '/' + selectedCases.length + ', quality failures: ' + qualityFailures + ', provider failures: ' + providerFailures + '. Report: ' + path.join(directory, 'latest.json'));
  if (passed !== selectedCases.length) process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof Error && ['LIVE_REQUIRED', 'KEY_MISSING'].includes(error.message) ? error.message : 'Evaluation could not start. Check the private backend configuration.'); process.exitCode = 1; });
