/**
 * Fills `${key}` placeholders in a URL template, URL-encoding each value. Unknown placeholders are
 * left as they are. Undefined if no template is configured.
 */
export function fillUrlTemplate(template: string | undefined, values: Record<string, string>): string | undefined {
  if (!template) return undefined;
  return template.replace(/\$\{(\w+)\}/g, (match, key: string) => (key in values ? encodeURIComponent(values[key]) : match));
}
