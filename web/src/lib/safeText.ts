// Attacker-controlled strings (usernames, raw_message) are only ever rendered as
// React text nodes. This additionally makes invisible or direction-changing
// characters visible so they cannot disguise what the operator is reading.
// Built from escapes so the source file stays plain ASCII.
const INVISIBLE_SRC =
  "[\\u0000-\\u001F\\u007F-\\u009F\\u00AD\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2069\\uFEFF]";

export function visible(s: string): string {
  return s.replace(new RegExp(INVISIBLE_SRC, "g"), (ch) => `⟨U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}⟩`);
}

export function hasInvisible(s: string): boolean {
  return new RegExp(INVISIBLE_SRC).test(s);
}
