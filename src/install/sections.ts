/**
 * Idempotently update or append a graphify-owned section in shared files.
 *
 * If `marker` is not in `content`, append `newSection` to the end
 * (with a blank-line separator if there's existing content).
 *
 * If `marker` IS in `content`, replace the existing section in place.
 * The section runs from the first line containing `marker` to the line
 * before the next H2 heading (`## ` at line start), or to EOF if no later
 * H2 exists.
 */
export function replaceOrAppendSection(
  content: string,
  marker: string,
  newSection: string
): string {
  if (!content.includes(marker)) {
    if (content.trim()) {
      return content.trimEnd() + "\n\n" + newSection.trimStart();
    }
    return newSection.trimStart();
  }

  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.includes(marker));
  if (start === -1) {
    return content.trimEnd() + "\n\n" + newSection.trimStart();
  }

  let end = lines.length;
  for (let j = start + 1; j < lines.length; j++) {
    if (lines[j].startsWith("## ")) {
      end = j;
      break;
    }
  }

  const head = lines.slice(0, start).join("\n").trimEnd();
  const tail = lines.slice(end).join("\n").trimStart();
  const section = newSection.trim();

  const parts: string[] = [];
  if (head) parts.push(head);
  parts.push(section);
  if (tail) parts.push(tail);
  let out = parts.join("\n\n");
  if (!out.endsWith("\n")) out += "\n";
  return out;
}
