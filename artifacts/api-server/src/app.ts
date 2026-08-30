import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import { attachPrincipal } from "./middlewares/principal";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// @clerk/express v1 resolves the managed Clerk keys from its environment.
// Its supported API accepts an options object, not the per-request callback
// used by newer SDK templates.
app.use(clerkMiddleware());
app.use(attachPrincipal);

app.use("/api", router);

export default app;
