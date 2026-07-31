/**
 * Template rendering. Variables: {username} {comment_text} {message_text}
 * {post_caption} {link:key}. link resolves against BotProfile.linksJson —
 * keeping URLs out of free text means the AI guard can whitelist them.
 * Unknown variables/links render empty and are reported in missingKeys so
 * the activity log can flag a misconfigured template.
 */

export interface RenderResult {
  text: string;
  missingKeys: string[];
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
  links: Record<string, string>,
): RenderResult {
  const missing: string[] = [];
  const text = template.replace(
    /\{([a-zA-Z_]+)(?::([^}]+))?\}/g,
    (_whole, name: string, key?: string) => {
      if (name === "link") {
        const k = (key ?? "").trim();
        const url = links[k];
        if (!url) {
          missing.push(`link:${k}`);
          return "";
        }
        return url;
      }
      if (name in vars) return vars[name];
      missing.push(name);
      return "";
    },
  );
  return { text: text.replace(/[ \t]+\n/g, "\n").trim(), missingKeys: missing };
}
