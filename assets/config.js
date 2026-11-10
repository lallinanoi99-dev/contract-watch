// The one place to set contract addresses, the Worker URL and links.
// Leave `registry` empty to run in preview mode (watches saved in this browser; events still read live from BOT Chain).
export const CONFIG = {
  networks: {
    mainnet: {
      chainId: 677,
      name: 'BOT Chain',
      rpc: 'https://rpc.botchain.ai',
      explorer: 'https://scan.botchain.ai',
      registry: '0x505fc62244B7E490c463B0390492F19C97d51910', // WatchRegistry on BOT Chain mainnet (also in README + footer)
    },
    testnet: {
      chainId: 968,
      name: 'BOT Chain Testnet',
      rpc: 'https://rpc.bohr.life',
      explorer: 'https://scan.bohr.life',
      registry: '', // ← testnet address (used with ?net=testnet)
    },
  },
  // Shared Cloudflare Worker (cron + /watch/* routes). Empty → AI uses the built-in parser, alerts are off,
  // and the dashboard scans recent blocks in the browser.
  worker: '',
  telegramBot: 'ContractWatchBot',
  links: {
    botchain: 'https://botchain.ai',
    docs: 'https://botchain.ai/docs',
    faucet: 'https://faucet.bohr.life',
    x: 'https://x.com/BOTChain_ai',
  },
  storageKey: 'contractwatch',
};
