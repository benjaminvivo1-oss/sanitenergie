import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://chantierpilot.vercel.app',
  compressHTML: true,
  integrations: [sitemap()],
});
