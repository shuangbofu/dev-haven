import GithubSlugger from 'github-slugger';
import { toString } from 'mdast-util-to-string';
import type { Root } from 'mdast';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

export type MarkdownHeading = { id: string; text: string; depth: number };

function collectHeadings(tree: Root): MarkdownHeading[] {
  const slugger = new GithubSlugger();
  const headings: MarkdownHeading[] = [];
  visit(tree, 'heading', node => {
    const text = toString(node);
    const id = `md-${slugger.slug(text)}`;
    node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
    headings.push({ id, text: text || '未命名章节', depth: node.depth });
  });
  return headings;
}

export function markdownHeadings(source: string) {
  return collectHeadings(unified().use(remarkParse).use(remarkGfm).parse(source));
}

export function remarkHeadingIds() {
  return (tree: Root) => { collectHeadings(tree); };
}
