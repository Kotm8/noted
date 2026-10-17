import { createContext, useContext } from "react";

export interface DesktopConnection {
  serverUrl: string;
  switchServer: () => Promise<void>;
}

export const DesktopConnectionContext = createContext<DesktopConnection | null>(null);
export const useDesktopConnection = () => useContext(DesktopConnectionContext);
export const isDesktop = import.meta.env.MODE === "desktop";
