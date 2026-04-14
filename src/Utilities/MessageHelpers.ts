import {
  HORIZONTAL_LINE_MD,
  IMAGE_EMBED_MARKDOWN_REGEX,
  IMAGE_EMBED_WIKI_REGEX,
  IMAGE_EXTENSIONS,
  MARKDOWN_LINKS_REGEX,
  WIKI_LINKS_REGEX,
} from "src/Constants";

/**
 * Utility functions for message parsing and manipulation
 * These are simple, stateless functions that can be used anywhere
 */

/**
 * Determine whether a file path/title refers to an image based on its extension
 */
export function isImageFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Remove comments from message content
 * Comment blocks are delimited by =begin-chatgpt-md-comment and =end-chatgpt-md-comment
 */
export function removeCommentBlocks(message: string): string {
  const commentStart = "=begin-chatgpt-md-comment";
  const commentEnd = "=end-chatgpt-md-comment";

  const startIndex = message.indexOf(commentStart);
  if (startIndex === -1) return message;

  const endIndex = message.indexOf(commentEnd, startIndex);
  if (endIndex === -1) return message;

  return message.substring(0, startIndex) + message.substring(endIndex + commentEnd.length);
}

/**
 * Find all wiki links and markdown links in a message
 * Returns unique links with their titles, excluding http/https URLs and image embeds
 */
export function findLinksInMessage(message: string): { link: string; title: string }[] {
  const regexes = [
    { regex: WIKI_LINKS_REGEX, fullMatchIndex: 0, titleIndex: 1 },
    { regex: MARKDOWN_LINKS_REGEX, fullMatchIndex: 0, titleIndex: 2 },
  ];

  const links: { link: string; title: string }[] = [];
  const seenTitles = new Set<string>();

  for (const { regex, fullMatchIndex, titleIndex } of regexes) {
    for (const match of message.matchAll(regex)) {
      const fullLink = match[fullMatchIndex];
      let linkTitle = match[titleIndex];

      // For wiki links with aliases ([[file|alias]]), extract only the filename
      if (linkTitle && linkTitle.includes("|")) {
        linkTitle = linkTitle.split("|")[0].trim();
      }

      // Skip URLs that start with http:// or https://
      if (
        linkTitle &&
        !seenTitles.has(linkTitle) &&
        !linkTitle.startsWith("http://") &&
        !linkTitle.startsWith("https://") &&
        !isImageFile(linkTitle)
      ) {
        links.push({ link: fullLink, title: linkTitle });
        seenTitles.add(linkTitle);
      }
    }
  }

  return links;
}

/**
 * Find all image embeds in a message (both ![[image.png]] and ![alt](image.png) syntax)
 * Returns unique embeds with their embed text and resolved title
 */
export function findImageEmbedsInMessage(message: string): { embedText: string; title: string }[] {
  const embeds: { embedText: string; title: string }[] = [];
  const seenTitles = new Set<string>();

  // Match ![[filename.ext]] style (Obsidian wiki image embeds)
  for (const match of message.matchAll(IMAGE_EMBED_WIKI_REGEX)) {
    const embedText = match[0];
    let title = match[1];

    // Handle display size suffix: ![[image.png|400]]
    // The size parameter is an Obsidian display directive and is intentionally discarded.
    if (title.includes("|")) {
      title = title.split("|")[0].trim();
    }

    if (title && isImageFile(title) && !seenTitles.has(title)) {
      embeds.push({ embedText, title });
      seenTitles.add(title);
    }
  }

  // Match ![alt](path.ext) style (Markdown image embeds)
  for (const match of message.matchAll(IMAGE_EMBED_MARKDOWN_REGEX)) {
    const embedText = match[0];
    const title = match[2]; // path is in capture group 2

    if (
      title &&
      isImageFile(title) &&
      !seenTitles.has(title) &&
      !title.startsWith("http://") &&
      !title.startsWith("https://")
    ) {
      embeds.push({ embedText, title });
      seenTitles.add(title);
    }
  }

  return embeds;
}

/**
 * Split text into messages based on horizontal line separator
 */
export function splitMessages(text: string | undefined): string[] {
  return text ? text.split(HORIZONTAL_LINE_MD) : [];
}

/**
 * Remove YAML frontmatter from text
 * Re-exported from YamlHelpers for backward compatibility
 */
export { removeYAMLFrontMatter } from "./YamlHelpers";
