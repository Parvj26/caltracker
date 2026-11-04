// Deno does not pick up @types packages on its own, so attach them here.
// The import map points `papaparse` at this shim.
// deno-lint-ignore-file no-import-prefix
// @ts-types="npm:@types/papaparse@5.5.2"
import Papa from 'npm:papaparse@5.7.0';

export default Papa;
