// @ts-check

const ADMIN_PROMPT = `You are editing a Slidev deck as an admin. You may change content, theme code, layouts, components, and dependency metadata inside the deck root. Keep changes scoped to the deck.`;
const MEMBER_PROMPT = `You are editing a Slidev deck as an employee. You may improve story, copy, slide structure, assets, frontmatter, and layout usage. Do not alter theme code, package metadata, or build configuration.`;

/**
 * Central role policy for agent model/tool/path access.
 *
 * @param {'admin'|'member'} role
 * @param {{ id: string, fs_path?: string }} deck
 */
export function getAgentConfig(role, deck) {
  if (role === 'admin') {
    return {
      modelName: process.env.ADMIN_AGENT_MODEL ?? 'claude-opus-4-8',
      systemPrompt: `${ADMIN_PROMPT}\nDeck id: ${deck.id}`,
      permissions: {
        read: ['**'],
        write: ['**'],
        deny: [],
      },
      toolNames: [
        'addAsset',
        'listLayouts',
        'listComponents',
        'applyFrontmatter',
        'screenshotSlide',
        'addDependency',
        'restartSlidev',
        'createComponent',
        'createLayout',
      ],
    };
  }

  return {
    modelName: process.env.MEMBER_AGENT_MODEL ?? 'claude-sonnet-4-6',
    systemPrompt: `${MEMBER_PROMPT}\nDeck id: ${deck.id}`,
    permissions: {
      read: ['**'],
      write: ['slides.md', 'public/**', 'assets/**', 'slides/*.md'],
      deny: ['theme/**', 'package.json', 'package-lock.json', 'setup/**', 'vite.config.*', '**/*.vue', '.*', '**/.*'],
    },
    toolNames: ['addAsset', 'listLayouts', 'listComponents', 'applyFrontmatter', 'screenshotSlide'],
  };
}

export const MEMBER_WRITE_DENY = ['theme/**', 'package.json', 'package-lock.json', 'setup/**', 'vite.config.*', '**/*.vue', '.*', '**/.*'];

