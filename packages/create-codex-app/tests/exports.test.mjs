import assert from 'node:assert/strict';
import test from 'node:test';
import { scaffoldProject } from '@codex-app-sdk/create-codex-app';

test('exports the programmatic scaffolder from the package root', () => {
  assert.equal(typeof scaffoldProject, 'function');
});
