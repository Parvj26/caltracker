import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// No incremental cache override: every page is dynamic (auth-gated), so nothing needs ISR storage.
export default defineCloudflareConfig();
