import './generate-authoring.mjs';
import { fileURLToPath } from 'node:url';
import { syncTree } from './sync-tree.mjs';

const root = new URL('../', import.meta.url);
const at = (relative) => fileURLToPath(new URL(relative, root));
// Fixed folders inside the CLI package, packed through its "files" list. A normal build
// followed by parallel pack/init tests leaves identical copies untouched.
await syncTree(at('templates/project/'), at('packages/cli/templates/project/'));
// The editor build, once packages/web is built; an npm-installed CLI serves it from here.
await syncTree(at('packages/web/dist/'), at('packages/cli/web/'), { optional: true });
