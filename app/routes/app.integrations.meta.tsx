import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { MetaConnectionSetup } from "../components/MetaConnectionSetup";
import { authenticateActiveAdmin } from "../shopify.server";
import styles from "../styles/dashboard.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateActiveAdmin(request);
  return { shop: session.shop, sessionId: session.id };
};
export default function MetaSetupRoute() {
  const scope = useLoaderData<typeof loader>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const done = () => {
    queryClient.removeQueries({
      queryKey: ["meta-integration", scope.shop, scope.sessionId],
    });
    void navigate(`/app/integrations${location.search}`);
  };
  return (
    <div className={styles.appViewport}>
      <div className={styles.panel}>
        <MetaConnectionSetup
          key={`${scope.shop}:${scope.sessionId}`}
          onDone={done}
        />
      </div>
    </div>
  );
}
