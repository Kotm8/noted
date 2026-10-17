import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./code-block";

export function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        components={{
          pre: ({ children, className }) => <CodeBlock className={className}>{children}</CodeBlock>,
          a: ({ children, href, title }) => (
            <a href={href} title={title} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="external-image">[Image: {alt || "external image"}]</span>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
