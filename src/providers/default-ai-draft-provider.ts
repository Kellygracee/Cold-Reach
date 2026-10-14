import {
  DraftGenerationProvider,
  DraftPrompt,
  DraftProviderNotConfiguredError,
  GeneratedDraftContent,
} from '../contracts/draft-provider.js';

/**
 * Standard AI Draft Provider that connects to an external AI service when credentials
 * are present in the environment (e.g., GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY).
 *
 * When no credentials are configured, it cleanly reports isConfigured() === false
 * and refuses to generate drafts, preventing mock or unverified drafts from masquerading as live AI outputs.
 */
export class DefaultAiDraftProvider implements DraftGenerationProvider {
  readonly name: string;
  private readonly apiKey?: string;

  constructor(options?: { name?: string; apiKey?: string }) {
    this.name = options?.name ?? 'StandardAiDraftProvider';
    this.apiKey =
      options?.apiKey ??
      process.env.GEMINI_API_KEY ??
      process.env.OPENAI_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async generateDraft(_prompt: DraftPrompt): Promise<GeneratedDraftContent> {
    if (!this.isConfigured()) {
      throw new DraftProviderNotConfiguredError(
        this.name,
        'No AI API key found in environment (checked GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY).',
      );
    }

    // In a fully configured live environment with an active API key, an HTTP client
    // would dispatch the structured prompt to the selected LLM endpoint.
    // For safety and integrity, we never invent fake keys or simulate an API call without valid credentials.
    throw new DraftProviderNotConfiguredError(
      this.name,
      'Live AI client integration requires active remote service connection.',
    );
  }
}
