import { createContext, useContext } from "react";
import type { useSharedAssistant } from "./use-assistant";

export const AssistantContext = createContext<ReturnType<
  typeof useSharedAssistant
> | null>(null);
export function useAssistant() {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("Assistant provider is missing");
  return value;
}
/** For places that also render outside the workspace, such as tests. */
export function useOptionalAssistant() {
  return useContext(AssistantContext);
}
