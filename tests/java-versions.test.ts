import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { EnvironmentService } from '../electron/service';

test('Java offers stable Temurin JDKs, excludes JREs, and sorts by numeric version', async () => {
  const service = new EnvironmentService(path.join(os.tmpdir(), 'devhaven-java-versions'));
  service.engine.exec = async () => [
    'temurin-jre-26.0.2+9', 'temurin-21.0.8+9', 'temurin-25.0.1+8',
    'temurin-17.0.16+8', 'temurin-26.0.0-rc1', 'zulu-21.0.8',
  ].join('\n');
  assert.deepEqual(await service.versions('java'), ['temurin-25.0.1+8', 'temurin-21.0.8+9', 'temurin-17.0.16+8']);
});
