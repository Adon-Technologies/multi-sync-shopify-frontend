import { flatRoutes } from "@react-router/fs-routes";
import { route } from "@react-router/dev/routes";

// The optional section route shares one mounted page for /app and all six tabs.
const routes = await flatRoutes({ ignoredRouteFiles: ["**/app._index.tsx"] });

export default routes.map((entry) =>
  entry.file === "routes/app.tsx"
    ? {
        ...entry,
        children: [
          ...(entry.children ?? []),
          route(":section?", "routes/app._index.tsx"),
        ],
      }
    : entry,
);
