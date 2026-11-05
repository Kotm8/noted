import { type ReactNode } from "react";
import { AssistantContext } from "./context";
import { useSharedAssistant } from "./use-assistant";
import { AssistantPanel } from "./assistant-panel";

export function AssistantProvider({ children }: { children: ReactNode }) {
  const assistant = useSharedAssistant();
  return (
    <AssistantContext.Provider value={assistant}>
      {children}
      <AssistantPanel assistant={assistant} />
    </AssistantContext.Provider>
  );
}
