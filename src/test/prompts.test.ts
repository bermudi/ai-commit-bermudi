import { strict as assert } from 'assert';
import { getMainCommitPrompt } from '../prompts';
import { ConfigKeys } from '../config';
import { installMockConfig } from './helpers/mock-config';

describe('getMainCommitPrompt', () => {
  let cfg: ReturnType<typeof installMockConfig>;

  beforeEach(() => {
    cfg = installMockConfig();
  });

  afterEach(() => {
    cfg.restore();
  });

  describe('scoped commits template (default)', () => {
    it('returns a single system message', async () => {
      const prompts = await getMainCommitPrompt();
      assert.equal(prompts.length, 1);
      assert.equal(prompts[0].role, 'system');
      assert.equal(typeof prompts[0].content, 'string');
    });

    it('embeds the language from configuration in the standard header', async () => {
      cfg.set(ConfigKeys.AI_COMMIT_LANGUAGE, 'Japanese');
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      assert.match(content, /in Japanese/);
      assert.match(content, /Scoped Commit/);
    });

    it('includes the canonical Scoped Commits spec body when no custom prompt is set', async () => {
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      // The spec file is loaded as a string and concatenated to the header.
      // We assert on stable strings that are part of the canonical spec.
      assert.match(content, /<scope>:/);
      assert.match(content, /Imperative present tense/);
      assert.match(content, /Refs:/);
      assert.match(content, /BREAKING CHANGE:/);
    });

    it('replaces the default language with a different configured language', async () => {
      cfg.set(ConfigKeys.AI_COMMIT_LANGUAGE, 'Deutsch');
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      assert.match(content, /in Deutsch/);
      assert.doesNotMatch(content, /in English/);
    });

    it('handles whitespace-only language values without throwing', async () => {
      cfg.set(ConfigKeys.AI_COMMIT_LANGUAGE, '   ');
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      assert.match(content, /in {3}/);
    });
  });

  describe('system prompt override', () => {
    it('replaces the default scoped-commits template with the custom prompt', async () => {
      cfg.set(ConfigKeys.SYSTEM_PROMPT, 'You are a custom commit assistant.');
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      assert.equal(content, 'You are a custom commit assistant.');
      // The canonical spec body should NOT appear when the user has overridden it.
      assert.doesNotMatch(content, /<scope>:/);
      assert.doesNotMatch(content, /Imperative present tense/);
    });

    it('treats whitespace-only custom prompts as no override (falls back to default)', async () => {
      cfg.set(ConfigKeys.SYSTEM_PROMPT, '   \n\t  ');
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      // Falls back to the canonical template.
      assert.match(content, /<scope>:/);
      assert.match(content, /Scoped Commit/);
    });

    it('preserves the custom prompt exactly (no header prefixing)', async () => {
      const custom = 'Write commit messages in haiku form.';
      cfg.set(ConfigKeys.SYSTEM_PROMPT, custom);
      const prompts = await getMainCommitPrompt();
      assert.equal(prompts[0].content, custom);
    });
  });

  describe('system prompt append', () => {
    it('appends to the default scoped-commits template when no custom prompt is set', async () => {
      cfg.set(ConfigKeys.SYSTEM_APPEND, 'Always mention the ticket ID.');
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      assert.match(content, /<scope>:/);
      assert.match(
        content,
        /Always mention the ticket ID\./
      );
      // The append should come after the canonical body.
      const bodyIndex = content.indexOf('Imperative present tense');
      const appendIndex = content.indexOf('Always mention the ticket ID.');
      assert.ok(bodyIndex > -1 && appendIndex > -1, 'expected body and append to be present');
      assert.ok(appendIndex > bodyIndex, 'append should follow the canonical body');
    });

    it('appends to the custom prompt when both are set', async () => {
      cfg.set(ConfigKeys.SYSTEM_PROMPT, 'You are a custom commit assistant.');
      cfg.set(ConfigKeys.SYSTEM_APPEND, 'Use formal language.');
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      assert.equal(
        content,
        'You are a custom commit assistant.\n\nUse formal language.'
      );
    });

    it('does not append when the append value is whitespace-only', async () => {
      cfg.set(ConfigKeys.SYSTEM_APPEND, '   \n  ');
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      // No trailing whitespace separator injected; the content ends with the canonical body.
      assert.doesNotMatch(content, /\n\n\s*$/);
      assert.match(content, /Imperative present tense/);
    });

    it('preserves multi-line append text verbatim', async () => {
      const append = 'Rules:\n- one scope\n- lowercase\n- no period';
      cfg.set(ConfigKeys.SYSTEM_APPEND, append);
      const prompts = await getMainCommitPrompt();
      const content = prompts[0].content as string;
      assert.ok(content.endsWith(append), 'append should be at the end of the prompt');
    });
  });

  describe('caching behavior', () => {
    it('returns the same system message structure across multiple calls', async () => {
      const first = await getMainCommitPrompt();
      const second = await getMainCommitPrompt();
      // The spec is cached at the module level; both calls should return the
      // same canonical body, and the structure (single system message) is stable.
      assert.equal(first.length, 1);
      assert.equal(second.length, 1);
      assert.equal(first[0].role, 'system');
      assert.equal(second[0].role, 'system');
    });

    it('reflects config changes between calls (ConfigurationManager caches at the config layer)', async () => {
      const first = await getMainCommitPrompt();
      assert.match(first[0].content as string, /in English/);

      cfg.set(ConfigKeys.AI_COMMIT_LANGUAGE, 'Français');
      const second = await getMainCommitPrompt();
      assert.match(second[0].content as string, /in Français/);
    });
  });
});
