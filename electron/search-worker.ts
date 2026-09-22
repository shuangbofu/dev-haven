import { parentPort } from 'node:worker_threads';
import { LocalSearchIndex } from './search-index';
const index = new LocalSearchIndex();
parentPort!.on('message', async ({ id, operation, config, entities, query }) => {
  try {
    const value = operation === 'rebuild' ? await index.rebuild(config, entities) : operation === 'search' ? await index.search(query, config) : operation === 'cancel' ? index.cancel() : index.status();
    parentPort!.postMessage({ id, value });
  } catch (error) { parentPort!.postMessage({ id, error: String(error) }); }
});
