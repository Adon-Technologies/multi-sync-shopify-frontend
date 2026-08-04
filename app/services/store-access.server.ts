import prisma from "../db.server";
import { normalizeShopDomain } from "./store-lifecycle";

export const STORE_SUSPENDED_MESSAGE =
  "This store has been suspended. Contact support for assistance.";

export async function assertStoreAccessAllowed(shop: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain: normalizeShopDomain(shop) },
    select: {
      accessStatus: true,
      status: true,
    },
  });

  if (store?.accessStatus === "SUSPENDED") {
    throw Response.json(
      {
        code: "STORE_SUSPENDED",
        error: STORE_SUSPENDED_MESSAGE,
        message: STORE_SUSPENDED_MESSAGE,
        ok: false,
      },
      { status: 403 },
    );
  }

  return store;
}
