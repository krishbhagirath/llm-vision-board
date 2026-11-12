import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'LLM Vision Board',
    description:
      'Branching, visual knowledge workspace for your ChatGPT conversations. Local-first: data stays in your browser.',
    // Minimum permissions:
    //  storage/unlimitedStorage – IndexedDB + session state for the request queue
    //  sidePanel – companion sidebar
    //  alarms – service-worker-safe request watchdog (no setTimeout reliance)
    //  scripting – inject the ChatGPT content script into tabs that were open before install
    permissions: ['storage', 'unlimitedStorage', 'sidePanel', 'alarms', 'scripting'],
    host_permissions: ['https://chatgpt.com/*'],
    action: {
      default_title: 'Open LLM Vision Board',
    },
    commands: {
      'open-board': {
        suggested_key: { default: 'Alt+Shift+B' },
        description: 'Open the full Vision Board',
      },
      'open-side-panel': {
        suggested_key: { default: 'Alt+Shift+V' },
        description: 'Open the Vision Board side panel',
      },
    },
  },
});
