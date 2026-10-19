import {
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
} from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./code-block";
import { taskListPositions } from "../task-list";

interface MarkdownProps {
  content: string;
  onContentChange?: (content: string) => void;
  pending?: boolean;
}

const TaskSettings = createContext<MarkdownProps>({ content: "" });
const TaskPosition = createContext<{ offset: number; label: string } | null>(
  null,
);

function TaskItem({
  node,
  children,
  ...props
}: ComponentPropsWithoutRef<"li"> & ExtraProps) {
  const offset = node?.properties["data-task-offset"];
  const position =
    typeof offset === "number"
      ? { offset, label: String(node?.properties["data-task-label"] || "Task") }
      : null;
  return (
    <TaskPosition.Provider value={position}>
      <li {...props}>{children}</li>
    </TaskPosition.Provider>
  );
}

function TaskInput({
  node,
  ...props
}: ComponentPropsWithoutRef<"input"> & ExtraProps) {
  const position = useContext(TaskPosition);
  const { content, onContentChange, pending } = useContext(TaskSettings);
  if (
    node?.tagName !== "input" ||
    props.type !== "checkbox" ||
    !position ||
    !onContentChange
  )
    return <input {...props} />;
  return (
    <input
      {...props}
      disabled={pending}
      aria-label={position.label}
      onChange={(event) => {
        const next =
          content.slice(0, position.offset) +
          (event.target.checked ? "x" : " ") +
          content.slice(position.offset + 1);
        onContentChange(next);
      }}
    />
  );
}

export function Markdown({ content, onContentChange, pending }: MarkdownProps) {
  return (
    <TaskSettings.Provider value={{ content, onContentChange, pending }}>
      <div className="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, taskListPositions]}
          rehypePlugins={[rehypeHighlight]}
          skipHtml
          components={{
            li: TaskItem,
            input: TaskInput,
            pre: ({ children, className }) => (
              <CodeBlock className={className}>{children}</CodeBlock>
            ),
            a: ({ children, href, title }) => (
              <a
                href={href}
                title={title}
                target="_blank"
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ),
            img: ({ alt }) => (
              <span className="external-image">
                [Image: {alt || "external image"}]
              </span>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </TaskSettings.Provider>
  );
}
