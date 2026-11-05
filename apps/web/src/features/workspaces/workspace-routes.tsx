import { AssistantProvider } from "../ai/assistant/assistant-provider";
import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
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

const ScheduleRoute = lazy(() =>
  import("./routes/schedule-route").then((module) => ({
    default: module.ScheduleRoute,
  })),
);

export function WorkspaceRoutes() {
  return (
    <Routes>
      <Route
        element={
          <AssistantProvider>
            <WorkspaceShell />
          </AssistantProvider>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="home" element={<HomeRoute />} />
        <Route path="schedule" element={<ScheduleRoute />} />
        <Route path="habits" element={<HabitsPage />} />
        <Route path="nutrition" element={<NutritionPage />} />
        <Route path="w/:workspaceId" element={<ChannelRoute />} />
        <Route path="w/:workspaceId/c/:channelId" element={<ChannelRoute />} />
        {/* Unknown paths redirect to the last workspace from the navigation hook. */}
        <Route path="*" element={<ChannelRoute />} />
      </Route>
    </Routes>
  );
}
