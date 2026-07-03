import { useState, useCallback, useEffect } from 'react';

/** An externally-seeded input value. `token` changes on each seed so the same
 *  text can be applied more than once. */
export type InputDraft = { text: string; token: number } | null;

/** Owns externally-seeded chat-input text (e.g. the fork-message action). */
export function useInputDraft(): { inputDraft: InputDraft; seedInput: (text: string) => void } {
  const [inputDraft, setInputDraft] = useState<InputDraft>(null);
  const seedInput = useCallback((text: string) => setInputDraft({ text, token: Date.now() }), []);
  return { inputDraft, seedInput };
}

/** Applies a seeded draft to a text setter whenever the draft token changes. */
export function useApplyDraft(draft: InputDraft, apply: (text: string) => void): void {
  const token = draft?.token;
  useEffect(() => {
    if (token === undefined) return;
    apply(draft?.text ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
}
