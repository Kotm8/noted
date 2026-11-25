import { AssistantProvider } from "../ai/assistant/assistant-provider";
import { lazy, useRef } from "react";
import { Route, Routes, useLocation, type Location } from "react-router-dom";
import { ChannelRoute } from "./routes/channel-route";
import { HomeRoute } from "./routes/home-route";
import { WorkspaceShell } from "./workspace-shell";

const HabitsPage = lazy(() =>
  import("../habits/habits-page").then((module) => ({
    default: module.HabitsPage,
  })),
);

const NutritionPage = lazy(() =>
  import("../nutrition/nutrition-page").then((module) => ({
    default: module.NutritionPage,
  })),
);

const FinancePage = lazy(() =>
  import("../finance/finance-page").then((module) => ({
    default: module.FinancePage,
  })),
);

const ScheduleRoute = lazy(() =>
  import("./routes/schedule-route").then((module) => ({
    default: module.ScheduleRoute,
  })),
);

export function WorkspaceRoutes() {
  const location = useLocation();
  const settingsPath = location.pathname.startsWith("/settings")
    ? location.pathname
    : null;
  const background = useRef<Location>({
    ...location,
    pathname: "/",
    search: "",
    hash: "",
  });
  if (!settingsPath) background.current = location;
  return (
    <Routes location={settingsPath ? background.current : location}>
      <Route
        element={
          <AssistantProvider>
            <WorkspaceShell settingsPath={settingsPath} />
          </AssistantProvider>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="home" element={<HomeRoute />} />
        <Route path="schedule" element={<ScheduleRoute />} />
        <Route
          path="habits"
          element={<HabitsPage key={background.current.search} />}
        />
        <Route path="nutrition" element={<NutritionPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="w/:workspaceId" element={<ChannelRoute />} />
        <Route path="w/:workspaceId/c/:channelId" element={<ChannelRoute />} />
        {/* Unknown paths redirect to the last workspace from the navigation hook. */}
        <Route path="*" element={<ChannelRoute />} />
      </Route>
    </Routes>
  );
}
